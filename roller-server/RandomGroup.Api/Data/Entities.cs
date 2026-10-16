namespace RandomGroup.Api.Data;

/// <summary>用户（一个小程序 openid 对应一条记录）</summary>
public class RollUser
{
    public long Id { get; set; }
    public string OpenId { get; set; } = string.Empty;
    public string? UnionId { get; set; }
    public string NickName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    /// <summary>开发模式登录产生的账号（仅本地调试用）</summary>
    public bool IsDevAccount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastLoginAt { get; set; }
}

/// <summary>小队</summary>
public class RollGroup
{
    public long Id { get; set; }
    /// <summary>6 位数字邀请码，用于搜索加入</summary>
    public string Code { get; set; } = string.Empty;
    public string Theme { get; set; } = string.Empty;
    /// <summary>5 位数字口令，空字符串表示不需要口令</summary>
    public string Passcode { get; set; } = string.Empty;
    public long OwnerId { get; set; }
    public string OwnerName { get; set; } = string.Empty;

    /// <summary>config | preparing | rolling | result</summary>
    public string Stage { get; set; } = Domain.Stages.Config;

    public DateTimeOffset? PrepStartedAt { get; set; }
    public DateTimeOffset? PrepDeadline { get; set; }
    public long? ResultOptionId { get; set; }
    public DateTimeOffset? ResultAt { get; set; }

    /// <summary>
    /// 抽取轮次。每次进入 rolling 自增一次，结果写入时以 (Stage, Round) 为条件，
    /// 保证同一轮只会产生一个结果（并发请求下也只有一条能改成功）。
    /// </summary>
    public long Round { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public List<RollMember> Members { get; set; } = new();
    public List<RollOption> Options { get; set; } = new();
}

/// <summary>小队成员</summary>
public class RollMember
{
    public long Id { get; set; }
    public long GroupId { get; set; }
    public long UserId { get; set; }
    /// <summary>组内显示名（默认取用户昵称，可在组内单独修改）</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>none | confirm | cancel</summary>
    public string Ready { get; set; } = Domain.ReadyStates.None;
    public DateTimeOffset JoinedAt { get; set; }

    public RollGroup? Group { get; set; }
}

/// <summary>备选项</summary>
public class RollOption
{
    public long Id { get; set; }
    public long GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public long CreatorId { get; set; }
    public string CreatorName { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }

    public RollGroup? Group { get; set; }
}

/// <summary>投票：一票即一单位权重</summary>
public class RollVote
{
    public long Id { get; set; }
    public long OptionId { get; set; }
    public long GroupId { get; set; }
    public long UserId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>站内通知</summary>
public class RollNotification
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public long? GroupId { get; set; }
    public string GroupTheme { get; set; } = string.Empty;
    /// <summary>join | prepare | cancel | result | info</summary>
    public string Type { get; set; } = Domain.NotificationTypes.Info;
    public string Content { get; set; } = string.Empty;
    public bool Read { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
