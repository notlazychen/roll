using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using RandomGroup.Api.Infrastructure;

namespace RandomGroup.Api.Services;

/// <summary>
/// 邮箱验证码：内存存储（单机部署足够），10 分钟有效、5 次尝试上限、同地址 60 秒重发限制。
/// 三种用途：注册 / 绑定邮箱 / 解绑邮箱（互不通用）。
/// 未配置 SMTP 时：开发环境把验证码打进日志并通过 debugCode 返回给客户端（仅 Development），
/// 生产环境直接报「邮件服务未配置」，避免验证码静默丢失。
/// </summary>
public sealed class EmailCodeService
{
    public static class Purposes
    {
        public const string Register = "register";
        public const string Bind = "bind";
        public const string Unbind = "unbind";

        public static bool IsValid(string? p) =>
            p is Register or Bind or Unbind;

        public static string LabelOf(string p) => p switch
        {
            Register => "注册",
            Bind => "绑定邮箱",
            _ => "解绑邮箱"
        };
    }

    private sealed record CodeEntry(string Code, DateTimeOffset ExpiresAt, int Attempts);

    private readonly ConcurrentDictionary<string, CodeEntry> _store = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _lastSendAt = new();
    private readonly MailSender _mail;
    private readonly IHostEnvironment _env;
    private readonly ILogger<EmailCodeService> _log;

    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan ResendInterval = TimeSpan.FromSeconds(60);
    private const int MaxAttempts = 5;

    public EmailCodeService(MailSender mail, IHostEnvironment env, ILogger<EmailCodeService> log)
    {
        _mail = mail;
        _env = env;
        _log = log;
    }

    private static string KeyOf(string purpose, string email) => purpose + ":" + email;

    /// <summary>发送验证码。返回 (sent, debugCode, hint)；debugCode 仅开发环境非空。</summary>
    public async Task<(bool Sent, string? DebugCode, string? Hint)> SendAsync(
        string email, string purpose, CancellationToken ct = default)
    {
        email = AccountService.NormalizeEmail(email);
        var key = KeyOf(purpose, email);

        // 清一清过期项，防止字典被慢慢撑大
        if (_store.Count > 5000)
        {
            foreach (var kv in _store)
                if (kv.Value.ExpiresAt <= DateTimeOffset.UtcNow)
                    _store.TryRemove(kv.Key, out _);
        }

        if (_lastSendAt.TryGetValue(key, out var last) &&
            DateTimeOffset.UtcNow - last < ResendInterval)
        {
            throw ApiException.BadRequest("发送太频繁，请 1 分钟后再试");
        }

        var code = Random.Shared.Next(0, 1_000_000).ToString("D6");
        _store[key] = new CodeEntry(code, DateTimeOffset.UtcNow.Add(Ttl), 0);
        _lastSendAt[key] = DateTimeOffset.UtcNow;

        var label = Purposes.LabelOf(purpose);

        if (!_mail.IsConfigured)
        {
            if (!_env.IsDevelopment())
                throw new ApiException(
                    "邮件服务未配置，暂时无法发送验证码，请联系管理员", 503);

            _log.LogWarning("[DEV] 邮件服务未配置，{Purpose} 验证码 {Code}（{Email}）直接返回给客户端",
                purpose, code, email);
            return (false, code, "开发环境：邮件服务未配置，验证码直接返回（仅限 Development）");
        }

        var subject = $"【哈姆斯特】{label}验证码";
        var body = "你好！\n\n" +
                   $"你的{label}验证码是：{code}\n\n" +
                   $"验证码 10 分钟内有效，请勿泄露给他人。\n" +
                   "如果不是你本人的操作，请忽略这封邮件。\n\n—— 哈姆斯特 · 仓鼠之家";

        try
        {
            await _mail.SendAsync(email, subject, body, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // 发送失败作废这张码，避免「收到失败提示但码仍有效」的困惑
            _store.TryRemove(key, out _);
            _lastSendAt.TryRemove(key, out _);
            _log.LogError(ex, "邮件发送失败 to={Email} purpose={Purpose}", email, purpose);
            throw new ApiException("验证码邮件发送失败，请稍后重试", 502);
        }

        return (true, null, null);
    }

    /// <summary>
    /// 校验并消费验证码：过期 / 次数超限 / 不匹配分别给出可读错误。
    /// email 传未规范化的原值即可，这里统一规范化。
    /// </summary>
    public Task ConsumeAsync(string email, string purpose, string? code, CancellationToken ct = default)
    {
        email = AccountService.NormalizeEmail(email);
        var input = (code ?? string.Empty).Trim();

        if (input.Length == 0)
            throw ApiException.BadRequest("请输入邮箱验证码");

        var key = KeyOf(purpose, email);
        if (!_store.TryGetValue(key, out var entry))
            throw ApiException.BadRequest("验证码不存在或已过期，请重新发送");

        if (entry.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            _store.TryRemove(key, out _);
            throw ApiException.BadRequest("验证码已过期，请重新发送");
        }

        if (entry.Attempts >= MaxAttempts)
        {
            _store.TryRemove(key, out _);
            throw ApiException.BadRequest("验证码尝试次数过多，请重新发送");
        }

        if (!string.Equals(entry.Code, input, StringComparison.Ordinal))
        {
            _store[key] = entry with { Attempts = entry.Attempts + 1 };
            throw ApiException.BadRequest("验证码不正确，请重新输入");
        }

        _store.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
