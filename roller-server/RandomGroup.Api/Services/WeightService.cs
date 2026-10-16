using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Services;

/// <summary>
/// 权重计算：一票即一单位权重；若全组无人投票则退化为等权，保证一定能抽出结果。
/// 计算完全放在服务端，所有成员看到的权重与最终结果必然一致。
/// </summary>
public sealed class WeightService
{
    private readonly RollDbContext _db;

    public WeightService(RollDbContext db) => _db = db;

    public async Task<WeightsDto> ComputeAsync(long groupId, CancellationToken ct)
    {
        var options = await _db.Options.AsNoTracking()
            .Where(o => o.GroupId == groupId)
            .OrderBy(o => o.CreatedAt)
            .ThenBy(o => o.Id)
            .Select(o => new { o.Id, o.Title, o.CreatorId, o.CreatorName })
            .ToListAsync(ct);

        var counts = await (
            from v in _db.Votes.AsNoTracking()
            where v.GroupId == groupId
            group v by v.OptionId into g
            select new { OptionId = g.Key, Count = g.Count() }
        ).ToListAsync(ct);

        var countMap = counts.ToDictionary(x => x.OptionId, x => x.Count);
        var totalVotes = counts.Sum(x => x.Count);
        var uniform = totalVotes == 0 && options.Count > 0;

        var items = new List<WeightItemDto>(options.Count);
        var sum = 0d;

        for (var i = 0; i < options.Count; i++)
        {
            var o = options[i];
            var votes = countMap.TryGetValue(o.Id, out var c) ? c : 0;
            var weight = uniform ? 1d : votes;
            sum += weight;

            items.Add(new WeightItemDto(
                OptionId: o.Id,
                Title: o.Title,
                Votes: votes,
                CreatorId: o.CreatorId,
                CreatorName: o.CreatorName,
                ColorIndex: i,
                Weight: weight,
                Percent: 0d));
        }

        for (var i = 0; i < items.Count; i++)
        {
            var p = sum > 0 ? items[i].Weight / sum : 0d;
            items[i] = items[i] with { Percent = p };
        }

        return new WeightsDto(items, totalVotes, uniform);
    }

    /// <summary>给抽奖用的纯数据（只含有权重的项）</summary>
    public async Task<IReadOnlyList<WeightItem>> ComputePoolAsync(long groupId, CancellationToken ct)
    {
        var weights = await ComputeAsync(groupId, ct);
        return weights.Items
            .Where(i => i.Weight > 0)
            .Select(i => new WeightItem(i.OptionId, i.Title, i.CreatorId, i.CreatorName, i.ColorIndex, i.Votes, i.Weight))
            .ToList();
    }
}
