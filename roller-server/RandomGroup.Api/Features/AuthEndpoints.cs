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

/* ------------------------- Web 端邮箱账号 ------------------------- */

/// <summary>注册：邮箱 + 密码，昵称可选（不填就用邮箱前缀）</summary>
public record RegisterRequest(string Email, string Password, string? NickName);

/// <summary>登录：邮箱 + 密码</summary>
public record LoginRequest(string Email, string Password);

/// <summary>修改密码（需要登录态）</summary>
public record ChangePasswordRequest(string? OldPassword, string NewPassword);

/// <summary>
/// 微信绑定：已登录的 Web 账号把小程序身份并进来。
/// Code 由小程序侧 wx.login 获取后通过二维码/中转页传给 Web 端。
/// </summary>
public record BindWeChatRequest(string Code);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("认证");

        /* ----------------------- Web 端：邮箱注册 / 登录 ----------------------- */

        // 注册。注册成功直接签发 token，前端不用再走一次登录
        auth.MapPost("/register", async (
            RegisterRequest req,
            RollDbContext db,
            TokenService tokens,
            AccountService accounts,
            CancellationToken ct) =>
        {
            if (!AccountService.IsValidEmail(req.Email))
                throw ApiException.BadRequest("邮箱格式不正确");

            // 密码强度：至少 8 位，且不能是纯数字/纯字母，避免随手设个 12345678
            var pwd = req.Password ?? string.Empty;
            if (pwd.Length < 8) throw ApiException.BadRequest("密码至少 8 位");
            if (pwd.Length > 64) throw ApiException.BadRequest("密码最多 64 位");
            if (pwd.All(char.IsDigit) || pwd.All(char.IsLetter))
                throw ApiException.BadRequest("密码需要同时包含字母和数字");

            var email = AccountService.NormalizeEmail(req.Email);

            if (await db.Users.AnyAsync(u => u.Email == email, ct))
                throw ApiException.BadRequest("该邮箱已注册，请直接登录");

            var now = DateTimeOffset.UtcNow;

            // 昵称不填就用邮箱前缀；重名自动追加数字
            var desiredNick = string.IsNullOrWhiteSpace(req.NickName)
                ? AccountService.NickFromEmail(email)
                : AccountService.CleanNick(req.NickName);
            var nick = await accounts.EnsureUniqueNickAsync(desiredNick, ct);

            var user = new LedgerUser
            {
                Email = email,
                PasswordHash = PasswordHasher.Hash(pwd),
                NickName = nick,
                NickKey = AccountService.NickKeyOf(nick),
                CreatedAt = now,
                LastLoginAt = now
            };

            db.Users.Add(user);
            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = AccountService.ToDto(user),
                isNew = true
            });
        }).AllowAnonymous();

        // 登录：邮箱 + 密码
        auth.MapPost("/login", async (
            LoginRequest req,
            RollDbContext db,
            TokenService tokens,
            AccountService.LoginThrottle throttle,
            CancellationToken ct) =>
        {
            var email = AccountService.NormalizeEmail(req.Email ?? string.Empty);
            var pwd = req.Password ?? string.Empty;

            if (string.IsNullOrWhiteSpace(email) || pwd.Length == 0)
                throw ApiException.BadRequest("请输入邮箱和密码");

            if (throttle.IsLocked(email))
                throw ApiException.Forbidden("密码错误次数过多，请 10 分钟后再试");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

            // 邮箱不存在和密码错误返回同一句话，避免被用来枚举账号
            if (user is null || !user.HasPassword || !PasswordHasher.Verify(user.PasswordHash, pwd))
            {
                throttle.RecordFailure(email);
                throw ApiException.Unauthorized("邮箱或密码不正确");
            }

            throttle.Reset(email);
            user.LastLoginAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = AccountService.ToDto(user),
                isNew = false
            });
        }).AllowAnonymous();

        // 修改 / 设置密码。已有密码需验旧密码；纯微信账号可借此补一个密码，
        // 从此同一账号在 Web 端也能登录
        auth.MapPost("/password", async (
            ChangePasswordRequest req,
            HttpContext ctx,
            RollDbContext db,
            TokenService tokens,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            var newPwd = req.NewPassword ?? string.Empty;
            if (newPwd.Length < 8) throw ApiException.BadRequest("密码至少 8 位");
            if (newPwd.Length > 64) throw ApiException.BadRequest("密码最多 64 位");
            if (newPwd.All(char.IsDigit) || newPwd.All(char.IsLetter))
                throw ApiException.BadRequest("密码需要同时包含字母和数字");

            if (user.HasPassword && !PasswordHasher.Verify(user.PasswordHash, req.OldPassword ?? string.Empty))
                throw ApiException.BadRequest("原密码不正确");

            user.PasswordHash = PasswordHasher.Hash(newPwd);
            await db.SaveChangesAsync(ct);

            // 换密码后重发 token，前端无感续期
            return Results.Json(new { ok = true, token = tokens.Create(user) });
        }).WithTags("认证");

        // 微信绑定：把当前 Web 账号与小程序 openid 合并到同一个 uid
        auth.MapPost("/bind-wechat", async (
            BindWeChatRequest req,
            HttpContext ctx,
            RollDbContext db,
            WeChatClient wechat,
            TokenService tokens,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (string.IsNullOrWhiteSpace(req.Code))
                throw ApiException.BadRequest("缺少微信授权 code");

            var session = await wechat.Code2SessionAsync(req.Code, ct);

            // 已被别的账号占用，说明这个小程序身份已经存在，不能悄悄抢过来
            var occupied = await db.Users.AsNoTracking()
                .Where(u => u.OpenId == session.OpenId && u.Id != uid)
                .Select(u => u.Id)
                .FirstOrDefaultAsync(ct);
            if (occupied != 0)
                throw ApiException.BadRequest("该微信已绑定其他账号，请用原账号登录");

            user.OpenId = session.OpenId;
            if (!string.IsNullOrWhiteSpace(session.UnionId)) user.UnionId = session.UnionId;
            user.LastLoginAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, user = AccountService.ToDto(user) });
        }).WithTags("认证");

        /* ----------------------- 小程序：微信一键登录 ----------------------- */

        // 微信一键登录：小程序 wx.login 拿到 code，服务端用 AppSecret 换 openid，再签发自己的 JWT
        auth.MapPost("/wechat", async (
            WeChatLoginRequest req,
            RollDbContext db,
            WeChatClient wechat,
            TokenService tokens,
            AccountService accounts,
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
                var desired = string.IsNullOrWhiteSpace(req.NickName) ? DefaultNick() : AccountService.CleanNick(req.NickName);
                var nick = await accounts.EnsureUniqueNickAsync(desired, ct);

                user = new LedgerUser
                {
                    OpenId = session.OpenId,
                    UnionId = session.UnionId,
                    NickName = nick,
                    NickKey = AccountService.NickKeyOf(nick),
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
                if (!string.IsNullOrWhiteSpace(req.NickName))
                {
                    // 昵称只在真的改了的时候才占用唯一键，避免每次登录都重算
                    var newNick = AccountService.CleanNick(req.NickName);
                    if (newNick != user.NickName)
                    {
                        var nick = await accounts.EnsureUniqueNickAsync(newNick, ct);
                        user.NickName = nick;
                        user.NickKey = AccountService.NickKeyOf(nick);
                    }
                }
                if (!string.IsNullOrWhiteSpace(req.AvatarUrl)) user.AvatarUrl = req.AvatarUrl;
            }

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = AccountService.ToDto(user),
                isNew
            });
        }).AllowAnonymous();

        // 开发模式登录：仅在 Development 环境且显式打开开关时可用，用于本地联调
        auth.MapPost("/dev", async (
            DevLoginRequest req,
            RollDbContext db,
            TokenService tokens,
            AccountService accounts,
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
                var uniqueNick = await accounts.EnsureUniqueNickAsync(nick, ct);
                user = new LedgerUser
                {
                    OpenId = openId,
                    NickName = uniqueNick,
                    NickKey = AccountService.NickKeyOf(uniqueNick),
                    IsDevAccount = true,
                    CreatedAt = now,
                    LastLoginAt = now
                };
                db.Users.Add(user);
            }
            else
            {
                // 同一 deviceKey 再次登录只更新昵称，uid 保持不变
                if (nick != user.NickName)
                {
                    var uniqueNick = await accounts.EnsureUniqueNickAsync(nick, ct);
                    user.NickName = uniqueNick;
                    user.NickKey = AccountService.NickKeyOf(uniqueNick);
                }
                user.LastLoginAt = now;
            }

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                token = tokens.Create(user),
                user = AccountService.ToDto(user),
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
                user = AccountService.ToDto(user),
                stats = new { entryCount = total, firstRecordAt = firstAt.ToMs() }
            });
        }).WithTags("认证");

        // 修改昵称 / 头像 / 标签自动识别开关
        app.MapPut("/api/me", async (
            UpdateProfileRequest req,
            HttpContext ctx,
            RollDbContext db,
            AccountService accounts,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (req.NickName is not null)
            {
                var nick = AccountService.CleanNick(req.NickName);
                if (nick != user.NickName)
                {
                    // 重名直接报错（而不是自动加数字）：用户主动改名时应该得到明确反馈
                    var key = AccountService.NickKeyOf(nick);
                    if (await db.Users.AnyAsync(u => u.NickKey == key && u.Id != uid, ct))
                        throw ApiException.BadRequest("这个昵称已被使用，换一个试试");
                    user.NickName = nick;
                    user.NickKey = key;
                }
            }

            if (req.AvatarUrl is not null)
                user.AvatarUrl = string.IsNullOrWhiteSpace(req.AvatarUrl) ? null : req.AvatarUrl;

            if (req.TagAutoEnabled.HasValue)
                user.TagAutoEnabled = req.TagAutoEnabled.Value;

            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                user = AccountService.ToDto(user)
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
