import { applyMove, canMove, isSolved, type Board, type Move, type Rods } from './board';
import { getLevel } from './levels';
import { createRng, seedFromString, shuffle } from './rng';
import { heuristic, solve } from './solver';

export interface Puzzle {
  readonly seed: string;
  readonly level: number;
  readonly start: Board;
  readonly target: Rods;
  /** Fewest moves found (proven minimum when `parIsMinimum`). */
  readonly par: number;
  readonly parIsMinimum: boolean;
  readonly solution: Move[];
}

function buildTarget(colours: number, height: number, spare: number, patterned: boolean, rng: () => number): Rods {
  const order = shuffle([...Array(colours).keys()], rng);
  let full: Rods;
  if (!patterned) {
    full = order.map((c) => Array<number>(height).fill(c));
  } else {
    const rings = order.flatMap((c) => Array<number>(height).fill(c));
    do {
      const mixed = shuffle(rings, rng);
      full = order.map((_, i) => mixed.slice(i * height, (i + 1) * height));
    } while (full.every((r) => new Set(r).size === 1));
  }
  return [...full, ...Array.from({ length: spare }, () => [] as number[])];
}

/** Deterministic: the same seed and level always produce the same puzzle. */
export function generatePuzzle(seed: string, levelId: number): Puzzle {
  const level = getLevel(levelId);
  const rng = createRng(seedFromString(`${seed}#${levelId}`));
  const target = buildTarget(level.colours, level.height, level.spare, level.patterned, rng);
  const goal: Board = { rods: target, capacity: level.height };

  // Mix by playing random legal moves from the target, so a solution always exists.
  let board = goal;
  const history: Move[] = [];
  let last: Move | null = null;
  const minDistance = Math.ceil(level.scramble / 2);
  while (history.length < level.scramble || heuristic(board.rods, target) < minDistance || isSolved(board, target)) {
    const options: Move[] = [];
    for (let f = 0; f < board.rods.length; f++)
      for (let t = 0; t < board.rods.length; t++)
        if (canMove(board, f, t) && !(last && last[0] === t && last[1] === f)) options.push([f, t]);
    const move = options[Math.floor(rng() * options.length)]!;
    board = applyMove(board, move[0], move[1]);
    history.push(move);
    last = move;
    if (history.length > level.scramble * 4) break;
  }

  const fallback = history
    .slice()
    .reverse()
    .map(([f, t]) => [t, f] as const);
  const result = solve(board, target);
  const solution = result.found && result.moves.length <= fallback.length ? result.moves : fallback;

  return {
    seed,
    level: levelId,
    start: board,
    target,
    par: solution.length,
    parIsMinimum: result.optimal && solution === result.moves,
    solution,
  };
}
