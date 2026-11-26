/** Everything is kept on this device only. Wrapped because storage can be unavailable. */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: the game still works, it just won't remember */
  }
}

export const store = {
  unlockedHash: () => read<string>('cs.unlocked', ''),
  setUnlockedHash: (h: string) => write('cs.unlocked', h),

  name: () => read<string>('cs.name', ''),
  setName: (n: string) => write('cs.name', n),

  /** Best result for each daily challenge, by date key. */
  daily: (key: string) => read<{ moves: number; par: number } | null>(`cs.daily.${key}`, null),
  saveDaily: (key: string, moves: number, par: number) => {
    const prev = store.daily(key);
    if (!prev || moves < prev.moves) write(`cs.daily.${key}`, { moves, par });
  },

  practiceLevel: () => read<number>('cs.level', 1),
  setPracticeLevel: (l: number) => write('cs.level', l),
};
