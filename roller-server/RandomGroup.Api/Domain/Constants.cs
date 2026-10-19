namespace RandomGroup.Api.Domain;

/// <summary>账目方向</summary>
public static class EntryTypes
{
    public const string Expense = "expense";
    public const string Income = "income";

    public static bool IsValid(string? type) => type is Expense or Income;
}

/// <summary>选项源种类</summary>
public static class OptionKinds
{
    public const string Category = "category";
    public const string Channel = "channel";
    public const string Consumer = "consumer";
    public const string Account = "account";
    public const string Tag = "tag";

    public static readonly string[] All = { Category, Channel, Consumer, Account, Tag };

    public static bool IsValid(string? kind) => kind is not null && All.Contains(kind);
}

/// <summary>业务硬约束，与小程序端保持一致</summary>
public static class Limits
{
    public const int MaxRemarkLength = 100;
    public const int MaxOptionNameLength = 16;
    /// <summary>单笔金额上限：1000 万元（分）</summary>
    public const long MaxAmountCents = 1_000_000_000L;
    /// <summary>标签数量上限（单条账目）</summary>
    public const int MaxTagsPerEntry = 8;
    /// <summary>标签规则条数上限</summary>
    public const int MaxTagRules = 50;
}

/// <summary>
/// 新用户初始化时预置的选项源。
/// 渠道用「父/子」，父级必须是同名的一级选项（分类里确实有这一项）。
/// </summary>
public static class PresetOptions
{
    public static readonly string[] Categories =
    {
        "餐饮", "住宿", "出行", "购物",
        "娱乐", "医疗", "学习", "人情往来",
        "工资", "奖金", "理财收益", "其他收入", "其他支出"
    };

    /// <summary>按分类挂的常用渠道</summary>
    public static readonly (string Parent, string[] Children)[] Channels =
    {
        ("餐饮", new[] { "肯德基", "麦当劳", "星巴克", "美团外卖", "海底捞" }),
        ("住宿", new[] { "如家", "汉庭", "全季", "Airbnb" }),
        ("出行", new[] { "滴滴", "高德打车", "地铁", "12306", "加油" }),
        ("购物", new[] { "淘宝", "京东", "拼多多", "万达广场", "山姆" }),
        ("娱乐", new[] { "猫眼电影", "Steam", "健身" })
    };

    public static readonly string[] Consumers = { "本人", "家人", "朋友", "同事" };

    public static readonly string[] Accounts = { "支付宝", "微信", "现金", "银行卡" };

    /// <summary>标签 + 对应的备注关键词规则</summary>
    public static readonly (string Tag, string Keywords)[] Tags =
    {
        ("聚餐", "聚餐|请客|团建"),
        ("外卖", "外卖|美团|饿了么"),
        ("交通", "打车|地铁|公交|高铁|机票"),
        ("网购", "淘宝|京东|拼多多|下单"),
        ("日用", "超市|买菜|日用品"),
        ("医疗", "医院|药|体检"),
        ("报销", "报销|发票")
    };
}
