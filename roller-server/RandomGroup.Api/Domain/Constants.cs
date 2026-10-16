namespace RandomGroup.Api.Domain;

/// <summary>阶段机：config（配置）-> preparing（准备）-> rolling（随机中）-> result（已出结果）</summary>
public static class Stages
{
    public const string Config = "config";
    public const string Preparing = "preparing";
    public const string Rolling = "rolling";
    public const string Result = "result";
}

/// <summary>成员在准备环节的状态</summary>
public static class ReadyStates
{
    public const string None = "none";
    public const string Confirm = "confirm";
    public const string Cancel = "cancel";
}

/// <summary>业务硬约束，与小程序端保持一致</summary>
public static class Limits
{
    public const int MaxMembers = 20;
    public const int MaxThemeLength = 10;
    public const int MaxOptionLength = 20;
    public const int MaxNotificationsPerUser = 100;

    /// <summary>准备环节允许的最长时限（秒），防止小队长设置过大的值</summary>
    public const int MaxPrepareSeconds = 3600;
}

/// <summary>通知类型</summary>
public static class NotificationTypes
{
    public const string Join = "join";
    public const string Prepare = "prepare";
    public const string Cancel = "cancel";
    public const string Result = "result";
    public const string Info = "info";
}
