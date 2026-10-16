using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

public record AddOptionRequest(string Title);

public static class OptionEndpoints
{
    public static void MapOptionEndpoints(this IEndpointRouteBuilder app)
    {
        // 添加备选项：仅小队成员、且仅在配置环节。创建者自动投自己一票，
        // 保证新备选项自带权重、默认就能参与抽奖。
        app.MapPost("/api/groups/{id:long}/options", async (
            long id,
            AddOptionRequest req,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var member = await groups.RequireMemberAsync(id, uid, ct);

            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");
            if (group.Stage != Stages.Config)
                throw ApiException.BadRequest(GroupService.StageLockedMessage(group.Stage));

            var title = (req.Title ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(title)) throw ApiException.BadRequest("请填写备选项内容");
            if (title.Length > Limits.MaxOptionLength)
                throw ApiException.BadRequest($"备选项最多 {Limits.MaxOptionLength} 个字符");

            var dup = await db.Options.AsNoTracking().AnyAsync(o => o.GroupId == id && o.Title == title, ct);
            if (dup) throw ApiException.BadRequest("该备选项已存在");

            var now = DateTimeOffset.UtcNow;

            await using var tx = await db.Database.BeginTransactionAsync(ct);

            var option = new RollOption
            {
                GroupId = id,
                Title = title,
                CreatorId = uid,
                CreatorName = member.Name,
                CreatedAt = now
            };
            db.Options.Add(option);
            await db.SaveChangesAsync(ct);

            db.Votes.Add(new RollVote
            {
                OptionId = option.Id,
                GroupId = id,
                UserId = uid,
                CreatedAt = now
            });
            await db.SaveChangesAsync(ct);

            await tx.CommitAsync(ct);

            return Results.Json(new { ok = true, optionId = option.Id, autoVoted = true });
        }).WithTags("备选项");

        // 删除备选项：只有创建者本人可以删；删除时连带清除该项所有投票
        app.MapDelete("/api/options/{optionId:long}", async (
            long optionId,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var option = await db.Options.AsNoTracking().FirstOrDefaultAsync(o => o.Id == optionId, ct)
                ?? throw ApiException.NotFound("备选项不存在");

            if (option.CreatorId != uid) throw ApiException.Forbidden("只有创建者可以删除");

            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == option.GroupId, ct)
                ?? throw ApiException.NotFound("小队不存在");
            if (group.Stage != Stages.Config)
                throw ApiException.BadRequest(GroupService.StageLockedMessage(group.Stage));

            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.Votes.Where(v => v.OptionId == optionId).ExecuteDeleteAsync(ct);
            await db.Options.Where(o => o.Id == optionId).ExecuteDeleteAsync(ct);
            await tx.CommitAsync(ct);

            return Results.Json(new { ok = true });
        }).WithTags("备选项");

        // 投票 / 撤票（切换）：一票即一单位权重
        app.MapPost("/api/options/{optionId:long}/vote", async (
            long optionId,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var option = await db.Options.AsNoTracking().FirstOrDefaultAsync(o => o.Id == optionId, ct)
                ?? throw ApiException.NotFound("备选项不存在");

            await groups.RequireMemberAsync(option.GroupId, uid, ct);

            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == option.GroupId, ct)
                ?? throw ApiException.NotFound("小队不存在");
            if (group.Stage != Stages.Config)
                throw ApiException.BadRequest(GroupService.StageLockedMessage(group.Stage));

            var existing = await db.Votes.FirstOrDefaultAsync(v => v.OptionId == optionId && v.UserId == uid, ct);

            if (existing is not null)
            {
                db.Votes.Remove(existing);
                await db.SaveChangesAsync(ct);
                return Results.Json(new { ok = true, voted = false });
            }

            db.Votes.Add(new RollVote
            {
                OptionId = optionId,
                GroupId = option.GroupId,
                UserId = uid,
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, voted = true });
        }).WithTags("备选项");
    }
}
