/**
 * Seed-match reject gate (Spec 2). A seeded vocab_recall draft whose
 * expectedWord doesn't normalize-match its seed would, if approved, never
 * register against the curated target — the target stays `not-yet` forever
 * despite the spend. Rejecting it makes "seeded → covered on approval" an
 * invariant; the target is simply re-seeded next scheduler run. Uses the same
 * normalizeWord as the coverage read model so the gate and the read agree.
 */

import {
  GenerationReasonCode,
  normalizeWord,
  type GenerationReason,
} from '@language-drill/shared';

/**
 * Returns a `SeedTargetMismatch` reason (with the observed drift in `detail`)
 * when a seeded vocab_recall draft's expectedWord doesn't normalize-match its
 * seed; `null` for unseeded drafts, non-vocab content, or a match.
 */
export function vocabSeedMismatch(
  content: unknown,
  seedWord: string | null,
): GenerationReason | null {
  if (seedWord === null || seedWord.length === 0) return null;
  if (typeof content !== 'object' || content === null) return null;
  const c = content as { type?: unknown; expectedWord?: unknown };
  if (c.type !== 'vocab_recall') return null;
  if (typeof c.expectedWord !== 'string') return null;
  const seed = normalizeWord(seedWord);
  if (normalizeWord(c.expectedWord) === seed) return null;
  return {
    code: GenerationReasonCode.SeedTargetMismatch,
    detail: `expected "${seed}", got "${c.expectedWord}"`,
  };
}
