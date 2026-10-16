using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace RandomGroup.Api.Infrastructure;

public sealed record WeChatSession(string OpenId, string? UnionId);

/// <summary>
/// 微信登录凭证校验。
/// 注意：api.weixin.qq.com 不允许被配置为小程序的服务器域名，
/// 因此 AppSecret 只能留在服务端，由这里发起 code2session 换取 openid。
/// </summary>
public sealed class WeChatClient
{
    private readonly HttpClient _http;
    private readonly WeChatOptions _opt;

    public WeChatClient(HttpClient http, IOptions<WeChatOptions> opt)
    {
        _http = http;
        _opt = opt.Value;
    }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_opt.AppId) && !string.IsNullOrWhiteSpace(_opt.AppSecret);

    public async Task<WeChatSession> Code2SessionAsync(string code, CancellationToken ct)
    {
        if (!IsConfigured)
            throw ApiException.BadRequest(
                "服务端尚未配置微信 AppId / AppSecret，暂时无法完成微信登录");

        var url = "https://api.weixin.qq.com/sns/jscode2session" +
                  $"?appid={Uri.EscapeDataString(_opt.AppId)}" +
                  $"&secret={Uri.EscapeDataString(_opt.AppSecret)}" +
                  $"&js_code={Uri.EscapeDataString(code)}" +
                  "&grant_type=authorization_code";

        Code2SessionResponse? res;
        try
        {
            res = await _http.GetFromJsonAsync<Code2SessionResponse>(url, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new ApiException("连接微信服务器失败：" + ex.Message, 502);
        }

        if (res is null)
            throw new ApiException("微信登录失败：微信未返回数据", 502);

        if (res.ErrCode is not null and not 0)
            throw ApiException.BadRequest($"微信登录失败（{res.ErrCode}）：{res.ErrMsg ?? "未知错误"}");

        if (string.IsNullOrWhiteSpace(res.OpenId))
            throw ApiException.BadRequest("微信登录失败：未取到 openid");

        return new WeChatSession(res.OpenId, res.UnionId);
    }

    private sealed class Code2SessionResponse
    {
        [JsonPropertyName("openid")] public string? OpenId { get; set; }
        [JsonPropertyName("unionid")] public string? UnionId { get; set; }
        [JsonPropertyName("session_key")] public string? SessionKey { get; set; }
        [JsonPropertyName("errcode")] public int? ErrCode { get; set; }
        [JsonPropertyName("errmsg")] public string? ErrMsg { get; set; }
    }
}
