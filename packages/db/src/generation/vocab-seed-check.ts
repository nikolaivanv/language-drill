/**
 * Seed-match reject gate (Spec 2). A seeded vocab_recall draft whose
 * expectedWord doesn't normalize-match its seed would, if approved, never
 * register against the curated target — the target stays `not-yet` forever
 * despite the spend. Rejecting it makes "seeded → covered on approval" an
 * invariant; the target is simply re-seeded next scheduler run. Uses the same
 * normalizeWord as the coverage read model so the gate and the read agree.
 */

import { normalizeWord } from '@language-drill/shared';

export const SEED_TARGET_MISMATCH_REASON = 'seed-target-mismatch';

export function vocabSeedMismatchReason(
  content: unknown,
  seedWord: string | null,
): string | null {
  if (seedWord === null || seedWord.length === 0) return null;
  if (typeof content !== 'object' || content === null) return null;
  const c = content as { type?: unknown; expectedWord?: unknown };
  if (c.type !== 'vocab_recall') return null;
  if (typeof c.expectedWord !== 'string') return null;
  return normalizeWord(c.expectedWord) === normalizeWord(seedWord)
    ? null
    : SEED_TARGET_MISMATCH_REASON;
}
