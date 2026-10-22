using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/reports").WithTags("报表");

        // 指定时间段的收支汇总 + 分类占比（饼图）+ 每日收支（折线图）
        // from/to 为毫秒时间戳，左闭右开：from <= tradeAt < to
        // tz：调用方的时区偏移（分钟，东八区为 480）。时间戳本身不带时区信息，
        //     不传就按服务器本地时区算，「按天分组」的边界可能和用户看到的差一天。
        g.MapGet("", async (
            long? from,
            long? to,
            int? tz,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var zone = ZoneOf(tz);

            // 边界按客户端时区切日之后，必须转 UTC 再进 SQL：
            // Npgsql 只接受 offset=0 的参数比较 timestamptz（开发机东八区必炸，生产容器 UTC 没暴露）
            var end = to.HasValue ? FromMs(to.Value) : DateTimeOffset.UtcNow;
            var start = from.HasValue
                ? FromMs(from.Value)
                : StartOfMonth(TimeZoneInfo.ConvertTime(end, zone)).ToUniversalTime();
            end = end.ToUniversalTime();

            if (end <= start) throw ApiException.BadRequest("结束时间必须晚于开始时间");
            if ((end - start).TotalDays > 400) throw ApiException.BadRequest("统计区间不能超过一年");

            var rows = await db.Entries.AsNoTracking()
                .Where(e => e.UserId == uid && e.TradeAt >= start && e.TradeAt < end)
                .Select(e => new { e.Type, e.Amount, e.Category, e.TradeAt })
                .ToListAsync(ct);

            var income = rows.Where(r => r.Type == EntryTypes.Income).Sum(r => r.Amount);
            var expense = rows.Where(r => r.Type == EntryTypes.Expense).Sum(r => r.Amount);

            static List<CategoryStatDto> Aggregate(IEnumerable<(string Name, long Amount)> src, long total)
            {
                var grouped = src.GroupBy(x => x.Name)
                    .Select(x => new { Name = x.Key, Amount = x.Sum(y => y.Amount), Count = x.Count() })
                    .OrderByDescending(x => x.Amount)
                    .ToList();

                return grouped.Select(x => new CategoryStatDto(
                    x.Name,
                    x.Amount,
                    x.Count,
                    total > 0 ? Math.Round((double)x.Amount / total, 4) : 0
                )).ToList();
            }

            var expenseCats = Aggregate(
                rows.Where(r => r.Type == EntryTypes.Expense).Select(r => (r.Category, r.Amount)),
                expense);

            var incomeCats = Aggregate(
                rows.Where(r => r.Type == EntryTypes.Income).Select(r => (r.Category, r.Amount)),
                income);

            // 每日收支：区间内每一天都要有点，没有账目的日子补 0，折线才不会断
            // 起点取「调用方时区下 start 所在那天的 00:00」，这样和用户在图表上看到的日期一致。
            var days = new List<DayPointDto>();
            for (var d = StartOfDay(TimeZoneInfo.ConvertTime(start, zone));
                 d < end;
                 d = d.AddDays(1))
            {
                var dayStart = d;
                var dayEnd = d.AddDays(1);
                var slice = rows.Where(r => r.TradeAt >= dayStart && r.TradeAt < dayEnd).ToList();
                days.Add(new DayPointDto(
                    TimeZoneInfo.ConvertTime(dayStart, zone).ToString("yyyy-MM-dd"),
                    slice.Where(r => r.Type == EntryTypes.Income).Sum(r => r.Amount),
                    slice.Where(r => r.Type == EntryTypes.Expense).Sum(r => r.Amount)));
            }

            return Results.Json(new ReportDto(income, expense, income - expense, rows.Count, expenseCats, incomeCats, days));
        });

        // 渠道排行：某段时间内花得最多的渠道（明细页/图表页的补充视图）
        g.MapGet("/channels", async (
            long? from,
            long? to,
            int? tz,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var zone = ZoneOf(tz);
            var end = to.HasValue ? FromMs(to.Value) : DateTimeOffset.UtcNow;
            var start = from.HasValue
                ? FromMs(from.Value)
                : StartOfMonth(TimeZoneInfo.ConvertTime(end, zone)).ToUniversalTime();
            end = end.ToUniversalTime();

            var rows = await db.Entries.AsNoTracking()
                .Where(e => e.UserId == uid && e.Type == EntryTypes.Expense &&
                            e.TradeAt >= start && e.TradeAt < end && e.Channel != null)
                .Select(e => new { e.Channel, e.Amount })
                .ToListAsync(ct);

            var items = rows.GroupBy(r => r.Channel)
                .Select(x => new { Name = x.Key, Amount = x.Sum(y => y.Amount), Count = x.Count() })
                .OrderByDescending(x => x.Amount)
                .Take(20)
                .ToList();

            return Results.Json(new { ok = true, items });
        });
    }

    /* ------------------------- 时区 ------------------------- */

    private static readonly TimeSpan MaxOffset = TimeSpan.FromHours(14);

    /// <summary>把前端传来的「分钟偏移」变成一个时区；不传或越界就退回服务器本地时区。</summary>
    private static TimeZoneInfo ZoneOf(int? tzMinutes)
    {
        if (!tzMinutes.HasValue) return TimeZoneInfo.Local;
        var offset = TimeSpan.FromMinutes(tzMinutes.Value);
        if (offset < -MaxOffset || offset > MaxOffset) offset = TimeSpan.Zero;
        return TimeZoneInfo.CreateCustomTimeZone(
            "client" + (int)offset.TotalMinutes, offset, "client", "client");
    }

    /// <summary>某个时刻在其所在时区当天的 00:00。</summary>
    private static DateTimeOffset StartOfDay(DateTimeOffset t) =>
        new(t.Year, t.Month, t.Day, 0, 0, 0, t.Offset);

    /// <summary>某个时刻所在月的 1 日 00:00。</summary>
    private static DateTimeOffset StartOfMonth(DateTimeOffset t) =>
        new(t.Year, t.Month, 1, 0, 0, 0, t.Offset);
}
