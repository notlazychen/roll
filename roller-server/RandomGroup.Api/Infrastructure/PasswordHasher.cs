using System.Security.Cryptography;
using System.Text;

namespace RandomGroup.Api.Infrastructure;

/// <summary>
/// 密码哈希：PBKDF2-HMACSHA256 + 每用户随机盐。
///
/// 存库格式：v1$迭代次数$盐(base64)$子键(base64)
/// 前面带版本号是为了以后换算法（比如 Argon2）时能平滑过渡：
/// 校验时按行内记录的版本与迭代次数算，旧密码继续能登录，
/// 新密码统一用当前版本写入。
///
/// 用 PBKDF2 而不是 ASP.NET 自带的 PasswordHasher，是为了不引入
/// Microsoft.AspNetCore.Identity 整套依赖（本项目是 Minimal API，
/// 没有 Identity 的 UserManager 等基础设施）。
/// </summary>
public static class PasswordHasher
{
    /// <summary>OWASP 对 PBKDF2-HMACSHA256 的建议值（2023 之后）</summary>
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const string Version = "v1";

    public static string Hash(string password)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, KeySize);

        return string.Join('$', Version, Iterations.ToString(), Convert.ToBase64String(salt), Convert.ToBase64String(key));
    }

    /// <summary>
    /// 校验密码。哈希串损坏或格式不认识时一律返回 false，不抛异常，
    /// 避免历史脏数据把登录接口打成 500。
    /// </summary>
    public static bool Verify(string? stored, string password)
    {
        if (string.IsNullOrEmpty(stored) || string.IsNullOrEmpty(password)) return false;

        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Version) return false;
        if (!int.TryParse(parts[1], out var iterations) || iterations <= 0) return false;

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);

        // 定长比较，避免按字节短路泄露信息
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
