using System.Text;
using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using RandomGroup.Api.Data;

namespace RandomGroup.Api.Infrastructure;

public sealed class JwtOptions
{
    public string Issuer { get; set; } = "ledger";
    public string Audience { get; set; } = "ledger-miniprogram";
    /// <summary>对称密钥，生产环境务必用环境变量 Jwt__Key 覆盖</summary>
    public string Key { get; set; } = string.Empty;
    public int ExpireDays { get; set; } = 30;
}

public sealed class WeChatOptions
{
    public string AppId { get; set; } = string.Empty;
    public string AppSecret { get; set; } = string.Empty;
}

public sealed class AuthOptions
{
    /// <summary>
    /// 是否允许「开发模式登录」。仅用于本地联调：不接微信也能造出多个账号来验证多人流程。
    /// 生产环境必须保持 false（代码会额外校验当前必须是 Development 环境）。
    /// </summary>
    public bool AllowDevLogin { get; set; }
}

public sealed class TokenService
{
    private readonly JwtOptions _opt;
    private readonly JsonWebTokenHandler _handler = new();

    public TokenService(IOptions<JwtOptions> opt) => _opt = opt.Value;

    public string Create(LedgerUser user)
    {
        if (string.IsNullOrWhiteSpace(_opt.Key) || _opt.Key.Length < 32)
            throw new InvalidOperationException("Jwt:Key 未配置或长度不足 32 位，请在配置或环境变量 Jwt__Key 中设置");

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_opt.Key)),
            SecurityAlgorithms.HmacSha256);

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _opt.Issuer,
            Audience = _opt.Audience,
            IssuedAt = DateTime.UtcNow,
            Expires = DateTime.UtcNow.AddDays(_opt.ExpireDays <= 0 ? 30 : _opt.ExpireDays),
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.NickName)
            }),
            SigningCredentials = credentials
        };

        return _handler.CreateToken(descriptor);
    }
}
