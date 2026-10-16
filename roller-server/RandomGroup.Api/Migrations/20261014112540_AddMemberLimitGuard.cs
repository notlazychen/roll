using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <summary>
    /// 人数上限的数据库级兜底。
    ///
    /// 应用层在加入小队时已经会检查人数并给出友好提示，但两个人几乎同时在人数边界上
    /// 请求加入时，仅靠「先查后写」仍可能双双通过。这里用 PostgreSQL 触发器做硬约束：
    /// 无论请求怎么并发，第 21 个成员都会在第 21 条 insert 上被数据库直接拒绝。
    /// </summary>
    public partial class AddMemberLimitGuard : Migration
    {
        private const int MaxMembers = 20;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 触发器是 PostgreSQL 专有语法，其它 provider（例如测试用的 SQLite）直接跳过
            if (ActiveProvider is null ||
                !ActiveProvider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            migrationBuilder.Sql($"""
                CREATE OR REPLACE FUNCTION roll_enforce_member_limit() RETURNS trigger AS $$
                DECLARE
                    cnt integer;
                BEGIN
                    SELECT count(*) INTO cnt FROM roll_members WHERE group_id = NEW.group_id;
                    IF cnt >= {MaxMembers} THEN
                        RAISE EXCEPTION 'MEMBER_LIMIT_REACHED'
                            USING ERRCODE = 'check_violation',
                                  HINT = 'group member limit is {MaxMembers}';
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                """);

            migrationBuilder.Sql("""
                CREATE TRIGGER trg_roll_members_limit
                BEFORE INSERT ON roll_members
                FOR EACH ROW EXECUTE FUNCTION roll_enforce_member_limit();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            if (ActiveProvider is null ||
                !ActiveProvider.Contains("Npgsql", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            migrationBuilder.Sql("DROP TRIGGER IF EXISTS trg_roll_members_limit ON roll_members;");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS roll_enforce_member_limit();");
        }
    }
}
