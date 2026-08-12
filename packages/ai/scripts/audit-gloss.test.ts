import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildFixtureCaseResult,
  computeMajorityVerdict,
  extractParentheticals,
  FIXTURE_DRAWS_PER_CASE,
  hasParenthetical,
  loadFixtureCases,
  parseAuditGlossArgs,
  scoreFixtureResults,
  selectRowsToJudge,
  type FixtureCaseResult,
  type FixtureDraw,
  type GlossRow,
} from './audit-gloss.js';
import { GLOSS_ROW_SYSTEM_PROMPT } from '../src/gloss-spoilage.js';

const here = path.dirname(fileURLToPath(import.meta.url));

type FixtureCase = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  glossEn: string;
  expected: 'spoiled' | 'legitimate';
  heldOut: boolean;
  note: string;
};

describe('fixtures/gloss-spoilage-cases.json', () => {
  const raw = JSON.parse(
    readFileSync(path.join(here, 'fixtures', 'gloss-spoilage-cases.json'), 'utf8'),
  ) as { cases: FixtureCase[] };
  const heldOut = raw.cases.filter((c) => c.heldOut);
  const contaminated = raw.cases.filter((c) => !c.heldOut);

  it('carries 21 cases total: 10 contaminated (regression guard) + 11 held-out (the gate)', () => {
    expect(raw.cases).toHaveLength(21);
    expect(contaminated).toHaveLength(10);
    expect(heldOut).toHaveLength(11);
  });

  it('the contaminated set carries 6 known spoilers and 4 known-legitimate rows', () => {
    expect(contaminated.filter((c) => c.expected === 'spoiled')).toHaveLength(6);
    expect(contaminated.filter((c) => c.expected === 'legitimate')).toHaveLength(4);
  });

  it('the held-out set carries 6 known spoilers and 5 known-legitimate rows', () => {
    // Originally 5/5: de55dc02 (tr-a1-accusative-definite-object) was
    // corrected from "legitimate" to "spoiled" on 2026-08-12 after the
    // judge's reasoning was checked against the generation prompt's
    // definiteness-fallback rule and found correct — see the case's `note`.
    // Then e658e200 was added as a 6th legitimate case: the generation
    // prompt's own SANCTIONED definiteness-fallback usage, added specifically
    // to catch the judge over-generalising the de55dc02 correction.
    expect(heldOut.filter((c) => c.expected === 'spoiled')).toHaveLength(6);
    expect(heldOut.filter((c) => c.expected === 'legitimate')).toHaveLength(5);
  });

  it('at least one held-out legitimate case has NO parenthetical at all (e658e200 — the sanctioned fallback)', () => {
    // Pinned so a future refactor cannot silently reintroduce an assumption
    // that every fixture gloss carries a "(...)" span.
    const noParenCases = heldOut.filter((c) => !c.glossEn.includes('('));
    expect(noParenCases.map((c) => c.id)).toEqual(['e658e200-3ff8-5b2a-a7e1-3af6ecb9d537']);
  });

  it('every case carries a gloss, a real exercise id, and an explicit heldOut flag', () => {
    for (const c of raw.cases) {
      expect(c.glossEn.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^[0-9a-f]{8}-/);
      expect(c.note.length).toBeGreaterThan(0);
      expect(typeof c.heldOut).toBe('boolean');
    }
  });

  it('every spoiler gloss contains the parenthetical that leaks', () => {
    // The gate would be vacuous if a "spoiler" case had no leaking span to find.
    for (const c of raw.cases.filter((x) => x.expected === 'spoiled')) {
      expect(c.glossEn).toContain('(');
    }
  });

  it('no id repeats across the contaminated and held-out sets', () => {
    const ids = raw.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // This is the regression the fix round exists to prevent: the ORIGINAL
  // fixture's 1.00/1.00 score turned out to measure whether the judge could
  // repeat GLOSS_ROW_SYSTEM_PROMPT's own worked examples, not whether it
  // generalises. These two tests pin the contamination boundary so it can
  // never silently drift — a held-out case whose span leaks into the prompt
  // (or a "contaminated" case that turns out to be clean) would invalidate
  // the corresponding score without anyone noticing.
  it('every held-out case is absent from GLOSS_ROW_SYSTEM_PROMPT (guards the gate against re-contamination)', () => {
    for (const c of heldOut) {
      expect(GLOSS_ROW_SYSTEM_PROMPT).not.toContain(c.glossEn);
      const span = c.glossEn.match(/\(([^)]*)\)/)?.[1];
      if (span) {
        expect(GLOSS_ROW_SYSTEM_PROMPT).not.toContain(span);
      }
    }
  });

  it('every contaminated case really is present in GLOSS_ROW_SYSTEM_PROMPT (documents why it cannot be the gate)', () => {
    for (const c of contaminated) {
      const span = c.glossEn.match(/\(([^)]*)\)/)?.[1];
      const glossPresent = GLOSS_ROW_SYSTEM_PROMPT.includes(c.glossEn);
      const spanPresent = span !== undefined && GLOSS_ROW_SYSTEM_PROMPT.includes(span);
      expect(glossPresent || spanPresent).toBe(true);
    }
  });
});

describe('parseAuditGlossArgs', () => {
  it('defaults to a live run with no filters', () => {
    const a = parseAuditGlossArgs([]);
    expect(a.dryRun).toBe(false);
    expect(a.checkFixture).toBe(false);
    expect(a.language).toBeUndefined();
  });

  it('uppercases language and cefr because the pool stores them uppercase', () => {
    const a = parseAuditGlossArgs(['--language', 'es', '--cefr', 'a1']);
    expect(a.language).toBe('ES');
    expect(a.cefr).toBe('A1');
  });

  it('parses numeric caps', () => {
    const a = parseAuditGlossArgs(['--limit', '25', '--max-cost-usd', '1.5']);
    expect(a.limit).toBe(25);
    expect(a.maxCostUsd).toBe(1.5);
  });

  it('rejects a non-numeric limit rather than silently yielding NaN', () => {
    expect(() => parseAuditGlossArgs(['--limit', 'lots'])).toThrow(/limit/);
  });
});

describe('hasParenthetical / extractParentheticals', () => {
  it('detects a parenthetical', () => {
    expect(hasParenthetical('Today the weather is very bad. (a current condition)')).toBe(true);
  });

  it('is false for a plain gloss', () => {
    expect(hasParenthetical('The coffee is on the table.')).toBe(false);
  });

  it('extracts every parenthetical span including the brackets', () => {
    expect(
      extractParentheticals('This lady (near me) is kind (really).'),
    ).toEqual(['(near me)', '(really)']);
  });

  it('ignores an unclosed bracket', () => {
    expect(extractParentheticals('Something (unclosed')).toEqual([]);
  });
});

describe('selectRowsToJudge', () => {
  const row = (id: string, point: string, gloss: string): GlossRow => ({
    id,
    grammarPointKey: point,
    language: 'ES',
    cefrLevel: 'A1',
    sentence: 'x ___ y',
    correctAnswer: 'a',
    acceptableAnswers: null,
    instructions: 'Fill in the blank.',
    glossEn: gloss,
  });

  it('keeps every row of a point where English encodes the distinction', () => {
    const rows = [row('1', 'es-a1-demonstratives', 'That tree over there.')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-demonstratives', true]]));
    expect(out.map((r) => r.id)).toEqual(['1']);
  });

  it('drops a plain-gloss row in an excluded point', () => {
    const rows = [row('1', 'es-a1-ser-estar-basic', 'The coffee is on the table.')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-ser-estar-basic', false]]));
    expect(out).toEqual([]);
  });

  it('KEEPS a parenthetical row even in an excluded point', () => {
    // This is the rule that catches "(a current condition)" on a ser/estar blank
    // — the case that proves point-level exclusion alone is not enough.
    const rows = [
      row('1', 'es-a1-ser-estar-basic', 'The coffee is on the table.'),
      row('2', 'es-a1-ser-estar-basic', 'Today the weather is bad. (a current condition)'),
    ];
    const out = selectRowsToJudge(rows, new Map([['es-a1-ser-estar-basic', false]]));
    expect(out.map((r) => r.id)).toEqual(['2']);
  });

  it('keeps a row whose point has no verdict, rather than silently dropping it', () => {
    const rows = [row('1', 'es-a1-unknown-point', 'Plain gloss.')];
    expect(selectRowsToJudge(rows, new Map()).map((r) => r.id)).toEqual(['1']);
  });

  it('does not duplicate a parenthetical row in an included point', () => {
    const rows = [row('1', 'es-a1-demonstratives', 'That tree (far away).')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-demonstratives', true]]));
    expect(out).toHaveLength(1);
  });
});

describe('loadFixtureCases', () => {
  it('loads the shipped fixture into 21 well-typed cases (11 held-out + 10 contaminated)', () => {
    const cases = loadFixtureCases(
      path.join(here, 'fixtures', 'gloss-spoilage-cases.json'),
    );
    expect(cases).toHaveLength(21);
    expect(cases.filter((c) => c.heldOut)).toHaveLength(11);
    expect(cases.filter((c) => !c.heldOut)).toHaveLength(10);
    for (const c of cases) {
      expect(['spoiled', 'legitimate']).toContain(c.expected);
      expect(c.grammarPointKey.length).toBeGreaterThan(0);
    }
  });

  it('loads a case whose glossEn has no parenthetical without throwing (loader must not assume every gloss carries a span)', () => {
    const cases = loadFixtureCases(path.join(here, 'fixtures', 'gloss-spoilage-cases.json'));
    const noParen = cases.find((c) => c.id === 'e658e200-3ff8-5b2a-a7e1-3af6ecb9d537');
    expect(noParen).toBeDefined();
    expect(noParen?.glossEn).not.toContain('(');
  });

  it('throws on a fixture missing the cases array', () => {
    const tmp = path.join(here, '..', '..', '..', 'node_modules', '.tmp-not-a-real-dir');
    expect(() => loadFixtureCases(tmp)).toThrow();
  });
});

describe('computeMajorityVerdict', () => {
  it('picks the verdict with a strict 2-of-3 majority', () => {
    expect(computeMajorityVerdict(['spoiled', 'spoiled', 'legitimate'])).toBe('spoiled');
    expect(computeMajorityVerdict(['legitimate', 'legitimate', 'legitimate'])).toBe('legitimate');
  });

  it('lets borderline win a majority rather than folding it into legitimate', () => {
    expect(computeMajorityVerdict(['borderline', 'borderline', 'spoiled'])).toBe('borderline');
  });

  it('reports no-majority on a 3-way tie or empty input', () => {
    expect(computeMajorityVerdict(['spoiled', 'legitimate', 'borderline'])).toBe('no-majority');
    expect(computeMajorityVerdict([])).toBe('no-majority');
  });
});

describe('buildFixtureCaseResult', () => {
  const baseCase = {
    id: 'row-1',
    grammarPointKey: 'es-a1-ser-estar-basic',
    language: 'ES',
    cefrLevel: 'A1',
    sentence: 'Hoy el tiempo ___ muy malo.',
    correctAnswer: 'está',
    instructions: 'Fill in the blank.',
    glossEn: 'Today the weather is very bad. (a current condition)',
    heldOut: true,
    note: 'test case',
  };

  const okDraw = (verdict: 'spoiled' | 'legitimate' | 'borderline'): FixtureDraw => ({
    ok: true,
    verdict,
    offendingSpan: verdict === 'spoiled' ? 'a current condition' : null,
    proposedGloss: null,
    loadBearing: false,
    reasoning: 'test reasoning',
    confidence: 'high',
  });
  const errDraw = (): FixtureDraw => ({ ok: false, error: 'boom' });

  it('marks a spoiler CORRECT only when the majority itself is spoiled', () => {
    const r = buildFixtureCaseResult(
      { ...baseCase, expected: 'spoiled' },
      [okDraw('spoiled'), okDraw('spoiled'), okDraw('legitimate')],
    );
    expect(r.majorityVerdict).toBe('spoiled');
    expect(r.caughtCorrectly).toBe(true);
  });

  it('marks a spoiler WRONG when the majority hedges to borderline', () => {
    // This is the brief's explicit rule: a judge that hedges on a known
    // spoiler has not caught it.
    const r = buildFixtureCaseResult(
      { ...baseCase, expected: 'spoiled' },
      [okDraw('borderline'), okDraw('borderline'), okDraw('spoiled')],
    );
    expect(r.majorityVerdict).toBe('borderline');
    expect(r.caughtCorrectly).toBe(false);
  });

  it('marks a legitimate row WRONG when the majority says spoiled', () => {
    const r = buildFixtureCaseResult(
      { ...baseCase, expected: 'legitimate' },
      [okDraw('spoiled'), okDraw('spoiled'), okDraw('legitimate')],
    );
    expect(r.majorityVerdict).toBe('spoiled');
    expect(r.caughtCorrectly).toBe(false);
  });

  it('counts errored draws separately without crashing the tally', () => {
    const r = buildFixtureCaseResult(
      { ...baseCase, expected: 'spoiled' },
      [okDraw('spoiled'), okDraw('spoiled'), errDraw()],
    );
    expect(r.errorCount).toBe(1);
    expect(r.spoiledCount).toBe(2);
    expect(r.majorityVerdict).toBe('spoiled');
  });
});

describe('scoreFixtureResults', () => {
  const result = (
    id: string,
    expected: 'spoiled' | 'legitimate',
    majorityVerdict: FixtureCaseResult['majorityVerdict'],
  ): FixtureCaseResult => ({
    id,
    grammarPointKey: 'es-a1-ser-estar-basic',
    expected,
    heldOut: true,
    note: '',
    draws: [],
    spoiledCount: majorityVerdict === 'spoiled' ? 2 : 0,
    legitimateCount: majorityVerdict === 'legitimate' ? 2 : 0,
    borderlineCount: majorityVerdict === 'borderline' ? 2 : 0,
    errorCount: 0,
    majorityVerdict,
    caughtCorrectly: majorityVerdict === expected,
  });

  it('passes the gate only when every case is caught correctly', () => {
    const results = [
      result('1', 'spoiled', 'spoiled'),
      result('2', 'legitimate', 'legitimate'),
    ];
    const score = scoreFixtureResults(results);
    expect(score.gatePassed).toBe(true);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.falsePositives).toEqual([]);
    expect(score.falseNegatives).toEqual([]);
  });

  it('flags a false positive when a legitimate row majority-verdicts spoiled', () => {
    const results = [
      result('1', 'spoiled', 'spoiled'),
      result('2', 'legitimate', 'spoiled'),
    ];
    const score = scoreFixtureResults(results);
    expect(score.gatePassed).toBe(false);
    expect(score.falsePositives.map((r) => r.id)).toEqual(['2']);
    // 1 true positive out of 2 predicted-spoiled → precision 0.5; recall
    // stays 1 since the one actual spoiler WAS caught.
    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(1);
  });

  it('flags a false negative (missed spoiler) without touching precision', () => {
    const results = [
      result('1', 'spoiled', 'legitimate'),
      result('2', 'legitimate', 'legitimate'),
    ];
    const score = scoreFixtureResults(results);
    expect(score.gatePassed).toBe(false);
    expect(score.falseNegatives.map((r) => r.id)).toEqual(['1']);
    expect(score.precision).toBeNull(); // no case predicted spoiled at all
    expect(score.recall).toBe(0);
  });
});

describe('FIXTURE_DRAWS_PER_CASE', () => {
  it('is 3 — enough that a single boundary draw cannot decide a verdict', () => {
    expect(FIXTURE_DRAWS_PER_CASE).toBe(3);
  });
});
