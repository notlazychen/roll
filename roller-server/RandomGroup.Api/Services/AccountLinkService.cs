using System.Collections.Concurrent;

namespace RandomGroup.Api.Services;

/// <summary>/wechat 遇到陌生 openid 时签发的「认领票据」，5 分钟内有效、一次性消费</summary>
public sealed record WeChatLinkTicket(string OpenId, string? UnionId, DateTimeOffset ExpiresAt);

/// <summary>
/// bind-wechat 发现 openid 已被其他账号占用时签发的「合并票据」。
/// OwnerUid = 当前登录账号（接收方），DonorUid = 被并入并删除的旧账号。
/// </summary>
public sealed record WeChatMergeTicket(long OwnerUid, long DonorUid, string OpenId, string? UnionId, DateTimeOffset ExpiresAt);

/// <summary>
/// 微信身份认领 / 账号合并的短时票据存储。
/// 单机内存实现（与 WebQrLogin 一致）：进程重启票据清空，用户重新走一遍即可。
/// </summary>
public sealed class AccountLinkService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);

    private readonly ConcurrentDictionary<string, WeChatLinkTicket> _links = new();
    private readonly ConcurrentDictionary<string, WeChatMergeTicket> _merges = new();

    /// <summary>为陌生 openid 签发认领票据</summary>
    public (string Ticket, DateTimeOffset ExpiresAt) NewLinkTicket(string openId, string? unionId)
    {
        Cleanup();
        var ticket = NewToken("wl");
        var expires = DateTimeOffset.UtcNow.Add(Ttl);
        _links[ticket] = new WeChatLinkTicket(openId, unionId, expires);
        return (ticket, expires);
    }

    /// <summary>取出认领票据（一次性，取出即作废）</summary>
    public WeChatLinkTicket? TakeLinkTicket(string? ticket)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return null;
        if (!_links.TryRemove(ticket, out var t)) return null;
        return t.ExpiresAt >= DateTimeOffset.UtcNow ? t : null;
    }

    /// <summary>为「合并两个账号」签发确认票据</summary>
    public (string Ticket, DateTimeOffset ExpiresAt) NewMergeTicket(long ownerUid, long donorUid, string openId, string? unionId)
    {
        Cleanup();
        var ticket = NewToken("wm");
        var expires = DateTimeOffset.UtcNow.Add(Ttl);
        _merges[ticket] = new WeChatMergeTicket(ownerUid, donorUid, openId, unionId, expires);
        return (ticket, expires);
    }

    /// <summary>取出合并票据（一次性）。校验票据确实属于当前发起者，防止拿别人的票据乱并</summary>
    public WeChatMergeTicket? TakeMergeTicket(string? ticket, long currentUid)
    {
        if (string.IsNullOrWhiteSpace(ticket)) return null;
        if (!_merges.TryRemove(ticket, out var t)) return null;
        if (t.ExpiresAt < DateTimeOffset.UtcNow || t.OwnerUid != currentUid) return null;
        return t;
    }

    private void Cleanup()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var (k, v) in _links) if (v.ExpiresAt < now) _links.TryRemove(k, out _);
        foreach (var (k, v) in _merges) if (v.ExpiresAt < now) _merges.TryRemove(k, out _);
    }

    private static string NewToken(string prefix) =>
        prefix + "-" + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
}
