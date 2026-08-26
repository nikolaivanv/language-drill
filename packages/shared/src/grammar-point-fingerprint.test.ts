import { describe, expect, it } from 'vitest';

import { ExerciseType } from './index';
import { grammarPointFingerprint } from './grammar-point-fingerprint';
import type { GrammarPoint } from './curriculum-types';

const gp = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b2-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B2',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

describe('grammarPointFingerprint', () => {
  it('is stable across calls for the same point', () => {
    expect(grammarPointFingerprint(gp())).toBe(grammarPointFingerprint(gp()));
  });

  it('ignores the source order of object keys', () => {
    const a = { key: 'k', kind: 'grammar', name: 'n' } as unknown as GrammarPoint;
    const b = { name: 'n', kind: 'grammar', key: 'k' } as unknown as GrammarPoint;
    expect(grammarPointFingerprint(a)).toBe(grammarPointFingerprint(b));
  });

  // Array order is semantic — constructionVariants order is pickVariantSeeds'
  // documented tie-break, so reordering must NOT be treated as a no-op.
  it('is sensitive to array order', () => {
    const a = gp({ examplesPositive: ['x', 'y'] });
    const b = gp({ examplesPositive: ['y', 'x'] });
    expect(grammarPointFingerprint(a)).not.toBe(grammarPointFingerprint(b));
  });

  it.each([
    ['description', { description: 'changed' }],
    ['name', { name: 'changed' }],
    ['targetOverride', { targetOverride: 75 }],
    ['examplesPositive', { examplesPositive: ['a', 'b', 'c'] }],
    ['commonErrors', { commonErrors: ['d', 'e'] }],
  ])('changes when %s changes', (_label, extra) => {
    expect(grammarPointFingerprint(gp(extra as Partial<GrammarPoint>))).not.toBe(
      grammarPointFingerprint(gp()),
    );
  });

  // The three fields the 2026-08-25/26 work turns on: a variant edit, a
  // per-variant appliesTo scoping, and a coverage floor must each force a
  // fresh attempt for the cells that read them.
  it('changes when a constructionVariant directive changes', () => {
    const a = gp({ constructionVariants: [{ id: 'v', directive: 'one' }, { id: 'w', directive: 'x' }] });
    const b = gp({ constructionVariants: [{ id: 'v', directive: 'two' }, { id: 'w', directive: 'x' }] });
    expect(grammarPointFingerprint(a)).not.toBe(grammarPointFingerprint(b));
  });

  it('changes when a variant gains appliesTo', () => {
    const a = gp({ constructionVariants: [{ id: 'v', directive: 'd' }, { id: 'w', directive: 'x' }] });
    const b = gp({
      constructionVariants: [
        { id: 'v', directive: 'd', appliesTo: [ExerciseType.TRANSLATION] },
        { id: 'w', directive: 'x' },
      ],
    });
    expect(grammarPointFingerprint(a)).not.toBe(grammarPointFingerprint(b));
  });

  it('changes when a coverageSpec floor changes', () => {
    const a = gp({ coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 5 } }] } } as Partial<GrammarPoint>);
    const b = gp({ coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 6 } }] } } as Partial<GrammarPoint>);
    expect(grammarPointFingerprint(a)).not.toBe(grammarPointFingerprint(b));
  });

  it('does not collide across every point in a realistic set', () => {
    const points = Array.from({ length: 500 }, (_, i) => gp({ key: `es-b2-${i}`, description: `d${i}` }));
    expect(new Set(points.map(grammarPointFingerprint)).size).toBe(500);
  });

  it('returns a short stable hex string', () => {
    expect(grammarPointFingerprint(gp())).toMatch(/^[0-9a-f]{32}$/);
  });
});
