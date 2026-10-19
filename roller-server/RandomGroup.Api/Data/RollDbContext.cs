using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Domain;

namespace RandomGroup.Api.Data;

public class RollDbContext : DbContext
{
    public RollDbContext(DbContextOptions<RollDbContext> options) : base(options) { }

    public DbSet<RollUser> Users => Set<RollUser>();
    public DbSet<RollGroup> Groups => Set<RollGroup>();
    public DbSet<RollMember> Members => Set<RollMember>();
    public DbSet<RollOption> Options => Set<RollOption>();
    public DbSet<RollVote> Votes => Set<RollVote>();
    public DbSet<RollNotification> Notifications => Set<RollNotification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // 小程序要求 6 位数字团队码长度固定，这里统一给出合理长度上限，兼顾 PostgreSQL 索引效率
        b.Entity<RollUser>(e =>
        {
            e.ToTable("roll_users");
            e.HasKey(x => x.Id);
            e.Property(x => x.OpenId).HasMaxLength(128).IsRequired();
            e.Property(x => x.UnionId).HasMaxLength(128);
            e.Property(x => x.NickName).HasMaxLength(64).IsRequired();
            e.Property(x => x.AvatarContentType).HasMaxLength(64);
            e.HasIndex(x => x.OpenId).IsUnique();
        });

        b.Entity<RollGroup>(e =>
        {
            e.ToTable("roll_groups");
            e.HasKey(x => x.Id);
            e.Property(x => x.Code).HasMaxLength(16).IsRequired();
            e.Property(x => x.Theme).HasMaxLength(Limits.MaxThemeLength).IsRequired();
            e.Property(x => x.Passcode).HasMaxLength(8).IsRequired();
            e.Property(x => x.OwnerName).HasMaxLength(64).IsRequired();
            e.Property(x => x.Stage).HasMaxLength(16).IsRequired();
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.OwnerId);
            e.HasMany(x => x.Members).WithOne(m => m.Group!)
                .HasForeignKey(m => m.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Options).WithOne(o => o.Group!)
                .HasForeignKey(o => o.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RollMember>(e =>
        {
            e.ToTable("roll_members");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(64).IsRequired();
            e.Property(x => x.Ready).HasMaxLength(16).IsRequired();
            // 同一小队同一人只能有一条成员记录
            e.HasIndex(x => new { x.GroupId, x.UserId }).IsUnique();
            e.HasIndex(x => x.UserId);
        });

        b.Entity<RollOption>(e =>
        {
            e.ToTable("roll_options");
            e.HasKey(x => x.Id);
            e.Property(x => x.Title).HasMaxLength(Limits.MaxOptionLength).IsRequired();
            e.Property(x => x.CreatorName).HasMaxLength(64).IsRequired();
            // 同一小队内备选项标题不允许重复
            e.HasIndex(x => new { x.GroupId, x.Title }).IsUnique();
            e.HasIndex(x => x.GroupId);
        });

        b.Entity<RollVote>(e =>
        {
            e.ToTable("roll_votes");
            e.HasKey(x => x.Id);
            // 同一人对同一备选项只能投一票
            e.HasIndex(x => new { x.OptionId, x.UserId }).IsUnique();
            e.HasIndex(x => x.GroupId);
        });

        b.Entity<RollNotification>(e =>
        {
            e.ToTable("roll_notifications");
            e.HasKey(x => x.Id);
            e.Property(x => x.GroupTheme).HasMaxLength(Limits.MaxThemeLength).IsRequired();
            e.Property(x => x.Type).HasMaxLength(16).IsRequired();
            e.Property(x => x.Content).HasMaxLength(256).IsRequired();
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
        });
    }
}
