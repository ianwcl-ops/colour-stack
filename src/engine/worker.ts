import type { Board } from './board';
import { generatePuzzle, solveForLevel } from './generate';

type Job = { id: number; kind: 'puzzle'; seed: string; level: number } | { id: number; kind: 'hint'; board: Board; level: number };

self.onmessage = (ev: MessageEvent<Job>) => {
  const job = ev.data;
  if (job.kind === 'puzzle') self.postMessage({ id: job.id, result: generatePuzzle(job.seed, job.level) });
  else self.postMessage({ id: job.id, result: solveForLevel(job.board, job.level).moves[0] ?? null });
};
