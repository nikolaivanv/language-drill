export type { BookCoverageLedger, CoverageDecision, TocEntry } from './types';
export { validateBookCoverage, type BookCoverageValidation } from './validate';

import { DE_BOOK_COVERAGE } from './de';
import { ES_BOOK_COVERAGE } from './es';
import type { BookCoverageLedger } from './types';

export { DE_BOOK_COVERAGE } from './de';
export { ES_BOOK_COVERAGE } from './es';

/**
 * Every authored ledger registers here; `book-coverage.test.ts` validates each
 * against its language's curriculum. DE/Hammer is the pilot and ES/B&B the
 * retrofit of the 2026-07-15 design; TR (Göksel & Kerslake) follows per the
 * design doc's sequencing. To add one: generate the TOC snapshot with
 * `propose:book-coverage --emit-toc`, author the decisions (LLM-proposed,
 * human-reviewed), and register the ledger module here.
 */
export const BOOK_COVERAGE_LEDGERS: readonly BookCoverageLedger[] = [
  DE_BOOK_COVERAGE,
  ES_BOOK_COVERAGE,
];
