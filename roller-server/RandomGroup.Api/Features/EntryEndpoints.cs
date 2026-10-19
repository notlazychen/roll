using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

public static class EntryEndpoints
{
    public static void MapEntryEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").WithTags("账目");

        // 明细列表：按交易时间倒序，游标分页（cursor = 上一页最后一条的 tradeAt|id）
        // 可选过滤：类型 / 分类 / 起止时间（毫秒）/ 关键词（备注、渠道、消费者）
        g.MapGet("/entries", async (
            string? type,
            string? category,
            long? from,
            long? to,
            string? keyword,
            string? cursor,
            int? limit,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var size = Math.Clamp(limit ?? 30, 1, 100);

            var q = db.Entries.AsNoTracking().Where(e => e.UserId == uid);

            if (EntryTypes.IsValid(type)) q = q.Where(e => e.Type == type);
            if (!string.IsNullOrWhiteSpace(category)) q = q.Where(e => e.Category == category);
            if (from.HasValue) { var f = FromMs(from.Value); q = q.Where(e => e.TradeAt >= f); }
            if (to.HasValue) { var t = FromMs(to.Value); q = q.Where(e => e.TradeAt < t); }

            var kw = (keyword ?? string.Empty).Trim();
            if (kw.Length > 0)
            {
                q = q.Where(e =>
                    (e.Remark != null && e.Remark.Contains(kw)) ||
                    (e.Channel != null && e.Channel.Contains(kw)) ||
                    (e.Consumer != null && e.Consumer.Contains(kw)) ||
                    (e.Account != null && e.Account.Contains(kw)));
            }

            if (!string.IsNullOrWhiteSpace(cursor))
            {
                var parts = cursor.Split('|');
                if (parts.Length == 2 && long.TryParse(parts[0], out var cAt) && long.TryParse(parts[1], out var cId))
                {
                    var cTime = FromMs(cAt);
                    q = q.Where(e => e.TradeAt < cTime || (e.TradeAt == cTime && e.Id < cId));
                }
            }

            // 多取一条用来判断还有没有下一页
            var rows = await q
                .OrderByDescending(e => e.TradeAt).ThenByDescending(e => e.Id)
                .Take(size + 1)
                .ToListAsync(ct);

            var hasMore = rows.Count > size;
            var page = hasMore ? rows.Take(size).ToList() : rows;
            string? next = null;
            if (page.Count > 0)
            {
                var last = page[^1];
                next = last.TradeAt.ToUnixTimeMilliseconds().ToString() + "|" + last.Id;
            }

            return Results.Json(new EntryPageDto(page.Select(EntryMapper.ToDto).ToList(), hasMore, next));
        });

        // 单条详情
        g.MapGet("/entries/{id:long}", async (long id, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var entry = await db.Entries.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id && e.UserId == uid, ct)
                ?? throw ApiException.NotFound("账目不存在或已被删除");
            return Results.Json(new { ok = true, entry = EntryMapper.ToDto(entry) });
        });

        // 新增账目
        g.MapPost("/entries", async (
            EntryRequest req,
            HttpContext ctx,
            RollDbContext db,
            TagService tags,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var type = NormalizeType(req.Type);
            var amount = NormalizeAmount(req.Amount);
            var category = RequireText(req.Category, "请选择分类", 32);
            var remark = CleanRemark(req.Remark);

            // 自动标签 + 手动标签；手动指定的标签之后若改名，账目上保留原名称
            var auto = await tags.AnalyzeAsync(uid, user.TagAutoEnabled, remark, ct);
            var tagList = TagService.Merge(auto, req.Tags ?? Array.Empty<string>());

            var now = DateTimeOffset.UtcNow;
            var entry = new LedgerEntry
            {
                UserId = uid,
                Type = type,
                Amount = amount,
                Category = category,
                Channel = NullIfBlank(req.Channel, 64),
                Consumer = NullIfBlank(req.Consumer, 32),
                Account = NullIfBlank(req.Account, 32),
                TradeAt = req.TradeAt > 0 ? FromMs(req.TradeAt) : now,
                CreatedAt = now,
                Remark = remark,
                TagsJson = TagService.SerializeTags(tagList)
            };

            db.Entries.Add(entry);
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, entry = EntryMapper.ToDto(entry) });
        });

        // 修改账目
        g.MapPut("/entries/{id:long}", async (
            long id,
            EntryRequest req,
            HttpContext ctx,
            RollDbContext db,
            TagService tags,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var entry = await db.Entries.FirstOrDefaultAsync(e => e.Id == id && e.UserId == uid, ct)
                ?? throw ApiException.NotFound("账目不存在或已被删除");

            entry.Type = NormalizeType(req.Type);
            entry.Amount = NormalizeAmount(req.Amount);
            entry.Category = RequireText(req.Category, "请选择分类", 32);
            entry.Channel = NullIfBlank(req.Channel, 64);
            entry.Consumer = NullIfBlank(req.Consumer, 32);
            entry.Account = NullIfBlank(req.Account, 32);
            entry.Remark = CleanRemark(req.Remark);
            if (req.TradeAt > 0) entry.TradeAt = FromMs(req.TradeAt);

            var auto = await tags.AnalyzeAsync(uid, user.TagAutoEnabled, entry.Remark, ct);
            var tagList = TagService.Merge(auto, req.Tags ?? Array.Empty<string>());
            entry.TagsJson = TagService.SerializeTags(tagList);

            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, entry = EntryMapper.ToDto(entry) });
        });

        // 删除账目
        g.MapDelete("/entries/{id:long}", async (long id, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var entry = await db.Entries.FirstOrDefaultAsync(e => e.Id == id && e.UserId == uid, ct)
                ?? throw ApiException.NotFound("账目不存在或已被删除");
            db.Entries.Remove(entry);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true });
        });

        // 备注预分析：记账页边输边看会命中哪些标签（不落库）
        g.MapPost("/entries/tags/preview", async (
            EntryRequest req,
            HttpContext ctx,
            RollDbContext db,
            TagService tags,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var auto = await tags.AnalyzeAsync(uid, user.TagAutoEnabled, CleanRemark(req.Remark), ct);
            return Results.Json(new { ok = true, tags = auto });
        });

        // 首页/明细页顶部概览：今日与本月收支
        g.MapGet("/stats/overview", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var now = DateTimeOffset.Now;
            var todayStart = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, now.Offset);
            var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, now.Offset);

            var monthRows = await db.Entries.AsNoTracking()
                .Where(e => e.UserId == uid && e.TradeAt >= monthStart)
                .Select(e => new { e.Type, e.Amount, e.TradeAt })
                .ToListAsync(ct);

            long todayExpense = 0, todayIncome = 0, monthExpense = 0, monthIncome = 0;
            foreach (var r in monthRows)
            {
                if (r.Type == EntryTypes.Expense) monthExpense += r.Amount; else monthIncome += r.Amount;
                if (r.TradeAt >= todayStart)
                {
                    if (r.Type == EntryTypes.Expense) todayExpense += r.Amount; else todayIncome += r.Amount;
                }
            }

            var total = await db.Entries.AsNoTracking().CountAsync(e => e.UserId == uid, ct);

            return Results.Json(new OverviewDto(todayExpense, todayIncome, monthExpense, monthIncome, total));
        });
    }

    /* ------------------------- 校验 ------------------------- */

    private static string NormalizeType(string? type)
    {
        var t = (type ?? EntryTypes.Expense).Trim().ToLowerInvariant();
        if (!EntryTypes.IsValid(t)) throw ApiException.BadRequest("账目类型只能是收入或支出");
        return t;
    }

    private static long NormalizeAmount(long amount)
    {
        if (amount <= 0) throw ApiException.BadRequest("金额必须大于 0");
        if (amount > Limits.MaxAmountCents) throw ApiException.BadRequest("金额超出上限");
        return amount;
    }

    private static string RequireText(string? raw, string message, int max)
    {
        var v = (raw ?? string.Empty).Trim();
        if (v.Length == 0) throw ApiException.BadRequest(message);
        return v.Length > max ? v[..max] : v;
    }

    private static string? NullIfBlank(string? raw, int max)
    {
        var v = (raw ?? string.Empty).Trim();
        if (v.Length == 0) return null;
        return v.Length > max ? v[..max] : v;
    }

    private static string? CleanRemark(string? raw)
    {
        var v = (raw ?? string.Empty).Trim();
        if (v.Length == 0) return null;
        if (v.Length > Limits.MaxRemarkLength) throw ApiException.BadRequest($"备注最多 {Limits.MaxRemarkLength} 个字");
        return v;
    }
}
