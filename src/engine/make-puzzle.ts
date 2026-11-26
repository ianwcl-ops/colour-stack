import type { Puzzle } from './generate';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (p: Puzzle) => void>();

/** Generates puzzles off the main thread so animations never stutter. */
export function makePuzzle(seed: string, level: number): Promise<Puzzle> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; puzzle: Puzzle }>) => {
      pending.get(ev.data.id)?.(ev.data.puzzle);
      pending.delete(ev.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, seed, level });
  });
}
