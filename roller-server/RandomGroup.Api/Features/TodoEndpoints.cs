using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;

namespace RandomGroup.Api.Features;

/// <summary>
/// 任务清单接口。约定：
///   · 「今天」按用户时区（tz 与报表接口一致：东八区 = 480）计算自然日；
///   · 打卡幂等：一个任务同一天只有一条记录；
///   · 一次性任务的「完成」= 一次打卡；周期性任务的打卡次数 = 打卡记录数。
/// </summary>
public static class TodoEndpoints
{
    public static void MapTodoEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/todos").WithTags("任务清单");

        /* -------------------- 规划页：全部任务 -------------------- */

        g.MapGet("/", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var tasks = await db.TodoTasks.AsNoTracking()
                .Where(t => t.UserId == uid)
                .OrderBy(t => t.Archived).ThenByDescending(t => t.CreatedAt)
                .ToListAsync(ct);

            var ids = tasks.Select(t => t.Id).ToList();
            var counts = await db.TodoCheckIns.AsNoTracking()
                .Where(c => c.UserId == uid && ids.Contains(c.TaskId))
                .GroupBy(c => c.TaskId)
                .Select(g2 => new { TaskId = g2.Key, Count = g2.Count(), Last = g2.Max(c => c.Day) })
                .ToDictionaryAsync(x => x.TaskId, ct);

            return Results.Json(new
            {
                ok = true,
                tasks = tasks.Select(t =>
                {
                    counts.TryGetValue(t.Id, out var s);
                    return ToDto(t, s?.Count ?? 0, s?.Last);
                }).ToList()
            });
        });

        /* -------------------- 今日任务 -------------------- */

        g.MapGet("/today", async (
            DateOnly? date,
            int? tz,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var today = ResolveDay(date, tz);

            // 一次性任务：目标日 <= 今天 且未归档（已过期的标出来提醒补卡）
            var onceTasks = await db.TodoTasks.AsNoTracking()
                .Where(t => t.UserId == uid && !t.Archived
                            && t.Type == TodoTypes.Once
                            && t.DueDate != null && t.DueDate <= today)
                .OrderBy(t => t.DueDate).ThenBy(t => t.Id)
                .ToListAsync(ct);

            // 周期性任务：生效日期 <= 今天 且今天在周期内
            var weekday = WeekBit(today);
            var recurringTasks = await db.TodoTasks.AsNoTracking()
                .Where(t => t.UserId == uid && !t.Archived
                            && t.Type == TodoTypes.Recurring
                            && t.StartDate <= today)
                .ToListAsync(ct);
            recurringTasks = recurringTasks
                .Where(t => (t.WeekDays & weekday) != 0)
                .OrderBy(t => t.CreatedAt)
                .ToList();

            var todayTasks = onceTasks.Concat(recurringTasks).ToList();
            var ids = todayTasks.Select(t => t.Id).ToList();

            var todayCheckins = await db.TodoCheckIns.AsNoTracking()
                .Where(c => c.UserId == uid && c.Day == today && ids.Contains(c.TaskId))
                .Select(c => c.TaskId)
                .ToListAsync(ct);
            var doneSet = todayCheckins.ToHashSet();

            // 一次性任务是否曾经完成过（提前打卡也算完成）
            var everDone = ids.Count == 0
                ? new Dictionary<long, int>()
                : await db.TodoCheckIns.AsNoTracking()
                    .Where(c => c.UserId == uid && ids.Contains(c.TaskId) && c.Day != today)
                    .GroupBy(c => c.TaskId)
                    .Select(g2 => new { TaskId = g2.Key, Count = g2.Count() })
                    .ToDictionaryAsync(x => x.TaskId, x => x.Count, ct);

            var items = todayTasks.Select(t =>
            {
                var checkedToday = doneSet.Contains(t.Id);
                var done = t.Type == TodoTypes.Recurring ? checkedToday : checkedToday || everDone.ContainsKey(t.Id);
                var overdue = !done && t.Type == TodoTypes.Once && t.DueDate < today;
                return new
                {
                    id = t.Id,
                    title = t.Title,
                    type = t.Type,
                    dueDate = t.DueDate?.ToString("yyyy-MM-dd"),
                    weekDays = t.Type == TodoTypes.Recurring ? Unpack(t.WeekDays) : null,
                    checkedIn = checkedToday,
                    done,
                    overdue,
                    times = checkedToday ? 1 : 0
                };
            })
            .OrderBy(i => i.done).ThenBy(i => i.overdue ? 0 : 1).ThenBy(i => i.id)
            .ToList();

            return Results.Json(new
            {
                ok = true,
                date = today.ToString("yyyy-MM-dd"),
                total = items.Count,
                done = items.Count(i => i.done),
                tasks = items
            });
        });

        /* -------------------- 新建 / 修改 / 删除 -------------------- */

        g.MapPost("/", async (
            TodoRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var (title, type, dueDate, weekDays, startDate) = Normalize(req);

            var now = DateTimeOffset.UtcNow;
            var task = new TodoTask
            {
                UserId = uid,
                Title = title,
                Type = type,
                DueDate = type == TodoTypes.Once ? dueDate : null,
                WeekDays = type == TodoTypes.Recurring ? weekDays : 0,
                StartDate = type == TodoTypes.Recurring ? (startDate ?? TodayFor(req.Tz)) : default,
                Archived = false,
                CreatedAt = now
            };

            db.TodoTasks.Add(task);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, task = ToDto(task, 0, null) });
        });

        g.MapPut("/{id:long}", async (
            long id,
            TodoRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var task = await db.TodoTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid, ct)
                ?? throw ApiException.NotFound("任务不存在或已被删除");

            var (title, type, dueDate, weekDays, startDate) = Normalize(req);
            task.Title = title;
            task.Type = type;
            task.DueDate = type == TodoTypes.Once ? dueDate : null;
            task.WeekDays = type == TodoTypes.Recurring ? weekDays : 0;
            if (type == TodoTypes.Recurring && startDate.HasValue) task.StartDate = startDate.Value;

            await db.SaveChangesAsync(ct);
            var count = await db.TodoCheckIns.AsNoTracking().CountAsync(c => c.TaskId == task.Id, ct);
            return Results.Json(new { ok = true, task = ToDto(task, count, null) });
        });

        g.MapDelete("/{id:long}", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var task = await db.TodoTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid, ct)
                ?? throw ApiException.NotFound("任务不存在或已被删除");

            // 打卡记录一并清掉，规划页和图表不再留幽灵数据
            var checkins = db.TodoCheckIns.Where(c => c.TaskId == id && c.UserId == uid);
            db.TodoCheckIns.RemoveRange(checkins);
            db.TodoTasks.Remove(task);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, id });
        });

        /* -------------------- 打卡 / 撤销打卡 -------------------- */

        g.MapPost("/{id:long}/checkin", async (
            long id,
            CheckInRequest? req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var task = await db.TodoTasks.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid, ct)
                ?? throw ApiException.NotFound("任务不存在或已被删除");

            var day = ResolveDay(req?.Date, req?.Tz);
            var today = TodayFor(req?.Tz);
            if (day > today) throw ApiException.BadRequest("不能给未来的日期打卡");

            var exists = await db.TodoCheckIns
                .AnyAsync(c => c.TaskId == id && c.Day == day, ct);
            if (exists)
            {
                var total = await db.TodoCheckIns.AsNoTracking().CountAsync(c => c.TaskId == id, ct);
                return Results.Json(new { ok = true, already = true, day = day.ToString("yyyy-MM-dd"), count = total });
            }

            db.TodoCheckIns.Add(new TodoCheckIn
            {
                UserId = uid,
                TaskId = id,
                Day = day,
                CreatedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync(ct);

            var count = await db.TodoCheckIns.AsNoTracking().CountAsync(c => c.TaskId == id, ct);
            return Results.Json(new { ok = true, already = false, day = day.ToString("yyyy-MM-dd"), count });
        });

        g.MapDelete("/{id:long}/checkin", async (
            long id,
            DateOnly? date,
            int? tz,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var day = ResolveDay(date, tz);

            var row = await db.TodoCheckIns
                .FirstOrDefaultAsync(c => c.TaskId == id && c.UserId == uid && c.Day == day, ct);
            if (row == null)
                throw ApiException.NotFound("这一天还没有打卡记录");

            db.TodoCheckIns.Remove(row);
            await db.SaveChangesAsync(ct);
            var count = await db.TodoCheckIns.AsNoTracking().CountAsync(c => c.TaskId == id, ct);
            return Results.Json(new { ok = true, count });
        });

        /* -------------------- 数据图表 -------------------- */

        g.MapGet("/stats", async (
            int? days,
            int? tz,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var span = Math.Clamp(days ?? 14, 7, 60);
            var today = TodayFor(tz);
            var from = today.AddDays(-(span - 1));

            // 每日完成数（含缺的日子补 0，前端直接画柱状图）
            var raw = await db.TodoCheckIns.AsNoTracking()
                .Where(c => c.UserId == uid && c.Day >= from && c.Day <= today)
                .GroupBy(c => c.Day)
                .Select(g2 => new { Day = g2.Key, Count = g2.Count() })
                .ToDictionaryAsync(x => x.Day, x => x.Count, ct);
            var daily = Enumerable.Range(0, span)
                .Select(i => from.AddDays(i))
                .Select(d => new { day = d.ToString("yyyy-MM-dd"), count = raw.GetValueOrDefault(d, 0) })
                .ToList();

            // 任务打卡榜（未归档）
            var tasks = await db.TodoTasks.AsNoTracking()
                .Where(t => t.UserId == uid && !t.Archived)
                .ToListAsync(ct);
            var ids = tasks.Select(t => t.Id).ToList();
            var perTask = ids.Count == 0
                ? new Dictionary<long, int>()
                : await db.TodoCheckIns.AsNoTracking()
                    .Where(c => c.UserId == uid && ids.Contains(c.TaskId))
                    .GroupBy(c => c.TaskId)
                    .Select(g2 => new { TaskId = g2.Key, Count = g2.Count() })
                    .ToDictionaryAsync(x => x.TaskId, x => x.Count, ct);

            var ranking = tasks
                .Select(t => new { id = t.Id, title = t.Title, type = t.Type, count = perTask.GetValueOrDefault(t.Id, 0) })
                .OrderByDescending(t => t.count).ThenBy(t => t.id)
                .Take(10)
                .ToList();

            return Results.Json(new
            {
                ok = true,
                totalCheckins = perTask.Values.Sum(),
                recurringCount = tasks.Count(t => t.Type == TodoTypes.Recurring),
                pendingOnceCount = tasks.Count(t => t.Type == TodoTypes.Once && t.DueDate != null && !perTask.ContainsKey(t.Id)),
                daily,
                ranking
            });
        });
    }

    /* ------------------------------ 私有辅助 ------------------------------ */

    public record TodoRequest(string Title, string Type, string? DueDate, int[]? WeekDays, string? StartDate, int? Tz);
    public record CheckInRequest(string? Date, int? Tz);

    private static (string Title, string Type, DateOnly? DueDate, int WeekDays, DateOnly? StartDate) Normalize(TodoRequest req)
    {
        var title = (req.Title ?? string.Empty).Trim();
        if (title.Length == 0) throw ApiException.BadRequest("请填写任务内容");
        if (title.Length > TodoLimits.MaxTitleLength)
            throw ApiException.BadRequest($"任务内容最多 {TodoLimits.MaxTitleLength} 个字");

        var type = (req.Type ?? TodoTypes.Once).Trim();
        if (!TodoTypes.IsValid(type)) throw ApiException.BadRequest("任务类型不正确");

        DateOnly? dueDate = null;
        if (type == TodoTypes.Once)
        {
            if (string.IsNullOrWhiteSpace(req.DueDate) || !DateOnly.TryParse(req.DueDate, out var d))
                throw ApiException.BadRequest("一次性任务请选择目标日期");
            dueDate = d;
        }

        var weekDays = 0;
        if (type == TodoTypes.Recurring)
        {
            var bits = (req.WeekDays ?? Array.Empty<int>()).Aggregate(0, (acc, w) => w is >= 1 and <= 7 ? acc | (1 << (w - 1)) : acc);
            if (bits == 0) throw ApiException.BadRequest("周期性任务请至少选择一个重复日");
            weekDays = bits;
        }

        DateOnly? startDate = null;
        if (!string.IsNullOrWhiteSpace(req.StartDate) && DateOnly.TryParse(req.StartDate, out var s))
            startDate = s;

        return (title, type, dueDate, weekDays, startDate);
    }

    /// <summary>解析自然日：显式 date 优先，否则用时区偏移从当前时刻算。
    /// tz 语义与项目内报表接口一致（东八区 = 480，即「本地 = UTC + tz 分钟」）。</summary>
    private static DateOnly ResolveDay(DateOnly? date, int? tz)
    {
        if (date.HasValue) return date.Value;
        return TodayFor(tz);
    }

    private static DateOnly ResolveDay(string? date, int? tz)
        => !string.IsNullOrWhiteSpace(date) && DateOnly.TryParse(date, out var d) ? d : TodayFor(tz);

    private static DateOnly TodayFor(int? tz)
        => DateOnly.FromDateTime(DateTimeOffset.UtcNow.AddMinutes(tz ?? 480).DateTime);

    /// <summary>周一=bit0 … 周日=bit6</summary>
    private static int WeekBit(DateOnly day) => 1 << (((int)day.DayOfWeek + 6) % 7);

    private static int[] Unpack(int weekDays)
    {
        var list = new List<int>();
        for (var w = 1; w <= 7; w++)
            if ((weekDays & (1 << (w - 1))) != 0) list.Add(w);
        return list.ToArray();
    }

    private static object ToDto(TodoTask t, int checkinCount, DateOnly? lastCheckIn) => new
    {
        id = t.Id,
        title = t.Title,
        type = t.Type,
        dueDate = t.DueDate?.ToString("yyyy-MM-dd"),
        weekDays = t.Type == TodoTypes.Recurring ? Unpack(t.WeekDays) : null,
        startDate = t.Type == TodoTypes.Recurring ? t.StartDate.ToString("yyyy-MM-dd") : null,
        archived = t.Archived,
        createdAt = t.CreatedAt.ToUnixTimeMilliseconds(),
        checkinCount,
        lastCheckIn = lastCheckIn?.ToString("yyyy-MM-dd")
    };
}
