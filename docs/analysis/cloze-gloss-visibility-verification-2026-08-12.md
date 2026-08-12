# Cloze gloss visibility — verification record (2026-08-12)

Verifies the fix for `fix/cloze-gloss-visibility` (spec
`docs/superpowers/specs/2026-08-12-cloze-gloss-visibility-design.md`, plan
`docs/superpowers/plans/2026-08-12-cloze-gloss-visibility.md`) against the
live Anthropic API. Two prompt paths changed; both are re-verified end to
end below, not just unit-tested.

## The defect

A cloze exercise's `glossEn` field is written by the generator and shown to
the learner (`apps/web/components/drill/cloze-prompt.tsx:112`), but before
this branch it was rendered to **neither** the evaluator's user prompt
(`buildClozeUserPrompt`) nor the validator's user prompt
(`buildClozeValidationUserPrompt`). One omission, two failures:

- **Evaluator symptom:** a wrong-person answer (`puedes` against a gloss
  reading "I can't eat the soup without salt", first person) scored a full
  1.0 — the evaluator had no way to know the gloss fixed the person.
- **Validator symptom:** a row glossed "The park is near the school." shipped
  with the antonym `lejos` ("far") declared in `acceptableAnswers` — the
  validator had no way to check the declared answers against the gloss it
  never saw.

The fix (Tasks 1–2) renders the gloss to both prompts as **Meaning (shown to
the learner)** and adds a binding clause telling the evaluator to treat it as
authoritative; Task 3 adds a matching **Gloss consistency (cloze)** rule to
the validator's system template. This record covers the live-API
verification of both (Tasks 4–5).

## Evaluator verification (Task 4)

Live A/B against the real Anthropic API and dev Langfuse, run name
`cloze-gloss-binding-2026-08-12`, dataset `eval-cloze-gloss-binding` (2
items). Baseline scores are the **observed pre-fix** values recorded in
`docs/analysis/qa-run-2026-08-12-prod-es-a1-cloze.json` (both rows scored
`{"score": 1, "band": "pass"}` on the wrong answer, confidence 0.98/0.99);
candidate scores are from the post-fix prompt run live.

| Item | Row / defect | baseline score | candidate score | candidate grammarAccuracy |
|---|---|---:|---:|---:|
| 1 `es-querer-poder-person-gloss` | wrong person (`puedes` vs. 1st-person gloss) | 1.0 | **0.2** | 0.3 |
| 2 `es-locative-antonym-gloss` | antonym (`lejos` vs. "near" gloss) | 1.0 | **0.0** | 1.0 |

Item 1 error text (the success-criterion evidence):

> type: grammar, severity: major, text: "puedes", correction: "puedo" — "The
> meaning specifies 'I can't eat...', which requires the first-person
> singular form of poder (puedo), not the second-person singular (puedes,
> meaning 'you can't')."

**Success criterion (item 1 score < 0.8): MET.** Score dropped from 1.0 to
0.2, and the reported error correctly names the person mismatch — direct
evidence the gloss is now bound and treated as authoritative.

Item 2 was informational, not a pass/fail gate. The plan predicted it
**might** stay at 1.0, since `lejos` exact-matches a declared
`acceptableAnswers` entry and that could plausibly short-circuit before any
judgement. It did not stay high — it dropped to 0.0. The reason: there is
**no code-level exact-match short-circuit** in `packages/ai/src/evaluate.ts`
— no `acceptableAnswers`/`correctAnswer` comparison, no `normalizeAnswer` or
exact-match path (only `vocab_recall`/`conjugation` get deterministic
exact-match treatment, in `packages/ai/src/prompts.ts`, and cloze is not
among them). "Matches a declared acceptable answer → score 1.0" is prompt
guidance the model weighs against other instructions, not a hard rule, so the
new gloss-binding clause outweighed it here.

**Consequence:** the prompt fix alone already mitigates the contradictory
rows at answer time — a learner hitting one of the 20 contradictory rows
identified by the spec would not currently be scored 1.0 for the wrong
answer, even before any data repair runs. The data repair (Task 9, removing
`lejos` and the other 19 contradicting entries from `acceptableAnswers`)
remains the correct fix for the underlying data, but it is cleanup rather
than the only line of defence against a learner being told a wrong answer is
right.

**Cost:** $0.0374 for the 2-item run (item 1 $0.0124, item 2 $0.0250).
Latency p50 7248 ms / p95 7426 ms.

## Validator verification (Task 5)

Three probe runs against the real Anthropic API, calling
`validateDraft(client, draft, spec)` directly (not `eval:gen`, which would
apply a validation-prompt change identically to both A/B arms and hide the
effect), 3 draws per case. Every run's first line was
`{"templateCheck":{"marker":"Gloss consistency (cloze)","found":true}}` —
confirmed the in-repo edited template was exercised, not a stale Langfuse
fetch. This flag is only trustworthy because of a doubled `env -u
LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY` around both the outer `dotenv`
invocation and the inner `tsx` command — `dotenv -e ../../.env` re-injects
the Langfuse keys the outer `env -u` stripped, so they must be stripped
again on the inner command or `buildValidationSystemPrompt` fetches the live
Langfuse body instead of the edited local template.

### Run 1 — original rule, pre-amendment ($0.1092)

| Case | Draw 1 | Draw 2 | Draw 3 | Verdict |
|---|---|---|---|---|
| contradictory-antonym (expect `true`) | `true` q0.1 | `true` q0.2 | `true` q0.2 | **3/3 true — PASS** |
| inclusive-gloss control (expect `false`) | `true` q0.6 | `true` q0.6 | `false` q0.85 | **2/3 true — FAILED** |
| unglossed control (expect unchanged) | `true` q0.62 | `true` q0.62 | `true` q0.62 | pre-existing reason, unrelated |

This run found a **real defect in the rule as first written**. The rule
offered "widen the gloss to cover every listed answer" as a cure; the
drafter built exactly that ("I want/can walk to the park every day" for
`quiero`/`puedo`), and the validator flagged the widened form anyway,
quoting (verbatim, draw 1):

> the glossEn reads 'I want/can walk to the park every day', which explicitly
> names both quiero and puedo as valid readings. While acceptableAnswers
> does enumerate both, the gloss itself reveals the full answer set to the
> learner, reducing the exercise to a recognition task rather than a
> productive recall task.

This was not a probe artifact: the rule's own stated cure creates a new
defect (a spoiler gloss), which the generation prompt's existing anti-leak
rule already forbids. It caused commit `bb1705d4`
("fix(validate): prefer dropping contradicting answers over widening the
gloss"), which reframed the cure hierarchy: dropping the contradicting
`acceptableAnswers` entries is now the primary cure; widening the gloss is
permitted only when it can stay genuinely vague; a gloss that names every
listed answer (the exact wording above) is now itself named in the rule
text as a spoiler and a defect.

### Run 2 — post-amendment, updated cases ($0.1358)

| Case | Draw 1 | Draw 2 | Draw 3 | Verdict |
|---|---|---|---|---|
| contradictory-antonym (expect `true`, unchanged regression check) | `true` q0.2 | `true` q0.2 | `true` q0.2 | **3/3 true — PASS** |
| compliant-tight-gloss (expect `false`) | `true` q0.5 | `true` q0.55 | `true` q0.55 | **3/3 true — did not meet expected `false`** |
| spoiler-gloss (expect `true`, the *old* case 2, now a permanent regression guard) | `true` q0.4 | `true` q0.4 | `true` q0.4 | **3/3 true — PASS** |

Run 2 confirmed the amendment: `spoiler-gloss` (the exact widened-gloss shape
Run 1 exposed) is now correctly flagged every draw, draw 1 quoting: "the
glossEn reads 'I want/can walk to the park every day' ... This is a
spoiler — the learner can write the answer by reading the gloss without
engaging with the blank at all... Recommended fix: drop the glossEn entirely
or make it vague..."

`compliant-tight-gloss`'s 3/3 result looked like an over-flag but was **not**
— it was a bad control, not validator misbehaviour. The control point,
`es-a1-querer-poder-infinitive`, is a **two-construction** grammar point
(both querer and poder + infinitive are on-target per the point's own
description) in a sentence carrying `todos los días`, a habitual/iterative
adverbial. Reading the actual verdict reasons (not just the boolean)
showed draw 1 citing the pre-existing tense-determinacy rule (habitual
adverbials license both present and imperfect with no anchor to rule the
imperfect out, per the #611/#619 rule) and draws 2–3 reasoning about `puedo`
as a live alternative — despite the cured draft carrying no
`acceptableAnswers` field at all — because the point's own form-contrast
logic treats both constructions as part of the answer space independent of
the gloss. Pre-existing form-contrast and tense-determinacy rules fired
independently of the gloss-consistency work; this is recorded as a
test-design error in choosing the control, not a rule defect.

### Run 3 — real production rows, the actual over-flag test ($0.1166)

Three rows from the spec's "Legitimate — no action" table (lines 260–280 of
the design doc) — the collapse audit had already judged these legitimate
independently of this branch:

| Case | Draw 1 | Draw 2 | Draw 3 | Verdict |
|---|---|---|---|---|
| `de-a2-two-way-prepositions-core` — `aufs`/`auf das` contraction (expect `false`) | `false` q0.85 | `false` q0.85 | `false` q0.85 | **3/3 false — PASS** |
| `tr-a2-ability-necessity` — `konuşamıyorum`/`konuşamam` (expect `false`) | `false` q0.85 | `false` q0.85 | `false` q0.85 | **3/3 false — PASS** |
| `tr-a2-causal-connectors` — `bu yüzden`/`bu sebeple` (expect `false`) | `false` q0.85 | `false` q0.90 | `false` q0.90 | **3/3 false — PASS** |

All 9 draws: `ambiguous: false`, `flaggedReasons: []`. Nine of nine clean on
real production content the audit had already judged legitimate — the
amended rule does not over-flag.

### Gate assessment

Combined across all three runs: the amended gloss-consistency rule catches
contradictions (Run 1/2 case 1, 6/6 true), catches spoiler glosses (Run 2
spoiler-gloss, 3/3 true), and leaves genuine alternants on real production
data alone (Run 3, 9/9 false). **Gate passed** — clear to push the amended
template to Langfuse.

### Cost

| Run | Cost |
|---|---:|
| Run 1 (original rule, 3 cases) | $0.1092 |
| Run 2 (post-amendment, 3 cases) | $0.1358 |
| Run 3 (real prod rows, 3 cases) | $0.1166 |
| **Validator total** | **$0.3616** |

## What this does not cover

Run 1's probe surfaced a second finding, `contextSpoilsAnswer`: the
validator judged that a gloss can *give away* a lexical-choice answer (the
antonym case — "The park is near the school." — also tripped this flag,
since the gloss itself names `cerca`). The generation prompt's own anti-leak
rule already forbids a `glossEn` that reveals the target ("nothing in the
visible `sentence`, `glossEn`, or `instructions` may let the learner write
the blank without engaging the grammar point"), but the validator could not
enforce it while it was blind to the field. This finding is **recorded, not
fixed**, by this branch.

Its potential population is far larger than the 20 contradictions this
branch addresses: 1,570 approved cloze rows carry a `glossEn` at all,
concentrated at TR A1 (464) and ES A1 (297), with the remainder spread across
TR A2 (289), ES A2 (265), DE A2 (128), DE A1 (84), and a long tail at
B1/B2 where the generator is told to omit the gloss. None of these rows have
been checked for the spoiler pattern specifically — only the 20 contradicting
rows identified by the spec's manual audit were in scope here.

## Cumulative verification spend

| Task | What | Cost |
|---|---|---:|
| Task 4 | Evaluator live A/B (2 items) | $0.0374 |
| Task 5, Run 1 | Validator probe, original rule | $0.1092 |
| Task 5, Run 2 | Validator probe, post-amendment | $0.1358 |
| Task 5, Run 3 | Validator probe, real prod rows | $0.1166 |
| **Total** | | **$0.3990** |

Tasks 1–3 (prompt/template edits, unit tests) made no Anthropic API calls.
