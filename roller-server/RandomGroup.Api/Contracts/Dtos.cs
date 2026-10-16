namespace RandomGroup.Api.Contracts;

/// <summary>
/// 响应结构与小程序端原来的 utils/store.js 保持一致：
/// 1) 所有时间字段都是「毫秒时间戳」数字，前端可直接做减法算倒计时；
/// 2) 成员/备选项/通知里的用户标识统一叫 uid；
/// 3) 增删改接口返回 { ok, ... }，失败时 ok=false 且带 error。
/// </summary>
public static class TimeMs
{
    public static long ToMs(this DateTimeOffset t) => t.ToUnixTimeMilliseconds();
    public static long? ToMs(this DateTimeOffset? t) => t?.ToUnixTimeMilliseconds();

    public static DateTimeOffset FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms);
    public static DateTimeOffset? FromMs(long? ms) => ms.HasValue ? DateTimeOffset.FromUnixTimeMilliseconds(ms.Value) : null;
}

public record UserDto(long Id, string NickName, string? AvatarUrl, bool IsDevAccount);

/// <summary>小队。passcode 只对小队长下发，其他成员拿到空串（避免口令泄露）。</summary>
public record GroupDto(
    long Id,
    string Code,
    string Theme,
    string Passcode,
    long OwnerId,
    string OwnerName,
    string Stage,
    long? PrepStartedAt,
    long? PrepDeadline,
    long? ResultOptionId,
    long? ResultAt,
    long CreatedAt,
    int MemberCount,
    bool HasPasscode);

public record MemberDto(long Id, long GroupId, long Uid, string Name, string Ready, long JoinedAt);

public record OptionDto(
    long Id,
    long GroupId,
    string Title,
    long CreatorId,
    string CreatorName,
    long CreatedAt,
    int VoteCount,
    IReadOnlyList<long> Voters);

public record WeightItemDto(
    long OptionId,
    string Title,
    int Votes,
    long CreatorId,
    string CreatorName,
    int ColorIndex,
    double Weight,
    double Percent);

public record WeightsDto(IReadOnlyList<WeightItemDto> Items, int TotalVotes, bool Uniform);

public record NotificationDto(
    long Id,
    long Uid,
    long? GroupId,
    string GroupTheme,
    string Type,
    string Content,
    bool Read,
    long CreatedAt);

public record StatsDto(int JoinedCount, int OwnedCount);

/// <summary>轮询用的轻量状态，只包含推进阶段与刷新界面所需的最小信息</summary>
public record GroupStateDto(
    long GroupId,
    string Stage,
    int MemberCount,
    int OptionCount,
    int ConfirmedCount,
    long? PrepDeadline,
    long? ResultOptionId,
    long? ResultAt);
