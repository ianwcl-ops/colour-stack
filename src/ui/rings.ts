import type { Rods } from '../engine/board';
import { h } from './dom';

export const COLOUR_NAMES = ['pink', 'yellow', 'green', 'blue', 'purple', 'orange', 'teal', 'charcoal'] as const;

/** A shape per colour so the game works for colour-blind players too. */
const SHAPES = [
  '<circle cx="6" cy="6" r="4.2"/>',
  '<path d="M6 1.4 10.8 10H1.2z"/>',
  '<rect x="2" y="2" width="8" height="8" rx="1"/>',
  '<path d="M6 .8 11.2 6 6 11.2.8 6z"/>',
  '<path d="M4.4 1h3.2v3.4H11v3.2H7.6V11H4.4V7.6H1V4.4h3.4z"/>',
  '<path d="M6 .6 7.6 4.3l4 .4-3 2.7.9 3.9L6 9.3l-3.5 2 .9-3.9-3-2.7 4-.4z"/>',
  '<path d="M6 11 1.4 6.6A2.9 2.9 0 0 1 6 2.9a2.9 2.9 0 0 1 4.6 3.7z"/>',
  '<path d="M6 .8a5.2 5.2 0 1 1 0 10.4A5.2 5.2 0 0 1 6 .8zm0 2.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z" fill-rule="evenodd"/>',
];

export function shapeSvg(colour: number): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg viewBox="0 0 12 12" aria-hidden="true">${SHAPES[colour] ?? ''}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

export function ringEl(colour: number): HTMLElement {
  return h(`span.ring.c${colour}`, {}, shapeSvg(colour));
}

/** Small read-only picture of a board: used for the opponent's live view. */
export function miniBoard(rods: Rods, capacity: number, className = 'mini'): HTMLElement {
  return h(
    `div.${className}`,
    { style: `--cap:${capacity}` },
    ...rods.map((rod) =>
      h(
        'div.mini-rod',
        {},
        ...rod.map((c) => h(`span.cell.c${c}`, {}, shapeSvg(c))),
      ),
    ),
  );
}
