import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
