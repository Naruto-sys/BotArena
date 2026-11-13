using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BotArena.Ugc.Migrations;

[DbContext(typeof(UgcDbContext))]
[Migration("20261113103000_EmptyManeuverLibrary")]
public sealed class EmptyManeuverLibrary : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DeleteData(
            table: "maneuvers", keyColumn: "Id", keyColumnType: "character varying(80)",
            keyValue: "keep-distance-js");
        migrationBuilder.DeleteData(
            table: "maneuvers", keyColumn: "Id", keyColumnType: "character varying(80)",
            keyValue: "precise-aim-js");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.InsertData(
            table: "maneuvers",
            columns: new[] { "Id", "Category", "Code", "Description", "Language", "Name", "Tags", "Usage" },
            columnTypes: new[]
            {
                "character varying(80)", "character varying(30)", "character varying(16384)",
                "character varying(1000)", "character varying(20)", "character varying(80)",
                "text[]", "character varying(500)"
            },
            values: new object[,]
            {
                {
                    "keep-distance-js", "movement",
                    "function keepDistance({ self, enemy }, target = 4.5) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const drive = Math.max(-1, Math.min(1, Math.hypot(x, y) - target));\n  const error = Math.atan2(y, x) - self.bodyAngle;\n  const turn = Math.max(-1, Math.min(1, error * 2));\n  return { leftTrack: drive + turn, rightTrack: drive - turn, aimDirection: { x, y } };\n}",
                    "Подъезжает или отступает, сохраняя заданную дистанцию до цели.", "javascript",
                    "Удержание дистанции", new[] { "движение", "дистанция" }, "keepDistance(state, 4.5)"
                },
                {
                    "precise-aim-js", "combat",
                    "function preciseAim({ self, enemy }) {\n  if (!enemy) return {};\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  const angle = Math.atan2(y, x);\n  const error = Math.atan2(Math.sin(angle - self.turretAngle), Math.cos(angle - self.turretAngle));\n  return { aimDirection: { x, y }, shoot: self.canShoot && Math.abs(error) < 0.05 };\n}",
                    "Наводит башню и стреляет после попадания цели в узкий сектор.", "javascript",
                    "Точное наведение", new[] { "прицел", "стрельба" }, "preciseAim(state)"
                }
            });
    }
}
