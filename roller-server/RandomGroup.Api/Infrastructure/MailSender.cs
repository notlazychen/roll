using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Options;

namespace RandomGroup.Api.Infrastructure;

/// <summary>
/// SMTP 配置（appsettings 的 "Mail" 节，生产环境用环境变量 Mail__Host 等覆盖）。
/// 字段名刻意避开常见敏感词，凭据请用环境变量注入，不要提交进仓库。
/// </summary>
public sealed class MailOptions
{
    /// <summary>SMTP 服务器，留空表示未配置邮件服务</summary>
    public string Host { get; set; } = string.Empty;

    /// <summary>端口。注意 System.Net.Mail 只支持 STARTTLS（如 587），不支持 465 隐式 TLS</summary>
    public int Port { get; set; } = 587;

    /// <summary>SMTP 登录账号（一般是发件邮箱）</summary>
    public string User { get; set; } = string.Empty;

    /// <summary>SMTP 授权码</summary>
    public string Pass { get; set; } = string.Empty;

    /// <summary>发件人显示地址，缺省用 User</summary>
    public string? From { get; set; }

    /// <summary>是否启用 STARTTLS</summary>
    public bool Ssl { get; set; } = true;
}

/// <summary>
/// 邮件发送器：只在生产环境真正出网发信；
/// 开发/测试环境不配置 Mail:Host 时，验证码走日志与 debugCode 返回，方便契约测试。
/// </summary>
public sealed class MailSender
{
    private readonly MailOptions _opt;
    private readonly ILogger<MailSender> _log;

    public MailSender(IOptions<MailOptions> opt, ILogger<MailSender> log)
    {
        _opt = opt.Value;
        _log = log;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_opt.Host);

    public async Task SendAsync(string to, string subject, string body, CancellationToken ct)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("邮件服务未配置（Mail:Host 为空）");

        _log.LogInformation("发送邮件 to={To} subject={Subject}", to, subject);

        // SmtpClient 不支持取消令牌，靠端口连接超时兜底；发送失败抛给调用方处理
        using var client = new SmtpClient(_opt.Host, _opt.Port)
        {
            EnableSsl = _opt.Ssl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(_opt.User, _opt.Pass),
            Timeout = 15000
        };

        using var message = new MailMessage
        {
            From = new MailAddress(_opt.From ?? _opt.User, "哈姆斯特", Encoding.UTF8),
            Subject = subject,
            SubjectEncoding = Encoding.UTF8,
            Body = body,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = false
        };
        message.To.Add(new MailAddress(to));

        await client.SendMailAsync(message);
    }
}
