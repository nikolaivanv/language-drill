import type { GrammarPoint } from '@language-drill/shared';

/**
 * Book-coverage ledger types — the per-language mapping from reference-grammar
 * sections to curriculum grammar points. Design:
 * docs/superpowers/specs/2026-07-15-book-coverage-ledger-design.md.
 *
 * The ledger is dev-time metadata enforced by `book-coverage.test.ts`; it has
 * no runtime consumer and MUST NOT be imported from any Lambda path. Ledger
 * edits do not bump `CURRICULUM_VERSION_*`.
 */

/** One conscious decision about one book section. */
export type CoverageDecision =
  /** ≥1 curriculum grammar points own this section's content. */
  | { readonly points: readonly string[] }
  /** Conscious skip with a short real reason (e.g. 'C1+', 'regional'). */
  | { readonly excluded: string }
  /** Conscious skip of this anchor AND every descendant anchor. */
  | { readonly excludedSubtree: string };

/**
 * One row of the vendored TOC snapshot, generated from the book mirror's
 * `index.json` by `propose:book-coverage --emit-toc`. Titles only — no book
 * text. `parent` is the containing section's anchor (chapters have `null`),
 * and drives `excludedSubtree` resolution; do not hand-edit.
 */
export type TocEntry = Readonly<{
  anchor: string;
  title: string;
  /** 1 = chapter, 2 = x.y, 3 = x.y.z — as emitted by the book mirror. */
  level: number;
  parent: string | null;
}>;

export type BookCoverageLedger = Readonly<{
  language: GrammarPoint['language'];
  /** Human-readable book identification, e.g. 'Butt & Benjamin (5th ed.)'. */
  book: string;
  toc: readonly TocEntry[];
  /** Section anchor → decision. Every TOC anchor must be accounted for. */
  decisions: Readonly<Record<string, CoverageDecision>>;
}>;
