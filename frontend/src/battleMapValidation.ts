import type { Wall } from './contracts';
const WIDTH = 16, HEIGHT = 10;

export function validateBattleMap(walls: Wall[]) {
  if (walls.length > 20) return 'На карте может быть не больше 20 препятствий.';
  for (let index = 0; index < walls.length; index++) {
    const wall = walls[index];
    if (![wall.x, wall.y, wall.width, wall.height].every(Number.isFinite)) return 'Координаты препятствия должны быть конечными числами.';
    if (wall.width < .4 || wall.width > 5 || wall.height < .4 || wall.height > 5) return 'Размер препятствия должен быть от 0,4 до 5 клеток.';
    if (wall.x < .2 || wall.y < .2 || wall.x + wall.width > 15.8 || wall.y + wall.height > 9.8) return 'Препятствие выходит за безопасную границу карты.';
    if (hitsSpawn(wall, 2, 5) || hitsSpawn(wall, 14, 5)) return 'Освободите стартовые зоны игроков.';
    if (walls.slice(0, index).some(other => overlaps(wall, other))) return 'Препятствия пересекаются или стоят слишком близко.';
  }
  if (walls.reduce((sum, wall) => sum + wall.width * wall.height, 0) > WIDTH * HEIGHT * .32) return 'Препятствия занимают слишком большую часть карты.';
  return '';
}
function hitsSpawn(wall: Wall, x: number, y: number) { return x >= wall.x - 1 && x <= wall.x + wall.width + 1 && y >= wall.y - 1 && y <= wall.y + wall.height + 1; }
function overlaps(a: Wall, b: Wall) { return a.x < b.x + b.width + .15 && a.x + a.width + .15 > b.x && a.y < b.y + b.height + .15 && a.y + a.height + .15 > b.y; }
