import { canMove, isRodComplete, type Board } from '../engine/board';
import { h, reducedMotion } from './dom';
import { COLOUR_NAMES, ringEl } from './rings';

interface Flight {
  to: number;
  fromRect: DOMRect;
}

/**
 * The playable rods. Tap a rod to lift its top ring, tap another to drop it.
 * Swiping from one rod to another works too, and number keys pick rods.
 */
export class BoardView {
  readonly el: HTMLElement;
  private rodsEl: HTMLElement;
  private board: Board;
  private selected: number | null = null;
  private dragFrom: number | null = null;
  private locked = false;

  constructor(
    board: Board,
    private onMove: (from: number, to: number) => void,
  ) {
    this.board = board;
    this.rodsEl = h('div.shelves');
    this.el = h('div.table', { style: `--cap:${board.capacity}` }, this.rodsEl);
    this.rodsEl.addEventListener('pointerdown', this.pointerDown);
    // Keyboard activation (Enter/Space) fires click with detail 0 and no pointer events.
    this.rodsEl.addEventListener('click', (ev) => {
      const i = this.rodAt(ev.target);
      if (ev.detail === 0 && i !== null && !this.locked) this.tap(i);
    });
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('resize', this.onResize);
    this.render();
  }

  destroy(): void {
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('resize', this.onResize);
  }

  /** Big boards wrap onto two shelves on narrow screens so rings stay tappable. */
  private rows(): number {
    return this.board.rods.length > 7 && window.innerWidth < 700 ? 2 : 1;
  }

  private lastRows = 0;
  private onResize = (): void => {
    if (this.rows() !== this.lastRows) this.render();
  };

  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.selected = null;
    this.el.classList.toggle('locked', locked);
    this.render();
  }

  update(board: Board, flight?: Flight): void {
    this.board = board;
    this.selected = null;
    this.render();
    if (flight) this.fly(flight);
  }

  private rodAt(target: EventTarget | null): number | null {
    const rod = (target as HTMLElement | null)?.closest?.('.rod') as HTMLElement | null;
    return rod ? Number(rod.dataset.rod) : null;
  }

  private pointerDown = (ev: PointerEvent): void => {
    const i = this.rodAt(ev.target);
    if (i === null || this.locked) return;
    ev.preventDefault();
    this.tap(i);
    this.dragFrom = this.selected === i ? i : null;
  };

  private pointerUp = (ev: PointerEvent): void => {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null || this.locked) return;
    const over = this.rodAt(document.elementFromPoint(ev.clientX, ev.clientY));
    if (over !== null && over !== from) this.tap(over);
  };

  private keyDown = (ev: KeyboardEvent): void => {
    if (this.locked || ev.target instanceof HTMLInputElement) return;
    if (ev.key === 'Escape') {
      this.selected = null;
      this.render();
      return;
    }
    const n = Number(ev.key);
    if (Number.isInteger(n) && n >= 1 && n <= this.board.rods.length) this.tap(n - 1);
  };

  private tap(i: number): void {
    if (this.selected === null) {
      if (this.board.rods[i]!.length) {
        this.selected = i;
        this.render();
      } else this.shake(i);
      return;
    }
    if (this.selected === i) {
      this.selected = null;
      this.render();
      return;
    }
    const from = this.selected;
    if (!canMove(this.board, from, i)) {
      this.shake(i);
      return;
    }
    const lifted = this.rodsEl.querySelector<HTMLElement>(`.rod[data-rod="${from}"] .ring.lifted`);
    this.pendingFlight = lifted ? { to: i, fromRect: lifted.getBoundingClientRect() } : null;
    this.onMove(from, i);
  }

  /** Set during tap() so the owner's update() call can animate the ring. */
  pendingFlight: Flight | null = null;

  takeFlight(): Flight | undefined {
    const f = this.pendingFlight ?? undefined;
    this.pendingFlight = null;
    return f;
  }

  private shake(i: number): void {
    const rod = this.rodsEl.querySelector<HTMLElement>(`.rod[data-rod="${i}"]`);
    if (!rod || reducedMotion()) return;
    rod.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  private fly({ to, fromRect }: Flight): void {
    const ring = this.rodsEl.querySelector<HTMLElement>(`.rod[data-rod="${to}"] .stack .ring:last-child`);
    if (!ring || reducedMotion()) return;
    const end = ring.getBoundingClientRect();
    const dx = fromRect.left - end.left;
    const dy = fromRect.top - end.top;
    const peak = Math.min(dy, 0) - 18;
    ring.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx * 0.35}px, ${peak}px)`, offset: 0.45 },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 300, easing: 'cubic-bezier(.3,.7,.25,1)' },
    );
  }

  private render(): void {
    const { rods, capacity } = this.board;
    const focused = this.rodAt(document.activeElement);
    const rows = this.rows();
    this.lastRows = rows;
    const perRow = Math.ceil(rods.length / rows);
    this.el.style.setProperty('--cols', String(perRow));
    this.el.style.setProperty('--rows', String(rows));
    const buttons = rods.map((rod, i) => {
      const done = isRodComplete(rod, capacity);
      const top = rod.at(-1);
      const stack = h('span.stack', {}, ...rod.map((c) => ringEl(c)));
      if (this.selected === i) {
        const lifted = stack.lastElementChild as HTMLElement;
        lifted.classList.add('lifted');
        lifted.style.setProperty('--lift', String(capacity - rod.length + 1));
      }
      const label =
        `Rod ${i + 1}: ${rod.length} of ${capacity} rings` +
        (top !== undefined ? `, top ${COLOUR_NAMES[top]}` : ', empty') +
        (done ? ', complete' : '');
      return h(
        `button.rod${this.selected === i ? '.selected' : ''}${done ? '.done' : ''}`,
        { type: 'button', 'data-rod': i, 'aria-label': label, 'aria-pressed': this.selected === i ? 'true' : 'false' },
        h('span.pole'),
        stack,
        h('span.match', { 'aria-hidden': 'true' }),
      );
    });
    const shelves: HTMLElement[] = [];
    for (let r = 0; r < rows; r++) {
      shelves.push(h('div.shelf', {}, h('div.rods', {}, ...buttons.slice(r * perRow, (r + 1) * perRow)), h('div.tabletop')));
    }
    this.rodsEl.replaceChildren(...shelves);
    if (focused !== null) this.rodsEl.querySelector<HTMLElement>(`.rod[data-rod="${focused}"]`)?.focus();
  }
}
