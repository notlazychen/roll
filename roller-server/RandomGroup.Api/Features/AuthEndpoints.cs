using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

/// <summary>
/// 微信登录只拿 code。昵称与头像走客户端现成的 userProfile，
/// 因为 wx.getUserProfile / chooseAvatar 由客户端授权后直接给出。
/// </summary>
public record WeChatLoginRequest(string Code, string? NickName, string? AvatarUrl);
/// <summary>
/// 开发模式登录。deviceKey 是稳定标识（客户端生成并保存在本地），
/// 用它而不是昵称来生成 openid —— 这样改昵称不会变成另一个账号。
/// </summary>
public record DevLoginRequest(string NickName, string? DeviceKey);
public record UpdateProfileRequest(string? NickName, string? AvatarUrl, bool? TagAutoEnabled);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("认证");

        // 微信一键登录：小程序 wx.login 拿到 code，服务端用 AppSecret 换 openid，再签发自己的 JWT
        auth.MapPost("/wechat", async (
            WeChatLoginRequest req,
            RollDbContext db,
            WeChatClient wechat,
            TokenService tokens,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Code))
                throw ApiException.BadRequest("缺少微信登录凭证 code");

            var session = await wechat.Code2SessionAsync(req.Code, ct);
            var now = DateTimeOffset.UtcNow;

            var user = await db.Users.FirstOrDefaultAsync(u => u.OpenId == session.OpenId, ct);
            var isNew = user is null;

            if (user is null)
            {
                user = new LedgerUser
                {
                    OpenId = session.OpenId,
                    UnionId = session.UnionId,
                    NickName = string.IsNullOrWhiteSpace(req.NickName) ? DefaultNick() : req.NickName.Trim(),
                    AvatarUrl = req.AvatarUrl,
                    CreatedAt = now,
                    LastLoginAt = now
                };
                db.Users.Add(user);
            }
            else
            {
                user.LastLoginAt = now;
                if (!string.IsNullOrWhiteSpace(session.UnionId)) user.UnionId = session.UnionId;
                if (!string.IsNullOrWhiteSpace(req.NickName)) user.NickName = req.NickName.Trim();
                if (!string.IsNullOrWhiteSpace(req.AvatarUrl)) user.AvatarUrl = req.AvatarUrl;
            }

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = new UserDto(user.Id, user.NickName, user.AvatarUrl, user.IsDevAccount, user.TagAutoEnabled),
                isNew
            });
        }).AllowAnonymous();

        // 开发模式登录：仅在 Development 环境且显式打开开关时可用，用于本地联调
        auth.MapPost("/dev", async (
            DevLoginRequest req,
            RollDbContext db,
            TokenService tokens,
            IOptions<AuthOptions> authOptions,
            IHostEnvironment env,
            CancellationToken ct) =>
        {
            if (!env.IsDevelopment() || !authOptions.Value.AllowDevLogin)
                throw ApiException.Forbidden("当前环境不允许开发模式登录");

            var nick = string.IsNullOrWhiteSpace(req.NickName) ? "记账用户" : req.NickName.Trim();
            if (nick.Length > 16) throw ApiException.BadRequest("昵称最多 16 个字符");

            var deviceKey = string.IsNullOrWhiteSpace(req.DeviceKey) ? nick : req.DeviceKey.Trim();
            if (deviceKey.Length > 64) throw ApiException.BadRequest("deviceKey 过长");

            var openId = "dev:" + deviceKey;
            var now = DateTimeOffset.UtcNow;

            var user = await db.Users.FirstOrDefaultAsync(u => u.OpenId == openId, ct);
            if (user is null)
            {
                user = new LedgerUser
                {
                    OpenId = openId,
                    NickName = nick,
                    IsDevAccount = true,
                    CreatedAt = now,
                    LastLoginAt = now
                };
                db.Users.Add(user);
            }
            else
            {
                // 同一 deviceKey 再次登录只更新昵称，uid 保持不变
                user.NickName = nick;
                user.LastLoginAt = now;
            }

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = new UserDto(user.Id, user.NickName, user.AvatarUrl, user.IsDevAccount, user.TagAutoEnabled),
                isNew = false,
                dev = true
            });
        }).AllowAnonymous();

        // 当前登录用户 + 我的记账概览
        app.MapGet("/api/me", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var total = await db.Entries.AsNoTracking().CountAsync(e => e.UserId == uid, ct);
            var firstAt = await db.Entries.AsNoTracking()
                .Where(e => e.UserId == uid)
                .OrderBy(e => e.CreatedAt)
                .Select(e => (DateTimeOffset?)e.CreatedAt)
                .FirstOrDefaultAsync(ct);

            return Results.Json(new
            {
                ok = true,
                user = new UserDto(user.Id, user.NickName, user.AvatarUrl, user.IsDevAccount, user.TagAutoEnabled),
                stats = new { entryCount = total, firstRecordAt = firstAt.ToMs() }
            });
        }).WithTags("认证");

        // 修改昵称 / 头像 / 标签自动识别开关
        app.MapPut("/api/me", async (
            UpdateProfileRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (req.NickName is not null)
            {
                var nick = req.NickName.Trim();
                if (nick.Length == 0) throw ApiException.BadRequest("昵称不能为空");
                if (nick.Length > 16) throw ApiException.BadRequest("昵称最多 16 个字符");
                user.NickName = nick;
            }

            if (req.AvatarUrl is not null)
                user.AvatarUrl = string.IsNullOrWhiteSpace(req.AvatarUrl) ? null : req.AvatarUrl;

            if (req.TagAutoEnabled.HasValue)
                user.TagAutoEnabled = req.TagAutoEnabled.Value;

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                user = new UserDto(user.Id, user.NickName, user.AvatarUrl, user.IsDevAccount, user.TagAutoEnabled)
            });
        }).WithTags("认证");

        // 标签识别规则列表（配合「标签管理」页展示与删除）
        app.MapGet("/api/tag-rules", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var rules = await db.TagRules.AsNoTracking()
                .Where(r => r.UserId == uid)
                .OrderBy(r => r.Id)
                .Select(r => new { r.Id, r.Keyword, r.Tag })
                .ToListAsync(ct);
            return Results.Json(new { ok = true, rules });
        }).WithTags("选项源");
    }

    private static string DefaultNick() => "记账" + Random.Shared.Next(1000, 10000);
}
