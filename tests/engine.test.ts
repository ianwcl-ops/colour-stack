import { describe, expect, it } from 'vitest';
import { applyMove, canMove, isRodComplete, isSolved, type Board } from '../src/engine/board';
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

  it('allows any colour onto any rod with space', () => {
    expect(canMove(board([[0], [1]]), 0, 1)).toBe(true);
  });

  it('does not allow moving a ring onto the rod it came from', () => {
    expect(canMove(board([[0], []]), 0, 0)).toBe(false);
  });

  it('moves only the top ring', () => {
    expect(applyMove(board([[0, 1], []]), 0, 1).rods).toEqual([[0], [1]]);
  });

  it('never mutates the original board', () => {
    const b = board([[0, 1], []]);
    applyMove(b, 0, 1);
    expect(b.rods).toEqual([[0, 1], []]);
  });

  it('throws on an illegal move', () => {
    expect(() => applyMove(board([[], []]), 0, 1)).toThrow();
  });
});

describe('win rule: every rod empty or full of one colour', () => {
  it('a rod is complete only when full of a single colour', () => {
    expect(isRodComplete([1, 1, 1], 3)).toBe(true);
    expect(isRodComplete([1, 1], 3)).toBe(false);
    expect(isRodComplete([1, 2, 1], 3)).toBe(false);
    expect(isRodComplete([], 3)).toBe(false);
  });

  it('any colour may finish on any rod', () => {
    expect(isSolved(board([[2, 2, 2], [], [0, 0, 0], [1, 1, 1]]))).toBe(true);
    expect(isSolved(board([[], [0, 0, 0], [1, 1, 1], [2, 2, 2]]))).toBe(true);
  });

  it('a mixed rod is never solved', () => {
    expect(isSolved(board([[0, 0, 1], [1, 1, 0], []]))).toBe(false);
  });

  it('a colour split across two rods is not solved', () => {
    expect(isSolved(board([[0, 0], [0], [1, 1, 1]]))).toBe(false);
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
  it('matches the agreed ladder', () => {
    expect(LEVELS.map((l) => [l.colours, l.height, l.spare])).toEqual([
      [3, 3, 1],
      [4, 4, 2],
      [5, 5, 2],
      [6, 6, 2],
      [8, 7, 1],
    ]);
  });

  it('gets bigger at every step', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      const prev = LEVELS[i - 1]!;
      const cur = LEVELS[i]!;
      expect(cur.colours * cur.height).toBeGreaterThan(prev.colours * prev.height);
    }
  });
});

describe('solver', () => {
  it('heuristic is zero on a sorted board', () => {
    expect(heuristic([[0, 0], [1, 1], []], 2)).toBe(0);
  });

  it('heuristic counts rings that must move', () => {
    // Rod 0: pink above blue must move (1). Pink also sits at the bottom of rod 1,
    // and blue's bottom runs are split: at least one run must leave.
    expect(heuristic([[0, 1], [1, 0], []], 2)).toBeGreaterThanOrEqual(2);
  });

  it('finds the optimal number of moves for a small puzzle', () => {
    const result = solve(board([[0, 1], [1, 0], []], 2), 10_000);
    expect(result.optimal).toBe(true);
    expect(result.moves).toHaveLength(3);
  });

  it('returns a path that actually sorts the puzzle', () => {
    let b = board([[0, 1, 0], [1, 0, 1], []]);
    const result = solve(b, 50_000);
    for (const [from, to] of result.moves) b = applyMove(b, from, to);
    expect(isSolved(b)).toBe(true);
  });
});

describe('puzzle generation', () => {
  it('generates identical puzzles from the same seed (same puzzle for both players)', () => {
    expect(generatePuzzle('room-abc', 3)).toEqual(generatePuzzle('room-abc', 3));
  });

  it.each([1, 2, 3, 4, 5])('level %i is solvable in par moves, starts unsorted and well mixed', (level) => {
    const p = generatePuzzle(`seed-${level}`, level);
    const l = LEVELS[level - 1]!;
    expect(p.start.rods).toHaveLength(l.colours + l.spare);
    expect(p.start.capacity).toBe(l.height);
    expect(isSolved(p.start)).toBe(false);
    // Hardly any rod starts already complete.
    expect(p.start.rods.filter((r) => isRodComplete(r, l.height)).length).toBeLessThanOrEqual(level >= 3 ? 0 : 1);
    let b = p.start;
    for (const [from, to] of p.solution) b = applyMove(b, from, to);
    expect(isSolved(b)).toBe(true);
    expect(p.solution).toHaveLength(p.par);
  }, 30_000);

  it('has every colour exactly `height` times', () => {
    const p = generatePuzzle('count', 4);
    const counts = new Map<number, number>();
    for (const c of p.start.rods.flat()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect([...counts.values()]).toEqual(Array(6).fill(6));
  });

  it('level 5 needs far more moves than level 3', () => {
    const p3 = generatePuzzle('compare', 3);
    const p5 = generatePuzzle('compare', 5);
    expect(p5.par).toBeGreaterThan(p3.par * 2);
  }, 30_000);
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
    expect(dailyPuzzleSpec(new Date(2026, 10, 26))).toEqual(dailyPuzzleSpec(new Date(2026, 10, 26, 18)));
  });
  it('gets harder towards the weekend', () => {
    expect(dailyPuzzleSpec(new Date(2026, 10, 29)).level).toBeGreaterThan(dailyPuzzleSpec(new Date(2026, 10, 23)).level);
  });
});
