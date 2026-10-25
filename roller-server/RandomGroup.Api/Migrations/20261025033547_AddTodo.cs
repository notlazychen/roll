using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTodo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "todo_checkins",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    task_id = table.Column<long>(type: "bigint", nullable: false),
                    day = table.Column<DateOnly>(type: "date", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_todo_checkins", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "todo_tasks",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<long>(type: "bigint", nullable: false),
                    title = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    due_date = table.Column<DateOnly>(type: "date", nullable: true),
                    week_days = table.Column<int>(type: "integer", nullable: false),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_todo_tasks", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_todo_checkins_task_id_day",
                table: "todo_checkins",
                columns: new[] { "task_id", "day" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_todo_checkins_user_id_day",
                table: "todo_checkins",
                columns: new[] { "user_id", "day" });

            migrationBuilder.CreateIndex(
                name: "ix_todo_tasks_user_id_archived_due_date",
                table: "todo_tasks",
                columns: new[] { "user_id", "archived", "due_date" });

            migrationBuilder.CreateIndex(
                name: "ix_todo_tasks_user_id_start_date",
                table: "todo_tasks",
                columns: new[] { "user_id", "start_date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "todo_checkins");

            migrationBuilder.DropTable(
                name: "todo_tasks");
        }
    }
}
