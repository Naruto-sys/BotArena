import type { StrategyLanguage, WeaponType } from './contracts';

export const weapons: Record<WeaponType, { name: string; description: string }> = {
  Cannon: { name: 'Обычная пушка', description: '20 HP · перезарядка 0,6 с · прямой выстрел' },
  Mortar: { name: 'Миномёт', description: '35 HP · радиус взрыва 1,25 · перезарядка 1,5 с' },
  Gauss: { name: 'Гаусс-пушка', description: '60 HP · перезарядка 2,5 с · мгновенный луч' },
};

export function savedWeapon(value: unknown): WeaponType {
  return value === 'Mortar' || value === 'Gauss' ? value : 'Cannon';
}

export const weaponExamples: Record<StrategyLanguage, string> = {
  javascript: `function tick({ self, enemy }) {
  if (!enemy) return {};
  const action = {
    aimAt: enemy.position,
    shoot: self.canShoot && (self.weapon === 'Mortar' || facing(self, enemy.position))
  };
  if (self.weapon === 'Mortar') action.targetPoint = enemy.position;
  return action;
}`,
  python: `def tick(state):
    self = state["self"]
    enemy = state["enemy"]
    if enemy is None:
        return {}
    action = {
        "aimAt": enemy["position"],
        "shoot": self["canShoot"] and (self["weapon"] == "Mortar" or facing(self, enemy["position"])),
    }
    if self["weapon"] == "Mortar":
        action["targetPoint"] = enemy["position"]
    return action
`,
};
