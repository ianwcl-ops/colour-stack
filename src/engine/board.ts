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

export function isSolved(board: Board, target: Rods): boolean {
  if (board.rods.length !== target.length) return false;
  return board.rods.every((rod, i) => {
    const t = target[i]!;
    return rod.length === t.length && rod.every((c, j) => c === t[j]);
  });
}

export function boardKey(rods: Rods): string {
  return rods.map((r) => r.join('')).join('|');
}
