import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  extractParentheticals,
  hasParenthetical,
  parseAuditGlossArgs,
  selectRowsToJudge,
  type GlossRow,
} from './audit-gloss.js';

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
  note: string;
};

describe('fixtures/gloss-spoilage-cases.json', () => {
  const raw = JSON.parse(
    readFileSync(path.join(here, 'fixtures', 'gloss-spoilage-cases.json'), 'utf8'),
  ) as { cases: FixtureCase[] };

  it('carries 6 known spoilers and 4 known-legitimate rows', () => {
    const spoiled = raw.cases.filter((c) => c.expected === 'spoiled');
    const legit = raw.cases.filter((c) => c.expected === 'legitimate');
    expect(spoiled).toHaveLength(6);
    expect(legit).toHaveLength(4);
  });

  it('every case carries a gloss and a real exercise id', () => {
    for (const c of raw.cases) {
      expect(c.glossEn.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^[0-9a-f]{8}-/);
      expect(c.note.length).toBeGreaterThan(0);
    }
  });

  it('every spoiler gloss contains the parenthetical that leaks', () => {
    // The gate would be vacuous if a "spoiler" case had no leaking span to find.
    for (const c of raw.cases.filter((x) => x.expected === 'spoiled')) {
      expect(c.glossEn).toContain('(');
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
