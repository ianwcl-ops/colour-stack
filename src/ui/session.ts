import { applyMove, isSolved, type Board, type Rods } from '../engine/board';
import { solve } from '../engine/solver';
import { stars, twoStarAllowance } from '../engine/score';
import type { PuzzleData } from '../net/match';
import { E2E } from '../config';
import { BoardView } from './board-view';
import { h } from './dom';
import { miniBoard } from './rings';

export interface SessionOptions {
  puzzle: PuzzleData;
  heading: string;
  sub: string;
  onBack: () => void;
  onMove?: (rods: Rods, moves: number) => void;
  onSolved: (moves: number, ms: number) => void;
  allowReset: boolean;
  /** Extra panel beside the target card, e.g. the opponent's live board. */
  side?: HTMLElement;
}

/** One puzzle being played: header, target card, rods and move counter. */
export class GameSession {
  readonly el: HTMLElement;
  private board: Board;
  private moves = 0;
  private startedAt = 0;
  private view: BoardView;
  private movesEl = h('strong.count', {}, '0');
  private starsEl = h('span.live-stars', { 'aria-label': '3 stars on track' });
  private finished = false;

  constructor(private o: SessionOptions) {
    this.board = o.puzzle.start;
    this.view = new BoardView(this.board, o.puzzle.target, (f, t) => this.move(f, t));
    this.view.setLocked(true);

    const p = o.puzzle;
    const card = h(
      'figure.card',
      {},
      miniBoard(p.target, p.start.capacity, 'mini.target'),
      h('figcaption', {}, 'Match this'),
    );

    this.el = h(
      'main.screen.play',
      {},
      h(
        'header.bar',
        {},
        h('button.back', { type: 'button', onclick: () => o.onBack(), 'aria-label': 'Leave game' }, 'Back'),
        h('div.heading', {}, h('span', {}, o.heading), h('small', {}, o.sub)),
        h(
          'div.tally',
          {},
          h('span.moves', {}, this.movesEl, h('small', {}, 'moves')),
          h('span.par', {}, h('strong', {}, String(p.par)), h('small', {}, 'par')),
          this.starsEl,
        ),
      ),
      h('section.cards', {}, card, o.side ?? null),
      this.view.el,
      h(
        'footer.actions',
        {},
        o.allowReset ? h('button.ghost', { type: 'button', onclick: () => this.reset() }, 'Start over') : null,
        h('p.hint', {}, 'Tap a rod to lift its top ring, then tap where it goes.'),
      ),
    );
    this.paintStars();
    if (E2E) (window as unknown as { __cs: unknown }).__cs = { solution: () => solve(this.board, p.target).moves };
  }

  start(): void {
    this.startedAt = performance.now();
    this.view.setLocked(false);
  }

  lock(): void {
    this.view.setLocked(true);
  }

  destroy(): void {
    this.view.destroy();
  }

  get elapsed(): number {
    return performance.now() - this.startedAt;
  }

  private move(from: number, to: number): void {
    if (this.finished) return;
    this.board = applyMove(this.board, from, to);
    this.moves++;
    this.movesEl.textContent = String(this.moves);
    this.view.update(this.board, this.view.takeFlight());
    this.paintStars();
    this.o.onMove?.(this.board.rods, this.moves);
    if (isSolved(this.board, this.o.puzzle.target)) {
      this.finished = true;
      this.view.setLocked(true);
      this.el.classList.add('solved');
      this.o.onSolved(this.moves, this.elapsed);
    }
  }

  private reset(): void {
    this.board = this.o.puzzle.start;
    this.moves = 0;
    this.movesEl.textContent = '0';
    this.view.update(this.board);
    this.paintStars();
  }

  /** Live star meter: shows what the player is still on track for. */
  private paintStars(): void {
    const par = this.o.puzzle.par;
    // Best still reachable: moves made so far can only grow.
    const best = this.moves <= par ? 3 : stars(this.moves, par);
    this.starsEl.replaceChildren(...[1, 2, 3].map((n) => h(`span.star${n <= best ? '.on' : ''}`, {}, '★')));
    this.starsEl.setAttribute('aria-label', `${best} star${best > 1 ? 's' : ''} still possible`);
    this.starsEl.title = `3 stars at ${par} moves or fewer, 2 stars up to ${par + twoStarAllowance(par)}`;
  }
}
