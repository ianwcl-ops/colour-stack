import { describe, expect, it } from 'vitest';
import { applyMove, canMove, isSolved, type Board } from '../src/engine/board';
import { createRng, seedFromString } from '../src/engine/rng';
import { LEVELS } from '../src/engine/levels';
import { generatePuzzle } from '../src/engine/generate';
import { heuristic, solve } from '../src/engine/solver';
import { stars } from '../src/engine/score';
import { dailyKey, dailyPuzzleSpec } from '../src/engine/daily';

const board = (rods: number[][], capacity = 3): Board => ({ rods, capacity });

describe('board rules', () => {
  it('only allows moving from a non-empty rod', () => {
    expect(canMove(board([[], [0]]), 0, 1)).toBe(false);
  });

  it('does not allow moving onto a full rod', () => {
    expect(canMove(board([[0], [1, 1, 1]]), 0, 1)).toBe(false);
  });

  it('does not allow moving a ring onto the rod it came from', () => {
    expect(canMove(board([[0], []]), 0, 0)).toBe(false);
  });

  it('moves only the top ring', () => {
    const next = applyMove(board([[0, 1], []]), 0, 1);
    expect(next.rods).toEqual([[0], [1]]);
  });

  it('never mutates the original board', () => {
    const b = board([[0, 1], []]);
    applyMove(b, 0, 1);
    expect(b.rods).toEqual([[0, 1], []]);
  });

  it('throws on an illegal move', () => {
    expect(() => applyMove(board([[], []]), 0, 1)).toThrow();
  });

  it('is solved only when every rod matches the target exactly', () => {
    const target = [[0, 1], [1]];
    expect(isSolved(board([[0, 1], [1]]), target)).toBe(true);
    expect(isSolved(board([[1, 0], [1]]), target)).toBe(false);
    expect(isSolved(board([[0], [1, 1]]), target)).toBe(false);
  });
});

describe('seeded randomness', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(seedFromString('family'));
    const b = createRng(seedFromString('family'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(seedFromString('a'))()).not.toEqual(createRng(seedFromString('b'))());
  });
});

describe('levels', () => {
  it('has exactly 5 levels that get harder', () => {
    expect(LEVELS).toHaveLength(5);
    for (let i = 1; i < LEVELS.length; i++) {
      const prev = LEVELS[i - 1]!;
      const cur = LEVELS[i]!;
      expect(cur.colours * cur.height).toBeGreaterThanOrEqual(prev.colours * prev.height);
      expect(cur.scramble).toBeGreaterThan(prev.scramble);
    }
  });
});

describe('solver', () => {
  it('heuristic is zero on a solved board', () => {
    expect(heuristic([[0, 1], []], [[0, 1], []])).toBe(0);
  });

  it('finds the optimal number of moves for a small puzzle', () => {
    // Swap two single rings using a spare rod: needs 3 moves.
    const result = solve(board([[1], [0], []], 1), [[0], [1], []], 10_000);
    expect(result.optimal).toBe(true);
    expect(result.moves).toHaveLength(3);
  });

  it('returns a path that actually solves the puzzle', () => {
    const target = [[0, 0, 0], [1, 1, 1], []];
    let b = board([[0, 1, 0], [1, 0, 1], []]);
    const result = solve(b, target, 50_000);
    for (const [from, to] of result.moves) b = applyMove(b, from, to);
    expect(isSolved(b, target)).toBe(true);
  });
});

describe('puzzle generation', () => {
  it('generates identical puzzles from the same seed (same puzzle for both players)', () => {
    expect(generatePuzzle('room-abc', 3)).toEqual(generatePuzzle('room-abc', 3));
  });

  it.each([1, 2, 3, 4, 5])('level %i is solvable within par and does not start solved', (level) => {
    const p = generatePuzzle(`seed-${level}`, level);
    expect(isSolved(p.start, p.target)).toBe(false);
    let b = p.start;
    for (const [from, to] of p.solution) b = applyMove(b, from, to);
    expect(isSolved(b, p.target)).toBe(true);
    expect(p.solution).toHaveLength(p.par);
  });

  it('keeps every colour count the same between start and target', () => {
    const p = generatePuzzle('count', 4);
    const tally = (rods: number[][]) => rods.flat().sort().join(',');
    expect(tally(p.start.rods)).toBe(tally(p.target));
  });

  it('uses solid-colour targets on the easy levels and patterns from level 3', () => {
    const easy = generatePuzzle('x', 1);
    expect(easy.target.filter((r) => r.length).every((r) => new Set(r).size === 1)).toBe(true);
    const hard = generatePuzzle('x', 3);
    expect(hard.target.some((r) => new Set(r).size > 1)).toBe(true);
  });
});

describe('stars', () => {
  it('gives 3 stars at or under par', () => {
    expect(stars(10, 10)).toBe(3);
    expect(stars(9, 10)).toBe(3);
  });
  it('gives 2 stars when close to par', () => {
    expect(stars(12, 10)).toBe(2);
  });
  it('gives 1 star for any other solve', () => {
    expect(stars(30, 10)).toBe(1);
  });
});

describe('daily challenge', () => {
  it('uses the local calendar date as the key', () => {
    expect(dailyKey(new Date(2026, 10, 26, 23, 59))).toBe('2026-11-26');
  });
  it('gives everyone the same puzzle spec on the same day', () => {
    const d = new Date(2026, 10, 26);
    expect(dailyPuzzleSpec(d)).toEqual(dailyPuzzleSpec(new Date(2026, 10, 26, 18)));
  });
  it('gets harder towards the weekend', () => {
    const monday = dailyPuzzleSpec(new Date(2026, 10, 23)).level;
    const sunday = dailyPuzzleSpec(new Date(2026, 10, 29)).level;
    expect(sunday).toBeGreaterThan(monday);
  });
});
