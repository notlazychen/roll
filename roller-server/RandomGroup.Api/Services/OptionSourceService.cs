using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Features;
using RandomGroup.Api.Services;
using RandomGroup.Api.Infrastructure;

namespace RandomGroup.Api.Services;

/// <summary>
/// 用户自己独有的选项源（分类/渠道/消费者/账户/标签）。
/// 另外维护两项全局口径：「预置项」「标签识别规则」都在这里。
/// </summary>
public sealed class OptionSourceService
{
    private readonly RollDbContext _db;

    public OptionSourceService(RollDbContext db) => _db = db;

    /// <summary>
    /// 取用户全部选项源。第一次访问时把预置项写进去；
    /// 之后只补「从来没有过」的项——已被删除的预置项不会被补回来。
    /// </summary>
    public async Task<List<LedgerOption>> EnsureAndLoadAsync(long uid, CancellationToken ct)
    {
        var rows = await _db.Options.Where(o => o.UserId == uid).ToListAsync(ct);

        if (rows.Count == 0)
        {
            var now = DateTimeOffset.UtcNow;
            var newRows = new List<LedgerOption>();

            void Add(string kind, string name, string? parent, int sort, bool preset, ref int seq)
            {
                newRows.Add(new LedgerOption
                {
                    UserId = uid,
                    Kind = kind,
                    Name = name,
                    Parent = parent,
                    SortOrder = seq++,
                    IsPreset = preset,
                    CreatedAt = now
                });
            }

            var seq = 0;
            foreach (var c in PresetOptions.Categories) Add(OptionKinds.Category, c, null, seq++, true, ref seq);
            foreach (var (parent, children) in PresetOptions.Channels)
            {
                foreach (var child in children) Add(OptionKinds.Channel, parent + "/" + child, parent, seq++, true, ref seq);
            }
            foreach (var c in PresetOptions.Consumers) Add(OptionKinds.Consumer, c, null, seq++, true, ref seq);
            foreach (var a in PresetOptions.Accounts) Add(OptionKinds.Account, a, null, seq++, true, ref seq);

            var ruleSeq = 0;
            foreach (var (tag, keywords) in PresetOptions.Tags)
            {
                Add(OptionKinds.Tag, tag, null, seq++, true, ref seq);
                _db.TagRules.Add(new TagRule
                {
                    UserId = uid,
                    Keyword = keywords,
                    Tag = tag,
                    CreatedAt = now
                });
                ruleSeq++;
            }

            _db.Options.AddRange(newRows);
            await _db.SaveChangesAsync(ct);
            return newRows;
        }

        // 老用户：补上新版本增加的预置项（按名称判断，已删过的不补）
        var missing = new List<LedgerOption>();
        var seqBase = rows.Count == 0 ? 0 : rows.Max(r => r.SortOrder) + 1;

        bool Has(string kind, string name) => rows.Any(r => r.Kind == kind && r.Name == name);

        void AddMissing(string kind, string name, string? parent)
        {
            if (Has(kind, name)) return;
            missing.Add(new LedgerOption
            {
                UserId = uid,
                Kind = kind,
                Name = name,
                Parent = parent,
                SortOrder = seqBase++,
                IsPreset = true,
                CreatedAt = DateTimeOffset.UtcNow
            });
        }

        foreach (var c in PresetOptions.Categories) AddMissing(OptionKinds.Category, c, null);
        foreach (var (parent, children) in PresetOptions.Channels)
        {
            // 只给「父级分类还在」的用户补渠道，避免渠道挂在已删除的分类下
            if (!Has(OptionKinds.Category, parent)) continue;
            foreach (var child in children) AddMissing(OptionKinds.Channel, parent + "/" + child, parent);
        }
        foreach (var c in PresetOptions.Consumers) AddMissing(OptionKinds.Consumer, c, null);
        foreach (var a in PresetOptions.Accounts) AddMissing(OptionKinds.Account, a, null);

        if (missing.Count == 0) return rows;

        _db.Options.AddRange(missing);
        await _db.SaveChangesAsync(ct);

        rows.AddRange(missing);
        return rows;
    }

    /// <summary>该标签被多少条账目使用（决定能不能删）</summary>
    public static int CountTagUsage(IEnumerable<LedgerEntry> entries, string tag)
        => entries.Count(e => TagService.ParseTags(e.TagsJson).Contains(tag));

    /// <summary>某项选项被使用的次数。渠道按完整名称（餐饮/KFC）统计。</summary>
    public async Task<int> CountUsageAsync(long uid, string kind, string name, CancellationToken ct)
    {
        var q = _db.Entries.AsNoTracking().Where(e => e.UserId == uid);

        switch (kind)
        {
            case OptionKinds.Category:
                return await q.CountAsync(e => e.Category == name, ct);
            case OptionKinds.Channel:
                return await q.CountAsync(e => e.Channel == name, ct);
            case OptionKinds.Consumer:
                return await q.CountAsync(e => e.Consumer == name, ct);
            case OptionKinds.Account:
                return await q.CountAsync(e => e.Account == name, ct);
            case OptionKinds.Tag:
            {
                var entries = await q.Select(e => e.TagsJson).ToListAsync(ct);
                return entries.Count(json => TagService.ParseTags(json).Contains(name));
            }
            default:
                return 0;
        }
    }

    /// <summary>把选项源整理成前端直接可用的树（渠道按父级分组）</summary>
    public static OptionsDto BuildDto(List<LedgerOption> rows)
    {
        List<OptionItemDto> Of(string kind) => rows
            .Where(r => r.Kind == kind)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.Id)
            .Select(r => new OptionItemDto(r.Id, r.Kind, r.Name, r.Parent, r.IsPreset))
            .ToList();

        var channelGroups = rows
            .Where(r => r.Kind == OptionKinds.Channel)
            .GroupBy(r => r.Parent ?? string.Empty)
            .OrderBy(g => rows.FirstOrDefault(r => r.Kind == OptionKinds.Category && r.Name == g.Key)?.SortOrder ?? 999)
            .Select(g => new ChannelGroupDto(
                g.Key,
                g.OrderBy(x => x.SortOrder).ThenBy(x => x.Id)
                    .Select(x => new OptionItemDto(x.Id, x.Kind, x.Name, x.Parent, x.IsPreset))
                    .ToList()))
            .ToList();

        return new OptionsDto(Of(OptionKinds.Category), Of(OptionKinds.Channel), channelGroups,
            Of(OptionKinds.Consumer), Of(OptionKinds.Account), Of(OptionKinds.Tag));
    }

    /// <summary>校验选项名：去空白、限长、非空</summary>
    public static string CleanName(string? raw, string label)
    {
        var name = (raw ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name)) throw ApiException.BadRequest("请填写" + label);
        if (name.Length > Limits.MaxOptionNameLength)
            throw ApiException.BadRequest(label + $"最多 {Limits.MaxOptionNameLength} 个字");
        if (name.Contains('/')) throw ApiException.BadRequest(label + "不能包含「/」");
        return name;
    }
}
