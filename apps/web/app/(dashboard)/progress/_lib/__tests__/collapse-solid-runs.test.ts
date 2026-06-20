import { describe, it, expect } from 'vitest';
import { collapseSolidRuns } from '../collapse-solid-runs';
import type { CurriculumMapPoint } from '@language-drill/api-client';

const p = (key: string, state: CurriculumMapPoint['state'], errorProne = false) =>
  ({ key, state, errorProne } as CurriculumMapPoint);

describe('collapseSolidRuns', () => {
  it('collapses a run of >=3 consecutive non-error solids into one run entry', () => {
    const out = collapseSolidRuns([p('a', 'learning'), p('b', 'solid'), p('c', 'solid'), p('d', 'solid'), p('e', 'not-started')]);
    expect(out.map((e) => e.kind)).toEqual(['point', 'run', 'point']);
    const run = out[1] as { kind: 'run'; count: number };
    expect(run.count).toBe(3);
  });
  it('does NOT collapse runs shorter than 3', () => {
    const out = collapseSolidRuns([p('a', 'solid'), p('b', 'solid'), p('c', 'learning')]);
    expect(out.every((e) => e.kind === 'point')).toBe(true);
  });
  it('never collapses an error-prone solid (it must stay visible)', () => {
    const out = collapseSolidRuns([p('a', 'solid'), p('b', 'solid', true), p('c', 'solid'), p('d', 'solid')]);
    // error-prone 'b' breaks the run; remaining are <3 or include the flagged one
    expect(out.some((e) => e.kind === 'point' && (e as any).point.key === 'b')).toBe(true);
  });
});
