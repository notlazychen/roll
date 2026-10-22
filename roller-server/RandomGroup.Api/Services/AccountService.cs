using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Infrastructure;

namespace RandomGroup.Api.Services;

/// <summary>
/// 账号相关的小工具：邮箱校验、昵称规范化与去重、对外 DTO 映射。
///
/// 选项源的预置数据由 OptionSourceService.EnsureAndLoadAsync 按需补种，
/// 这里不再重复初始化，避免两处逻辑各写一遍慢慢走样。
/// </summary>
public sealed class AccountService
{
    private readonly RollDbContext _db;

    public AccountService(RollDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// 极简邮箱校验：够挡住明显的笔误即可，不追求 RFC 完整性。
    /// 真正的有效性由「能不能收到邮件」决定，这里不做过度校验。
    /// </summary>
    public static bool IsValidEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;
        email = email.Trim();
        if (email.Length is < 5 or > 254) return false;

        var at = email.IndexOf('@');
        if (at <= 0 || at != email.LastIndexOf('@')) return false;

        var local = email[..at];
        var domain = email[(at + 1)..];
        if (local.Length is < 1 or > 64) return false;
        if (domain.Length < 3 || !domain.Contains('.')) return false;
        if (domain.StartsWith('.') || domain.EndsWith('.') || domain.Contains("..")) return false;

        // 不允许空白与常见非法字符
        foreach (var c in email)
        {
            if (char.IsWhiteSpace(c)) return false;
        }

        return true;
    }

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    /// <summary>
    /// 由邮箱生成默认昵称：取 @ 前的部分，超过 16 字截断
    /// （与 PUT /api/me 的昵称上限保持一致）。
    /// </summary>
    public static string NickFromEmail(string email)
    {
        var local = email.Split('@')[0];
        local = local.Trim();
        if (local.Length == 0) local = "用户";
        return local.Length > 16 ? local[..16] : local;
    }

    /// <summary>
    /// 昵称唯一键：去掉首尾空白并转小写，用于防重名判断。
    /// 昵称本身允许中文、数字、下划线、连字符与空格，其余字符拒绝。
    /// </summary>
    public static string NickKeyOf(string nickName) => nickName.Trim().ToLowerInvariant();

    /// <summary>校验昵称并返回去空白后的值</summary>
    public static string CleanNick(string? raw)
    {
        var nick = (raw ?? string.Empty).Trim();
        if (nick.Length is < 2 or > 16) throw ApiException.BadRequest("昵称需 2-16 个字符");
        foreach (var c in nick)
        {
            var ok = char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == ' ';
            if (!ok) throw ApiException.BadRequest("昵称只能包含中英文、数字、下划线、连字符和空格");
        }
        return nick;
    }

    /// <summary>
    /// 保证昵称唯一：先试原名，被占用就依次追加 2、3、4…
    /// 返回最终可用的昵称（调用方需要自行 SaveChanges）。
    /// </summary>
    public async Task<string> EnsureUniqueNickAsync(string desired, CancellationToken ct = default)
    {
        var baseNick = desired.Trim();
        if (baseNick.Length == 0) baseNick = "用户";
        if (baseNick.Length > 16) baseNick = baseNick[..16];

        var candidate = baseNick;
        var suffix = 2;

        while (await _db.Users.AnyAsync(u => u.NickKey == NickKeyOf(candidate), ct))
        {
            var tail = suffix.ToString();
            var keep = Math.Max(1, 16 - tail.Length);
            candidate = (baseNick.Length > keep ? baseNick[..keep] : baseNick) + tail;
            suffix++;
        }

        return candidate;
    }

    /// <summary>公开用户信息（不含手机号、密码哈希等敏感字段）</summary>
    public static UserDto ToDto(LedgerUser u) => new(
        u.Id, u.NickName, u.AvatarUrl, u.IsDevAccount, u.TagAutoEnabled,
        u.Email, u.OpenId is not null);

    /// <summary>
    /// 轻量登录节流：同一邮箱连续失败过多时暂时锁定。
    /// 存在进程内存里，多实例部署时各自计数 —— 对当前单机部署足够，
    /// 将来上多实例再换成 Redis。
    /// </summary>
    public sealed class LoginThrottle
    {
        private readonly Dictionary<string, (int Count, DateTimeOffset Until)> _map = new();
        private const int MaxFailures = 8;
        private static readonly TimeSpan LockFor = TimeSpan.FromMinutes(10);

        /// <summary>是否处于锁定期</summary>
        public bool IsLocked(string key)
        {
            lock (_map)
            {
                if (!_map.TryGetValue(key, out var state)) return false;
                if (state.Until <= DateTimeOffset.UtcNow)
                {
                    _map.Remove(key);
                    return false;
                }
                return state.Count >= MaxFailures;
            }
        }

        public void RecordFailure(string key)
        {
            lock (_map)
            {
                if (_map.Count > 5000) _map.Clear(); // 防止被刷爆内存
                var count = _map.TryGetValue(key, out var state) ? state.Count + 1 : 1;
                _map[key] = (count, DateTimeOffset.UtcNow.Add(LockFor));
            }
        }

        public void Reset(string key)
        {
            lock (_map)
            {
                _map.Remove(key);
            }
        }
    }
}
