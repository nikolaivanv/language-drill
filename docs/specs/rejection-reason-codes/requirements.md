# Requirements Document

## Introduction

The generation pipeline records *why* a draft was rejected or flagged in two
places:

- `generation_jobs.rejection_reason_counts` — a per-cell frequency map
  (`Record<reasonString, count>`), added by migration `0012` to gate a planned
  validator→generator repair loop on rejection-reason frequencies.
- `exercises.flagged_reasons` — a per-exercise `string[]` shown in the manual
  review UI.

Today both arrays are built by **concatenating three incompatible kinds of
string** into one flat `string[]`:

1. **Canonical tags** — a fixed, hand-written set emitted on deterministic
   predicates in `routing.ts` (`'low quality score (<0.5)'`,
   `'context spoils answer'`, `'low quality score (<0.7)'`, `'ambiguous'`,
   `'level mismatch'`, `'grammar point mismatch'`), plus the synthetic
   `PARSER_FAILURE_REASON` / `VALIDATOR_PARSE_FAILURE_REASON` from
   `validate-and-insert.ts`.
2. **Free-form model prose** — `ValidationResult.culturalIssues[]` and
   `ValidationResult.flaggedReasons[]`, which the validator tool schema and
   prompt explicitly define as unbounded free text.
3. **Value-interpolated deterministic strings** — `deterministic-checks.ts`
   emits e.g. `'wrong vowel-harmony allomorph (deterministic): expected <X>,
   got <Y>'`, producing a distinct string per token.

Because `run-one-cell.ts` folds these strings directly as **map keys**
(`rejectionReasonCounts[reason]++`), every unique model sentence and every
interpolated value becomes its own bucket with count 1. The 2026-06-01 prod TR
run produced a single 200+ char paragraph as a map key. This corrupts the exact
analytics signal `rejection_reason_counts` exists to provide: a
`GROUP BY reason` aggregation has unbounded, ever-growing cardinality and
understates the genuine top reasons.

This feature separates the canonical reason **code** (enum-constrained, the
analytics key) from the free-text **detail** (the prose / interpolated values,
retained for human review). The fix is internal to the generation pipeline; no
user-facing behavior changes.

Source: `docs/tech-debt.md` — *"`rejection_reason_counts` / `flagged_reasons`
mix canonical tags with free-form model prose (no canonical reason code)"*.

## Alignment with Product Vision

The pre-generated content pool (tech.md §7, CLAUDE.md "Content Strategy") is the
cost-control backbone of the product: a background Lambda batches exercises and
the validator gates quality. `rejection_reason_counts` is the observability
signal that tells us *where* generation quality is failing, so we can target
prompt and curriculum fixes (the planned validator→generator repair loop). A
signal that aggregates to bounded, stable buckets is a prerequisite for that
loop. This is a tech-debt remediation that restores an already-built but
currently-unusable analytics column — it supports the product's quality and
cost goals without adding scope.

## Requirements

### Requirement 1 — Canonical reason-code enum as single source of truth

**User Story:** As a developer maintaining the generation pipeline, I want a
single canonical reason-code enum, so that every rejection/flag reason is drawn
from a bounded, documented set instead of inline string literals scattered
across three files.

#### Acceptance Criteria

1. WHEN the codebase is built THEN a new module (e.g.
   `packages/shared/src/generation-reasons.ts`) SHALL export a canonical reason
   code union/enum and be re-exported from `packages/shared/src/index.ts`.
2. The enum SHALL cover, with **no interpolated values in the code itself**:
   the `routing.ts` reject-branch tags (`low-quality-reject`,
   `context-spoils-answer`, `cultural-issue`), the `routing.ts` flag-branch tags
   (`low-quality-flag`, `ambiguous`, `level-mismatch`, `grammar-point-mismatch`,
   `validator-note`), the deterministic-check categories
   (`vowel-harmony-allomorph`, `malformed-surface-form`), and the synthetic
   failures (`parser-failure`, `validator-parse-failure`).
3. WHEN `routing.ts`, `deterministic-checks.ts`, and `validate-and-insert.ts`
   reference a reason THEN they SHALL reference a member of the canonical enum
   rather than an inline string literal.
4. IF a reviewer reads the enum module THEN each code SHALL have a short
   human-readable label/comment so dashboards and the review UI can render a
   friendly name without re-deriving it.

### Requirement 2 — Reasons carried as `{ code, detail? }`

**User Story:** As a developer, I want reasons carried as structured
`{ code, detail? }` pairs out of the routing/deterministic/synthetic layers, so
that the enum-constrained code and the free-form prose / interpolated value live
in separate fields and never collapse into one string.

#### Acceptance Criteria

1. WHEN `routeValidationResult()` produces a routing decision THEN its reasons
   SHALL be a list of `{ code, detail? }` objects (the public `RoutingDecision`
   type updated accordingly), where `code` is enum-constrained.
2. WHEN a reason originates from free-form validator prose
   (`culturalIssues[]`, `flaggedReasons[]`) THEN the original prose SHALL be
   preserved in `detail` under a canonical `code` (`cultural-issue` /
   `validator-note`).
3. WHEN `applyDeterministicChecks()` emits a vowel-harmony or malformed-surface
   reason THEN the interpolated values (expected/actual allomorph,
   reconstructed surface form) SHALL be placed in `detail` under the
   corresponding enum `code`, never embedded in the code key.
4. WHEN the synthetic parser-failure / validator-parse-failure outcomes are
   produced THEN they SHALL carry the corresponding enum `code`.
5. The reason-ordering guarantees documented on `routeValidationResult` and
   `applyDeterministicChecks` (reject-branch order; harmony prepended;
   malformed-surface appended; auto-approved→flagged downgrade) SHALL be
   preserved over the `{ code, detail? }` list.

### Requirement 3 — Frequency map keyed on `code` only

**User Story:** As an operator analyzing generation quality, I want
`generation_jobs.rejection_reason_counts` keyed exclusively on canonical codes,
so that `GROUP BY reason` returns a bounded, stable set of rows that aggregates
cleanly across cells, runs, and days.

#### Acceptance Criteria

1. WHEN `runOneCell` folds a rejected ordinal's reasons into
   `rejectionReasonCounts` THEN it SHALL increment the map using the reason's
   `code` as the key, never the `detail`.
2. WHEN a cell completes THEN every key in the persisted
   `rejection_reason_counts` map SHALL be a member of the canonical enum.
3. WHEN no ordinals were rejected THEN `rejection_reason_counts` SHALL remain
   `null` (current behavior preserved — not `{}`).
4. WHEN the same `code` arises from multiple ordinals with different `detail`
   values THEN they SHALL collapse into a single map bucket (count summed).

### Requirement 4 — `exercises.flagged_reasons` retains human-readable detail

**User Story:** As a manual reviewer, I want each exercise's `flagged_reasons`
to retain the free-form prose and interpolated values, so that I lose no review
context while dashboards can still filter on codes.

#### Acceptance Criteria

1. WHEN a draft is inserted with a non-empty routing decision THEN
   `exercises.flagged_reasons` SHALL be persisted as a structured shape that
   carries both the canonical `code` and the free-form `detail` per reason
   (e.g. `{ code, detail }[]`).
2. WHEN the routing decision has no reasons THEN `flagged_reasons` SHALL be
   persisted as `null` (current behavior preserved).
3. WHEN the manual-review read path (admin route / review UI / revalidation
   CLI) consumes `flagged_reasons` THEN it SHALL render the human-readable
   reason without loss relative to today (code label + detail), AND SHALL
   tolerate historical `string[]` rows written before this change without
   throwing.
4. The `detail` text persisted per reason SHALL be byte-equivalent to the prose
   / interpolated value that today lands in the flat `string[]` (no information
   dropped in the format migration).

### Requirement 5 — Bounded, verifiable aggregation

**User Story:** As an operator, I want a guarantee that the rejection-reason
columns aggregate to a finite, documented key set, so that dashboards and the
planned repair loop do not degrade as data accumulates.

#### Acceptance Criteria

1. WHEN `run-one-cell.test.ts` asserts on a post-fix `rejection_reason_counts`
   map THEN it SHALL assert that **no** map key contains a colon-interpolated
   value or a sentence-length string (the explicit tech-debt acceptance check).
2. WHEN `SELECT reason, SUM(...) FROM generation_jobs, LATERAL
   jsonb_each_text(rejection_reason_counts) GROUP BY reason` is run on a
   post-fix run THEN it SHALL return a bounded set of rows whose `reason` values
   are all members of the canonical enum.
3. The total set of possible `rejection_reason_counts` keys SHALL equal the
   subset of the canonical enum reachable on the rejected branch, and this SHALL
   be covered by a test enumerating each reject path → its expected code.

## Non-Functional Requirements

### Performance
- The change is pure data-shape plumbing on the post-LLM path; it SHALL add no
  additional Claude calls, DB round-trips, or measurable latency to
  `runOneCell`.

### Reliability / Compatibility
- Backfill of historical rows is **out of scope** (per tech-debt: historical
  rows stay as-is). New runs produce the clean shape; the read path SHALL
  handle both old (`string[]`) and new (`{ code, detail }[]`) `flagged_reasons`
  shapes so no migration of existing data is required.
- No Drizzle schema migration that rewrites existing data SHALL be required; if
  the `flagged_reasons` column type is widened, it SHALL remain
  backward-readable for existing rows.
- The validator tool schema / prompt (`validate.ts`, `validation-prompts.ts`)
  MAY keep emitting free text; the canonicalization happens in the routing
  layer that consumes that free text, so no prompt-version bump or Langfuse
  re-sync is forced by this change unless the prompt body itself is edited.

### Usability (operator/reviewer)
- Each canonical code SHALL have a documented human label so dashboards and the
  review UI can show friendly names.

### Testing
- Existing tests in `routing.test.ts`, `deterministic-checks.test.ts`,
  `validate-and-insert.test.ts`, and `run-one-cell.test.ts` SHALL be updated to
  the new shape and continue to pass; new assertions per Req 5.1 / 5.3 SHALL be
  added.
- `pnpm lint && pnpm typecheck && pnpm test` SHALL pass before the change is
  considered complete (CLAUDE.md pre-push gate).
