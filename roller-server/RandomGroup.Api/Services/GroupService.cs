using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Domain;
using RandomGroup.Api.Infrastructure;
using static RandomGroup.Api.Contracts.TimeMs;

namespace RandomGroup.Api.Services;

/// <summary>小队的读取、映射与权限判定</summary>
public sealed class GroupService
{
    private readonly RollDbContext _db;
    private readonly StageEngine _engine;

    public GroupService(RollDbContext db, StageEngine engine)
    {
        _db = db;
        _engine = engine;
    }

    public static GroupDto Map(RollGroup g, int memberCount, long viewerId)
    {
        var hasPasscode = !string.IsNullOrEmpty(g.Passcode);
        return new GroupDto(
            Id: g.Id,
            Code: g.Code,
            Theme: g.Theme,
            // 口令只对小队长下发，其他成员拿到空串
            Passcode: g.OwnerId == viewerId ? g.Passcode : string.Empty,
            OwnerId: g.OwnerId,
            OwnerName: g.OwnerName,
            Stage: g.Stage,
            PrepStartedAt: g.PrepStartedAt.ToMs(),
            PrepDeadline: g.PrepDeadline.ToMs(),
            ResultOptionId: g.ResultOptionId,
            ResultAt: g.ResultAt.ToMs(),
            CreatedAt: g.CreatedAt.ToMs(),
            MemberCount: memberCount,
            HasPasscode: hasPasscode);
    }

    /// <summary>读取小队并推进阶段。返回 null 表示小队不存在。</summary>
    public async Task<(RollGroup Group, int MemberCount)?> LoadAsync(long groupId, CancellationToken ct)
    {
        await _engine.AdvanceAsync(groupId, ct);

        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId, ct);
        if (group is null) return null;

        var count = await CountMembersAsync(groupId, ct);
        return (group, count);
    }

    public Task<int> CountMembersAsync(long groupId, CancellationToken ct)
        => _db.Members.AsNoTracking().CountAsync(m => m.GroupId == groupId, ct);

    public Task<RollMember?> FindMemberAsync(long groupId, long userId, CancellationToken ct)
        => _db.Members.AsNoTracking().FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId, ct);

    /// <summary>要求当前用户是该小队成员，否则抛错。</summary>
    public async Task<RollMember> RequireMemberAsync(long groupId, long userId, CancellationToken ct)
    {
        var member = await FindMemberAsync(groupId, userId, ct);
        if (member is null) throw ApiException.Forbidden("你还不是该小队成员");
        return member;
    }

    /// <summary>要求当前用户是小队成员，且小队处于指定阶段。</summary>
    public async Task<RollGroup> RequireMemberInStageAsync(long groupId, long userId, string stage, CancellationToken ct)
    {
        await RequireMemberAsync(groupId, userId, ct);

        var group = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == groupId, ct)
            ?? throw ApiException.NotFound("小队不存在");

        if (group.Stage != stage)
            throw ApiException.BadRequest(StageLockedMessage(group.Stage));

        return group;
    }

    public static string StageLockedMessage(string stage) => stage switch
    {
        Stages.Preparing => "准备环节进行中，备选项已锁定",
        Stages.Rolling => "正在随机，请稍候",
        Stages.Result => "本轮已出结果，请先回到配置环节",
        _ => "当前阶段不能进行该操作"
    };

    /// <summary>生成不重复的 6 位数字邀请码</summary>
    public async Task<string> GenerateCodeAsync(CancellationToken ct)
    {
        for (var i = 0; i < 8; i++)
        {
            var code = Random.Shared.Next(100000, 1000000).ToString();
            var exists = await _db.Groups.AsNoTracking().AnyAsync(g => g.Code == code, ct);
            if (!exists) return code;
        }
        throw new ApiException("邀请码生成失败，请重试", 500);
    }

    public static void ValidateTheme(string theme)
    {
        if (string.IsNullOrWhiteSpace(theme)) throw ApiException.BadRequest("请填写小队主题");
        if (theme.Length > Limits.MaxThemeLength)
            throw ApiException.BadRequest($"主题最多 {Limits.MaxThemeLength} 个字符");
    }

    public static void ValidatePasscode(string? passcode)
    {
        if (string.IsNullOrEmpty(passcode)) return;
        if (passcode.Length != 5 || !passcode.All(char.IsAsciiDigit))
            throw ApiException.BadRequest("口令必须是 5 位数字");
    }
}
