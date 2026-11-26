/** Level by day of week (Sunday first): easier early in the week, hardest at the weekend. */
const LEVEL_BY_WEEKDAY = [5, 2, 3, 3, 4, 4, 5] as const;

export function dailyKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyPuzzleSpec(date: Date): { seed: string; level: number; key: string } {
  const key = dailyKey(date);
  return { seed: `daily-${key}`, level: LEVEL_BY_WEEKDAY[date.getDay()]!, key };
}
