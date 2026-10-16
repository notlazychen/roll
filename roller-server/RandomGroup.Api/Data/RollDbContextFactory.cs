using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace RandomGroup.Api.Data;

/// <summary>
/// 供 `dotnet ef` 在设计时创建上下文使用（生成迁移时不需要真的连上数据库）。
/// </summary>
public class RollDbContextFactory : IDesignTimeDbContextFactory<RollDbContext>
{
    public RollDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ROLL_CONNECTION")
            ?? "Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=roll";

        var options = new DbContextOptionsBuilder<RollDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

        return new RollDbContext(options);
    }
}
