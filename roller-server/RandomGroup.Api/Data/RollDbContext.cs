using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Data;

public class RollDbContext : DbContext
{
    public RollDbContext(DbContextOptions<RollDbContext> options) : base(options) { }

    public DbSet<LedgerUser> Users => Set<LedgerUser>();
    public DbSet<LedgerOption> Options => Set<LedgerOption>();
    public DbSet<LedgerEntry> Entries => Set<LedgerEntry>();
    public DbSet<TagRule> TagRules => Set<TagRule>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<LedgerUser>(e =>
        {
            e.ToTable("ledger_users");
            e.HasKey(x => x.Id);
            // 三种身份字段都可空：Web 账号没有 openid，纯微信账号没有邮箱
            e.Property(x => x.OpenId).HasMaxLength(128);
            e.Property(x => x.UnionId).HasMaxLength(128);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.PasswordHash).HasMaxLength(256);
            e.Property(x => x.NickName).HasMaxLength(64).IsRequired();
            e.Property(x => x.NickKey).HasMaxLength(64).IsRequired();
            e.Property(x => x.AvatarUrl).HasMaxLength(512);
            e.Property(x => x.TagAutoEnabled).HasDefaultValue(true);

            // 唯一约束只对有值的行生效（PostgreSQL 里 NULL 不参与唯一比较，
            // 但仍显式过滤，避免换成别的数据库时行为不一致）
            e.HasIndex(x => x.OpenId).IsUnique().HasFilter("open_id IS NOT NULL");
            e.HasIndex(x => x.Email).IsUnique().HasFilter("email IS NOT NULL");
            e.HasIndex(x => x.NickKey).IsUnique();
        });

        b.Entity<LedgerOption>(e =>
        {
            e.ToTable("ledger_options");
            e.HasKey(x => x.Id);
            e.Property(x => x.Kind).HasMaxLength(16).IsRequired();
            e.Property(x => x.Name).HasMaxLength(64).IsRequired();
            e.Property(x => x.Parent).HasMaxLength(32);
            // 同一用户、同一类选项名称唯一：删过一次的预置项也不会被重复补回来
            e.HasIndex(x => new { x.UserId, x.Kind, x.Name }).IsUnique();
            e.HasIndex(x => new { x.UserId, x.Kind, x.Parent });
        });

        b.Entity<LedgerEntry>(e =>
        {
            e.ToTable("ledger_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.Type).HasMaxLength(16).IsRequired();
            e.Property(x => x.Category).HasMaxLength(32).IsRequired();
            e.Property(x => x.Channel).HasMaxLength(64);
            e.Property(x => x.Consumer).HasMaxLength(32);
            e.Property(x => x.Account).HasMaxLength(32);
            e.Property(x => x.Remark).HasMaxLength(Limits.MaxRemarkLength);
            e.Property(x => x.TagsJson).HasMaxLength(256).IsRequired();
            // 明细列表按交易时间倒序分页，报表按用户 + 时间段聚合，这两个索引覆盖主要查询
            e.HasIndex(x => new { x.UserId, x.TradeAt });
            e.HasIndex(x => new { x.UserId, x.Category, x.TradeAt });
        });

        b.Entity<TagRule>(e =>
        {
            e.ToTable("ledger_tag_rules");
            e.HasKey(x => x.Id);
            e.Property(x => x.Keyword).HasMaxLength(128).IsRequired();
            e.Property(x => x.Tag).HasMaxLength(32).IsRequired();
            e.HasIndex(x => new { x.UserId, x.Tag });
        });
    }
}
