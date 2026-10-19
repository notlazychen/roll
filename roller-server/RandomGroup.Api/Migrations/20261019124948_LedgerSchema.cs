using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <inheritdoc />
    public partial class LedgerSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ledger_entries",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    amount = table.Column<long>(type: "bigint", nullable: false),
                    category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    channel = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    consumer = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    account = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    trade_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    remark = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    tags_json = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ledger_entries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "ledger_options",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    parent = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    is_preset = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ledger_options", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "ledger_tag_rules",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    keyword = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    tag = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ledger_tag_rules", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "ledger_users",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    open_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    union_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    nick_name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    avatar_url = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    is_dev_account = table.Column<bool>(type: "boolean", nullable: false),
                    tag_auto_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ledger_users", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ledger_entries_user_id_category_trade_at",
                table: "ledger_entries",
                columns: new[] { "user_id", "category", "trade_at" });

            migrationBuilder.CreateIndex(
                name: "ix_ledger_entries_user_id_trade_at",
                table: "ledger_entries",
                columns: new[] { "user_id", "trade_at" });

            migrationBuilder.CreateIndex(
                name: "ix_ledger_options_user_id_kind_name",
                table: "ledger_options",
                columns: new[] { "user_id", "kind", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_ledger_options_user_id_kind_parent",
                table: "ledger_options",
                columns: new[] { "user_id", "kind", "parent" });

            migrationBuilder.CreateIndex(
                name: "ix_ledger_tag_rules_user_id_tag",
                table: "ledger_tag_rules",
                columns: new[] { "user_id", "tag" });

            migrationBuilder.CreateIndex(
                name: "ix_ledger_users_open_id",
                table: "ledger_users",
                column: "open_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ledger_entries");

            migrationBuilder.DropTable(
                name: "ledger_options");

            migrationBuilder.DropTable(
                name: "ledger_tag_rules");

            migrationBuilder.DropTable(
                name: "ledger_users");
        }
    }
}
