using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

public record PrepareRequest(int? DeadlineSeconds);
public record ReadyRequest(string Action);

public static class RollEndpoints
{
    public static void MapRollEndpoints(this IEndpointRouteBuilder app)
    {
        // 开启准备环节（仅小队长）。deadlineSeconds 为空表示不设最晚结束时间。
        app.MapPost("/api/groups/{id:long}/prepare", async (
            long id,
            PrepareRequest? req,
            HttpContext ctx,
            RollDbContext db,
            NotificationService notify,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            // 注意：这里必须 AsNoTracking，否则后续 ExecuteUpdate 之后
            // 一旦触发 SaveChanges 会把过期实体写回数据库。
            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.OwnerId != uid) throw ApiException.Forbidden("只有小队长可以开启随机");

            var seconds = req?.DeadlineSeconds;
            if (seconds is <= 0) seconds = null;
            if (seconds > Limits.MaxPrepareSeconds)
                throw ApiException.BadRequest($"准备时间最长 {Limits.MaxPrepareSeconds} 秒");

            var optionCount = await db.Options.AsNoTracking().CountAsync(o => o.GroupId == id, ct);
            if (optionCount == 0) throw ApiException.BadRequest("请先添加备选项");

            var now = DateTimeOffset.UtcNow;
            var deadline = seconds.HasValue ? now.AddSeconds(seconds.Value) : (DateTimeOffset?)null;

            var moved = await db.Groups
                .Where(g => g.Id == id && g.Stage == Stages.Config)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(g => g.Stage, Stages.Preparing)
                    .SetProperty(g => g.PrepStartedAt, (DateTimeOffset?)now)
                    .SetProperty(g => g.PrepDeadline, deadline)
                    .SetProperty(g => g.ResultOptionId, (long?)null)
                    .SetProperty(g => g.ResultAt, (DateTimeOffset?)null), ct);

            if (moved == 0) throw ApiException.BadRequest("当前阶段不能开启随机，请刷新后再试");

            await db.Members.Where(m => m.GroupId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.Ready, ReadyStates.None), ct);

            var others = await db.Members.AsNoTracking()
                .Where(m => m.GroupId == id && m.UserId != uid)
                .Select(m => m.UserId)
                .ToListAsync(ct);

            await notify.PushManyAsync(others, id, group.Theme, NotificationTypes.Prepare,
                "小队长已开启随机，请确认准备完毕", ct);

            return Results.Json(new
            {
                ok = true,
                stage = Stages.Preparing,
                prepDeadline = deadline?.ToUnixTimeMilliseconds()
            });
        }).WithTags("随机");

        // 准备环节的「确定 / 取消」
        app.MapPost("/api/groups/{id:long}/ready", async (
            long id,
            ReadyRequest req,
            HttpContext ctx,
            RollDbContext db,
            StageEngine engine,
            NotificationService notify,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var member = await db.Members.AsNoTracking()
                .FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == uid, ct)
                ?? throw ApiException.Forbidden("你还不是该小队成员");

            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.Stage != Stages.Preparing)
                throw ApiException.BadRequest("当前不在准备环节");

            var action = (req.Action ?? string.Empty).Trim().ToLowerInvariant();

            if (action == "confirm")
            {
                await db.Members.Where(m => m.GroupId == id && m.UserId == uid)
                    .ExecuteUpdateAsync(s => s.SetProperty(m => m.Ready, ReadyStates.Confirm), ct);

                // 全员确认时会立刻推进阶段并产出结果
                await engine.AdvanceAsync(id, ct);

                var total = await db.Members.AsNoTracking().CountAsync(m => m.GroupId == id, ct);
                var confirmed = await db.Members.AsNoTracking()
                    .CountAsync(m => m.GroupId == id && m.Ready == ReadyStates.Confirm, ct);

                return Results.Json(new { ok = true, allConfirmed = total > 0 && confirmed == total });
            }

            if (action == "cancel")
            {
                await db.Members.Where(m => m.GroupId == id && m.UserId == uid)
                    .ExecuteUpdateAsync(s => s.SetProperty(m => m.Ready, ReadyStates.Cancel), ct);

                // 任一成员取消都会中断整个准备环节，并通知小队长
                if (group.OwnerId != uid)
                {
                    await notify.PushAsync(group.OwnerId, id, group.Theme, NotificationTypes.Cancel,
                        member.Name + " 取消了本次准备，随机已中断", ct);
                }

                await db.Members.Where(m => m.GroupId == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(m => m.Ready, ReadyStates.None), ct);

                await db.Groups.Where(g => g.Id == id && g.Stage == Stages.Preparing)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(g => g.Stage, Stages.Config)
                        .SetProperty(g => g.PrepStartedAt, (DateTimeOffset?)null)
                        .SetProperty(g => g.PrepDeadline, (DateTimeOffset?)null), ct);

                return Results.Json(new { ok = true, cancelled = true });
            }

            throw ApiException.BadRequest("action 只能是 confirm 或 cancel");
        }).WithTags("随机");

        // 取本轮结果（幂等）。若阶段推进条件已满足，会在这里产出结果。
        app.MapPost("/api/groups/{id:long}/roll", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            WeightService weights,
            StageEngine engine,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var exists = await db.Groups.AsNoTracking().AnyAsync(x => x.Id == id, ct);
            if (!exists) throw ApiException.NotFound("小队不存在");
            await groups.RequireMemberAsync(id, uid, ct);

            await engine.AdvanceAsync(id, ct);

            var loaded = await groups.LoadAsync(id, ct) ?? throw ApiException.NotFound("小队不存在");
            var (group, _) = loaded;

            if (group.Stage != Stages.Result || group.ResultOptionId is null)
                return Results.Json(new { ok = true, pending = true, stage = group.Stage });

            var w = await weights.ComputeAsync(id, ct);
            var chosen = w.Items.FirstOrDefault(i => i.OptionId == group.ResultOptionId.Value);
            if (chosen is null)
                return Results.Json(new { ok = true, pending = true, stage = group.Stage });

            return Results.Json(new
            {
                ok = true,
                chosen,
                items = w.Items,
                uniform = w.Uniform,
                totalVotes = w.TotalVotes
            });
        }).WithTags("随机");

        // 回到配置环节（仅小队长），用于开始新一轮
        app.MapPost("/api/groups/{id:long}/reset", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.OwnerId != uid) throw ApiException.Forbidden("只有小队长可以开始新一轮");

            await using var tx = await db.Database.BeginTransactionAsync(ct);

            await db.Members.Where(m => m.GroupId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.Ready, ReadyStates.None), ct);

            await db.Groups.Where(g => g.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(g => g.Stage, Stages.Config)
                    .SetProperty(g => g.PrepStartedAt, (DateTimeOffset?)null)
                    .SetProperty(g => g.PrepDeadline, (DateTimeOffset?)null)
                    .SetProperty(g => g.ResultOptionId, (long?)null)
                    .SetProperty(g => g.ResultAt, (DateTimeOffset?)null), ct);

            await tx.CommitAsync(ct);

            return Results.Json(new { ok = true, stage = Stages.Config });
        }).WithTags("随机");
    }
}
