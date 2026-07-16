export type { BookCoverageLedger, CoverageDecision, TocEntry } from './types';
export { validateBookCoverage, type BookCoverageValidation } from './validate';

import { ES_BOOK_COVERAGE } from './es';
import type { BookCoverageLedger } from './types';

export { ES_BOOK_COVERAGE } from './es';

/**
 * Every authored ledger registers here; `book-coverage.test.ts` validates each
 * against its language's curriculum. ES/B&B is the retrofit of the 2026-07-15
 * design (the DE/Hammer pilot ledger lands with the DE curriculum branch); TR
 * (Göksel & Kerslake) follows per the design doc's sequencing. To add one:
 * generate the TOC snapshot with `propose:book-coverage --emit-toc`, author the
 * decisions (LLM-proposed, human-reviewed), and register the ledger module here.
 */
export const BOOK_COVERAGE_LEDGERS: readonly BookCoverageLedger[] = [ES_BOOK_COVERAGE];
