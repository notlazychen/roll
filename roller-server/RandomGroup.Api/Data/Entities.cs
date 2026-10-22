namespace RandomGroup.Api.Data;

/// <summary>
/// 用户 —— 平台的「中心账号」。
///
/// 一个账号可以同时有多种登录方式，全部指向同一个 uid：
///   · 邮箱 + 密码：Web 端注册登录（Email / PasswordHash）
///   · 微信 openid：小程序静默登录（OpenId / UnionId）
/// 三种身份字段都可空，但至少要有一种。小程序首次微信登录会直接建号，
/// 之后用户在 Web 端登录同一账号即可看到同一份数据。
/// </summary>
public class LedgerUser
{
    public long Id { get; set; }
    /// <summary>微信 openid。未绑定微信的 Web 账号为 null</summary>
    public string? OpenId { get; set; }
    public string? UnionId { get; set; }
    /// <summary>登录邮箱（小写存储）。未注册邮箱的纯微信账号为 null</summary>
    public string? Email { get; set; }
    /// <summary>PBKDF2 哈希，格式 v1$迭代次数$盐(base64)$子键(base64)</summary>
    public string? PasswordHash { get; set; }
    /// <summary>对外展示的名字。Web 账号默认取注册邮箱的 @ 前缀</summary>
    public string NickName { get; set; } = string.Empty;
    /// <summary>昵称唯一（不含扩展 mark），用于「我的」页展示与将来的 @ 提及</summary>
    public string NickKey { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    /// <summary>开发模式登录产生的账号（仅本地调试用）</summary>
    public bool IsDevAccount { get; set; }
    /// <summary>是否允许从备注里按规则自动生成标签</summary>
    public bool TagAutoEnabled { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastLoginAt { get; set; }

    /// <summary>是否可以通过邮箱密码登录</summary>
    public bool HasPassword => !string.IsNullOrEmpty(Email) && !string.IsNullOrEmpty(PasswordHash);
}

/// <summary>
/// 选项源项。分类 / 渠道 / 消费者 / 账户 / 标签共用一张表，用 kind 区分。
/// Name 用「父/子」两段式记录层级：渠道必须有父级（餐饮/KFC、购物/淘宝），
/// 其余三类是一级选项。用路径字符串存层级，查询与唯一约束都不用递归 CTE。
/// </summary>
public class LedgerOption
{
    public long Id { get; set; }
    public long UserId { get; set; }
    /// <summary>category | channel | consumer | account | tag</summary>
    public string Kind { get; set; } = Domain.OptionKinds.Category;
    /// <summary>名称，渠道形如「餐饮/KFC」</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>父级名称，仅渠道有值</summary>
    public string? Parent { get; set; }
    /// <summary>排序值，越小越靠前</summary>
    public int SortOrder { get; set; }
    /// <summary>预置项：可以改名，但删除后不会再自动补回来</summary>
    public bool IsPreset { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// 标签规则：备注命中 Keyword 就自动打上该标签。
/// 依赖「标签」这个选项源存在，所以删除标签时连带删除规则。
/// </summary>
public class TagRule
{
    public long Id { get; set; }
    public long UserId { get; set; }
    /// <summary>规则关键词，多个用 | 分隔</summary>
    public string Keyword { get; set; } = string.Empty;
    /// <summary>命中的标签名</summary>
    public string Tag { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>一条账目。金额一律以「分」为单位存整数，避免浮点误差。</summary>
public class LedgerEntry
{
    public long Id { get; set; }
    public long UserId { get; set; }
    /// <summary>expense | income</summary>
    public string Type { get; set; } = Domain.EntryTypes.Expense;
    /// <summary>金额（分），恒为正数，方向由 Type 决定</summary>
    public long Amount { get; set; }
    public string Category { get; set; } = string.Empty;
    public string? Channel { get; set; }
    public string? Consumer { get; set; }
    public string? Account { get; set; }
    /// <summary>交易时间：这笔钱实际发生的时间</summary>
    public DateTimeOffset TradeAt { get; set; }
    /// <summary>记录时间：这条账目录入系统的时间</summary>
    public DateTimeOffset CreatedAt { get; set; }
    public string? Remark { get; set; }
    /// <summary>标签（JSON 字符串数组）</summary>
    public string TagsJson { get; set; } = "[]";
}
