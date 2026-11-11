import type { Movement, StrategyLanguage } from './contracts';
export interface SavedStrategy { id: string; name: string; code: string; language: StrategyLanguage; movement: Movement; }
const key = 'botarena.strategies.v1';
export function loadStrategies(): SavedStrategy[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is SavedStrategy => item && typeof item.id === 'string'
      && typeof item.name === 'string' && typeof item.code === 'string'
      && ['javascript', 'python'].includes(item.language)
      && ['tracked', 'hover', 'wheeled', 'omni'].includes(item.movement));
  } catch { return []; }
}
export function saveStrategies(items: SavedStrategy[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(items)); return true; } catch { return false; }
}
