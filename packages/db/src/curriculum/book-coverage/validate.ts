import type { GrammarPoint } from '@language-drill/shared';

import type { BookCoverageLedger, CoverageDecision, TocEntry } from './types';

export type BookCoverageValidation = {
  /** Hard failures — the ledger test asserts this is empty. */
  errors: string[];
  /**
   * Grammar-kind curriculum keys never claimed by any section. Informational,
   * not asserted: coursebook-driven points may have no reference-grammar home.
   */
  unclaimedPoints: string[];
};

function isExcludedSubtree(
  d: CoverageDecision | undefined,
): d is { excludedSubtree: string } {
  return d !== undefined && 'excludedSubtree' in d;
}

/**
 * Validate one ledger against the TOC snapshot it vendors and the curriculum
 * of its language. Pure; used only by `book-coverage.test.ts` and the
 * `propose:book-coverage` CLI.
 */
export function validateBookCoverage(
  ledger: BookCoverageLedger,
  curriculum: readonly Pick<GrammarPoint, 'key' | 'kind'>[],
): BookCoverageValidation {
  const errors: string[] = [];
  const tocByAnchor = new Map<string, TocEntry>(
    ledger.toc.map((entry) => [entry.anchor, entry]),
  );
  const curriculumKeys = new Set(curriculum.map((p) => p.key));

  // Per-row shape checks (orphan anchors, dangling keys, empty content).
  for (const [anchor, decision] of Object.entries(ledger.decisions)) {
    if (!tocByAnchor.has(anchor)) {
      errors.push(`ledger row '${anchor}' is not an anchor in the TOC snapshot`);
    }
    if ('points' in decision) {
      if (decision.points.length === 0) {
        errors.push(`ledger row '${anchor}' has an empty points array`);
      }
      for (const key of decision.points) {
        if (!curriculumKeys.has(key)) {
          errors.push(
            `ledger row '${anchor}' claims unknown curriculum key '${key}'`,
          );
        }
      }
    } else {
      const reason = 'excluded' in decision ? decision.excluded : decision.excludedSubtree;
      if (reason.trim().length === 0) {
        errors.push(`ledger row '${anchor}' has a blank exclusion reason`);
      }
    }
  }

  // Coverage: every TOC anchor needs its own decision or an ancestor
  // excludedSubtree — but not both (a shadowed row is a contradiction).
  for (const entry of ledger.toc) {
    const own = ledger.decisions[entry.anchor];
    let subtreeAncestor: string | null = null;
    for (
      let parent = entry.parent;
      parent !== null;
      parent = tocByAnchor.get(parent)?.parent ?? null
    ) {
      if (isExcludedSubtree(ledger.decisions[parent])) {
        subtreeAncestor = parent;
        break;
      }
    }
    if (own !== undefined && subtreeAncestor !== null) {
      errors.push(
        `ledger row '${entry.anchor}' is shadowed by excludedSubtree on '${subtreeAncestor}'`,
      );
    } else if (own === undefined && subtreeAncestor === null) {
      errors.push(
        `book section '${entry.anchor}' (${entry.title}) has no coverage decision`,
      );
    }
  }

  const claimed = new Set<string>();
  for (const decision of Object.values(ledger.decisions)) {
    if ('points' in decision) for (const key of decision.points) claimed.add(key);
  }
  const unclaimedPoints = curriculum
    .filter((p) => p.kind === 'grammar' && !claimed.has(p.key))
    .map((p) => p.key);

  return { errors, unclaimedPoints };
}
