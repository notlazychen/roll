using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Services;

public static class OptionQueries
{
    /// <summary>列出某小队的备选项，并附带票数与投票人列表</summary>
    public static async Task<List<OptionDto>> ListAsync(RollDbContext db, long groupId, CancellationToken ct)
    {
        var options = await db.Options.AsNoTracking()
            .Where(o => o.GroupId == groupId)
            .OrderBy(o => o.CreatedAt)
            .ThenBy(o => o.Id)
            .Select(o => new { o.Id, o.GroupId, o.Title, o.CreatorId, o.CreatorName, o.CreatedAt })
            .ToListAsync(ct);

        var votes = await db.Votes.AsNoTracking()
            .Where(v => v.GroupId == groupId)
            .Select(v => new { v.OptionId, v.UserId })
            .ToListAsync(ct);

        var byOption = votes
            .GroupBy(v => v.OptionId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.UserId).ToList());

        var list = new List<OptionDto>(options.Count);
        foreach (var o in options)
        {
            var voters = byOption.TryGetValue(o.Id, out var v) ? v : new List<long>();
            list.Add(new OptionDto(
                o.Id, o.GroupId, o.Title, o.CreatorId, o.CreatorName, o.CreatedAt.ToMs(), voters.Count, voters));
        }

        return list;
    }
}
