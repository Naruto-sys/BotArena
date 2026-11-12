using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class InitialUgc : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "maneuvers",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Category = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Language = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Code = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: false),
                    Usage = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Tags = table.Column<string[]>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_maneuvers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    YandexId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AvatarUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Nickname = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    NormalizedNickname = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastLoginAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "strategies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Language = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Code = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: false),
                    Tags = table.Column<string[]>(type: "text[]", nullable: false),
                    Visibility = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ShareToken = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ForkedFromId = table.Column<Guid>(type: "uuid", nullable: true),
                    ForkCount = table.Column<int>(type: "integer", nullable: false),
                    RunCount = table.Column<int>(type: "integer", nullable: false),
                    LikeCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_strategies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_strategies_strategies_ForkedFromId",
                        column: x => x.ForkedFromId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_strategies_users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "strategy_versions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Tags = table.Column<string[]>(type: "text[]", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_strategy_versions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_strategy_versions_strategies_StrategyId",
                        column: x => x.StrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "maneuvers",
                columns: new[] { "Id", "Category", "Code", "Description", "Language", "Name", "Tags", "Usage" },
                values: new object[,]
                {
                    { "keep-distance-js", "movement", "function keepDistance({ self, enemy }, target = 4.5) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const drive = Math.max(-1, Math.min(1, Math.hypot(x, y) - target));\n  const error = Math.atan2(y, x) - self.bodyAngle;\n  const turn = Math.max(-1, Math.min(1, error * 2));\n  return { leftTrack: drive + turn, rightTrack: drive - turn, aimDirection: { x, y } };\n}", "Подъезжает или отступает, сохраняя заданную дистанцию до цели.", "javascript", "Удержание дистанции", new[] { "движение", "дистанция" }, "keepDistance(state, 4.5)" },
                    { "precise-aim-js", "combat", "function preciseAim({ self, enemy }) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const angle = Math.atan2(y, x);\n  const error = Math.atan2(Math.sin(angle - self.turretAngle), Math.cos(angle - self.turretAngle));\n  return { aimDirection: { x, y }, shoot: self.canShoot && Math.abs(error) < 0.05 };\n}", "Наводит башню и стреляет после попадания цели в узкий сектор.", "javascript", "Точное наведение", new[] { "прицел", "стрельба" }, "preciseAim(state)" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_strategies_ForkedFromId",
                table: "strategies",
                column: "ForkedFromId");

            migrationBuilder.CreateIndex(
                name: "IX_strategies_OwnerId",
                table: "strategies",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_strategies_ShareToken",
                table: "strategies",
                column: "ShareToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_strategies_Visibility_UpdatedAt",
                table: "strategies",
                columns: new[] { "Visibility", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_strategy_versions_StrategyId_Number",
                table: "strategy_versions",
                columns: new[] { "StrategyId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_NormalizedNickname",
                table: "users",
                column: "NormalizedNickname",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_YandexId",
                table: "users",
                column: "YandexId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "maneuvers");

            migrationBuilder.DropTable(
                name: "strategy_versions");

            migrationBuilder.DropTable(
                name: "strategies");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
