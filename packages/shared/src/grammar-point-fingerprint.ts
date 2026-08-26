/**
 * packages/shared — content fingerprint of a single curriculum grammar point.
 *
 * WHY THIS EXISTS. The scheduler suppresses a cell that is stuck
 * (`skip-low-yield`) or that has exhausted its dedup search space
 * (`skip-saturated-dedup`), and clears that suppression when the curriculum
 * changes — otherwise a curriculum fix could never reach an already-suppressed
 * cell. Until 2026-08-26 "the curriculum changed" was tested with
 * `CURRICULUM_VERSION_<LANG>`, which is per-LANGUAGE while the suppression it
 * clears is per-CELL. Editing one Spanish point therefore re-released all ~297
 * Spanish cells, and because this repo edits curricula most days, neither
 * suppression ever actually fired: the 2026-08-25 and 2026-08-26 prod runs both
 * logged `lowYield: 0, saturatedDedup: 0` while
 * `de:a2:conjugation:de-a2-praeteritum-modals` — 47 drafts produced for 14
 * requested, 11 dedup give-ups, 1 approved, every run since 2026-08-15 — was
 * re-enqueued nightly at ~$0.96 a night.
 *
 * A fingerprint of the point's own content makes the test per-cell: the cells
 * whose point actually changed get their fresh attempt, and the rest keep the
 * give-up state they earned.
 *
 * DELIBERATELY HASHES THE WHOLE POINT. Picking out "the fields that affect
 * generation" would be a standing judgement call that silently rots every time
 * a field is added — exactly how `appliesTo` would have been missed. Hashing
 * everything is conservative in the safe direction: a cosmetic edit costs one
 * extra generation attempt, whereas a missed field would leave a cell
 * suppressed against a curriculum fix aimed at it.
 *
 * Pure and dependency-free (no `node:crypto`) so `packages/shared` stays
 * importable from the browser bundle. Same FNV-1a mixing as
 * `deterministicUuid`, which has been stable in this repo since Phase 4 —
 * 128 bits, so a collision between successive versions of ONE point (the only
 * comparison ever made) is ~1 in 3.4e38.
 */

import type { GrammarPoint } from './curriculum-types';

/**
 * Canonical JSON: object keys sorted recursively, array order PRESERVED.
 *
 * Array order is semantic here — `constructionVariants` order is
 * `pickVariantSeeds`' documented deterministic tie-break, and the example lists
 * are rendered into prompts in order — so reordering an array is a real change
 * and must move the fingerprint. Reordering object KEYS is not, and must not.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    // Mirrors JSON.stringify's own treatment of undefined, so an explicitly
    // `undefined` field and an absent one fingerprint identically.
    if (obj[key] === undefined) continue;
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/**
 * A stable 32-hex-character fingerprint of a grammar point's full content.
 *
 * Stored on `generation_jobs.grammar_point_fingerprint` when a job opens and
 * compared by `decideEnqueue` on the next run. Equal fingerprints mean the
 * point is byte-identical to what that job generated against, so any
 * suppression it earned still applies.
 */
export function grammarPointFingerprint(grammarPoint: GrammarPoint): string {
  const key = JSON.stringify(canonicalize(grammarPoint));

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0xcafebabe;

  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
    h3 = Math.imul(h3 ^ c, 0x0100019d) >>> 0;
    h4 = Math.imul(h4 ^ c, 0x811c9dd1) >>> 0;
  }

  return [h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}
