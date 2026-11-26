export interface Level {
  readonly id: number;
  readonly name: string;
  /** Number of ring colours. */
  readonly colours: number;
  /** Rings per colour, which is also the rod height limit. */
  readonly height: number;
  /** Extra empty rods for shuffling rings around. */
  readonly spare: number;
  /** Random moves used to mix the puzzle up from a sorted board. */
  readonly scramble: number;
}

export const LEVELS: readonly Level[] = [
  { id: 1, name: 'Warm-up', colours: 3, height: 3, spare: 1, scramble: 60 },
  { id: 2, name: 'Easy', colours: 4, height: 4, spare: 2, scramble: 150 },
  { id: 3, name: 'Tricky', colours: 5, height: 5, spare: 2, scramble: 260 },
  { id: 4, name: 'Hard', colours: 6, height: 6, spare: 2, scramble: 420 },
  { id: 5, name: 'Expert', colours: 8, height: 7, spare: 1, scramble: 900 },
];

export function getLevel(id: number): Level {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown level ${id}`);
  return level;
}
