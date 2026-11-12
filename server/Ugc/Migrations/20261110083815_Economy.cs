using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class Economy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Balance",
                table: "users",
                type: "bigint",
                nullable: false,
                defaultValue: 1000L);

            migrationBuilder.AddColumn<long>(
                name: "SalePrice",
                table: "strategies",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "balance_transactions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ReferenceId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_balance_transactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_balance_transactions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "battle_challenges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChallengerId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpponentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChallengerStrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    OpponentStrategyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Stake = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WinnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_battle_challenges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_battle_challenges_strategies_ChallengerStrategyId",
                        column: x => x.ChallengerStrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_battle_challenges_strategies_OpponentStrategyId",
                        column: x => x.OpponentStrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_battle_challenges_users_ChallengerId",
                        column: x => x.ChallengerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_battle_challenges_users_OpponentId",
                        column: x => x.OpponentId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "strategy_purchases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BuyerId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<long>(type: "bigint", nullable: false),
                    PurchasedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_strategy_purchases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_strategy_purchases_strategies_StrategyId",
                        column: x => x.StrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_strategy_purchases_users_BuyerId",
                        column: x => x.BuyerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_balance_transactions_UserId_CreatedAt",
                table: "balance_transactions",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_battle_challenges_ChallengerId",
                table: "battle_challenges",
                column: "ChallengerId");

            migrationBuilder.CreateIndex(
                name: "IX_battle_challenges_ChallengerStrategyId",
                table: "battle_challenges",
                column: "ChallengerStrategyId");

            migrationBuilder.CreateIndex(
                name: "IX_battle_challenges_OpponentId_Status",
                table: "battle_challenges",
                columns: new[] { "OpponentId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_battle_challenges_OpponentStrategyId",
                table: "battle_challenges",
                column: "OpponentStrategyId");

            migrationBuilder.CreateIndex(
                name: "IX_strategy_purchases_BuyerId",
                table: "strategy_purchases",
                column: "BuyerId");

            migrationBuilder.CreateIndex(
                name: "IX_strategy_purchases_StrategyId_BuyerId",
                table: "strategy_purchases",
                columns: new[] { "StrategyId", "BuyerId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "balance_transactions");

            migrationBuilder.DropTable(
                name: "battle_challenges");

            migrationBuilder.DropTable(
                name: "strategy_purchases");

            migrationBuilder.DropColumn(
                name: "Balance",
                table: "users");

            migrationBuilder.DropColumn(
                name: "SalePrice",
                table: "strategies");
        }
    }
}
