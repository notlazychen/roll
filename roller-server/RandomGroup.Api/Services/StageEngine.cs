using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Services;

/// <summary>
/// 阶段推进引擎。所有阶段变化都由服务端裁决，客户端只负责发起动作与轮询结果。
///
///   config ──(小队长点 Roll)──► preparing ──(全员确认 / 超时)──► rolling ──► result
///     ▲                              │
///     └────────(任一成员取消)────────┘
///
/// 并发安全的关键：
///   进入 rolling 时用一条带条件的 UPDATE 自增 round；
///   写结果时再以 (stage='rolling' AND round=当前轮次) 为条件更新。
///   同一轮内无论多少个请求同时到达，只有一个能改成功，因此只会产生一个结果。
/// </summary>
public sealed class StageEngine
{
    private readonly RollDbContext _db;
    private readonly WeightService _weights;
    private readonly NotificationService _notify;
    private readonly ILogger<StageEngine> _log;

    public StageEngine(RollDbContext db, WeightService weights, NotificationService notify, ILogger<StageEngine> log)
    {
        _db = db;
        _weights = weights;
        _notify = notify;
        _log = log;
    }

    /// <summary>推进该小队的阶段（可安全地被反复调用，每次请求都调一次即可）。</summary>
    public async Task AdvanceAsync(long groupId, CancellationToken ct)
    {
        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId, ct);
        if (group is null) return;

        if (group.Stage == Stages.Preparing && !await TryLeavePreparingAsync(group, ct))
            return;

        if (group.Stage == Stages.Rolling)
            await ResolveAsync(group, ct);
    }

    /// <summary>准备环节是否可以结束：全员确认，或已到最晚结束时间。</summary>
    private async Task<bool> TryLeavePreparingAsync(RollGroup group, CancellationToken ct)
    {
        var readyStates = await _db.Members.AsNoTracking()
            .Where(m => m.GroupId == group.Id)
            .Select(m => m.Ready)
            .ToListAsync(ct);

        var allConfirmed = readyStates.Count > 0 && readyStates.All(r => r == ReadyStates.Confirm);
        var timedOut = group.PrepDeadline.HasValue && DateTimeOffset.UtcNow >= group.PrepDeadline.Value;

        if (!allConfirmed && !timedOut) return false;

        var moved = await _db.Groups
            .Where(g => g.Id == group.Id && g.Stage == Stages.Preparing)
            .ExecuteUpdateAsync(s => s
                .SetProperty(g => g.Stage, Stages.Rolling)
                .SetProperty(g => g.Round, g => g.Round + 1), ct);

        if (moved == 0) return false;   // 已被并发的另一个请求推进

        group.Stage = Stages.Rolling;
        group.Round += 1;
        return true;
    }

    /// <summary>执行加权随机并落库，同时通知全部成员。</summary>
    private async Task ResolveAsync(RollGroup group, CancellationToken ct)
    {
        var pool = await _weights.ComputePoolAsync(group.Id, ct);

        if (pool.Count == 0)
        {
            // 没有任何带权重的备选项：退回配置环节，避免小队永久卡在 rolling
            await _db.Groups
                .Where(g => g.Id == group.Id && g.Stage == Stages.Rolling)
                .ExecuteUpdateAsync(s => s.SetProperty(g => g.Stage, Stages.Config), ct);
            _log.LogWarning("小队 {GroupId} 无可抽取备选项，已退回配置环节", group.Id);
            return;
        }

        var index = RollAlgorithm.PickIndex(pool.Select(p => p.Weight).ToArray(), Random.Shared.NextDouble());
        var chosen = pool[index];
        var round = group.Round;
        var now = DateTimeOffset.UtcNow;

        var updated = await _db.Groups
            .Where(g => g.Id == group.Id && g.Stage == Stages.Rolling && g.Round == round)
            .ExecuteUpdateAsync(s => s
                .SetProperty(g => g.Stage, Stages.Result)
                .SetProperty(g => g.ResultOptionId, (long?)chosen.OptionId)
                .SetProperty(g => g.ResultAt, (DateTimeOffset?)now), ct);

        if (updated == 0) return;   // 本轮结果已由其他请求写出

        var memberIds = await _db.Members.AsNoTracking()
            .Where(m => m.GroupId == group.Id)
            .Select(m => m.UserId)
            .ToListAsync(ct);

        await _notify.PushManyAsync(
            memberIds,
            group.Id,
            group.Theme,
            NotificationTypes.Result,
            "随机结果已出：" + chosen.Title,
            ct);
    }
}
