using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations
{
    /// <inheritdoc />
    public partial class PveCampaignStats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "CompletedAt",
                table: "pve_level_progress",
                type: "timestamp with time zone",
                nullable: true,
                oldClrType: typeof(DateTimeOffset),
                oldType: "timestamp with time zone");

            migrationBuilder.AddColumn<int>(
                name: "Attempts",
                table: "pve_level_progress",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "BestDurationTicks",
                table: "pve_level_progress",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastDamageTaken",
                table: "pve_level_progress",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastDurationTicks",
                table: "pve_level_progress",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LowestDamageTaken",
                table: "pve_level_progress",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Attempts",
                table: "pve_level_progress");

            migrationBuilder.DropColumn(
                name: "BestDurationTicks",
                table: "pve_level_progress");

            migrationBuilder.DropColumn(
                name: "LastDamageTaken",
                table: "pve_level_progress");

            migrationBuilder.DropColumn(
                name: "LastDurationTicks",
                table: "pve_level_progress");

            migrationBuilder.DropColumn(
                name: "LowestDamageTaken",
                table: "pve_level_progress");

            migrationBuilder.AlterColumn<DateTimeOffset>(
                name: "CompletedAt",
                table: "pve_level_progress",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)),
                oldClrType: typeof(DateTimeOffset),
                oldType: "timestamp with time zone",
                oldNullable: true);
        }
    }
}
