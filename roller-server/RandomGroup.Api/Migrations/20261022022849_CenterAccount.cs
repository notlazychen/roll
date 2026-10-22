using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <inheritdoc />
    public partial class CenterAccount : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_ledger_users_open_id",
                table: "ledger_users");

            migrationBuilder.AlterColumn<string>(
                name: "open_id",
                table: "ledger_users",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128);

            migrationBuilder.AddColumn<string>(
                name: "email",
                table: "ledger_users",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "nick_key",
                table: "ledger_users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "password_hash",
                table: "ledger_users",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            // 老数据补齐 nick_key：昵称转小写去空白。
            // 必须在「加列之后、建唯一索引之前」执行 —— 生产库已有真实用户，
            // 空字符串会让唯一索引直接建不起来。
            migrationBuilder.Sql("""
                UPDATE ledger_users
                SET nick_key = LOWER(TRIM(nick_name))
                WHERE nick_key = '' OR nick_key IS NULL;
                """);

            // 兜底：历史数据里本来就有重名时，给重复项追加 id 后缀
            migrationBuilder.Sql("""
                WITH dup AS (
                    SELECT id,
                           ROW_NUMBER() OVER (PARTITION BY nick_key ORDER BY id) AS rn
                    FROM ledger_users
                )
                UPDATE ledger_users u
                SET nick_key = u.nick_key || '_' || u.id::text
                FROM dup
                WHERE u.id = dup.id AND dup.rn > 1;
                """);

            migrationBuilder.CreateIndex(
                name: "ix_ledger_users_email",
                table: "ledger_users",
                column: "email",
                unique: true,
                filter: "email IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_ledger_users_nick_key",
                table: "ledger_users",
                column: "nick_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_ledger_users_open_id",
                table: "ledger_users",
                column: "open_id",
                unique: true,
                filter: "open_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_ledger_users_email",
                table: "ledger_users");

            migrationBuilder.DropIndex(
                name: "ix_ledger_users_nick_key",
                table: "ledger_users");

            migrationBuilder.DropIndex(
                name: "ix_ledger_users_open_id",
                table: "ledger_users");

            migrationBuilder.DropColumn(
                name: "email",
                table: "ledger_users");

            migrationBuilder.DropColumn(
                name: "nick_key",
                table: "ledger_users");

            migrationBuilder.DropColumn(
                name: "password_hash",
                table: "ledger_users");

            migrationBuilder.AlterColumn<string>(
                name: "open_id",
                table: "ledger_users",
                type: "character varying(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(128)",
                oldMaxLength: 128,
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_ledger_users_open_id",
                table: "ledger_users",
                column: "open_id",
                unique: true);
        }
    }
}
