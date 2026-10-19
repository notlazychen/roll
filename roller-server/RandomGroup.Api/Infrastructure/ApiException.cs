using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;

namespace RandomGroup.Api.Infrastructure;

/// <summary>统一的业务异常。中间件会把它翻译成 { ok:false, error } 的 400 响应。</summary>
public class ApiException : Exception
{
    public int StatusCode { get; }
    public object? Extra { get; }

    public ApiException(string message, int statusCode = 400, object? extra = null) : base(message)
    {
        StatusCode = statusCode;
        Extra = extra;
    }

    public static ApiException BadRequest(string message, object? extra = null) => new(message, 400, extra);
    public static ApiException Forbidden(string message) => new(message, 403);
    public static ApiException NotFound(string message) => new(message, 404);
    public static ApiException Unauthorized(string message) => new(message, 401);
}

public static class ClaimsExtensions
{
    public static long? TryGetUserId(this ClaimsPrincipal? principal)
    {
        var raw = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        return long.TryParse(raw, out var id) ? id : null;
    }

    /// <summary>取当前登录用户 id，未登录直接抛 401。</summary>
    public static long GetUserId(this ClaimsPrincipal? principal)
        => principal.TryGetUserId() ?? throw ApiException.Unauthorized("登录状态已失效，请重新登录");
}

/// <summary>把异常转成前端约定的响应体</summary>
public sealed class ApiExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ApiExceptionMiddleware> _log;

    public ApiExceptionMiddleware(RequestDelegate next, ILogger<ApiExceptionMiddleware> log)
    {
        _next = next;
        _log = log;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ApiException ex)
        {
            await WriteAsync(context, ex.StatusCode, ex.Message, ex.Extra);
        }
        catch (BadHttpRequestException ex)
        {
            await WriteAsync(context, 400, "请求参数不合法：" + ex.Message, null);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "处理请求 {Path} 时发生未预期异常", context.Request.Path);
            await WriteAsync(context, 500, "服务端开小差了，请稍后重试", null);
        }
    }
    private static async Task WriteAsync(HttpContext context, int status, string message, object? extra)
    {
        if (context.Response.HasStarted) return;
        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";

        var payload = new Dictionary<string, object?>
        {
            ["ok"] = false,
            ["error"] = message
        };

        if (extra is not null)
        {
            foreach (var prop in extra.GetType().GetProperties())
                payload[char.ToLowerInvariant(prop.Name[0]) + prop.Name[1..]] = prop.GetValue(extra);
        }

        await context.Response.WriteAsJsonAsync(payload);
    }
}
