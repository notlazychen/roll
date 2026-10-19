using RandomGroup.Api.Data;

namespace RandomGroup.Api.Infrastructure;

/// <summary>
/// 头像地址与格式校验
/// ---------------------------------------------------------------
/// 接口只下发「相对路径 + 版本号」，形如 /api/users/12/avatar?v=3，
/// 由客户端自己拼上它正在使用的服务地址（utils/config.js 的 baseUrl）。
/// 好处：反代后的真实域名、端口、本地调试地址都不用让服务端知道，换域名也不用刷库。
/// </summary>
public static class AvatarUrls
{
    /// <summary>单张头像上限。小程序端会先压到 240px JPEG（约 10~30KB），512KB 留足余量。</summary>
    public const int MaxBytes = 512 * 1024;

    public const string DefaultContentType = "image/jpeg";

    public static readonly string[] AllowedContentTypes =
    [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    /// <summary>没有头像时返回 null，客户端据此回退到「底色 + 首字」的圆形占位。</summary>
    public static string? For(RollUser user)
        => user.AvatarData is { Length: > 0 }
            ? $"/api/users/{user.Id}/avatar?v={user.AvatarVersion}"
            : null;

    /// <summary>
    /// 按文件头判断图片类型。不信任客户端传来的 MIME，
    /// 既挡住「把任意文件当头像传上来」，也顺手挡住伪造扩展名。
    /// </summary>
    public static string? SniffContentType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            return "image/jpeg";

        if (bytes.Length >= 8 &&
            bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 &&
            bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A)
            return "image/png";

        // RIFF....WEBP
        if (bytes.Length >= 12 &&
            bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
            bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            return "image/webp";

        return null;
    }

    /// <summary>去掉 data URI 前缀（小程序端有时会带上），返回纯 base64</summary>
    public static string StripDataUriPrefix(string? raw)
    {
        var text = (raw ?? string.Empty).Trim();
        var comma = text.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
        return comma >= 0 ? text[(comma + 7)..] : text;
    }
}
