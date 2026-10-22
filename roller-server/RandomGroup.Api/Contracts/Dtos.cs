namespace RandomGroup.Api.Contracts;

/// <summary>
/// 响应结构与小程序端 utils/store-http.js 的约定保持一致：
/// 1) 所有时间字段都是「毫秒时间戳」数字；
/// 2) 金额字段一律是「分」为单位的整数，前端负责除以 100 显示；
/// 3) 增删改接口返回 { ok, ... }，失败时 ok=false 且带 error。
/// </summary>
public static class TimeMs
{
    public static long ToMs(this DateTimeOffset t) => t.ToUnixTimeMilliseconds();
    public static long? ToMs(this DateTimeOffset? t) => t?.ToUnixTimeMilliseconds();

    /// <summary>
    /// 毫秒 → 时间。必须转 UTC：Npgsql 只接受 offset=0 的值写 timestamptz，
    /// 开发机在东八区时 FromUnixTimeMilliseconds 会带 +08:00，直接查库会炸。
    /// （生产容器是 UTC，所以这个问题以前没暴露。）
    /// </summary>
    public static DateTimeOffset FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToUniversalTime();
    public static DateTimeOffset? FromMs(long? ms) => ms.HasValue ? FromMs(ms.Value) : null;
}

public record UserDto(
    long Id,
    string NickName,
    string? AvatarUrl,
    bool IsDevAccount,
    bool TagAutoEnabled,
    // 登录邮箱；纯微信账号为 null
    string? Email = null,
    // 是否已绑定微信（Web 端用来显示绑定状态）
    bool WeChatBound = false);

/* ------------------------- 账目 ------------------------- */

public record EntryDto(
    long Id,
    string Type,
    long Amount,
    string Category,
    string? Channel,
    string? Consumer,
    string? Account,
    long TradeAt,
    long CreatedAt,
    string? Remark,
    IReadOnlyList<string> Tags);

/// <summary>新增 / 修改账目的请求体。时间都是毫秒时间戳。</summary>
public record EntryRequest(
    string Type,
    long Amount,
    string? Category,
    string? Channel,
    string? Consumer,
    string? Account,
    long TradeAt,
    string? Remark,
    string[]? Tags);

public record EntryPageDto(IReadOnlyList<EntryDto> Items, bool HasMore, string? NextCursor);

/* ------------------------- 选项源 ------------------------- */

public record OptionItemDto(long Id, string Kind, string Name, string? Parent, bool IsPreset);

public record ChannelGroupDto(string Parent, IReadOnlyList<OptionItemDto> Items);

public record OptionsDto(
    IReadOnlyList<OptionItemDto> Categories,
    IReadOnlyList<OptionItemDto> Channels,
    IReadOnlyList<ChannelGroupDto> ChannelGroups,
    IReadOnlyList<OptionItemDto> Consumers,
    IReadOnlyList<OptionItemDto> Accounts,
    IReadOnlyList<OptionItemDto> Tags);

public record OptionAddRequest(string Kind, string Name, string? Parent);

public record TagRuleDto(long Id, string Keyword, string Tag);
public record TagRuleRequest(string Keyword, string Tag);

/* ------------------------- 报表 ------------------------- */

public record CategoryStatDto(string Name, long Amount, long Count, double Percent);

public record DayPointDto(string Date, long Income, long Expense);

public record ReportDto(
    long Income,
    long Expense,
    long Balance,
    long Count,
    IReadOnlyList<CategoryStatDto> Categories,
    IReadOnlyList<CategoryStatDto> IncomeCategories,
    IReadOnlyList<DayPointDto> Days);

/* ------------------------- 概览 ------------------------- */

public record OverviewDto(long TodayExpense, long TodayIncome, long MonthExpense, long MonthIncome, long EntryCount);
