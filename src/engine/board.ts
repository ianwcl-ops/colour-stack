/** A rod is a stack of colour indices, bottom ring first. */
export type Rods = number[][];
export type Move = readonly [from: number, to: number];

export interface Board {
  readonly rods: Rods;
  /** Maximum rings a rod can hold. */
  readonly capacity: number;
}

export function canMove(board: Board, from: number, to: number): boolean {
  if (from === to) return false;
  const src = board.rods[from];
  const dst = board.rods[to];
  if (!src || !dst) return false;
  return src.length > 0 && dst.length < board.capacity;
}

export function applyMove(board: Board, from: number, to: number): Board {
  if (!canMove(board, from, to)) throw new Error(`Illegal move ${from} -> ${to}`);
  const rods = board.rods.map((r) => r.slice());
  const ring = rods[from]!.pop()!;
  rods[to]!.push(ring);
  return { rods, capacity: board.capacity };
}

/** A rod is complete when it is full and every ring on it is the same colour. */
export function isRodComplete(rod: readonly number[], capacity: number): boolean {
  return rod.length === capacity && rod.every((c) => c === rod[0]);
}

/** Solved when every rod is either empty or complete. Any colour may sit on any rod. */
export function isSolved(board: Board): boolean {
  return board.rods.every((rod) => rod.length === 0 || isRodComplete(rod, board.capacity));
}

/** Rod order doesn't matter for sorting, so equivalent boards share one key. */
export function boardKey(rods: Rods): string {
  return rods
    .map((r) => r.join(','))
    .sort()
    .join('|');
}
