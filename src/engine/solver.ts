import { boardKey, canMove, type Board, type Move, type Rods } from './board';

/**
 * Admissible lower bound on moves left. On each rod, every ring at or above the
 * first wrong position must leave, and every target ring from there up must arrive.
 * A move does one of each, so the larger total is a valid lower bound.
 */
export function heuristic(rods: Rods, target: Rods): number {
  let out = 0;
  let inn = 0;
  for (let r = 0; r < rods.length; r++) {
    const cur = rods[r]!;
    const tgt = target[r]!;
    let i = 0;
    while (i < cur.length && i < tgt.length && cur[i] === tgt[i]) i++;
    out += cur.length - i;
    inn += tgt.length - i;
  }
  return Math.max(out, inn);
}

export interface SolveResult {
  moves: Move[];
  /** True when the search proved this is the fewest possible moves. */
  optimal: boolean;
  found: boolean;
}

interface Node {
  rods: Rods;
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

function search(start: Board, target: Rods, limit: number, weight: number): Move[] | null {
  const goal = boardKey(target);
  const best = new Map<string, number>();
  const heap = new MinHeap();
  heap.push({ rods: start.rods, g: 0, f: weight * heuristic(start.rods, target), parent: null, move: null });
  best.set(boardKey(start.rods), 0);
  let expanded = 0;
  while (heap.size) {
    const node = heap.pop()!;
    const key = boardKey(node.rods);
    if (key === goal) {
      const path: Move[] = [];
      for (let n: Node | null = node; n && n.move; n = n.parent) path.push(n.move);
      return path.reverse();
    }
    if ((best.get(key) ?? Infinity) < node.g) continue;
    if (++expanded > limit) return null;
    const board: Board = { rods: node.rods, capacity: start.capacity };
    for (let from = 0; from < node.rods.length; from++) {
      for (let to = 0; to < node.rods.length; to++) {
        if (!canMove(board, from, to)) continue;
        // Moving straight back undoes the last move; never useful.
        if (node.move && node.move[0] === to && node.move[1] === from) continue;
        const rods = node.rods.map((r, i) => (i === from || i === to ? r.slice() : r));
        rods[to]!.push(rods[from]!.pop()!);
        const g = node.g + 1;
        const k = boardKey(rods);
        if ((best.get(k) ?? Infinity) <= g) continue;
        best.set(k, g);
        heap.push({ rods, g, f: g + weight * heuristic(rods, target), parent: node, move: [from, to] });
      }
    }
  }
  return null;
}

/** Optimal A* first; if that runs out of budget, a weighted search for a good path. */
export function solve(start: Board, target: Rods, limit = 120_000): SolveResult {
  const exact = search(start, target, limit, 1);
  if (exact) return { moves: exact, optimal: true, found: true };
  const approx = search(start, target, limit, 2.5);
  if (approx) return { moves: approx, optimal: false, found: true };
  return { moves: [], optimal: false, found: false };
}
