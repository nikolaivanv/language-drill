# Drop Cloze for TR B1 Voice + Periphrastic Points — Design

_Date: 2026-06-19 · Status: approved, pre-implementation_

## Problem

On the 2026-06-19 generation run, Turkish B1 "voice" cloze cells and the obligation-periphrases cloze cell had the worst approval of the B1 launch:

| Cell (cloze) | Approved | Flagged | Rejected | Appr% |
|---|---|---|---|---|
| `tr-b1-causative-voice` | 6 | 21 | 23 | 12% |
| `tr-b1-obligation-periphrases` | 12 | 14 | 22 | 24% |
| `tr-b1-reciprocal-voice` | 16 | 19 | 15 | 32% |
| `tr-b1-reflexive-voice-kendi` | 17 | 22 | 11 | 34% |
| `tr-b1-passive-voice` | 27 | 15 | 8 | 54% |

The dominant substantive flag is `ambiguous` (≥ ~70% of flagged items). Root cause: Turkish voice is agglutinative — the voice morpheme sits between the stem and a mandatory stack of inflection (negation, tense/aspect, person). A single whole-word cloze blank conflates the target voice morpheme with free inflectional choices the carrier sentence rarely constrains, so multiple surface forms are valid answers and the validator (correctly) flags `ambiguous`. Obligation has the same disease for a different reason: multiple constructions (`gerek` / `lāzım` / `-mAlI`) satisfy one blank.

This is structural, not a prompt bug:
- The cloze schema deliberately **blanks the whole word** — the generation prompt explicitly forbids partial-suffix blanks ("Blank the whole word … never 'kahve___' → 'yi'"). So "blank only the voice morpheme" would contradict an existing design rule and require a schema change.
- The same five grammar points clear **68–80%** as **translation** and **sentence-construction** on the same run — surfaces that give the learner the full target meaning, exercising voice/obligation productively without the ambiguity trap.

Conclusion: cloze is the wrong surface for productive voice/periphrastic morphology in Turkish. Remove it for these points and rely on the surfaces that already work.

## Goal & scope

Stop generating (and stop serving) cloze for the five affected TR B1 points; keep their other, well-performing surfaces untouched.

**In scope:**
- Curriculum: set `clozeUnsuitable: true` on the five points; bump `CURRICULUM_VERSION_TR`.
- Test updates for the exhaustive `clozeUnsuitable` set.
- A one-off prod pool cleanup demoting existing cloze for these points.

**Out of scope (deliberately):** other languages; the cloze generation prompt (the surface is the issue, not the prompt); non-cloze surfaces for these points (unchanged); any schema change for partial blanks.

## Change 1 — curriculum (`packages/db/src/curriculum/tr.ts`)

Add `clozeUnsuitable: true` to these five grammar points:

| Key | Surfaces it keeps after the change |
|---|---|
| `tr-b1-causative-voice` | translation + sentence_construction + conjugation |
| `tr-b1-passive-voice` | translation + sentence_construction |
| `tr-b1-reflexive-voice-kendi` | translation + sentence_construction |
| `tr-b1-reciprocal-voice` | translation + sentence_construction |
| `tr-b1-obligation-periphrases` | translation + conjugation (carries `conjugationSuitable`, not SC; translation is its strongest surface, 80%) |

`compatibleTypes()` in `packages/db/src/generation/cells.ts` already drops `CLOZE` when `clozeUnsuitable` is set (and keeps `TRANSLATION` + any `sentenceConstructionSuitable` / `conjugationSuitable` cells) — **no new logic**. There is strong precedent: six TR points already carry this flag.

Bump `CURRICULUM_VERSION_TR` from `'2026-06-19'` to `'2026-06-19a'`. The version test regex is `^\d{4}-\d{2}-\d{2}[a-z]?$`, so a same-day re-bump uses a trailing letter. The bump signals the scheduler to re-resolve cells and clears any low-yield/saturated-dedup suppression keyed on the prior curriculum revision.

**Invariant:** all five points are `kind: 'grammar'`, satisfying the existing `clozeUnsuitable ⇒ kind==='grammar'` curriculum invariant (the test at `curriculum.test.ts:126`).

## Change 2 — tests (`packages/db`)

- `packages/db/src/curriculum/curriculum.test.ts` — the test "the full TR clozeUnsuitable set is exactly these nine points" (≈ line 264) hardcodes the expected set. Update it to **fourteen** points: the existing nine plus the five new keys.
- `packages/db/src/generation/cells.test.ts` — the cell-count test derives `clozeUnsuitable` count dynamically from `ALL_CURRICULA`, so it adjusts automatically; verify it still passes. The "emits only … no cloze for a clozeUnsuitable point" test is generic and needs no change.
- `CURRICULUM_VERSION_TR` format/value test — passes with the `a` suffix; update any exact-value assertion if one exists.

## Change 3 — prod pool cleanup (one-off, gated)

Setting `clozeUnsuitable` only stops generating **new** cloze. Existing rows (approved + flagged) remain — approved ones keep serving the ambiguous surface. Demote them on the **prod** Neon branch (`br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337`).

**Ordering:** run this **after** Change 1 is merged + deployed. If demoted before the curriculum deploys, the next ~04:00 UTC scheduler run regenerates the cloze cells.

Dry-run first:
```sql
SELECT grammar_point_key, review_status, count(*)
FROM exercises
WHERE language='TR' AND type='cloze'
  AND grammar_point_key IN (
    'tr-b1-causative-voice','tr-b1-passive-voice','tr-b1-reflexive-voice-kendi',
    'tr-b1-reciprocal-voice','tr-b1-obligation-periphrases')
  AND review_status IN ('auto-approved','manual-approved','flagged')
GROUP BY 1,2 ORDER BY 1,2;
```
Then apply (gated on explicit confirmation — prod mutation):
```sql
UPDATE exercises SET review_status='rejected'
WHERE language='TR' AND type='cloze'
  AND grammar_point_key IN ( ...same five... )
  AND review_status IN ('auto-approved','manual-approved','flagged');
```
Target status `'rejected'`: intentional removal, won't be revalidated back, and frees the partial-unique index slot (the index covers `review_status IN ('auto-approved','manual-approved')`). Reversible via SQL if needed (status change, not a delete). `'rejected'` is an established demotion target in `revalidate-cloze-pool.ts`.

## Deployment & verification

- Standard CI/CD: merge → Drizzle migrate (no schema change here) → CDK deploy → the scheduler picks up the new curriculum on the next tick and stops resolving the cloze cells for these points.
- After deploy, run the dry-run SELECT, confirm counts, then the gated UPDATE.
- Confirm on the next ~04:00 UTC run that no new `tr:b1:cloze:` jobs appear for the five points and overall TR B1 flag rate drops.

## Risks

- **Coverage:** dropping cloze removes one practice surface, but each point retains translation (and SC / conjugation where applicable) — the surfaces that already clear 68–80%. No net pedagogical loss; arguably better practice.
- **Stale exhaustive test:** the hardcoded nine-point set test will fail if not updated — explicitly handled in Change 2.
- **Cleanup ordering:** demoting before deploy lets the scheduler regenerate — explicitly sequenced after deploy.
- **No `eval:gen`/prompt risk:** this removes a cell rather than editing a prompt, so there is no Langfuse sync step and no generation-prompt A/B to run.
