using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "roll_groups",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    theme = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    passcode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    owner_id = table.Column<long>(type: "bigint", nullable: false),
                    owner_name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    stage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    prep_started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    prep_deadline = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    result_option_id = table.Column<long>(type: "bigint", nullable: true),
                    result_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    round = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_groups", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roll_notifications",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    group_id = table.Column<long>(type: "bigint", nullable: true),
                    group_theme = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    content = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    read = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_notifications", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roll_users",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    open_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    union_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    nick_name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    avatar_url = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    is_dev_account = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roll_votes",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    option_id = table.Column<long>(type: "bigint", nullable: false),
                    group_id = table.Column<long>(type: "bigint", nullable: false),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_votes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "roll_members",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    group_id = table.Column<long>(type: "bigint", nullable: false),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ready = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_members", x => x.id);
                    table.ForeignKey(
                        name: "fk_roll_members_roll_groups_group_id",
                        column: x => x.group_id,
                        principalTable: "roll_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "roll_options",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    group_id = table.Column<long>(type: "bigint", nullable: false),
                    title = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    creator_id = table.Column<long>(type: "bigint", nullable: false),
                    creator_name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_roll_options", x => x.id);
                    table.ForeignKey(
                        name: "fk_roll_options_roll_groups_group_id",
                        column: x => x.group_id,
                        principalTable: "roll_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_roll_groups_code",
                table: "roll_groups",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_roll_groups_created_at",
                table: "roll_groups",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "ix_roll_groups_owner_id",
                table: "roll_groups",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_roll_members_group_id_user_id",
                table: "roll_members",
                columns: new[] { "group_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_roll_members_user_id",
                table: "roll_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_roll_notifications_user_id_created_at",
                table: "roll_notifications",
                columns: new[] { "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_roll_options_group_id",
                table: "roll_options",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "ix_roll_options_group_id_title",
                table: "roll_options",
                columns: new[] { "group_id", "title" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_roll_users_open_id",
                table: "roll_users",
                column: "open_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_roll_votes_group_id",
                table: "roll_votes",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "ix_roll_votes_option_id_user_id",
                table: "roll_votes",
                columns: new[] { "option_id", "user_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "roll_members");

            migrationBuilder.DropTable(
                name: "roll_notifications");

            migrationBuilder.DropTable(
                name: "roll_options");

            migrationBuilder.DropTable(
                name: "roll_users");

            migrationBuilder.DropTable(
                name: "roll_votes");

            migrationBuilder.DropTable(
                name: "roll_groups");
        }
    }
}
