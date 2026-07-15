export type { BookCoverageLedger, CoverageDecision, TocEntry } from './types';
export { validateBookCoverage, type BookCoverageValidation } from './validate';

import type { BookCoverageLedger } from './types';

/**
 * Every authored ledger registers here; `book-coverage.test.ts` validates each
 * against its language's curriculum. Empty until the DE pilot and ES retrofit
 * land (see the 2026-07-15 design doc's sequencing section). To add one:
 * generate the TOC snapshot with `propose:book-coverage --emit-toc`, author the
 * decisions (LLM-proposed, human-reviewed), and push the ledger module here.
 */
export const BOOK_COVERAGE_LEDGERS: readonly BookCoverageLedger[] = [];
