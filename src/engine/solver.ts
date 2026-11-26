import type { Board, Move, Rods } from './board';

/**
 * Admissible lower bound on moves left to sort the board.
 * - Every ring sitting above a different colour must move at least once.
 * - If a colour forms the bottom run of several rods, only one of those runs can
 *   stay put, so all the others must move.
 */
export function heuristic(rods: Rods, _capacity: number): number {
  let total = 0;
  const runs = new Map<number, number[]>();
  for (const rod of rods) {
    if (!rod.length) continue;
    let run = 1;
    while (run < rod.length && rod[run] === rod[0]) run++;
    total += rod.length - run;
    const c = rod[0]!;
    const list = runs.get(c);
    if (list) list.push(run);
    else runs.set(c, [run]);
  }
  for (const list of runs.values()) {
    if (list.length > 1) total += list.reduce((a, b) => a + b, 0) - Math.max(...list);
  }
  return total;
}

export interface SolveResult {
  moves: Move[];
  /** True when the search proved this is the fewest possible moves. */
  optimal: boolean;
  found: boolean;
}

/** Internally each rod is a short string (one char per ring): fast to copy, compare and key. */
type SRods = string[];

interface Node {
  rods: SRods;
  g: number;
  f: number;
  parent: Node | null;
  move: Move | null;
}

class MinHeap {
  private items: Node[] = [];
  get size(): number {
    return this.items.length;
  }
  push(n: Node): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= n.f) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = n;
  }
  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mf = last.f;
        if (l < a.length && a[l]!.f < mf) {
          m = l;
          mf = a[l]!.f;
        }
        if (r < a.length && a[r]!.f < mf) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

const toS = (rods: Rods): SRods => rods.map((r) => String.fromCharCode(...r.map((c) => 65 + c)));
const keyS = (rods: SRods): string => rods.slice().sort().join('|');

function uniformS(rod: string): boolean {
  for (let i = 1; i < rod.length; i++) if (rod.charCodeAt(i) !== rod.charCodeAt(0)) return false;
  return true;
}

function solvedS(rods: SRods, cap: number): boolean {
  for (const r of rods) if (r.length && (r.length !== cap || !uniformS(r))) return false;
  return true;
}

/** Same bound as `heuristic`, on the string form. */
function hS(rods: SRods): number {
  let total = 0;
  const runs: number[][] = [];
  for (const rod of rods) {
    if (!rod.length) continue;
    const c = rod.charCodeAt(0);
    let run = 1;
    while (run < rod.length && rod.charCodeAt(run) === c) run++;
    total += rod.length - run;
    (runs[c] ??= []).push(run);
  }
  for (const list of runs) {
    if (list && list.length > 1) {
      let sum = 0;
      let max = 0;
      for (const v of list) {
        sum += v;
        if (v > max) max = v;
      }
      total += sum - max;
    }
  }
  return total;
}

function search(start: Board, limit: number, weight: number, prune: boolean): Move[] | null {
  const cap = start.capacity;
  const init = toS(start.rods);
  const best = new Map<string, number>();
  const heap = new MinHeap();
  heap.push({ rods: init, g: 0, f: weight * hS(init), parent: null, move: null });
  best.set(keyS(init), 0);
  let expanded = 0;
  const n = init.length;
  while (heap.size) {
    const node = heap.pop()!;
    const rods = node.rods;
    if (solvedS(rods, cap)) {
      const path: Move[] = [];
      for (let x: Node | null = node; x && x.move; x = x.parent) path.push(x.move);
      return path.reverse();
    }
    if ((best.get(keyS(rods)) ?? Infinity) < node.g) continue;
    if (++expanded > limit) return null;
    for (let from = 0; from < n; from++) {
      const src = rods[from]!;
      if (!src.length) continue;
      const srcUniform = uniformS(src);
      if (prune && srcUniform && src.length === cap) continue;
      const ring = src[src.length - 1]!;
      const rest = src.slice(0, -1);
      let triedEmpty = false;
      for (let to = 0; to < n; to++) {
        if (to === from) continue;
        const dst = rods[to]!;
        if (dst.length >= cap) continue;
        if (node.move && node.move[0] === to && node.move[1] === from) continue;
        if (!dst.length) {
          // All empty rods are equivalent; moving a single-colour rod onto an empty one achieves nothing.
          if (triedEmpty || (prune && srcUniform)) continue;
          triedEmpty = true;
        }
        const next = rods.slice();
        next[from] = rest;
        next[to] = dst + ring;
        const g = node.g + 1;
        const k = keyS(next);
        if ((best.get(k) ?? Infinity) <= g) continue;
        best.set(k, g);
        heap.push({ rods: next, g, f: g + weight * hS(next), parent: node, move: [from, to] });
      }
    }
  }
  return null;
}

export interface SolveOptions {
  /** Node budget for the proven-optimal search (0 skips it). */
  exactLimit?: number;
  /** Node budget for each weighted search. */
  approxLimit?: number;
  weights?: number[];
}

/**
 * Proven-optimal A* when the board is small enough; otherwise an "anytime" run of
 * weighted searches, keeping the shortest solution found. Budgets are node counts,
 * not time, so every device computes exactly the same par.
 */
export function solve(start: Board, opts: SolveOptions | number = {}): SolveResult {
  const o = typeof opts === 'number' ? { exactLimit: opts } : opts;
  const exactLimit = o.exactLimit ?? 150_000;
  const approxLimit = o.approxLimit ?? 30_000;
  if (exactLimit > 0) {
    const exact = search(start, exactLimit, 1, false);
    if (exact) return { moves: exact, optimal: true, found: true };
  }
  let bestMoves: Move[] | null = null;
  for (const w of o.weights ?? [3, 1.8]) {
    // A bigger weight finds some solution fast; smaller weights then look for shorter ones.
    const m = search(start, approxLimit, w, true);
    if (m && (!bestMoves || m.length < bestMoves.length)) bestMoves = m;
  }
  return bestMoves ? { moves: bestMoves, optimal: false, found: true } : { moves: [], optimal: false, found: false };
}
