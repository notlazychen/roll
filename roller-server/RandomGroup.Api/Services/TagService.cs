using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Services;

/// <summary>
/// 标签自动识别：按用户维护的关键词规则，从备注里命中标签。
/// 之所以放在服务端：规则存在库里，多端一致；也方便以后换成更强的语义分析。
/// </summary>
public sealed class TagService
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly RollDbContext _db;

    public TagService(RollDbContext db) => _db = db;

    public static List<string> ParseTags(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try
        {
            var list = JsonSerializer.Deserialize<List<string>>(json, JsonOpts);
            return list ?? new List<string>();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    public static string SerializeTags(IEnumerable<string> tags)
        => JsonSerializer.Serialize(tags.Distinct().Take(Limits.MaxTagsPerEntry).ToList(), JsonOpts);

    /// <summary>从备注中按规则分析标签（不落库）。用户关掉自动识别时返回空列表。</summary>
    public async Task<List<string>> AnalyzeAsync(long uid, bool autoEnabled, string? remark, CancellationToken ct)
    {
        var text = (remark ?? string.Empty).Trim();
        if (!autoEnabled || text.Length == 0) return new List<string>();

        var rules = await _db.TagRules.AsNoTracking()
            .Where(r => r.UserId == uid)
            .OrderBy(r => r.Id)
            .ToListAsync(ct);

        var hit = new List<string>();
        foreach (var rule in rules)
        {
            var words = rule.Keyword.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (words.Any(w => text.Contains(w, StringComparison.OrdinalIgnoreCase)))
            {
                if (!hit.Contains(rule.Tag)) hit.Add(rule.Tag);
                if (hit.Count >= Limits.MaxTagsPerEntry) break;
            }
        }
        return hit;
    }

    /// <summary>合并自动标签与手动标签，自动的在前</summary>
    public static List<string> Merge(IEnumerable<string> auto, IEnumerable<string> manual)
        => auto.Concat(manual)
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.Trim())
            .Distinct()
            .Take(Limits.MaxTagsPerEntry)
            .ToList();
}
