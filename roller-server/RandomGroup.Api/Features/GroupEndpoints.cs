using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

public record CreateGroupRequest(string Theme, string? Passcode);
public record JoinGroupRequest(string? Passcode);

/// <summary>大厅列表项：在小队信息基础上附加「我是否已加入 / 我是否是小队长」</summary>
public record GroupSummaryDto(
    long Id, string Code, string Theme, string Passcode, long OwnerId, string OwnerName, string Stage,
    long? PrepStartedAt, long? PrepDeadline, long? ResultOptionId, long? ResultAt, long CreatedAt,
    int MemberCount, bool HasPasscode, bool Joined, bool Owner);

public static class GroupEndpoints
{
    public static void MapGroupEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/groups").WithTags("小队");

        // 大厅列表 / 搜索（主题模糊匹配，或精确匹配 6 位邀请码）
        g.MapGet("", async (string? keyword, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var kw = (keyword ?? string.Empty).Trim();

            var query = db.Groups.AsNoTracking().AsQueryable();
            if (kw.Length > 0)
                query = query.Where(x => x.Theme.Contains(kw) || x.Code == kw);

            var groups = await query.OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync(ct);
            var ids = groups.Select(x => x.Id).ToList();

            var counts = await db.Members.AsNoTracking()
                .Where(m => ids.Contains(m.GroupId))
                .GroupBy(m => m.GroupId)
                .Select(x => new { GroupId = x.Key, Count = x.Count() })
                .ToListAsync(ct);
            var countMap = counts.ToDictionary(x => x.GroupId, x => x.Count);

            var mine = await db.Members.AsNoTracking()
                .Where(m => m.UserId == uid && ids.Contains(m.GroupId))
                .Select(m => m.GroupId)
                .ToListAsync(ct);
            var mineSet = mine.ToHashSet();

            var items = groups.Select(x => new GroupSummaryDto(
                Id: x.Id,
                Code: x.Code,
                Theme: x.Theme,
                Passcode: x.OwnerId == uid ? x.Passcode : string.Empty,
                OwnerId: x.OwnerId,
                OwnerName: x.OwnerName,
                Stage: x.Stage,
                PrepStartedAt: x.PrepStartedAt.ToMs(),
                PrepDeadline: x.PrepDeadline.ToMs(),
                ResultOptionId: x.ResultOptionId,
                ResultAt: x.ResultAt.ToMs(),
                CreatedAt: x.CreatedAt.ToMs(),
                MemberCount: countMap.TryGetValue(x.Id, out var c) ? c : 0,
                HasPasscode: !string.IsNullOrEmpty(x.Passcode),
                Joined: mineSet.Contains(x.Id),
                Owner: x.OwnerId == uid)).ToList();

            return Results.Json(new { ok = true, groups = items });
        });

        // 创建小队：创建者自动成为小队长并入组
        g.MapPost("", async (
            CreateGroupRequest req,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var theme = (req.Theme ?? string.Empty).Trim();
            GroupService.ValidateTheme(theme);

            var passcode = (req.Passcode ?? string.Empty).Trim();
            GroupService.ValidatePasscode(passcode);

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var now = DateTimeOffset.UtcNow;
            var group = new RollGroup
            {
                Code = await groups.GenerateCodeAsync(ct),
                Theme = theme,
                Passcode = passcode,
                OwnerId = uid,
                OwnerName = user.NickName,
                Stage = Stages.Config,
                Round = 0,
                CreatedAt = now
            };
            db.Groups.Add(group);
            await db.SaveChangesAsync(ct);

            db.Members.Add(new RollMember
            {
                GroupId = group.Id,
                UserId = uid,
                Name = user.NickName,
                Ready = ReadyStates.None,
                JoinedAt = now
            });
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, group = GroupService.Map(group, 1, uid) });
        });

        // 小队详情：一次返回小队、成员、备选项、权重与我的身份，供页面轮询使用
        g.MapGet("/{id:long}", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            WeightService weights,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var loaded = await groups.LoadAsync(id, ct) ?? throw ApiException.NotFound("小队不存在");
            var (group, memberCount) = loaded;

            var members = await db.Members.AsNoTracking()
                .Where(m => m.GroupId == id)
                .OrderBy(m => m.JoinedAt).ThenBy(m => m.Id)
                .Select(m => new MemberDto(m.Id, m.GroupId, m.UserId, m.Name, m.Ready, m.JoinedAt.ToUnixTimeMilliseconds()))
                .ToListAsync(ct);

            var options = await OptionQueries.ListAsync(db, id, ct);
            var w = await weights.ComputeAsync(id, ct);
            var mine = members.FirstOrDefault(m => m.Uid == uid);

            return Results.Json(new
            {
                ok = true,
                group = GroupService.Map(group, memberCount, uid),
                members,
                options,
                weights = w,
                isMember = mine is not null,
                isLeader = group.OwnerId == uid,
                me = mine
            });
        });

        // 轻量状态：轮询用，只返回判断阶段变化所需的最小字段
        g.MapGet("/{id:long}/state", async (
            long id,
            RollDbContext db,
            GroupService groups,
            CancellationToken ct) =>
        {
            var loaded = await groups.LoadAsync(id, ct) ?? throw ApiException.NotFound("小队不存在");
            var (group, memberCount) = loaded;

            var optionCount = await db.Options.AsNoTracking().CountAsync(o => o.GroupId == id, ct);
            var confirmed = await db.Members.AsNoTracking()
                .CountAsync(m => m.GroupId == id && m.Ready == ReadyStates.Confirm, ct);

            return Results.Json(new
            {
                ok = true,
                state = new GroupStateDto(
                    id, group.Stage, memberCount, optionCount, confirmed,
                    group.PrepDeadline.ToMs(), group.ResultOptionId, group.ResultAt.ToMs())
            });
        });

        g.MapGet("/{id:long}/members", async (long id, RollDbContext db, CancellationToken ct) =>
        {
            var exists = await db.Groups.AsNoTracking().AnyAsync(x => x.Id == id, ct);
            if (!exists) throw ApiException.NotFound("小队不存在");

            var members = await db.Members.AsNoTracking()
                .Where(m => m.GroupId == id)
                .OrderBy(m => m.JoinedAt).ThenBy(m => m.Id)
                .Select(m => new MemberDto(m.Id, m.GroupId, m.UserId, m.Name, m.Ready, m.JoinedAt.ToUnixTimeMilliseconds()))
                .ToListAsync(ct);

            return Results.Json(new { ok = true, members });
        });

        g.MapGet("/{id:long}/options", async (long id, RollDbContext db, CancellationToken ct) =>
        {
            var exists = await db.Groups.AsNoTracking().AnyAsync(x => x.Id == id, ct);
            if (!exists) throw ApiException.NotFound("小队不存在");

            var options = await OptionQueries.ListAsync(db, id, ct);
            return Results.Json(new { ok = true, options });
        });

        g.MapGet("/{id:long}/weights", async (long id, RollDbContext db, WeightService weights, CancellationToken ct) =>
        {
            var exists = await db.Groups.AsNoTracking().AnyAsync(x => x.Id == id, ct);
            if (!exists) throw ApiException.NotFound("小队不存在");

            var w = await weights.ComputeAsync(id, ct);
            return Results.Json(new
            {
                ok = true,
                items = w.Items,
                totalVotes = w.TotalVotes,
                uniform = w.Uniform
            });
        });

        // 修改主题 / 口令（仅小队长）。只有请求体里出现的字段才会被修改。
        g.MapPatch("/{id:long}", async (
            long id,
            JsonElement body,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var group = await db.Groups.FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.OwnerId != uid) throw ApiException.Forbidden("只有小队长可以修改小队设置");

            JsonElement themeEl = default;
            JsonElement passEl = default;
            var isObject = body.ValueKind == JsonValueKind.Object;
            var hasTheme = isObject && body.TryGetProperty("theme", out themeEl);
            var hasPasscode = isObject && body.TryGetProperty("passcode", out passEl);

            if (!hasTheme && !hasPasscode)
                throw ApiException.BadRequest("没有需要修改的内容");

            if (hasTheme)
            {
                var theme = (themeEl.GetString() ?? string.Empty).Trim();
                GroupService.ValidateTheme(theme);
                group.Theme = theme;
            }

            if (hasPasscode)
            {
                var passcode = (passEl.GetString() ?? string.Empty).Trim();
                GroupService.ValidatePasscode(passcode);
                group.Passcode = passcode;
            }

            await db.SaveChangesAsync(ct);

            var count = await db.Members.AsNoTracking().CountAsync(m => m.GroupId == id, ct);
            return Results.Json(new { ok = true, group = GroupService.Map(group, count, uid) });
        });

        // 加入小队
        g.MapPost("/{id:long}/join", async (
            long id,
            JoinGroupRequest req,
            HttpContext ctx,
            RollDbContext db,
            GroupService groups,
            NotificationService notify,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            await using var tx = await db.Database.BeginTransactionAsync(ct);

            var group = await db.Groups.FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            var mine = await db.Members.FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == uid, ct);
            var count = await db.Members.CountAsync(m => m.GroupId == id, ct);

            if (mine is not null)
            {
                await tx.CommitAsync(ct);
                return Results.Json(new
                {
                    ok = true,
                    already = true,
                    group = GroupService.Map(group, count, uid),
                    me = new MemberDto(mine.Id, mine.GroupId, mine.UserId, mine.Name, mine.Ready, mine.JoinedAt.ToMs())
                });
            }

            if (!string.IsNullOrEmpty(group.Passcode) &&
                !string.Equals((req.Passcode ?? string.Empty).Trim(), group.Passcode, StringComparison.Ordinal))
            {
                throw ApiException.BadRequest("口令不正确", new { needPasscode = true });
            }

            if (count >= Limits.MaxMembers)
                throw ApiException.BadRequest($"小队人数已达上限（{Limits.MaxMembers} 人）");

            var row = new RollMember
            {
                GroupId = id,
                UserId = uid,
                Name = user.NickName,
                Ready = ReadyStates.None,
                JoinedAt = DateTimeOffset.UtcNow
            };
            db.Members.Add(row);

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg &&
                                               pg.MessageText.Contains("MEMBER_LIMIT_REACHED"))
            {
                // 数据库触发器的兜底：并发情况下第 21 个成员会在这里被拦下
                throw ApiException.BadRequest($"小队人数已达上限（{Limits.MaxMembers} 人）");
            }

            await notify.PushAsync(group.OwnerId, id, group.Theme, NotificationTypes.Join, user.NickName + " 加入了小队", ct);
            await tx.CommitAsync(ct);

            return Results.Json(new
            {
                ok = true,
                group = GroupService.Map(group, count + 1, uid),
                me = new MemberDto(row.Id, row.GroupId, row.UserId, row.Name, row.Ready, row.JoinedAt.ToMs())
            });
        });

        // 退出小队（小队长不能退出，只能删除小队）
        g.MapPost("/{id:long}/leave", async (long id, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var group = await db.Groups.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.OwnerId == uid)
                throw ApiException.BadRequest("小队长不能退出小队，如需解散请删除小队");

            var mine = await db.Members.FirstOrDefaultAsync(m => m.GroupId == id && m.UserId == uid, ct);
            if (mine is not null)
            {
                db.Members.Remove(mine);
                await db.SaveChangesAsync(ct);
            }

            await db.Votes.Where(v => v.GroupId == id && v.UserId == uid).ExecuteDeleteAsync(ct);

            return Results.Json(new { ok = true });
        });

        // 解散小队
        g.MapDelete("/{id:long}", async (long id, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var group = await db.Groups.FirstOrDefaultAsync(x => x.Id == id, ct)
                ?? throw ApiException.NotFound("小队不存在");

            if (group.OwnerId != uid) throw ApiException.Forbidden("只有小队长可以解散小队");

            await db.Votes.Where(v => v.GroupId == id).ExecuteDeleteAsync(ct);
            await db.Notifications.Where(n => n.GroupId == id).ExecuteDeleteAsync(ct);
            await db.Members.Where(m => m.GroupId == id).ExecuteDeleteAsync(ct);
            await db.Options.Where(o => o.GroupId == id).ExecuteDeleteAsync(ct);
            db.Groups.Remove(group);
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true });
        });
    }
}
