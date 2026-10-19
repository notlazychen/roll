using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

public static class OptionEndpoints
{
    public static void MapOptionEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").WithTags("选项源");

        // 拉取全部选项源（分类/渠道/消费者/账户/标签），首次访问自动写入预置项
        g.MapGet("/options", async (HttpContext ctx, RollDbContext db, OptionSourceService svc, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var rows = await svc.EnsureAndLoadAsync(uid, ct);
            return Results.Json(new { ok = true, options = OptionSourceService.BuildDto(rows) });
        });

        // 各项使用次数：管理页要在列表上直接显示「已被 N 条账目使用」
        g.MapGet("/options/usage", async (HttpContext ctx, RollDbContext db, OptionSourceService svc, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var rows = await svc.EnsureAndLoadAsync(uid, ct);
            var entries = await db.Entries.AsNoTracking()
                .Where(e => e.UserId == uid)
                .Select(e => new { e.Category, e.Channel, e.Consumer, e.Account, e.TagsJson })
                .ToListAsync(ct);

            var usage = new Dictionary<long, int>();
            foreach (var row in rows)
            {
                int n;
                switch (row.Kind)
                {
                    case OptionKinds.Category:
                        n = entries.Count(e => e.Category == row.Name);
                        break;
                    case OptionKinds.Channel:
                        n = entries.Count(e => e.Channel == row.Name);
                        break;
                    case OptionKinds.Consumer:
                        n = entries.Count(e => e.Consumer == row.Name);
                        break;
                    case OptionKinds.Account:
                        n = entries.Count(e => e.Account == row.Name);
                        break;
                    case OptionKinds.Tag:
                        n = entries.Count(e => TagService.ParseTags(e.TagsJson).Contains(row.Name));
                        break;
                    default:
                        n = 0;
                        break;
                }
                usage[row.Id] = n;
            }

            return Results.Json(new { ok = true, usage });
        });

        // 新增选项（用户自己扩充选项源）
        g.MapPost("/options", async (
            OptionAddRequest req,
            HttpContext ctx,
            RollDbContext db,
            OptionSourceService svc,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var kind = (req.Kind ?? string.Empty).Trim();
            if (!OptionKinds.IsValid(kind)) throw ApiException.BadRequest("未知的选项类型");

            var rows = await svc.EnsureAndLoadAsync(uid, ct);
            var name = OptionSourceService.CleanName(req.Name, KindLabel(kind));

            string finalName = name;
            string? parent = null;

            if (kind == OptionKinds.Channel)
            {
                // 渠道必须挂在已有分类下：餐饮/KFC、购物/淘宝
                parent = (req.Parent ?? string.Empty).Trim();
                if (parent.Length == 0) throw ApiException.BadRequest("请先选择渠道所属分类");
                if (!rows.Any(r => r.Kind == OptionKinds.Category && r.Name == parent))
                    throw ApiException.BadRequest("渠道所属分类不存在，请先添加该分类");
                finalName = parent + "/" + name;
            }

            if (rows.Any(r => r.Kind == kind && r.Name == finalName))
                throw ApiException.BadRequest("「" + finalName + "」已存在");

            var seq = rows.Count == 0 ? 0 : rows.Max(r => r.SortOrder) + 1;
            var row = new LedgerOption
            {
                UserId = uid,
                Kind = kind,
                Name = finalName,
                Parent = parent,
                SortOrder = seq,
                IsPreset = false,
                CreatedAt = DateTimeOffset.UtcNow
            };
            db.Options.Add(row);
            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                option = new OptionItemDto(row.Id, row.Kind, row.Name, row.Parent, row.IsPreset)
            });
        });

        // 改名
        g.MapPut("/options/{id:long}", async (
            long id,
            OptionAddRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var row = await db.Options.FirstOrDefaultAsync(o => o.Id == id && o.UserId == uid, ct)
                ?? throw ApiException.NotFound("选项不存在");

            var name = OptionSourceService.CleanName(req.Name, KindLabel(row.Kind));

            if (row.Kind == OptionKinds.Channel)
            {
                // 渠道改名只改子项名字，父级沿用原来的分类
                var child = name;
                var newName = (row.Parent ?? string.Empty) + "/" + child;

                var dup = await db.Options.AnyAsync(o => o.UserId == uid && o.Kind == OptionKinds.Channel &&
                                                         o.Name == newName && o.Id != id, ct);
                if (dup) throw ApiException.BadRequest("「" + newName + "」已存在");

                // 已记录的账目同步改名，避免旧名称在明细里变成孤儿
                await db.Entries.Where(e => e.UserId == uid && e.Channel == row.Name)
                    .ExecuteUpdateAsync(s => s.SetProperty(e => e.Channel, newName), ct);
                row.Name = newName;
            }
            else
            {
                var dup = await db.Options.AnyAsync(o => o.UserId == uid && o.Kind == row.Kind &&
                                                         o.Name == name && o.Id != id, ct);
                if (dup) throw ApiException.BadRequest("「" + name + "」已存在");

                var old = row.Name;
                row.Name = name;

                if (row.Kind == OptionKinds.Category)
                {
                    await db.Entries.Where(e => e.UserId == uid && e.Category == old)
                        .ExecuteUpdateAsync(s => s.SetProperty(e => e.Category, name), ct);
                }
                else if (row.Kind == OptionKinds.Consumer)
                {
                    await db.Entries.Where(e => e.UserId == uid && e.Consumer == old)
                        .ExecuteUpdateAsync(s => s.SetProperty(e => e.Consumer, name), ct);
                }
                else if (row.Kind == OptionKinds.Account)
                {
                    await db.Entries.Where(e => e.UserId == uid && e.Account == old)
                        .ExecuteUpdateAsync(s => s.SetProperty(e => e.Account, name), ct);
                }

                if (row.Kind == OptionKinds.Tag)
                {
                    // 标签规则跟着改名，否则自动识别会失效
                    await db.TagRules.Where(r => r.UserId == uid && r.Tag == old)
                        .ExecuteUpdateAsync(s => s.SetProperty(r => r.Tag, name), ct);

                    var entries = await db.Entries.Where(e => e.UserId == uid && e.TagsJson.Contains(old)).ToListAsync(ct);
                    foreach (var e in entries)
                    {
                        var tags = TagService.ParseTags(e.TagsJson);
                        if (!tags.Remove(old)) continue;
                        if (!tags.Contains(name)) tags.Insert(0, name);
                        e.TagsJson = TagService.SerializeTags(tags);
                    }
                }

                // 分类改名时，挂在它下面的渠道要一起改父级，否则渠道列表会挂空
                if (row.Kind == OptionKinds.Category)
                {
                    var children = await db.Options
                        .Where(o => o.UserId == uid && o.Kind == OptionKinds.Channel && o.Parent == old)
                        .ToListAsync(ct);
                    foreach (var c in children)
                    {
                        var childName = c.Name.Contains('/') ? c.Name[(c.Name.IndexOf('/') + 1)..] : c.Name;
                        var newChannel = name + "/" + childName;
                        await db.Entries.Where(e => e.UserId == uid && e.Channel == c.Name)
                            .ExecuteUpdateAsync(s => s.SetProperty(e => e.Channel, newChannel), ct);
                        c.Parent = name;
                        c.Name = newChannel;
                    }
                }
            }

            await db.SaveChangesAsync(ct);
            return Results.Json(new
            {
                ok = true,
                option = new OptionItemDto(row.Id, row.Kind, row.Name, row.Parent, row.IsPreset)
            });
        });

        // 删除：已经被账目用过的选项不允许删除，并告知用了多少次
        g.MapDelete("/options/{id:long}", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            OptionSourceService svc,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var row = await db.Options.FirstOrDefaultAsync(o => o.Id == id && o.UserId == uid, ct)
                ?? throw ApiException.NotFound("选项不存在");

            if (row.Kind == OptionKinds.Category)
            {
                var childCount = await db.Options.CountAsync(
                    o => o.UserId == uid && o.Kind == OptionKinds.Channel && o.Parent == row.Name, ct);
                if (childCount > 0)
                    throw ApiException.BadRequest("该分类下还有 " + childCount + " 个渠道，请先删除或改到其他分类");
            }

            var used = await svc.CountUsageAsync(uid, row.Kind, row.Name, ct);
            if (used > 0)
                throw ApiException.BadRequest("「" + row.Name + "」已被 " + used + " 条账目使用，不能删除");

            if (row.Kind == OptionKinds.Tag)
                await db.TagRules.Where(r => r.UserId == uid && r.Tag == row.Name).ExecuteDeleteAsync(ct);

            db.Options.Remove(row);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true });
        });

        // 排序：把某个选项上移/下移一位（管理页长按排序的轻量实现）
        g.MapPost("/options/{id:long}/move", async (
            long id,
            string? direction,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var row = await db.Options.FirstOrDefaultAsync(o => o.Id == id && o.UserId == uid, ct)
                ?? throw ApiException.NotFound("选项不存在");

            var siblings = await db.Options
                .Where(o => o.UserId == uid && o.Kind == row.Kind && o.Parent == row.Parent)
                .OrderBy(o => o.SortOrder).ThenBy(o => o.Id)
                .ToListAsync(ct);

            var idx = siblings.FindIndex(o => o.Id == row.Id);
            var target = string.Equals(direction, "down", StringComparison.OrdinalIgnoreCase) ? idx + 1 : idx - 1;
            if (idx < 0 || target < 0 || target >= siblings.Count) return Results.Json(new { ok = true });

            var other = siblings[target];
            (row.SortOrder, other.SortOrder) = (other.SortOrder, row.SortOrder);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true });
        });
        // 标签识别规则：一句话一条规则，关键词用|分隔（如「聚餐|请客|团建 聚餐」）
        g.MapPost("/tag-rules", async (
            TagRuleRequest req,
            HttpContext ctx,
            RollDbContext db,
            OptionSourceService svc,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var keyword = (req.Keyword ?? string.Empty).Trim();
            var tag = (req.Tag ?? string.Empty).Trim();

            if (keyword.Length == 0) throw ApiException.BadRequest("请填写关键词");
            if (keyword.Length > 120) throw ApiException.BadRequest("关键词太长");
            if (tag.Length == 0) throw ApiException.BadRequest("请选择要打上的标签");

            var rows = await svc.EnsureAndLoadAsync(uid, ct);
            if (!rows.Any(r => r.Kind == OptionKinds.Tag && r.Name == tag))
                throw ApiException.BadRequest("标签「" + tag + "」不存在，请先在标签管理中添加");

            var count = await db.TagRules.CountAsync(r => r.UserId == uid, ct);
            if (count >= Limits.MaxTagRules) throw ApiException.BadRequest($"标签规则最多 {Limits.MaxTagRules} 条");

            var rule = new TagRule { UserId = uid, Keyword = keyword, Tag = tag, CreatedAt = DateTimeOffset.UtcNow };
            db.TagRules.Add(rule);
            await db.SaveChangesAsync(ct);

            return Results.Json(new { ok = true, rule = new TagRuleDto(rule.Id, rule.Keyword, rule.Tag) });
        });

        g.MapDelete("/tag-rules/{id:long}", async (long id, HttpContext ctx, RollDbContext db, CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();
            var rule = await db.TagRules.FirstOrDefaultAsync(r => r.Id == id && r.UserId == uid, ct)
                ?? throw ApiException.NotFound("规则不存在");
            db.TagRules.Remove(rule);
            await db.SaveChangesAsync(ct);
            return Results.Json(new { ok = true });
        });
    }

    private static string KindLabel(string kind) => kind switch
    {
        OptionKinds.Category => "分类名称",
        OptionKinds.Channel => "渠道名称",
        OptionKinds.Consumer => "消费者名称",
        OptionKinds.Account => "账户名称",
        OptionKinds.Tag => "标签名称",
        _ => "名称"
    };
}
