using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RandomGroup.Api.Migrations
{
    /// <summary>
    /// 头像由「客户端传 URL」改为「传图片，服务端存库」。
    /// 1) 新增 avatar_data(bytea) / avatar_content_type / avatar_version；
    /// 2) 删掉旧的 avatar_url —— 它从来没被真正写过（微信早已不再下发头像地址，
    ///    客户端也一直没传过 AvatarUrl），所以这里的数据丢失是零风险；
    ///    头像地址改成每次响应由 AvatarUrls.For(user) 现算（/api/users/{id}/avatar?v=N）。
    /// </summary>
    public partial class AddUserAvatar : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "avatar_url",
                table: "roll_users");

            migrationBuilder.AddColumn<string>(
                name: "avatar_content_type",
                table: "roll_users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "avatar_data",
                table: "roll_users",
                type: "bytea",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "avatar_version",
                table: "roll_users",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "avatar_content_type",
                table: "roll_users");

            migrationBuilder.DropColumn(
                name: "avatar_data",
                table: "roll_users");

            migrationBuilder.DropColumn(
                name: "avatar_version",
                table: "roll_users");

            migrationBuilder.AddColumn<string>(
                name: "avatar_url",
                table: "roll_users",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);
        }
    }
}
