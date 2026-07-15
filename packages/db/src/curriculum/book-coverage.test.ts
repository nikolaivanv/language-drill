import { describe, expect, it } from 'vitest';

import {
  BOOK_COVERAGE_LEDGERS,
  validateBookCoverage,
  type BookCoverageLedger,
  type TocEntry,
} from './book-coverage';
import { ALL_CURRICULA } from './index';

/**
 * Synthetic mini-book: one content chapter with a nested section tree plus a
 * front-matter chapter, exercising every decision shape the validator knows.
 */
const TOC: readonly TocEntry[] = [
  { anchor: 'ch00', title: '0 Conventions', level: 1, parent: null },
  { anchor: '0-1', title: '0.1 Symbols', level: 2, parent: 'ch00' },
  { anchor: 'ch29', title: '29 Conditional sentences', level: 1, parent: null },
  { anchor: '29-1', title: '29.1 Types overview', level: 2, parent: 'ch29' },
  { anchor: '29-8', title: '29.8 Si', level: 2, parent: 'ch29' },
  { anchor: '29-8-1', title: '29.8.1 Si: general', level: 3, parent: '29-8' },
  { anchor: '29-8-2', title: '29.8.2 Como = si', level: 3, parent: '29-8' },
];

const CURRICULUM = [
  { key: 'xx-a1-open-conditions', kind: 'grammar' },
  { key: 'xx-b2-remote-conditions', kind: 'grammar' },
  { key: 'xx-a1-vocab-family', kind: 'vocab' },
] as const;

function ledgerWith(
  decisions: BookCoverageLedger['decisions'],
): BookCoverageLedger {
  return { language: 'ES', book: 'Synthetic Test Grammar', toc: TOC, decisions };
}

const VALID_DECISIONS: BookCoverageLedger['decisions'] = {
  ch00: { excludedSubtree: 'front matter — no grammar content' },
  ch29: { excluded: 'chapter intro; content is in the sections' },
  '29-1': { points: ['xx-a1-open-conditions', 'xx-b2-remote-conditions'] },
  '29-8': { points: ['xx-a1-open-conditions'] },
  '29-8-1': { excluded: 'lexical notes on si' },
  '29-8-2': { excluded: 'C1, regional' },
};

describe('validateBookCoverage — decision shapes', () => {
  it('accepts a ledger where every anchor has exactly one decision', () => {
    const result = validateBookCoverage(ledgerWith(VALID_DECISIONS), CURRICULUM);
    expect(result.errors).toEqual([]);
  });

  it('flags an uncovered anchor, naming its section title', () => {
    const { '29-8-2': _dropped, ...rest } = VALID_DECISIONS;
    const result = validateBookCoverage(ledgerWith(rest), CURRICULUM);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/29-8-2/);
    expect(result.errors[0]).toMatch(/Como = si/);
  });

  it('lets an excludedSubtree cover all descendant anchors', () => {
    const result = validateBookCoverage(
      ledgerWith({
        ch00: { excludedSubtree: 'front matter' },
        ch29: { excludedSubtree: 'whole chapter out of scope' },
      }),
      CURRICULUM,
    );
    expect(result.errors).toEqual([]);
  });

  it('flags a decision shadowed by an ancestor excludedSubtree', () => {
    const result = validateBookCoverage(
      ledgerWith({
        ...VALID_DECISIONS,
        ch29: { excludedSubtree: 'whole chapter out of scope' },
      }),
      CURRICULUM,
    );
    expect(result.errors.some((e) => /29-1/.test(e) && /shadowed/.test(e))).toBe(true);
  });

  it('flags a point key that does not exist in the curriculum', () => {
    const result = validateBookCoverage(
      ledgerWith({ ...VALID_DECISIONS, '29-1': { points: ['xx-b9-no-such-point'] } }),
      CURRICULUM,
    );
    expect(result.errors.some((e) => /xx-b9-no-such-point/.test(e))).toBe(true);
  });

  it('flags an empty points array and blank exclusion reasons', () => {
    const result = validateBookCoverage(
      ledgerWith({
        ...VALID_DECISIONS,
        '29-1': { points: [] },
        '29-8-1': { excluded: '  ' },
      }),
      CURRICULUM,
    );
    expect(result.errors.some((e) => /29-1/.test(e) && /empty/.test(e))).toBe(true);
    expect(result.errors.some((e) => /29-8-1/.test(e) && /reason/.test(e))).toBe(true);
  });

  it('flags a ledger row whose anchor is not in the TOC snapshot', () => {
    const result = validateBookCoverage(
      ledgerWith({ ...VALID_DECISIONS, '99-9': { excluded: 'typo anchor' } }),
      CURRICULUM,
    );
    expect(result.errors.some((e) => /99-9/.test(e))).toBe(true);
  });
});

describe('validateBookCoverage — unclaimed-point report', () => {
  it('reports grammar points never claimed by any section, ignoring non-grammar kinds', () => {
    const result = validateBookCoverage(
      ledgerWith({
        ch00: { excludedSubtree: 'front matter' },
        ch29: { excludedSubtree: 'out of scope' },
      }),
      CURRICULUM,
    );
    expect(result.unclaimedPoints).toEqual([
      'xx-a1-open-conditions',
      'xx-b2-remote-conditions',
    ]);
  });

  it('is empty when every grammar point claims at least one section', () => {
    const result = validateBookCoverage(ledgerWith(VALID_DECISIONS), CURRICULUM);
    expect(result.unclaimedPoints).toEqual([]);
  });
});

describe('registered ledgers', () => {
  // Empty until the DE pilot / ES retrofit land their ledgers; the loop below
  // becomes the enforcement gate the moment a ledger is registered.
  it('every registered ledger validates cleanly against its language curriculum', () => {
    for (const ledger of BOOK_COVERAGE_LEDGERS) {
      const curriculum = ALL_CURRICULA.filter((p) => p.language === ledger.language);
      const result = validateBookCoverage(ledger, curriculum);
      expect(result.errors, `${ledger.book} (${ledger.language})`).toEqual([]);
      if (result.unclaimedPoints.length > 0) {
        // Informational only — coursebook-driven points may legitimately have
        // no reference-grammar section.
        console.info(
          `[book-coverage] ${ledger.language}: points with no claimed section: ${result.unclaimedPoints.join(', ')}`,
        );
      }
    }
  });
});
