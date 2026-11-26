import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/engine/levels';
import { COLOUR_NAMES } from '../src/ui/rings';

// Guards against the bug where Level 5 used colours with no style or shape.
describe('every colour used by any level is drawable', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const rings = readFileSync(new URL('../src/ui/rings.ts', import.meta.url), 'utf8');
  const shapes = rings.slice(rings.indexOf('const SHAPES'), rings.indexOf('];', rings.indexOf('const SHAPES'))).match(/'<[^']+'/g) ?? [];
  const most = Math.max(...LEVELS.map((l) => l.colours));

  it('has a name, a CSS colour and a unique shape for each colour', () => {
    expect(COLOUR_NAMES.length).toBeGreaterThanOrEqual(most);
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(most);
    for (let c = 0; c < most; c++) expect(css).toMatch(new RegExp(`\\.c${c} \\{ --c: var\\(--`));
  });
});
