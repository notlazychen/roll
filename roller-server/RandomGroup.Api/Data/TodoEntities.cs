using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Data;

/// <summary>
/// 任务清单的一个任务。
/// 一次性任务：到 dueDate 当天出现在「今日任务」里，打卡一次即完成；
/// 周期性任务：按 week_days 位掩码（bit0=周一…bit6=周日）重复出现，持续累计打卡次数。
/// </summary>
public class TodoTask
{
    public long Id { get; set; }
    public long UserId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Type { get; set; } = Domain.TodoTypes.Once;

    /// <summary>一次性任务的目标日期（当天出现在今日任务里）</summary>
    public DateOnly? DueDate { get; set; }

    /// <summary>周期性任务的重复位掩码；每天 = 127</summary>
    public int WeekDays { get; set; }

    /// <summary>周期性任务生效开始日期（早于它的日期不出现）</summary>
    public DateOnly StartDate { get; set; }

    public bool Archived { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>打卡记录：一个任务在某天打了一次卡。一次性任务的「完成」也是一条打卡。</summary>
public class TodoCheckIn
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public long TaskId { get; set; }

    /// <summary>打卡日期（按用户时区计算的自然日）</summary>
    public DateOnly Day { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
