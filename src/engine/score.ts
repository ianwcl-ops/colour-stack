export type Stars = 1 | 2 | 3;

/** How many extra moves over par still earn 2 stars. */
export function twoStarAllowance(par: number): number {
  return Math.max(2, Math.ceil(par * 0.25));
}

export function stars(moves: number, par: number): Stars {
  if (moves <= par) return 3;
  if (moves <= par + twoStarAllowance(par)) return 2;
  return 1;
}
