export interface Level {
  readonly id: number;
  readonly name: string;
  /** Number of ring colours (each colour gets its own full rod in the target). */
  readonly colours: number;
  /** Rings per colour, and the rod height limit. */
  readonly height: number;
  /** Empty rods available for shuffling rings. */
  readonly spare: number;
  /** Random moves used to mix the puzzle from the target. */
  readonly scramble: number;
  /** Solid colour columns (false) or mixed target patterns (true). */
  readonly patterned: boolean;
}

export const LEVELS: readonly Level[] = [
  { id: 1, name: 'Warm-up', colours: 3, height: 3, spare: 1, scramble: 8, patterned: false },
  { id: 2, name: 'Easy', colours: 3, height: 4, spare: 2, scramble: 14, patterned: false },
  { id: 3, name: 'Tricky', colours: 4, height: 4, spare: 2, scramble: 20, patterned: true },
  { id: 4, name: 'Hard', colours: 4, height: 5, spare: 2, scramble: 28, patterned: true },
  { id: 5, name: 'Expert', colours: 5, height: 5, spare: 2, scramble: 36, patterned: true },
];

export function getLevel(id: number): Level {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown level ${id}`);
  return level;
}
