namespace RandomGroup.Api.Domain;

/// <summary>参与抽奖的一项及其权重（权重即票数）</summary>
public sealed record WeightItem(
    long OptionId,
    string Title,
    long CreatorId,
    string CreatorName,
    int ColorIndex,
    int Votes,
    double Weight);

/// <summary>
/// 加权随机算法。
/// 抽成纯函数是为了能被单独测试：给定权重与随机数，结果必须确定。
/// </summary>
public static class RollAlgorithm
{
    /// <summary>
    /// 按权重挑选一项。r01 为 [0,1) 的随机数。
    /// 返回选中项在 pool 中的下标。
    /// </summary>
    public static int PickIndex(IReadOnlyList<double> weights, double r01)
    {
        if (weights.Count == 0)
            throw new ArgumentException("权重列表不能为空", nameof(weights));

        var total = 0d;
        for (var i = 0; i < weights.Count; i++)
        {
            if (weights[i] < 0) throw new ArgumentException("权重不能为负数", nameof(weights));
            total += weights[i];
        }

        if (total <= 0)
            throw new ArgumentException("权重总和必须大于 0", nameof(weights));

        var r = Math.Clamp(r01, 0d, 0.9999999999d) * total;
        var acc = 0d;
        for (var i = 0; i < weights.Count; i++)
        {
            acc += weights[i];
            if (r < acc) return i;
        }

        // 浮点累计误差兜底：返回最后一个有权重的项
        for (var i = weights.Count - 1; i >= 0; i--)
        {
            if (weights[i] > 0) return i;
        }

        return weights.Count - 1;
    }
}
