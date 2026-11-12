const storageKey = 'botarena.campaign.completed';

export function loadCompletedLevels(): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function markLevelCompleted(levelId: string): string[] {
  const completed = new Set(loadCompletedLevels());
  completed.add(levelId);
  const next = [...completed];
  localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
}

export function isLevelUnlocked(order: number, levels: { id: string; order: number }[], completed: string[]): boolean {
  if (order <= 1) return true;
  const previous = levels.find(level => level.order === order - 1);
  return previous ? completed.includes(previous.id) : false;
}
