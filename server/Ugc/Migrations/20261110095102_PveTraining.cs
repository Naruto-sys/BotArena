using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class PveTraining : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "pve_level_progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LevelId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Reward = table.Column<long>(type: "bigint", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pve_level_progress", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pve_level_progress_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_pve_level_progress_UserId_LevelId",
                table: "pve_level_progress",
                columns: new[] { "UserId", "LevelId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "pve_level_progress");
        }
    }
}
