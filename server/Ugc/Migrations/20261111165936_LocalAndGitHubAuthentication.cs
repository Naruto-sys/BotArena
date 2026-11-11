using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class LocalAndGitHubAuthentication : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "YandexId",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.AddColumn<string>(
                name: "GitHubId",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Login",
                table: "users",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedLogin",
                table: "users",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PasswordHash",
                table: "users",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_GitHubId",
                table: "users",
                column: "GitHubId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_NormalizedLogin",
                table: "users",
                column: "NormalizedLogin",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_users_GitHubId",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_NormalizedLogin",
                table: "users");

            migrationBuilder.DropColumn(
                name: "GitHubId",
                table: "users");

            migrationBuilder.DropColumn(
                name: "Login",
                table: "users");

            migrationBuilder.DropColumn(
                name: "NormalizedLogin",
                table: "users");

            migrationBuilder.DropColumn(
                name: "PasswordHash",
                table: "users");

            migrationBuilder.AlterColumn<string>(
                name: "YandexId",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);
        }
    }
}
