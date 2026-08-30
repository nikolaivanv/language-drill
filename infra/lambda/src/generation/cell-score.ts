/**
 * Expected-yield scoring for the nightly scheduler's backlog ranking.
 *
 * Deficit ranking adversely selects. Measured over the whole prod pool on
 * 2026-08-30, need and approval rate are strongly NEGATIVELY correlated:
 *
 *   rate 0.115 → 34 cells, avg need 17.6, 5,293 lifetime drafts
 *   rate 0.301 → 106 cells, avg need  7.6
 *   rate 0.698 → 242 cells, avg need  3.1
 *
 * So ranking by raw `need` puts the cells least able to produce anything at
 * the top of the backlog every night. `need × p̂` fixes the ordering.
 *
 * Note what this does NOT buy: expected rows are nearly flat (2.0–2.6) across
 * the main population, so nightly row COUNT barely moves. The win is that the
 * hopeless tail stops consuming slots and the drafts that go with them.
 */

/**
 * Drafts of prior weight in the shrinkage. A cell with exactly this many
 * observed drafts weights evidence and prior equally.
 *
 * 20 is not arbitrary: scoped to the current prompt version, prod carries
 * ~9,523 drafts across ~471 cells — almost exactly 20 per cell — so the
 * average cell sits at a 50/50 evidence-to-prior split.
 *
 * Shrinkage is what makes small samples safe. 23 prod cells hold a perfect
 * lifetime approval rate over ~15 drafts each; ranked on the raw rate they
 * would dominate the backlog on noise. It is also what makes evidence RESET
 * safe: scope a cell's evidence away and p̂ collapses to the prior, so the
 * cell ranks on `need × prior` — its old deficit rank — with no special case.
 */
export const EVIDENCE_PRIOR_WEIGHT = 20;

/** Used only when there is no evidence anywhere — e.g. the first run after a
 *  prompt bump discards every row. Keeps the ranking numeric rather than NaN. */
export const NEUTRAL_PRIOR = 0.5;

export type ApprovalEvidence = {
  approved: number;
  produced: number;
  prior: number;
};

/**
 * Beta-style shrinkage of a cell's observed approval rate toward its group
 * prior: `(approved + α·prior) / (produced + α)`.
 */
export function shrunkApprovalRate({
  approved,
  produced,
  prior,
}: ApprovalEvidence): number {
  const a = EVIDENCE_PRIOR_WEIGHT;
  return (approved + a * prior) / (produced + a);
}

/** Expected approved rows from running this cell: `need × p̂`. */
export function expectedYield(need: number, shrunkRate: number): number {
  return need * shrunkRate;
}

export type EvidenceRow = {
  /** `<lang>:<level>:<type>:<point>` */
  cellKey: string;
  approved: number;
  produced: number;
};

export type ApprovalPriors = {
  /** The prior for a cell: its (language, type) rate, else global, else neutral. */
  forCell(cellKey: string): number;
};

/** `<lang>:<type>` — the grouping the prior is pooled over. */
function groupKeyOf(cellKey: string): string {
  const parts = cellKey.split(':');
  return `${parts[0]}:${parts[2]}`;
}

/**
 * Pool the scoped evidence into (language, type) priors, with a global
 * fallback for a group that has no evidence yet and a neutral fallback for a
 * corpus with none at all.
 *
 * Grouped by language AND type because the two differ a lot: vocab_recall runs
 * far below cloze in the same language, so a single global prior would flatter
 * the former and punish the latter.
 */
export function computeApprovalPriors(
  rows: readonly EvidenceRow[],
): ApprovalPriors {
  const byGroup = new Map<string, { approved: number; produced: number }>();
  let globalApproved = 0;
  let globalProduced = 0;

  for (const row of rows) {
    const key = groupKeyOf(row.cellKey);
    const acc = byGroup.get(key) ?? { approved: 0, produced: 0 };
    acc.approved += row.approved;
    acc.produced += row.produced;
    byGroup.set(key, acc);
    globalApproved += row.approved;
    globalProduced += row.produced;
  }

  const globalRate =
    globalProduced > 0 ? globalApproved / globalProduced : NEUTRAL_PRIOR;

  return {
    forCell(cellKey: string): number {
      const group = byGroup.get(groupKeyOf(cellKey));
      if (group && group.produced > 0) return group.approved / group.produced;
      return globalRate;
    },
  };
}

/**
 * The evidence cutoff implied by the current prompt versions.
 *
 * `*_PROMPT_VERSION` constants are `<surface>@YYYY-MM-DD`, and CLAUDE.md
 * requires bumping the date in the same commit as any prompt edit — so the
 * later of the generation and validation dates is when generation last
 * changed behaviour. Runs before it describe a different generator and are
 * not evidence about this one.
 *
 * A version that does not parse is IGNORED rather than treated as "now",
 * mirroring `decideEnqueue`'s missing-metadata rule: a metadata problem must
 * never trigger the destructive action. Here the destructive action would be
 * discarding the whole evidence corpus, so an unparseable set yields the
 * epoch and every row is kept.
 *
 * Limitation worth knowing: the runtime serves the prompt BODY from Langfuse
 * while this reads the in-repo constant. A prompt edited only in the Langfuse
 * dashboard, with no repo commit, does not move this cutoff. That is a
 * policy dependency (`bootstrap-prompts --check` detects the drift), not a
 * silent failure mode of this function.
 */
export function promptEvidenceCutoff(versions: readonly string[]): Date {
  let latest = 0;
  for (const version of versions) {
    const match = /@(\d{4}-\d{2}-\d{2})$/.exec(version);
    if (!match) continue;
    const parsed = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed) && parsed > latest) latest = parsed;
  }
  return new Date(latest);
}
