export type { BookCoverageLedger, CoverageDecision, TocEntry } from './types';
export { validateBookCoverage, type BookCoverageValidation } from './validate';

import { DE_BOOK_COVERAGE } from './de';
import type { BookCoverageLedger } from './types';

export { DE_BOOK_COVERAGE } from './de';

/**
 * Every authored ledger registers here; `book-coverage.test.ts` validates each
 * against its language's curriculum. DE is the pilot (2026-07-16); the ES
 * retrofit (B&B) and TR (Göksel & Kerslake) follow per the 2026-07-15 design
 * doc's sequencing. To add one: generate the TOC snapshot with
 * `propose:book-coverage --emit-toc`, author the decisions (LLM-proposed,
 * human-reviewed), and register the ledger module here.
 */
export const BOOK_COVERAGE_LEDGERS: readonly BookCoverageLedger[] = [DE_BOOK_COVERAGE];
