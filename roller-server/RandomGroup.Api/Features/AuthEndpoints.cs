using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

/// <summary>
/// 微信一键登录。微信只给 openid，不给头像昵称 —— 头像昵称由客户端另外走
/// 「头像昵称填写能力」收集后提交（见 ProfileEndpoints 与小程序「我的」页）。
/// NickName 保留可选：客户端若已拿到昵称可以顺带带上，省一次改资料请求。
/// </summary>
public record WeChatLoginRequest(string Code, string? NickName);
/// <summary>
/// 开发模式登录。deviceKey 是稳定标识（客户端生成并保存在本地），
/// 用它而不是昵称来生成 openid —— 这样改昵称不会变成另一个账号。
/// </summary>
public record DevLoginRequest(string NickName, string? DeviceKey);
public record UpdateProfileRequest(string NickName);

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
                user = new RollUser
                {
                    OpenId = session.OpenId,
                    UnionId = session.UnionId,
                    NickName = string.IsNullOrWhiteSpace(req.NickName) ? DeviceDefaultNick() : req.NickName.Trim(),
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
            }

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = ToDto(user),
                isNew,
                needNickName = string.IsNullOrWhiteSpace(req.NickName) && isNew
            });
        }).AllowAnonymous();

        // 开发模式登录：仅在 Development 环境且显式打开开关时可用，用于本地验证多人流程
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

            var nick = string.IsNullOrWhiteSpace(req.NickName) ? "测试成员" : req.NickName.Trim();
            if (nick.Length > 16) throw ApiException.BadRequest("昵称最多 16 个字符");

            var deviceKey = string.IsNullOrWhiteSpace(req.DeviceKey) ? nick : req.DeviceKey.Trim();
            if (deviceKey.Length > 64) throw ApiException.BadRequest("deviceKey 过长");

            var openId = "dev:" + deviceKey;
            var now = DateTimeOffset.UtcNow;

            var user = await db.Users.FirstOrDefaultAsync(u => u.OpenId == openId, ct);
            if (user is null)
            {
                user = new RollUser
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

            // 已加入小队里的显示名跟着改，避免出现两个名字
            await db.Members.Where(m => m.UserId == user.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.Name, nick), ct);
            await db.Groups.Where(g => g.OwnerId == user.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(g => g.OwnerName, nick), ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = ToDto(user),
                isNew = false,
                dev = true
            });
        }).AllowAnonymous();

        // 当前登录用户
        app.MapGet("/api/me", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            return Results.Json(new { ok = true, user = ToDto(user) });
        }).WithTags("认证");

        // 修改昵称：同步更新已加入小队里的显示名与小队长名称。
        // 头像不走这里，改头像用 POST /api/me/avatar（见 ProfileEndpoints）。
        app.MapPut("/api/me", async (
            UpdateProfileRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var nick = (req.NickName ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(nick)) throw ApiException.BadRequest("昵称不能为空");
            if (nick.Length > 16) throw ApiException.BadRequest("昵称最多 16 个字符");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            user.NickName = nick;

            await db.Members.Where(m => m.UserId == uid)
                .ExecuteUpdateAsync(s => s.SetProperty(m => m.Name, nick), ct);
            await db.Groups.Where(g => g.OwnerId == uid)
                .ExecuteUpdateAsync(s => s.SetProperty(g => g.OwnerName, nick), ct);

            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, user = ToDto(user) });
        }).WithTags("认证");

        // 我的统计：已加入小队数与我创建的小队数
        app.MapGet("/api/me/stats", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var joined = await (
                from m in db.Members.AsNoTracking()
                join g in db.Groups.AsNoTracking() on m.GroupId equals g.Id
                where m.UserId == uid
                select m.Id
            ).CountAsync(ct);

            var owned = await db.Groups.AsNoTracking().CountAsync(g => g.OwnerId == uid, ct);

            return Results.Json(new { ok = true, stats = new StatsDto(joined, owned) });
        }).WithTags("认证");
    }

    private static string DeviceDefaultNick()
        => "成员" + Random.Shared.Next(1000, 10000);

    /// <summary>统一出口：头像地址永远由 AvatarUrls 现算，库里不再存 URL</summary>
    private static UserDto ToDto(RollUser user)
        => new(user.Id, user.NickName, AvatarUrls.For(user), user.IsDevAccount);
}
