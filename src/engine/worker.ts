import { generatePuzzle } from './generate';

self.onmessage = (ev: MessageEvent<{ id: number; seed: string; level: number }>) => {
  const { id, seed, level } = ev.data;
  self.postMessage({ id, puzzle: generatePuzzle(seed, level) });
};
