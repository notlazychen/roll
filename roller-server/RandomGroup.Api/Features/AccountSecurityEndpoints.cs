using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

/* ------------------------- 请求体 ------------------------- */

/// <summary>发送邮箱验证码。purpose: register / bind / unbind</summary>
public record EmailCodeRequest(string? Email, string? Purpose);

/// <summary>绑定邮箱：验证发到新邮箱的验证码</summary>
public record BindEmailRequest(string? Email, string? Code);

/// <summary>解绑邮箱：验证发到当前绑定邮箱的验证码</summary>
public record UnbindEmailRequest(string? Code);

/// <summary>解绑微信：小程序端带 wx.login 的 code 做二次校验；网页端可不带</summary>
public record UnbindWeChatRequest(string? Code);

/// <summary>
/// 账号安全管理：绑定/解绑邮箱（带邮箱验证码）、解绑微信。
/// 与 AuthEndpoints 平级，避开一个文件越改越长。
/// </summary>
public static class AccountSecurityEndpoints
{
    public static void MapAccountSecurityEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("账号安全");

        // 发送邮箱验证码（匿名）：注册 / 绑定 / 解绑 三种用途
        auth.MapPost("/email-code", async (
            EmailCodeRequest req,
            EmailCodeService codes,
            CancellationToken ct) =>
        {
            var email = AccountService.NormalizeEmail(req.Email ?? string.Empty);
            if (!AccountService.IsValidEmail(email))
                throw ApiException.BadRequest("邮箱格式不正确");

            var purpose = req.Purpose ?? EmailCodeService.Purposes.Register;
            if (!EmailCodeService.Purposes.IsValid(purpose))
                throw ApiException.BadRequest("未知的验证码用途");

            var (sent, debugCode, hint) = await codes.SendAsync(email, purpose, ct);
            return Results.Json(new { ok = true, sent, debugCode, hint });
        }).AllowAnonymous();

        // 绑定邮箱：验证码发到「新邮箱」，验证通过后才落库
        auth.MapPost("/bind-email", async (
            BindEmailRequest req,
            HttpContext ctx,
            RollDbContext db,
            EmailCodeService codes,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (!string.IsNullOrEmpty(user.Email))
                throw ApiException.BadRequest("该账号已绑定邮箱，如需更换请先解绑");

            var email = AccountService.NormalizeEmail(req.Email ?? string.Empty);
            if (!AccountService.IsValidEmail(email))
                throw ApiException.BadRequest("邮箱格式不正确");

            await codes.ConsumeAsync(email, EmailCodeService.Purposes.Bind, req.Code, ct);

            var taken = await db.Users.AnyAsync(u => u.Email == email && u.Id != uid, ct);
            if (taken)
                throw ApiException.BadRequest("该邮箱已被其他账号使用");

            user.Email = email;
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, user = AccountService.ToDto(user) });
        });

        // 解绑邮箱：验证码发到「当前绑定的邮箱」，确认是本人操作
        auth.MapPost("/unbind-email", async (
            UnbindEmailRequest req,
            HttpContext ctx,
            RollDbContext db,
            EmailCodeService codes,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (string.IsNullOrEmpty(user.Email))
                throw ApiException.BadRequest("当前账号没有绑定邮箱");

            await codes.ConsumeAsync(user.Email, EmailCodeService.Purposes.Unbind, req.Code, ct);

            user.Email = null;
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, user = AccountService.ToDto(user) });
        });

        // 解绑微信：要求账号已有邮箱（否则解绑后将无法登录）；
        // 小程序端带 wx.login 的 code，服务端校验 openid 确实是绑定的那个微信
        auth.MapPost("/unbind-wechat", async (
            UnbindWeChatRequest req,
            HttpContext ctx,
            RollDbContext db,
            WeChatClient wechat,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (string.IsNullOrEmpty(user.OpenId))
                throw ApiException.BadRequest("当前账号没有绑定微信");

            if (string.IsNullOrEmpty(user.Email))
                throw ApiException.BadRequest("请先绑定邮箱再解绑微信，否则解绑后将无法登录本账号");

            if (!string.IsNullOrWhiteSpace(req.Code))
            {
                var session = await wechat.Code2SessionAsync(req.Code, ct);
                if (session.OpenId != user.OpenId)
                    throw ApiException.BadRequest("授权的微信与当前绑定的不一致，请用绑定的微信操作");
            }
            // 网页端没有微信授权能力：已通过登录态鉴权，直接解绑

            user.OpenId = null;
            user.UnionId = null;
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true, user = AccountService.ToDto(user) });
        });
    }
}
