using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Features;

public static class NotificationEndpoints
{
    public static void MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/notifications").WithTags("通知");

        // 我的通知（按时间倒序）与未读数
        g.MapGet("", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var rows = await db.Notifications.AsNoTracking()
                .Where(n => n.UserId == uid)
                .OrderByDescending(n => n.CreatedAt)
                .ThenByDescending(n => n.Id)
                .Take(Limits.MaxNotificationsPerUser)
                .ToListAsync(ct);

            var items = rows.Select(n => new NotificationDto(
                n.Id, n.UserId, n.GroupId, n.GroupTheme, n.Type, n.Content, n.Read, n.CreatedAt.ToMs())).ToList();

            return Results.Json(new
            {
                ok = true,
                items,
                unread = items.Count(i => !i.Read)
            });
        });

        g.MapGet("/unread", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var unread = await db.Notifications.AsNoTracking().CountAsync(n => n.UserId == uid && !n.Read, ct);
            return Results.Json(new { ok = true, unread });
        });

        g.MapPost("/read", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            await db.Notifications.Where(n => n.UserId == uid && !n.Read)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.Read, true), ct);
            return Results.Json(new { ok = true });
        });

        g.MapDelete("", async (HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            await db.Notifications.Where(n => n.UserId == uid).ExecuteDeleteAsync(ct);
            return Results.Json(new { ok = true });
        });
    }
}
