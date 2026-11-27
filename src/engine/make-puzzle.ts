import type { Board, Move } from './board';
import type { Puzzle } from './generate';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: unknown) => void>();

function run<T>(job: Record<string, unknown>): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; result: unknown }>) => {
      pending.get(ev.data.id)?.(ev.data.result);
      pending.delete(ev.data.id);
    };
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as (r: unknown) => void);
    worker!.postMessage({ ...job, id });
  });
}

/** Generates puzzles off the main thread so animations never stutter. */
export const makePuzzle = (seed: string, level: number): Promise<Puzzle> => run({ kind: 'puzzle', seed, level });

/** A good next move for the hint button, worked out in the background. */
export const hintMove = (board: Board, level: number): Promise<Move | null> => run({ kind: 'hint', board, level });
