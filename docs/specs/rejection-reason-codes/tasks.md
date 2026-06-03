# Implementation Plan

## Task Overview

Introduce a canonical reason-code enum in `@language-drill/shared` and thread
reasons through the exercise-generation post-LLM path as `{ code, detail? }`
objects, keying the frequency map on `code` only. Both DB columns are already
`jsonb`, so there is no migration — the work is type + value plumbing plus test
updates. Tasks proceed bottom-up: shared types first (so every consumer can
import them), then each emitter (`routing` → `deterministic-checks` →
`validate-and-insert`), then the consumer (`run-one-cell`), then the
revalidation CLI / display read path, then a final pre-push gate.

## Steering Document Compliance

- New shared module + barrel re-export follow the `packages/shared` convention
  (tech.md §4) and the existing extensionless `export * from "./<module>"` idiom.
- `GenerationReasonCode` uses a TS `enum`, matching `Language` / `CefrLevel` /
  `ExerciseType`.
- Tests are co-located in each module's existing `*.test.ts` (CLAUDE.md Testing).
- No prompt edits → no `*_PROMPT_VERSION` bump; no SQL migration.

## Atomic Task Requirements

**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1-3 related files maximum
- **Time Boxing**: Completable in 15-30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Tasks

- [x] 1. Create canonical reason enum + types in packages/shared/src/generation-reasons.ts
  - File: packages/shared/src/generation-reasons.ts (new)
  - Define `enum GenerationReasonCode` with the 12 active members (reject-branch:
    `LowQualityReject='low-quality-reject'`, `ContextSpoilsAnswer='context-spoils-answer'`,
    `CulturalIssue='cultural-issue'`, `VowelHarmonyAllomorph='vowel-harmony-allomorph'`,
    `ParserFailure='parser-failure'`, `ValidatorParseFailure='validator-parse-failure'`;
    flag-branch: `LowQualityFlag='low-quality-flag'`, `Ambiguous='ambiguous'`,
    `LevelMismatch='level-mismatch'`, `GrammarPointMismatch='grammar-point-mismatch'`,
    `MalformedSurfaceForm='malformed-surface-form'`, `ValidatorNote='validator-note'`)
    plus the read-only `LegacyUncoded='legacy-uncoded'` member.
  - Define `type GenerationReason = { code: GenerationReasonCode; detail?: string }`.
  - Add a doc comment on each code; mark `LegacyUncoded` as read-only (normalizer-only).
  - Purpose: Establish the single source of truth for reason codes (Req 1.1–1.3).
  - _Leverage: packages/shared/src/index.ts (enum style of Language/CefrLevel)_
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Add REASON_LABELS, REJECTED_BRANCH_CODES, and helpers to generation-reasons.ts
  - File: packages/shared/src/generation-reasons.ts (continue from task 1)
  - Add `REASON_LABELS: Record<GenerationReasonCode, string>` (friendly label per code).
  - Add `REJECTED_BRANCH_CODES: readonly GenerationReasonCode[]` = the 6 reject-branch codes.
  - Add `formatReason(r: GenerationReason): string` → `REASON_LABELS[code]` (fallback to raw
    code if missing) + `": " + detail` when detail present.
  - Add `normalizeFlaggedReasons(raw: unknown): GenerationReason[]` — total, throw-free:
    pass-through `{code,...}[]`; wrap legacy `string[]` elements as
    `{ code: LegacyUncoded, detail: str }`; `null`/`undefined`/non-array → `[]`.
  - Purpose: Display + back-compat read helpers (Req 1.4, 4.3, 4.4, 5.3).
  - _Leverage: packages/shared/src/generation-reasons.ts (task 1)_
  - _Requirements: 1.4, 4.3, 4.4, 5.3_

- [x] 3. Re-export generation-reasons from the shared barrel
  - File: packages/shared/src/index.ts (modify)
  - Add `export * from "./generation-reasons";` following the existing extensionless
    re-export convention (alongside `./onboarding`, `./read`, etc.).
  - Purpose: Make the new types importable as `@language-drill/shared` (Req 1.1).
  - _Leverage: packages/shared/src/index.ts (existing re-export block)_
  - _Requirements: 1.1_

- [x] 4. Write unit tests for generation-reasons helpers
  - File: packages/shared/src/generation-reasons.test.ts (new)
  - Test `normalizeFlaggedReasons` over: a `{code,detail}[]` (pass-through), a legacy
    `string[]` (each → `LegacyUncoded` with prose in detail), `null`/`undefined`/malformed (→ `[]`).
  - Test `formatReason` with detail, without detail, and an unknown code (raw-code fallback).
  - Assert every `GenerationReasonCode` member has a `REASON_LABELS` entry and that
    `REJECTED_BRANCH_CODES` are all valid enum members.
  - Run `pnpm --filter @language-drill/shared test`; report pass/fail.
  - Purpose: Lock the shared contract before consumers depend on it (Req 5.3).
  - _Leverage: packages/shared/src/read.test.ts (test file style)_
  - _Requirements: 1.4, 4.3, 5.3_

- [x] 5. Change RoutingDecision to GenerationReason[] in routing.ts
  - File: packages/db/src/generation/routing.ts (modify)
  - Import `GenerationReason`, `GenerationReasonCode` from `@language-drill/shared`.
  - Change `RoutingDecision.flaggedReasons` type `string[]` → `GenerationReason[]`.
  - Reject branch: push `{ code: LowQualityReject }`, `{ code: ContextSpoilsAnswer }`,
    then `culturalIssues.map(issue => ({ code: CulturalIssue, detail: issue }))` — same order.
  - Flag branch: push `{ code: LowQualityFlag }`, `{ code: Ambiguous }`,
    `{ code: LevelMismatch }`, `{ code: GrammarPointMismatch }`, then
    `flaggedReasons.map(r => ({ code: ValidatorNote, detail: r }))` — same order.
  - Purpose: Emit structured reasons from the routing choke-point (Req 2.1, 2.2, 2.5).
  - _Leverage: packages/db/src/generation/routing.ts (existing branch structure)_
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 6. Update routing.test.ts to the GenerationReason shape
  - File: packages/db/src/generation/routing.test.ts (modify)
  - Update existing assertions from string literals to `{ code, detail? }` objects.
  - Pin each reject/flag branch → expected codes in documented order; assert
    `culturalIssues` prose lands in `detail` under `cultural-issue` and validator
    `flaggedReasons` under `validator-note`.
  - Run `pnpm --filter @language-drill/db test routing`; report pass/fail.
  - Purpose: Verify the routing reshape (Req 2.1, 2.2, 2.5).
  - _Leverage: packages/db/src/generation/routing.test.ts (existing cases)_
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 7. Move interpolated values into detail in deterministic-checks.ts
  - File: packages/db/src/generation/deterministic-checks.ts (modify)
  - Import `GenerationReasonCode` from `@language-drill/shared`.
  - `wrong-harmony` → prepend `{ code: VowelHarmonyAllomorph, detail: \`expected ${verdict.expected}, got ${verdict.actual}\` }`.
  - `non-word-stem` → append `{ code: MalformedSurfaceForm, detail: verdict.reconstructed }`;
    keep the `auto-approved → flagged` downgrade and prepend/append ordering.
  - Purpose: Keep interpolated values out of the code key (Req 2.3, 2.5).
  - _Leverage: packages/db/src/generation/deterministic-checks.ts (existing switch)_
  - _Requirements: 2.3, 2.5_

- [x] 8. Update deterministic-checks.test.ts to the GenerationReason shape
  - File: packages/db/src/generation/deterministic-checks.test.ts (modify)
  - Assert `vowel-harmony-allomorph` / `malformed-surface-form` codes with the
    interpolated values in `detail` (never embedded in the code); assert prepend/append
    position and the downgrade are preserved.
  - Run `pnpm --filter @language-drill/db test deterministic-checks`; report pass/fail.
  - Purpose: Verify deterministic reasons carry detail correctly (Req 2.3, 2.5).
  - _Leverage: packages/db/src/generation/deterministic-checks.test.ts (existing cases)_
  - _Requirements: 2.3, 2.5_

- [x] 9. Convert synthetic reasons + DraftOutcome.rejectionReasons in validate-and-insert.ts
  - File: packages/db/src/generation/validate-and-insert.ts (modify)
  - Import `GenerationReason`, `GenerationReasonCode` from `@language-drill/shared`.
  - Change `DraftOutcome.rejectionReasons` type `string[]` → `GenerationReason[]`.
  - Replace `PARSER_FAILURE_REASON` / `VALIDATOR_PARSE_FAILURE_REASON` string constants:
    set the synthetic returns to `[{ code: ParserFailure }]` (parser-failure-at-final
    returns) and `[{ code: ValidatorParseFailure }]` (`validatorParseFailedOutcome`).
  - Genuine-veto return forwards `decision.flaggedReasons` (now `GenerationReason[]`) unchanged.
  - Purpose: Synthetic + veto reasons carry enum codes (Req 2.4).
  - _Leverage: packages/db/src/generation/validate-and-insert.ts (outcome builders)_
  - _Requirements: 2.4_

- [x] 10. Persist {code,detail}[] to exercises.flagged_reasons + add column $type
  - Files: packages/db/src/generation/validate-and-insert.ts (modify),
    packages/db/src/schema/exercises.ts (modify)
  - In the insert (`flaggedReasons:` field ~line 440), persist `decision.flaggedReasons`
    (now `GenerationReason[]`) when non-empty, else `null` — logic shape unchanged.
  - In `schema/exercises.ts:29`, add `.$type<GenerationReason[]>()` to the
    `flagged_reasons` jsonb column (import the type from `@language-drill/shared`).
  - Purpose: Per-exercise reasons keep code + detail; no migration (Req 4.1, 4.2).
  - _Leverage: packages/db/src/schema/exercises.ts, validate-and-insert.ts insert path_
  - _Requirements: 4.1, 4.2_

- [x] 11. Update validate-and-insert.test.ts to the GenerationReason shape
  - File: packages/db/src/generation/validate-and-insert.test.ts (modify)
  - Assert synthetic outcomes carry `{ code: 'parser-failure' }` / `{ code: 'validator-parse-failure' }`;
    assert the insert persists `{ code, detail }[]` to `flagged_reasons` and `null` when empty;
    assert the Turkish deterministic reason appears as `{ code, detail }` in the persisted array.
  - Run `pnpm --filter @language-drill/db test validate-and-insert`; report pass/fail.
  - Purpose: Verify synthetic codes + persistence shape (Req 2.4, 4.1, 4.2).
  - _Leverage: packages/db/src/generation/validate-and-insert.test.ts (existing cases)_
  - _Requirements: 2.4, 4.1, 4.2_

- [x] 12. Key rejection_reason_counts on reason.code in run-one-cell.ts
  - File: packages/db/src/generation/run-one-cell.ts (modify)
  - Change the fold loop (~line 553) to
    `for (const reason of outcome.rejectionReasons ?? []) { rejectionReasonCounts[reason.code] = (rejectionReasonCounts[reason.code] ?? 0) + 1; }`.
  - Leave persistence (~line 611) and the `null`-when-empty behavior unchanged.
  - Purpose: Bounded, code-keyed frequency map (Req 3.1, 3.2, 3.3, 3.4).
  - _Leverage: packages/db/src/generation/run-one-cell.ts (existing fold + persist)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 13. Add rejection_reason_counts key assertions to run-one-cell.test.ts
  - File: packages/db/src/generation/run-one-cell.test.ts (modify)
  - Update existing reason expectations to codes; add: every map key is a
    `GenerationReasonCode` member (primary set-membership check) AND contains no `:` and
    is not sentence-length (secondary guard); same-code-different-detail collapses to one
    summed bucket; dedup-given-up contributes nothing; `null` when no rejections.
  - Run `pnpm --filter @language-drill/db test run-one-cell`; report pass/fail.
  - Purpose: Lock the bounded-cardinality guarantee (Req 5.1, 3.4, 3.3).
  - _Leverage: packages/db/src/generation/run-one-cell.test.ts (existing cases), REJECTED_BRANCH_CODES_
  - _Requirements: 5.1, 5.2, 3.3, 3.4_

- [x] 14. Update revalidation CLI demotion to GenerationReason[]
  - File: packages/db/scripts/revalidate-cloze-pool.ts (modify)
  - Change `DemotionAction` demote variant `reasons: string[]` → `GenerationReason[]`
    (it already comes from `routeValidationResult`/`applyDeterministicChecks`).
  - Ensure `applyDemotion` writes `action.reasons` (now `GenerationReason[]`) to
    `flaggedReasons` unchanged.
  - Purpose: Keep the revalidation writer consistent with the live path (Req 4.1).
  - _Leverage: packages/db/scripts/revalidate-cloze-pool.ts (decideDemotion/applyDemotion)_
  - _Requirements: 4.1, 2.1_

- [x] 15. Render reasons via formatReason in CLI summaries (read-side back-compat)
  - Files: packages/db/scripts/revalidate-cloze-pool.ts (modify),
    packages/db/scripts/generate-exercises.ts (modify)
  - In `revalidate-cloze-pool.ts` summary (~line 452), render demotion reasons via
    `formatReason`; where reading existing `flagged_reasons`, route through
    `normalizeFlaggedReasons` so legacy `string[]` rows render without throwing.
  - In `generate-exercises.ts` summary (~line 229), the aggregated keys are now codes —
    render their `REASON_LABELS` friendly names (codes still group cleanly).
  - Purpose: Display retains human-readable reasons for both shapes (Req 4.3, 1.4).
  - _Leverage: packages/shared formatReason/normalizeFlaggedReasons, REASON_LABELS_
  - _Requirements: 4.3, 1.4_

- [x] 16. Update revalidate-cloze-pool.test.ts to the GenerationReason shape
  - File: packages/db/scripts/revalidate-cloze-pool.test.ts (modify)
  - Update `decideDemotion` assertions: `reasons` is `GenerationReason[]` with expected codes.
  - Run `pnpm --filter @language-drill/db test revalidate-cloze-pool`; report pass/fail.
  - Purpose: Verify the revalidation reshape (Req 4.1).
  - _Leverage: packages/db/scripts/revalidate-cloze-pool.test.ts (existing cases)_
  - _Requirements: 4.1_

- [x] 17. Run the full pre-push gate and fix any residual type/lint errors
  - Files: any of the above as needed (compile/lint fixes only)
  - Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root; resolve any
    remaining `string` vs `GenerationReason` type errors or unused-import lints (e.g. the
    removed `PARSER_FAILURE_REASON` constant references, `log.ts` passing the code-keyed map).
  - Confirm zero failures across lint, typecheck, and test.
  - Purpose: Satisfy the CLAUDE.md pre-push gate (NFR Testing).
  - _Leverage: CLAUDE.md Pre-Push Checks_
  - _Requirements: 5.1, 5.2, all_
