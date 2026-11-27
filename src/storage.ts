import { E2E } from './config';

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

function tabRead(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function tabWrite(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function localRaw(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
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

  /**
   * My player id for a room, so reopening the link gets my seat back. Kept per tab
   * (survives reloads) and per device (survives closing the browser). The automated
   * tests run several players in one browser, so they use the per-tab copy only.
   */
  seat: (code: string) => tabRead(`cs.seat.${code}`) || (E2E ? '' : read<string>(`cs.seat.${code}`, '')),
  setSeat: (code: string, pid: string) => {
    tabWrite(`cs.seat.${code}`, pid);
    if (!E2E) write(`cs.seat.${code}`, pid);
  },

  /** The room I created, saved after every change so my phone can restore it after a reload. */
  hostRoom: (code: string): unknown => {
    const raw = tabRead(`cs.host.${code}`) || (E2E ? '' : localRaw(`cs.host.${code}`));
    if (!raw) return null;
    try {
      const saved = JSON.parse(raw) as { at: number; state: unknown };
      return Date.now() - saved.at < 60 * 60_000 ? saved.state : null;
    } catch {
      return null;
    }
  },
  saveHostRoom: (code: string, state: unknown) => {
    const raw = JSON.stringify({ at: Date.now(), state });
    tabWrite(`cs.host.${code}`, raw);
    if (!E2E) write(`cs.host.${code}`, { at: Date.now(), state });
  },
  forgetHostRoom: (code: string) => {
    try {
      sessionStorage.removeItem(`cs.host.${code}`);
      localStorage.removeItem(`cs.host.${code}`);
    } catch {
      /* ignore */
    }
  },

  practiceLevel: () => read<number>('cs.level', 1),
  setPracticeLevel: (l: number) => write('cs.level', l),
};
