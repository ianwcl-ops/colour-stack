import { applyMove, isSolved, type Board, type Rods } from '../engine/board';
import { solveForLevel } from '../engine/generate';
import { stars, twoStarAllowance } from '../engine/score';
import type { PuzzleData } from '../net/match';
import { E2E } from '../config';
import { BoardView } from './board-view';
import { h } from './dom';

export interface SessionOptions {
  puzzle: PuzzleData;
  heading: string;
  sub: string;
  onBack: () => void;
  onMove?: (rods: Rods, moves: number) => void;
  onSolved: (moves: number, ms: number) => void;
  allowReset: boolean;
  /** Panel above the rods, e.g. opponents' live progress. */
  side?: HTMLElement;
  /** Races only: lets a stuck player stop (no points). */
  onGiveUp?: () => void;
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
  private footer: HTMLElement;
  private note = h('p.hint', {}, 'Tap a rod to lift its top ring, then tap where it goes.');

  constructor(private o: SessionOptions) {
    this.board = o.puzzle.start;
    this.view = new BoardView(this.board, (f, t) => this.move(f, t));
    this.view.setLocked(true);

    const p = o.puzzle;

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
      o.side ? h('section.cards', {}, o.side) : h('p.goal', {}, 'Sort the rings so every rod holds just one colour.'),
      this.view.el,
      (this.footer = h(
        'footer.actions',
        {},
        o.allowReset ? h('button.ghost', { type: 'button', onclick: () => this.reset() }, 'Start over') : null,
        o.onGiveUp ? this.giveUpButton(o.onGiveUp) : null,
        this.note,
      )),
    );
    this.paintStars();
    if (E2E) (window as unknown as { __cs: unknown }).__cs = { solution: () => solveForLevel(this.board, p.level).moves };
  }

  /** Two taps, so a stray tap can't end someone's race. */
  private giveUpButton(onGiveUp: () => void): HTMLElement {
    let armed = false;
    const b = h<'button'>('button.ghost.give-up', {
      type: 'button',
      onclick: () => {
        if (!armed) {
          armed = true;
          b.textContent = 'Tap again to give up';
          setTimeout(() => {
            armed = false;
            b.textContent = 'Give up';
          }, 3000);
          return;
        }
        this.finished = true;
        this.view.setLocked(true);
        onGiveUp();
      },
    }, 'Give up');
    return b;
  }

  /** Replace the footer with a status line, e.g. after finishing while others race on. */
  setNote(text: string): void {
    this.footer.replaceChildren(h('p.note', { role: 'status' }, text));
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
    if (isSolved(this.board)) {
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
