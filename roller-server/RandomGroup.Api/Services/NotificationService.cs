using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Services;

/// <summary>站内通知的写入与保留策略（每人最多保留 100 条）</summary>
public sealed class NotificationService
{
    private readonly RollDbContext _db;

    public NotificationService(RollDbContext db) => _db = db;

    public Task PushAsync(long userId, long? groupId, string groupTheme, string type, string content, CancellationToken ct)
        => PushManyAsync(new[] { userId }, groupId, groupTheme, type, content, ct);

    public async Task PushManyAsync(
        IEnumerable<long> userIds,
        long? groupId,
        string groupTheme,
        string type,
        string content,
        CancellationToken ct)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0) return;

        var now = DateTimeOffset.UtcNow;
        _db.Notifications.AddRange(ids.Select(uid => new RollNotification
        {
            UserId = uid,
            GroupId = groupId,
            GroupTheme = groupTheme ?? string.Empty,
            Type = type,
            Content = content,
            Read = false,
            CreatedAt = now
        }));
        await _db.SaveChangesAsync(ct);

        await TrimAsync(ids, ct);
    }

    private async Task TrimAsync(IReadOnlyList<long> userIds, CancellationToken ct)
    {
        foreach (var uid in userIds)
        {
            var stale = await _db.Notifications.AsNoTracking()
                .Where(n => n.UserId == uid)
                .OrderByDescending(n => n.Id)
                .Skip(Limits.MaxNotificationsPerUser)
                .Select(n => n.Id)
                .ToListAsync(ct);

            if (stale.Count == 0) continue;

            await _db.Notifications.Where(n => stale.Contains(n.Id)).ExecuteDeleteAsync(ct);
        }
    }
}
