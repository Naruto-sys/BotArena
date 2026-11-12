using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class StrategyLifecycleTransfersRooms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "strategies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "strategies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPendingTransfer",
                table: "strategies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ValidationError",
                table: "strategies",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "game_rooms",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    CreatorId = table.Column<Guid>(type: "uuid", nullable: false),
                    GuestId = table.Column<Guid>(type: "uuid", nullable: true),
                    AllowClipboard = table.Column<bool>(type: "boolean", nullable: false),
                    AllowPresetStrategies = table.Column<bool>(type: "boolean", nullable: false),
                    MaxCharactersPerSecond = table.Column<int>(type: "integer", nullable: false),
                    Stake = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WinnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    MatchResultJson = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_game_rooms", x => x.Id);
                    table.ForeignKey(
                        name: "FK_game_rooms_users_CreatorId",
                        column: x => x.CreatorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_game_rooms_users_GuestId",
                        column: x => x.GuestId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "strategy_transfers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SenderId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceStrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    CopyStrategyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RespondedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_strategy_transfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_strategy_transfers_strategies_CopyStrategyId",
                        column: x => x.CopyStrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_strategy_transfers_strategies_SourceStrategyId",
                        column: x => x.SourceStrategyId,
                        principalTable: "strategies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_strategy_transfers_users_RecipientId",
                        column: x => x.RecipientId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_strategy_transfers_users_SenderId",
                        column: x => x.SenderId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "room_participants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(16384)", maxLength: 16384, nullable: false),
                    Language = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SourceStrategyId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsReady = table.Column<bool>(type: "boolean", nullable: false),
                    RateWindowStartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CharactersInWindow = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_room_participants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_room_participants_game_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "game_rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_room_participants_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_game_rooms_CreatorId",
                table: "game_rooms",
                column: "CreatorId");

            migrationBuilder.CreateIndex(
                name: "IX_game_rooms_GuestId",
                table: "game_rooms",
                column: "GuestId");

            migrationBuilder.CreateIndex(
                name: "IX_game_rooms_Status_CreatedAt",
                table: "game_rooms",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_room_participants_RoomId_UserId",
                table: "room_participants",
                columns: new[] { "RoomId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_room_participants_UserId",
                table: "room_participants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_strategy_transfers_CopyStrategyId",
                table: "strategy_transfers",
                column: "CopyStrategyId");

            migrationBuilder.CreateIndex(
                name: "IX_strategy_transfers_RecipientId_Status",
                table: "strategy_transfers",
                columns: new[] { "RecipientId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_strategy_transfers_SenderId",
                table: "strategy_transfers",
                column: "SenderId");

            migrationBuilder.CreateIndex(
                name: "IX_strategy_transfers_SourceStrategyId",
                table: "strategy_transfers",
                column: "SourceStrategyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "room_participants");

            migrationBuilder.DropTable(
                name: "strategy_transfers");

            migrationBuilder.DropTable(
                name: "game_rooms");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "strategies");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "strategies");

            migrationBuilder.DropColumn(
                name: "IsPendingTransfer",
                table: "strategies");

            migrationBuilder.DropColumn(
                name: "ValidationError",
                table: "strategies");
        }
    }
}
