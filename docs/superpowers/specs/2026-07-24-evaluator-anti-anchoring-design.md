# Evaluator anti-anchoring for cloze + vocab_recall

**Date:** 2026-07-24
**Status:** Approved design
**Branch:** `fix/evaluator-anti-anchoring`

## Problem

The answer evaluator anchors on the stored reference answer and invents unstated
context to defend it. Reported case: a learner answered `deja` (present) on

> El guardia de seguridad no nos ___ entrar al edificio sin identificación.

and was marked **wrong (20%)**. The evaluator's feedback asserted *"the sentence
describes a specific past event"* — context that is nowhere in the sentence.

Root cause is an **information asymmetry**: `buildClozeUserPrompt` (prompts.ts:128)
feeds the evaluator strictly MORE than the learner saw — `correctAnswer`,
`acceptableAnswers`, and `context` — and frames it as *"if it doesn't match Correct
Answer, decide whether it's still valid."* Nothing tells the evaluator that the
learner never saw the reference, so the model treats divergence from the stored
answer as a problem to justify, and back-fills invented context to do so. This is
the same reference-anchoring class already fixed for the **translation** evaluator
(prompts.ts:163-165, PR #523) — cloze and vocab_recall have no equivalent guard.

The generation/validation side of this (PR #611, 2026-07-23) stops *new*
tense-ambiguous items from being produced/approved. This change is the
**defense-in-depth** at evaluation time: even when an ambiguous item exists (old
pool, or any other grammar point), a learner's valid alternative must not be
marked wrong on invented context.

## Decisions made

- **Scope: cloze + vocab_recall**, in the per-type user-prompt builders (translation
  already has its own anti-anchoring block). Rejected: cloze-only (leaves vocab_recall
  latent trap); a general rule in the shared `EVALUATION_SYSTEM_PROMPT` (DRYer but
  edits the hot cached prompt, needs a Langfuse push, higher blast radius).
- **Framing names the mechanism** (information asymmetry) + the anti-anchoring
  behavior, not a generic "don't anchor."
- **Leave the legacy `context` field render as-is.** It is not the main culprit
  (the model invented context from `correctAnswer`, not from the context field), it
  is already retired on the generation side (schema dropped it 2026-07-12), and the
  new rule names it as something the learner did not see. Removing the render is a
  separate, bigger change — out of scope.
- **Over-correction risk runs OPPOSITE to PR #611**: the danger here is
  over-*accepting* (marking a genuinely-wrong answer correct). Guarded by the phrase
  "valid given ONLY the visible sentence, and among the Options when options are
  shown."

## The rule

Appended in `buildClozeUserPrompt`, after the existing "Evaluate the user's answer…"
line:

> **What the learner saw:** only the Sentence, Instructions, and Options (if listed)
> — NOT the Correct Answer, Acceptable Answers, or Context. Correct Answer /
> Acceptable Answers are the *intended* fill and your reference, but not the only
> admissible answer: if the user's answer is grammatically and semantically valid in
> the visible sentence — and among the Options when options are shown — it is fully
> correct (score 1.0, no error), even when it differs from Correct Answer. Do NOT
> invent unstated context (a specific time, past event, place, or referent not
> present in the visible sentence) to justify marking a valid answer wrong. When the
> sentence does not itself fix the tense/aspect/number, any form the visible sentence
> licenses is correct — e.g. for "El portero no ___ entrar sin identificación" both
> present "deja" (a standing rule) and preterite "dejó" are correct.

Parallel (shorter) block in `buildVocabRecallUserPrompt`:

> **What the learner saw:** only the Prompt/definition and Hints — NOT the Expected
> Word or Acceptable Answers. A word the learner produces that genuinely fits the
> definition and is used appropriately is fully correct even if it is not the Expected
> Word and not listed in Acceptable Answers; judge it on whether it satisfies the
> visible prompt, not on whether it matches the reference. Do not mark a valid
> synonym wrong merely for differing from the Expected Word.

## Implementation

### 1. Prompt edit — `packages/ai/src/prompts.ts`

- Append the cloze block in `buildClozeUserPrompt` (~line 141) and the vocab block in
  `buildVocabRecallUserPrompt` (~line 187).
- Bump `EVALUATION_SYSTEM_PROMPT_VERSION` → `evaluate@2026-07-24` with a dated
  version-history comment noting: user-builder-only edit (cloze + vocab_recall
  anti-anchoring), cached system template unchanged → ships with code deploy, NO
  Langfuse push, version bumped only to cohort traces.

### 2. Tests — `packages/ai/src/prompts.test.ts`

- Assert `buildClozeUserPrompt(...)` output contains the new rule phrase (e.g.
  "What the learner saw") and the tense example.
- Assert `buildVocabRecallUserPrompt(...)` output contains its parallel phrase.
- Update the `EVALUATION_SYSTEM_PROMPT_VERSION` assertion to `evaluate@2026-07-24`.
- Full `pnpm lint && pnpm typecheck && pnpm test` green before push.

### 3. Verification — scratch harness through the real `evaluateAnswer` (~$0.15)

The edit is in the USER builders, so `systemPromptOverride` cannot A/B it; the
"before" is empirically known (the reported 20%). Run ~8 crafted cases through the
NEW `evaluateAnswer` and confirm BOTH directions:

- **False-negatives flip to score 1.0:**
  - cloze `El portero no ___ entrar al edificio sin identificación.` / correctAnswer
    `dejó` / user `deja`.
  - cloze `Los celos le ___ actuar de una manera muy extraña.` / correctAnswer
    `hicieron` / user `hacen`.
  - vocab_recall: a valid synonym that fits the definition but is not the Expected
    Word / not in Acceptable Answers.
- **Controls stay correct (guard against over-accepting):**
  - cloze `Cuando llegué tarde a la reunión, mi jefe no me ___ disculparme.` /
    correctAnswer `dejó` / user `deja` → must stay < 1.0 (the in-stem preterite
    `llegué` forces past; present is wrong here).
  - cloze flat-wrong fill (semantically invalid word) → wrong.
  - cloze with Options (MC) where the user picks a grammatically-wrong distractor →
    wrong.
  - vocab_recall clearly-wrong word (outside the definition's domain) → wrong.

Pass criteria: every false-negative scores 1.0 with no error; every control keeps its
correct (non-1.0 / error) verdict. If a control flips to 1.0, the rule over-accepts —
tighten the "valid given ONLY the visible sentence / among the Options" guard and
re-run. Delete the scratch harness after.

## Out of scope

- Removing the legacy `context` field from the evaluator render.
- Any system-prompt (`EVALUATION_SYSTEM_PROMPT`) edit — this is user-builder-only.
- The translation builder (already has its anti-anchoring block).
