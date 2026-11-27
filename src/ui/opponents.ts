import { heuristic } from '../engine/solver';
import { playerPuzzle, type MatchState, type Player } from '../net/match';
import { h } from './dom';
import { miniBoard } from './rings';

export const ordinal = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

/**
 * Live view of everyone else in the race: mini boards on bigger screens (or when
 * there's just one opponent), compact progress bars on phones.
 */
export class OpponentsPanel {
  readonly el = h('section.opponents', { 'aria-label': 'Other players' });
  constructor(private s: MatchState) {
    window.addEventListener('resize', this.onResize);
    this.update(s);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.update(this.s);

  private racers(s: MatchState): Player[] {
    return s.players.filter((p) => p.id !== s.myId && p.inRound);
  }

  update(s: MatchState): void {
    this.s = s;
    const others = this.racers(s);
    const boards = others.length === 1 || window.innerWidth >= 700;
    this.el.className = `opponents ${boards ? 'as-boards' : 'as-bars'}`;
    this.el.replaceChildren(...others.map((p) => (boards ? this.board(p) : this.bar(p))));
  }

  private status(p: Player): string {
    if (!p.present) return 'left';
    if (!p.connected && !p.result) return 'reconnecting…';
    if (p.result?.gaveUp) return 'gave up';
    if (p.result?.place) return ordinal(p.result.place);
    return `${p.moves} moves`;
  }

  private progress(p: Player): number {
    if (p.result && !p.result.gaveUp) return 1;
    if (!p.rods.length) return 0;
    const start = playerPuzzle(this.s, p).start;
    const startH = Math.max(1, heuristic(start.rods, start.capacity));
    return Math.min(1, Math.max(0, 1 - heuristic(p.rods, start.capacity) / startH));
  }

  private board(p: Player): HTMLElement {
    const cap = playerPuzzle(this.s, p).start.capacity;
    return h(
      `article.opp${p.result ? '.done' : ''}${p.present && (p.connected || p.result) ? '' : '.gone'}`,
      { 'data-player': p.name },
      miniBoard(p.rods, cap),
      h('p', {}, h('span.name', {}, p.name), ' ', h('strong.status', {}, this.status(p))),
      p.handicap ? h('small.lmm-tag', {}, 'Little man mode') : null,
    );
  }

  private bar(p: Player): HTMLElement {
    const pct = Math.round(this.progress(p) * 100);
    return h(
      `article.opp-bar${p.result ? '.done' : ''}${p.present && (p.connected || p.result) ? '' : '.gone'}`,
      { 'data-player': p.name },
      h('span.name', {}, p.name),
      h('span.track', { role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${p.name}'s progress` }, h('span.fill', { style: `width:${pct}%` })),
      h('strong.status', {}, this.status(p)),
    );
  }
}
