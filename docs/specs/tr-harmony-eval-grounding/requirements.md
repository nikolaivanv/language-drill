# Requirements Document

## Introduction

A Turkish A1 cloze shipped to learners as:

> **Sentence:** `Pazarda taze domat___ satıyorlar.` **Correct Answer:** `ler`

Fusing the visible stem with the answer yields `domatler`, which is **not a Turkish word**. The word for "tomato" is `domates`; its plural is `domatesler`. The generator dropped the stem-final `-es` and placed the blank at a non-morpheme boundary. Separately, when a learner answered `lar`, the runtime evaluator's free-text feedback asserted that *"domates contains front vowels (o, a, e)"* — which is factually wrong: in Turkish `o` and `a` are **back** vowels (front = `e i ö ü`; back = `a ı o u`), and harmony keys off the **last** vowel only.

Both defects are real model errors on Turkish morphophonology, produced at two different LLM stages:

1. **Generation/validation gap.** The generator truncated the stem; the LLM validator approved it. The validator's rubric has no dimension that checks whether the visible stem fused with `correctAnswer` is a well-formed word, nor whether the suffix is the harmonically-correct allomorph. PR #177 (`generation-quality-fixes`) rebuilt the validator prompt but added no such check — `domat___ / ler` passes the post-#177 validator unchanged.
2. **Evaluation gap.** The runtime evaluator (`EVALUATION_SYSTEM_PROMPT`) is never given the Turkish vowel inventory, so it fabricates phonological justifications. PR #177 never touched `prompts.ts`; its own "Future Work" section explicitly defers this evaluator-prompt fix to a later spec — this is that spec.

Turkish vowel harmony and suffix-allomorph selection are **fully algorithmic, closed-class rules** — computable deterministically from a small vowel table. The fix is therefore not "use a bigger model" but "stop delegating a deterministic rule to a probabilistic model at three independent stages." This spec adds a pure, non-LLM Turkish checker as a hard gate after the LLM validator (reused by the revalidation CLI to demote existing offenders), grounds the evaluator's feedback with the explicit vowel inventory, and upgrades the pinned Claude models to the current versions (closing an existing doc/code drift).

## Alignment with Product Vision

The product thesis (`product.md`) is *active production over passive recognition* and *honest, skill-based progress*. A cloze whose only correct answer is a non-word cannot be produced correctly by any learner, and it corrupts the mastery signal for the grammar point it claims to drill — the opposite of honest progress. Grounded evaluator feedback is equally load-bearing: for an intermediate learner past the Duolingo plateau, a *wrong* grammatical explanation is worse than terse feedback, because the learner internalizes the error. Deterministic grounding of a deterministic rule is the cheapest, most reliable way to protect both. The model upgrade keeps the AI surface on the current generation per the documented stack (`tech.md` already names `claude-sonnet-4-6`).

## Requirements

### Requirement 1 — Deterministic Turkish vowel-harmony allomorph check

**User Story:** As a learner, I want a Turkish cloze whose blanked suffix is the wrong harmonic allomorph for its visible stem to never reach my queue, so that the exercise I practice is itself grammatically correct.

#### Acceptance Criteria

1. WHEN a Turkish (`language === TR`) cloze draft has a **suffixal blank** (the `___` marker is immediately preceded by a letter with no intervening whitespace) THEN the checker SHALL identify the suffix paradigm from the `correctAnswer` surface form (e.g. `lar`/`ler` → 2-way plural; a bare high vowel `i`/`ı`/`u`/`ü` → 4-way accusative/possessive) and compute the harmonically-correct allomorph from the **last vowel of the visible stem**, using the canonical vowel table (front = `e i ö ü`, back = `a ı o u`; rounded = `o ö u ü`, unrounded = `a e ı i`).
2. WHEN the `correctAnswer` is a member of a recognised harmonic paradigm AND it is **not** the allomorph that the visible stem's last vowel selects THEN the checker SHALL return a hard-veto verdict of kind `wrong-harmony` carrying both the expected and actual allomorph (e.g. stem `domat` → last vowel `a` (back) → expects `lar`, got `ler`).
3. IF the `correctAnswer` does not match any recognised harmonic paradigm (the blank does not test a vowel-harmony-governed suffix) THEN the harmony check SHALL return `not-applicable` and SHALL NOT veto the draft.
4. The harmony check SHALL be a **pure function** with no I/O, no Claude calls, and no dependency on the LLM `ValidationResult`; it operates on `ClozeContent` plus the draft's `language`.

### Requirement 2 — Deterministic word-formedness / morpheme-boundary check

**User Story:** As a learner, I want a Turkish cloze whose visible stem is a truncated non-word (the blank placed mid-lexeme) to be caught before it reaches me, so that `domat___ / ler` (→ `domatler`) is rejected and `domates___ / ler` (→ `domatesler`) is accepted.

#### Acceptance Criteria

1. WHEN a Turkish cloze draft has a suffixal blank THEN the checker SHALL reconstruct the full surface word (visible stem concatenated with `correctAnswer`) and evaluate whether the visible stem corresponds to a real Turkish lexeme, using the bundled Turkish frequency lexicon (`packages/ai/src/frequency/tr.json` via `loadFrequency(Language.TR)`).
2. WHEN none of {the full reconstructed surface form, the bare visible stem, the visible stem with Turkish final-consonant de-mutation applied (`b→p`, `c→ç`, `d→t`, `ğ→k`)} is found in the Turkish lexicon THEN the checker SHALL return a verdict of kind `non-word-stem` naming the reconstructed form (e.g. `domatler`).
3. WHEN the visible stem (or its de-mutated form, or the reconstructed surface) IS found in the lexicon THEN the word-formedness check SHALL pass — `domates` is in the lexicon, so `domates___ / ler` passes; `domat` is not, so `domat___ / ler` fails.
4. The word-formedness check SHALL be conservative to absorb lexicon coverage gaps: a `non-word-stem` verdict SHALL route to **flagged** (human review), not auto-rejected, whereas a Requirement 1 `wrong-harmony` verdict (provably incorrect) SHALL route to **rejected**. (Routing precedence is defined in Requirement 3.)
5. The word-formedness check SHALL only run on suffixal blanks (R1.1's adjacency rule); a whole-word lexical blank (whitespace before `___`, e.g. `Sınıfta sekiz ___ var`) SHALL be skipped — those are the LLM validator's ambiguity domain, out of scope here.

### Requirement 3 — Single deterministic gate shared by generation-time and revalidation-time

**User Story:** As the maintainer of the pool, I want the deterministic check applied identically when a draft is first generated and when the pool is re-scored, so that the live path and the revalidator can never diverge (the failure mode PR #177's R3.C.8 guarded against).

#### Acceptance Criteria

1. The deterministic verdicts from R1 and R2 SHALL be combined with the LLM `ValidationResult` routing in **one** pure helper (e.g. `applyDeterministicChecks(routingDecision, content, language)` in `packages/db/src/generation/`) that both `validateAndInsertWithRetry` (`packages/db/src/generation/validate-and-insert.ts`) and the revalidate CLI (`packages/db/scripts/revalidate-cloze-pool.ts`) call — no second copy of the precedence logic.
2. WHEN the deterministic check yields a `wrong-harmony` veto THEN the combined decision SHALL be `reviewStatus = 'rejected'` with `'wrong vowel-harmony allomorph (deterministic): expected <x>, got <y>'` prepended to `flaggedReasons`, regardless of the LLM `qualityScore`.
3. WHEN the deterministic check yields a `non-word-stem` veto AND the LLM decision was `auto-approved` THEN the combined decision SHALL be downgraded to `reviewStatus = 'flagged'` with `'suspected malformed surface form (deterministic): <form>'` added to `flaggedReasons`. WHEN the LLM decision was already `rejected` THEN it SHALL remain `rejected` (no upgrade).
4. WHEN a draft is non-Turkish, is not a cloze, or has a non-suffixal blank THEN `applyDeterministicChecks` SHALL return the LLM routing decision unchanged (pass-through).
5. WHEN `pnpm revalidate:cloze --language TR --apply` is run after this ships — covering **all active TR cloze CEFR levels (A1 and A2)**, not only A1 (TR A2 suffixal-blank grammar points such as accusative `-(y)I` and genitive-possessive `-(s)I` are in the deterministic checker's domain) — THEN existing approved offenders matching R1 (`wrong-harmony`) or R2 (`non-word-stem`) patterns SHALL be demoted to `rejected` / `flagged` respectively, via the existing `decideDemotion` path with no new CLI surface. IF the CLI requires a per-level invocation THEN the sweep SHALL be run once per active TR level (A1, A2). The deterministic verdict requires no Claude call; the per-row LLM re-validation that `revalidate:cloze` already performs runs on the upgraded `claude-sonnet-4-6` (R5) as a side benefit.
6. The deterministic gate SHALL NOT change any prompt and SHALL NOT bump `GENERATION_PROMPT_VERSION` or `VALIDATION_PROMPT_VERSION` — it is post-LLM routing logic, not a prompt edit.

### Requirement 4 — Grounded evaluation feedback for Turkish vowel harmony

**User Story:** As a Turkish learner, I want the evaluator's explanation of a vowel-harmony mistake to be phonologically correct, so that I do not internalize a wrong rule (e.g. being told `o` and `a` are front vowels).

#### Acceptance Criteria

1. WHEN `EVALUATION_SYSTEM_PROMPT` (`packages/ai/src/prompts.ts`) is rebuilt THEN its Turkish (TR) language-specific note SHALL state the explicit vowel inventory — front: `e i ö ü`; back: `a ı o u`; rounded: `o ö u ü`; unrounded: `a e ı i` — and SHALL state that suffix harmony is determined by the **last vowel** of the stem only.
2. WHEN `EVALUATION_SYSTEM_PROMPT` is rebuilt THEN it SHALL instruct the evaluator that for borrowed/mixed-vowel words (e.g. `domates`) only the final vowel governs the suffix, and that it MUST NOT mislabel a vowel's front/back class in its feedback.
3. WHEN the prompt edit ships THEN `EVALUATION_SYSTEM_PROMPT_VERSION` SHALL be bumped to today's date (`evaluate@YYYY-MM-DD`) per the CLAUDE.md prompt-editing rule, in the same commit as the prompt edit.
4. WHEN the evaluation prompt is fetched at runtime THEN the existing Langfuse-registered/fallback resolution (`getPromptOrFallback`) SHALL continue to work; the byte-parity and prompt-registry tests SHALL be updated to the new text and SHALL pass.

### Requirement 5 — Claude model upgrade to current versions

**User Story:** As the maintainer, I want the generation, validation, and evaluation calls pinned to the current Claude Sonnet, so that the AI surface matches the documented stack and benefits from the latest model's reliability.

#### Acceptance Criteria

1. WHEN the model constants are updated THEN `GENERATION_MODEL` (`packages/ai/src/generate.ts`), `VALIDATION_MODEL` (`packages/ai/src/validate.ts`), the evaluation `MODEL` (`packages/ai/src/evaluate.ts`), and `THEORY_VALIDATION_MODEL` / the `THEORY_GENERATION_MODEL` alias (`packages/ai/src/theory-validate.ts`, `theory-generate.ts`) SHALL all equal `claude-sonnet-4-6`.
2. WHEN the cross-file model-equality invariant is checked THEN the existing assertions in `generate.test.ts`, `validate.test.ts`, `evaluate.test.ts`, `theory-generate.test.ts`, `theory-validate.test.ts`, and the model strings in `observability.test.ts` SHALL be updated to `claude-sonnet-4-6` and SHALL pass.
3. WHEN the annotation model is reviewed THEN `annotate.ts`'s `MODEL` and `STREAM_MODEL` SHALL be confirmed at `claude-haiku-4-5-20251001` (the current Haiku 4.5 snapshot id) — already the most recent Haiku, so this is a verification, not a change. IF a change is made it SHALL NOT downgrade the model.
4. WHEN the docs are reconciled THEN the `claude-sonnet-4-6` reference already in `CLAUDE.md` / `tech.md` SHALL match the code (drift closed); no doc SHALL still imply the code runs `claude-sonnet-4-5`.
5. WHEN model ids change THEN no `*_PROMPT_VERSION` constant SHALL change on account of the model bump alone (model id is not part of the prompt text). The R4 evaluation-prompt bump is independent and driven by R4.3.

## Non-Functional Requirements

### Performance
- The deterministic checker MUST add **no network calls and no Claude calls**; it is in-process pure computation plus an O(1) lookup against the already-bundled frequency map. Its added latency per draft MUST be negligible (<1 ms) relative to the ~1 s LLM validator call.
- The Turkish frequency lexicon is already imported into the `@language-drill/ai` bundle for the streaming-annotate Lambda; reusing it MUST NOT add a second copy to any bundle.

### Security
- No new external network surfaces, credentials, or secrets. The revalidator reuses its existing env-injected `DATABASE_URL` / `ANTHROPIC_API_KEY` auth model.

### Reliability
- The deterministic checker MUST be defensive: any internal error (e.g. unparseable stem, empty `correctAnswer`) MUST degrade to `not-applicable` (pass-through to the LLM decision) rather than throw and abort the per-ordinal flow — it must never regress R5 of PR #177 (one bad draft must not kill the batch).
- The word-formedness check MUST bias toward false negatives over false positives (flag, never auto-reject) given known lexicon coverage gaps, so that a rare-but-valid stem is not wrongly hidden from learners.
- No schema changes. Routing reuses the existing `exercises.review_status` enum (`rejected`, `flagged`) and `flagged_reasons`.

### Usability
- Deterministic veto reasons MUST be human-readable and self-describing in `flagged_reasons` (naming the expected vs actual allomorph, or the offending reconstructed form) so a reviewer scanning the queue understands the demotion without re-running the checker.
- The model-equality test assertions MUST keep the single-source-of-truth invariant (generation = validation = evaluation model) intact so the three Claude paths cannot silently drift again.

## Future Work (out of scope for this spec)

- **Generation-time prevention.** This spec catches the malformed stem at validation/eval time. A follow-up could add the same deterministic harmony/word-formedness check inside the generator's own self-check loop so the draft is never produced, saving the validator call.
- **Extending the deterministic checker beyond Turkish.** German (`umlaut`/case) and Spanish (gender/number agreement) have partially-algorithmic surfaces; the same pure-checker pattern could apply, but their failure modes have not been audited against production data.
- **Full morphological analysis.** A complete analyzer (e.g. a Zemberek-equivalent) would catch consonant-mutation and buffer-consonant boundary errors the lexicon-lookup heuristic can miss; deferred as JVM/bundle-weight is disproportionate to the current defect rate.
