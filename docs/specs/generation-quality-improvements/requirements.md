# Requirements Document

## Introduction

This feature improves the **quality and cost-efficiency of the exercise-generation pipeline**, driven by analysis of the 2026-05-30 04:00 UTC production generation run (a full Turkish re-sweep of 77 cells triggered by the `CURRICULUM_VERSION_TR` bump). That run approved only **35.6%** of requested slots, flagged 36.1%, and rejected 28.0% — spending ~$30.80 to produce a pool where the dominant failure modes are systematic and fixable.

The analysis isolated four root causes, addressed by four coupled changes confined to the **generation path** (the `packages/ai` generation prompt and `packages/db` cell-type allocation):

1. **Cloze is structurally wrong for clause-linking / bipartite grammar points.** `tr-a2-converbs` cloze produced **0/30 approved** (27 of 29 rejections were "context spoils answer") while its translation cell yielded 19/30; the same gap holds for correlatives, nominalization, and subject-relative `-(y)An`. The cloze blank's answer is leaked by the other half of the construction, or two near-synonym alternants both fit (`koşa koşa`/`koşarak`, `gezmek`/`gezme`).
2. **Vocabulary/level drift** — the single largest flag driver ("level mismatch", 352 of 638 flagged). The generator reaches for topical but above-level content words, so items test vocabulary rather than the target grammar.
3. **Content-safety vetoes** — ~40 rejections, a recurring `bomba` (bomb) cluster plus alcohol and cultural/stereotype topics — pure wasted generate→reject spend.
4. **Ambiguity** — the top flag tag (402 of 638). The generator fails to force a unique answer (especially Turkish accusative *definiteness*) or to enumerate `acceptableAnswers` when several renderings are valid.

This is **purely generator-behavior and cell-allocation work**. It makes **no changes to curriculum grammar-point text** (audited separately in PR #220).

## Assumptions

- The "vocabulary band" (R2) and "safety topic" (R3) constraints are **model-judgment guardrails validated by `pnpm eval:gen`** (the real generation-quality gate, not the answer-evaluation `pnpm eval`), not by unit tests — there is no in-repo frequency cutoff a test can assert against.
- The cloze-suitability flag (R1) is added to the `GrammarPoint` type at its real definition site, **`packages/shared/src/curriculum-types.ts`** (re-exported through `packages/db`), mirroring the existing optional `targetOverride`.
- The four targeted Turkish A2 grammar-point keys (`tr-a2-converbs`, `tr-a2-correlative-conjunctions`, `tr-a2-nominalization`, `tr-a2-relative-an`) exist unchanged in the curriculum (their text was audited in PR #220; only a flag is added here).

## Alignment with Product Vision

Supports `product.md`/`tech.md` §7 (**Content & AI Strategy** — "pre-generate reusable content … reduces Claude API cost dramatically") and the cost-controlled, AI-heavy constraints in `tech.md` §1: higher first-pass approval means fewer wasted Claude calls per usable exercise and a higher-quality shared pool. It directly serves the product's core promise of **active production practice** — an exercise that tests above-level vocabulary, leaks its own answer, or marks a correct answer wrong undermines the learning signal. No architectural change; the scheduler, evaluator, and retrieval interfaces are untouched.

## Requirements

### Requirement 1 — Suppress cloze for cloze-unsuitable grammar points (type re-allocation)

**User Story:** As a curriculum maintainer, I want grammar points that are structurally unsuited to cloze to be marked so the generator stops producing ambiguous, answer-leaking cloze for them, so that generation spend drops and the served pool's quality rises.

#### Acceptance Criteria

1. WHEN a grammar point carries a new optional cloze-suitability flag set to "unsuitable" THEN `enumerateCurriculumCells` SHALL NOT emit a `cloze` cell for that point.
2. WHEN cloze is suppressed for a grammar point THEN the system SHALL still emit that point's `translation` cell (production does not drop to zero for the point).
3. The flag SHALL be a **data-driven property on the `GrammarPoint` model** (analogous to the existing optional `targetOverride`), set in the curriculum data — NOT a hard-coded language/key list inside the scheduler or cell enumerator.
4. IF a grammar point has no cloze-suitability flag THEN cell enumeration SHALL behave exactly as today (grammar points → `cloze` + `translation`; vocab umbrellas → `vocab_recall`), preserving every existing cell.
5. WHEN the curriculum is loaded THEN the four identified Turkish A2 points — `tr-a2-converbs`, `tr-a2-correlative-conjunctions`, `tr-a2-nominalization`, `tr-a2-relative-an` — SHALL be marked cloze-unsuitable.
6. WHEN curriculum invariants are checked THEN a cloze-unsuitable point SHALL pass `assertCurriculumInvariants` / curriculum tests without throwing, and the per-language minimum-count gates SHALL continue to pass.

> The intended production outcome — re-allocated points showing yield routed to `translation` rather than a near-zero-yield `cloze` cell — is tracked as a success metric under Non-Functional → Performance / Cost, not as a statically verifiable acceptance criterion.

### Requirement 2 — CEFR vocabulary-band guardrail in the generation system prompt

**User Story:** As a learner, I want each exercise to test the target grammar using everyday words I already know at my level, so that an unfamiliar content word does not block me from practising the grammar point.

#### Acceptance Criteria

1. WHEN the generation system prompt is built THEN it SHALL instruct the model that **every content word must be high-frequency everyday vocabulary at or below the cell's CEFR level** (`{{cefrLevel}}`), and that the **target grammatical form is the only element that may be challenging**.
2. WHEN the cell already has frequency seeding available THEN the guardrail wording SHALL reinforce (not contradict) the existing per-draft seed-word injection and `frequency` module behaviour.
3. WHEN this guardrail changes the generation system prompt body THEN the shared prompt-versioning rule (NFR → Prompt Versioning & Sync) SHALL apply.
4. WHEN the prompt body changes THEN the `GENERATION_SYSTEM_PROMPT_TEMPLATE` and the sync-builder output SHALL remain byte-identical (the existing byte-parity test SHALL pass), and the added text SHALL live in the **cached system-prompt prefix** without introducing per-draft variability.

### Requirement 3 — Content-safety / topic guardrail in the generation system prompt

**User Story:** As a learner (and as the product owner), I want exercises to use safe, neutral everyday contexts, so that no learner is shown weapons, substance, violence, or stereotyping content and no Claude spend is wasted on drafts the validator will veto on safety grounds.

#### Acceptance Criteria

1. WHEN the generation system prompt is built THEN it SHALL instruct the model to **avoid weapons/explosives (e.g. `bomba`), alcohol, violence, and culturally-sensitive or stereotyping topics**, and to prefer neutral everyday contexts.
2. WHEN this guardrail changes the generation system prompt body THEN the shared prompt-versioning rule (NFR → Prompt Versioning & Sync) SHALL apply.
3. WHEN the content-safety guardrail is added THEN the validator's existing independent safety veto SHALL remain unchanged — the generator guardrail is additive defence-in-depth, not a replacement.

### Requirement 4 — Ambiguity reduction: in-sentence answer forcing + `acceptableAnswers` enumeration

**User Story:** As a learner, I want a cloze/translation to have exactly one defensible answer (or to accept every correct variant), so that I am never marked wrong for a response that is actually correct.

#### Acceptance Criteria

1. WHEN the generation system prompt's Turkish accusative-definiteness cloze rule is built THEN it SHALL instruct the model to **force definiteness structurally inside the L2 sentence** — via prior mention, a uniquely-identifiable referent, or a possessive — and SHALL treat `glossEn` as a **fallback** disambiguation device only.
2. WHEN the accusative rule is stated THEN it SHALL include a concrete worked example of prior-mention forcing (e.g. `"Denizde büyük bir dalga vardı. Çocuklar ___ gördü. (dalga)"` → `dalgayı`).
3. WHEN a definiteness-forcing device is added THEN it SHALL be placed in the **sentence/context**, NEVER in the `instructions` field — the existing anti-spoil rule (instructions must stay generic and must not name the case or outcome) SHALL remain in force.
4. WHEN any forcing clause is added THEN it SHALL itself obey the Requirement 2 vocabulary-band guardrail (no above-level vocabulary introduced to force definiteness).
5. WHEN the visible context admits more than one structurally valid answer (translations with multiple natural renderings; alternant-bearing clozes) THEN the prompt SHALL require `acceptableAnswers` to **enumerate every valid form**.
6. WHEN these changes alter the generation system prompt body THEN the shared prompt-versioning rule (NFR → Prompt Versioning & Sync) SHALL apply.

## Non-Functional Requirements

### Prompt Versioning & Sync
- IF any of Requirements 2–4 change the generation system prompt body in a commit THEN `GENERATION_PROMPT_VERSION` SHALL be bumped **exactly once** to `generate@YYYY-MM-DD` (today) in that commit — not once per requirement.
- After merge, the live prompt body SHALL be synced to each environment's Langfuse project via `pnpm push-prompts` (the in-repo `*_SYSTEM_PROMPT` constant is the fallback; the runtime fetches the live body). `bootstrap-prompts --check` SHALL report no drift post-sync.

### Performance / Cost
- Prompt additions SHALL preserve the **Anthropic prompt-cache prefix byte-identity** across drafts within a cell (the system prompt is the cached prefix per `tech.md` §7 prompt caching); no interpolation that varies per draft may enter the cached prefix.
- The net effect SHALL be a **higher first-pass approval rate** (fewer Claude calls per usable exercise); changes SHALL be validated via `pnpm eval:gen` against a cell dataset and SHALL NOT regress approval/quality before shipping.
- **Success metrics** (validated on a post-merge eval/run, not unit-tested): the four re-allocated points (R1) show yield routed to `translation` instead of a near-zero `cloze` cell; safety-reason rejections (R3) and "level mismatch" / "ambiguous" flags (R2/R4) drop versus the 2026-05-30 baseline.

### Security
- The content-safety guardrail SHALL only **reduce** unsafe drafts at generation time; it SHALL NOT relax or bypass the validator's existing independent safety veto (defence in depth preserved).

### Reliability
- Forward-only and additive: no migration is required (Requirement 1 is a data/enumeration change; existing rows are unaffected). The post-merge Langfuse sync is specified under **Prompt Versioning & Sync** above.

### Usability (learner-facing correctness)
- Generated exercises SHALL test their declared grammar point with level-appropriate vocabulary and a uniquely determinable (or fully enumerated) answer, eliminating the "correct answer marked wrong" failure mode for the targeted cells.

### Maintainability / Compatibility
- The cloze-suitability mechanism SHALL be **data-driven and language-agnostic** (a `GrammarPoint` property), so future points in any language opt in without code changes.
- No changes to curriculum grammar-point **text** (descriptions/examples/commonErrors) — that content was audited in PR #220.
- All pre-push checks (`pnpm lint`, `pnpm typecheck`, `pnpm test`) SHALL pass, including the curriculum invariant gate, the generation-prompt byte-parity test, and the cells / cell-targets tests.
