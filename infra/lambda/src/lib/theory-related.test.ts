import { describe, expect, it } from 'vitest';

import { deriveRelatedGrammarPoints, TOTAL_RELATED_CAP } from './theory-related';

// Pure-data tests against the REAL curriculum (no db mock needed — the module
// imports only curriculum data helpers from @language-drill/db, never ../db).

describe('deriveRelatedGrammarPoints', () => {
  it('lists reverse-prerequisite edges as leadsTo for Conditional simple', () => {
    const related = deriveRelatedGrammarPoints('ES', 'b1-conditional');
    const leadsTo = related.leadsTo.map((r) => r.topicId);
    // es-b2-remote-conditionals and es-b2-conditional-perfect both declare
    // es-b1-conditional as a prerequisite.
    expect(leadsTo).toContain('b2-remote-conditionals');
    expect(leadsTo).toContain('b2-conditional-perfect');
  });

  it('lists forward prerequisites as buildsOn for Remote conditionals', () => {
    const related = deriveRelatedGrammarPoints('ES', 'b2-remote-conditionals');
    expect(related.buildsOn.map((r) => r.topicId)).toEqual([
      'b1-conditional',
      'b2-past-subjunctive',
    ]);
  });

  it('fills siblings from the same theory category, disjoint from the other groups and capped', () => {
    const related = deriveRelatedGrammarPoints('ES', 'b1-conditional');
    const all = [...related.buildsOn, ...related.leadsTo, ...related.siblings];
    const ids = all.map((r) => r.topicId);
    expect(new Set(ids).size).toBe(ids.length); // disjoint groups
    expect(ids).not.toContain('b1-conditional'); // never self
    expect(all.length).toBeLessThanOrEqual(TOTAL_RELATED_CAP);
    expect(related.siblings.length).toBeGreaterThan(0); // 'moods' is populous
    for (const ref of all) {
      expect(ref.title.length).toBeGreaterThan(0);
      expect(['A1', 'A2', 'B1', 'B2']).toContain(ref.cefr);
    }
  });

  it('ranks siblings by CEFR proximity to the current point', () => {
    const related = deriveRelatedGrammarPoints('ES', 'b1-conditional');
    const distances = related.siblings.map((r) =>
      Math.abs(['A1', 'A2', 'B1', 'B2'].indexOf(r.cefr) - 2 /* B1 */),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('returns empty groups for an unknown topic id', () => {
    const related = deriveRelatedGrammarPoints('ES', 'z9-no-such-topic');
    expect(related).toEqual({ buildsOn: [], leadsTo: [], siblings: [] });
  });

  it('returns empty groups for a non-grammar (vocab umbrella) topic id', () => {
    const related = deriveRelatedGrammarPoints('ES', 'b1-environment-vocab');
    expect(related).toEqual({ buildsOn: [], leadsTo: [], siblings: [] });
  });
});
