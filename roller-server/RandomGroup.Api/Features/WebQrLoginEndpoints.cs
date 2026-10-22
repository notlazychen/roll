using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

/// <summary>
/// Web 端微信扫码登录（跨端配对）。
/// ---------------------------------------------------------------
/// 浏览器拿不到 wx.login 的 code，微信开放平台的网站扫码登录又需要额外
/// 资质，所以用自己的一套配对流程：
///
///   1. Web 调 POST /api/auth/web-qr 生成一个 8 位配对码（5 分钟有效）
///   2. 用户在小程序「我的 → 扫一扫登录网页」里输入/扫到这串码
///   3. 小程序调 POST /api/auth/web-qr/{ticket}/approve，把自己批给这张票
///   4. Web 轮询 GET /api/auth/web-qr/{ticket}，approved 时拿到 token，
///      票随即作废（token 只发一次，第二个轮询者拿不到）
///
/// 票只存在内存里：单机单容器部署够用，重启即清空，也没有持久化泄露面。
/// </summary>
public static class WebQrLoginEndpoints
{
    private sealed record Ticket(long UserId, DateTimeOffset ExpiresAt, bool Consumed);

    private static readonly ConcurrentDictionary<string, Ticket> Tickets = new();

    /// <summary>配对码有效期</summary>
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);

    /// <summary>去掉容易看错的字符（0/O、1/I/L），手输时少出错</summary>
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    private static string NewTicket()
    {
        Span<char> buf = stackalloc char[8];
        for (var i = 0; i < buf.Length; i++)
            buf[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(buf);
    }

    private static void Cleanup()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var (key, t) in Tickets)
            if (t.ExpiresAt < now)
                Tickets.TryRemove(key, out _);
    }

    public static void MapWebQrLoginEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth/web-qr").WithTags("认证");

        // Web：生成配对码
        group.MapPost("/", () =>
        {
            Cleanup();

            string ticket;
            // 撞码概率极低，但循环一次成本为零
            do { ticket = NewTicket(); } while (Tickets.ContainsKey(ticket));

            var expiresAt = DateTimeOffset.UtcNow.Add(Ttl);
            Tickets[ticket] = new Ticket(0, expiresAt, Consumed: false);

            return Results.Json(new
            {
                ok = true,
                ticket,
                expiresInMs = (long)Ttl.TotalMilliseconds
            });
        }).AllowAnonymous();

        // Web：轮询配对状态
        group.MapGet("/{ticket}", (string ticket, RollDbContext db, TokenService tokens, CancellationToken ct) =>
        {
            if (!Tickets.TryGetValue(ticket, out var t))
                return Results.Json(new { ok = false, status = "expired" });

            if (t.Consumed)
                return Results.Json(new { ok = false, status = "consumed" });

            if (t.ExpiresAt < DateTimeOffset.UtcNow)
            {
                Tickets.TryRemove(ticket, out _);
                return Results.Json(new { ok = false, status = "expired" });
            }

            if (t.UserId == 0)
                return Results.Json(new { ok = true, status = "pending" });

            // 已批准：发 token（只发一次），发完立即作废这张票
            var user = db.Users.FirstOrDefault(u => u.Id == t.UserId);
            if (user is null)
            {
                Tickets.TryRemove(ticket, out _);
                return Results.Json(new { ok = false, status = "expired" });
            }

            Tickets[ticket] = t with { Consumed = true };

            return Results.Json(new
            {
                ok = true,
                status = "approved",
                token = tokens.Create(user),
                user = AccountService.ToDto(user)
            });
        }).AllowAnonymous();

        // 小程序：批准配对（需要小程序登录态）
        group.MapPost("/{ticket}/approve", async (
            string ticket,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            if (!Tickets.TryGetValue(ticket, out var t))
                throw ApiException.BadRequest("配对码不存在或已过期，请在网页上重新生成");

            if (t.Consumed)
                throw ApiException.BadRequest("配对码已被使用，请在网页上重新生成");

            if (t.ExpiresAt < DateTimeOffset.UtcNow)
            {
                Tickets.TryRemove(ticket, out _);
                throw ApiException.BadRequest("配对码已过期，请在网页上重新生成");
            }

            // 已批准但网页还没轮询到：允许改绑（用户扫错了可以再扫一次）
            Tickets[ticket] = t with { UserId = uid };

            return Results.Json(new { ok = true, webUser = user.NickName });
        }).WithTags("认证");
    }
}
