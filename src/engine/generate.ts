import { applyMove, canMove, isRodComplete, isSolved, type Board, type Move, type Rods } from './board';
import { getLevel } from './levels';
import { createRng, seedFromString, shuffle } from './rng';
import { solve } from './solver';

export interface Puzzle {
  readonly seed: string;
  readonly level: number;
  readonly start: Board;
  /** Fewest moves found (the proven minimum when `parIsMinimum`). */
  readonly par: number;
  readonly parIsMinimum: boolean;
  readonly solution: Move[];
}

/** Search budgets per level: exact on small boards, best-found on big ones. */
const SOLVER_BUDGET = [
  { exactLimit: 100_000 },
  { exactLimit: 100_000 },
  { exactLimit: 15_000, approxLimit: 15_000, weights: [1.6] },
  { exactLimit: 0, approxLimit: 15_000, weights: [5, 2] },
  { exactLimit: 0, approxLimit: 15_000, weights: [8, 3] },
];

/** Solve with the same budget that sets par, so the result is reproducible. */
export function solveForLevel(board: Board, levelId: number) {
  return solve(board, SOLVER_BUDGET[levelId - 1]!);
}

/** Deterministic: the same seed and level always produce the same puzzle. */
export function generatePuzzle(seed: string, levelId: number): Puzzle {
  const level = getLevel(levelId);
  const rng = createRng(seedFromString(`${seed}#${levelId}#sort`));
  const cap = level.height;

  // Start sorted, then mix with random legal moves. Every move can be undone,
  // so the puzzle is always solvable, even with a single spare rod.
  const sorted: Rods = [
    ...[...Array(level.colours).keys()].map((c) => Array<number>(cap).fill(c)),
    ...Array.from({ length: level.spare }, () => [] as number[]),
  ];
  let board: Board = { rods: shuffle(sorted, rng), capacity: cap };
  const history: Move[] = [];
  let last: Move | null = null;
  const allowedComplete = levelId >= 3 ? 0 : 1;
  const wellMixed = (b: Board) => !isSolved(b) && b.rods.filter((r) => isRodComplete(r, cap)).length <= allowedComplete;

  while (history.length < level.scramble || !wellMixed(board)) {
    const options: Move[] = [];
    for (let f = 0; f < board.rods.length; f++)
      for (let t = 0; t < board.rods.length; t++)
        if (canMove(board, f, t) && !(last && last[0] === t && last[1] === f)) options.push([f, t]);
    const move = options[Math.floor(rng() * options.length)]!;
    board = applyMove(board, move[0], move[1]);
    history.push(move);
    last = move;
    if (history.length > level.scramble * 6) break;
  }

  const fallback: Move[] = history
    .slice()
    .reverse()
    .map(([f, t]) => [t, f] as const);
  const result = solveForLevel(board, levelId);
  const useSolver = result.found && result.moves.length <= fallback.length;
  const solution = useSolver ? result.moves : fallback;

  return {
    seed,
    level: levelId,
    start: board,
    par: solution.length,
    parIsMinimum: useSolver && result.optimal,
    solution,
  };
}
