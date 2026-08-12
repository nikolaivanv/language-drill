# Gloss-spoilage audit (`pnpm audit:gloss`) — Design

**Date:** 2026-08-12
**Branch:** `fix/gloss-spoilage-audit`
**Status:** approved (design), pending implementation plan
**Precursor:** PR #639 made the validator able to see `glossEn` and flag
`contextSpoilsAnswer` on new drafts. This audit finds the pattern in the
**existing** pool, which that rule cannot reach.

---

## Background

A cloze `glossEn` is an English gloss of the sentence's meaning, shown to the
learner (`apps/web/components/drill/cloze-prompt.tsx:112`). The generator is
instructed to add one at CEFR A1–A2 as a disambiguation device — a way to force a
reading that a short L2 sentence cannot force on its own.

The generation prompt already forbids a gloss that gives the answer away:

> **Do not leak the answer in the visible text (anti-leak).** … nothing in the
> visible `sentence`, `glossEn`, or `instructions` may let the learner write the
> blank without engaging the grammar point.

That rule was **unenforceable** until #639, because neither the validator nor the
evaluator was shown the field. During #639's verification the validator — newly
able to see the gloss — independently flagged a production row:

> "The gloss 'The park is near the school.' directly states the meaning 'near',
> giving away that the answer is 'cerca'. The learner can write the answer
> without engaging with the blank at all."

`contextSpoilsAnswer` is a **veto** in `routeValidationResult`
(`validation-prompts.ts:129`: "any cultural issue OR contextSpoilsAnswer →
REJECTED (dropped, not stored)"), so the rule now blocks such drafts at
generation time. It does nothing about rows already approved.

**1,568 approved cloze rows carry a gloss**, measured 2026-08-12:

| | A1 | A2 | B1 | B2 | total |
|---|---:|---:|---:|---:|---:|
| TR | 464 | 289 | 4 | — | 757 |
| ES | 297 | 265 | 16 | 7 | 585 |
| DE | 83 | 127 | 9 | 7 | 226 |
| **total** | 844 | 681 | 29 | 14 | **1,568** |

This reconciles with the 1,570 in #639's record: DE A1 went 84 → 83 and DE A2
128 → 127, which are exactly the two Class B rows whose over-specified gloss that
repair dropped.

The **43-row B1/B2 tail** (29 + 14) exists because the generator is told to
populate the gloss for A1–A2 only; those rows predate or ignore that instruction.

---

## The insight that scopes the work

**Most glossed rows cannot be spoiled, and this is provable without an LLM.**
Spoilage requires *both* a gloss that encodes the tested distinction *and* a
distinction English actually marks. Sampled production rows show how often the
second condition fails:

| Point | Gloss | Answer | Spoiled? |
|---|---|---|---|
| `es-a1-ser-estar-basic` | "The coffee **is** on the table." | `está` | **No** — English "is" collapses ser/estar |
| `es-a2-por-para` | (glosses render both as "for") | `por`/`para` | **No** |
| `tr-a1-possessive-suffixes` | "**my** friend" | `arkadaşım` | **No** — the gloss gives the possessor; the tested skill is the harmonised suffix |
| `tr-a1-accusative-definite-object` | "I drink **the** coffee" | `kahveyi` | **No** — this is the generator's *intended* cue, documented in the generation prompt |
| `es-a1-locative-prepositions` | "The park is **near** the school." | `cerca` | **Yes** — English marks near/far |
| `es-a1-demonstratives` | "that tree **(far away)**" | `aquel` | **Yes** — names the deictic distance that *is* the distinction |

So the population needing row-level judgement is far smaller than 1,568. Two
signals find it.

### Signal 1 — parenthetical rule-hints

Only **125** glossed rows contain a parenthetical at all. Parentheticals split
into two kinds, and the split is exactly the anti-leak rule's own line:

**Legitimate** — supplies *meaning* the learner must still convert into a form:

| Gloss | Answer | Why it is fine |
|---|---|---|
| "The book belongs to the teacher **(female)**." | `der` | Gender given; the learner still supplies the dative form |
| "**Could you (formal)** please tell me…" | `Könnten` | Register given; the form is the tested skill |
| "Do you **(all)** see each other every day…" | `euch` | Addressee number given; the reflexive form is not |
| "I have two Spanish friends **(female)**…" | `españolas` | Gender given; the agreement is the skill |

**Spoilers** — state the rule *trigger or outcome*:

| Gloss | Answer | What it leaks |
|---|---|---|
| "Today the weather is very bad. **(a current condition)**" | `está` | Names estar's trigger |
| "It is without salt **(right now)**." | `Está` | Same |
| "She is very happy today. **(temporary feeling)**" | `Está` | Same |
| "This building is very old **(it has always been old — it's ancient)**." | `es` | Names ser's trigger |
| "The paper is **(located)** on the table." | `está` | Names estar's semantic role |
| "My sister is **(standing/sitting)** next to the window." | `está` | Same |
| "Do you see that tree **(far away)** over there?" | `aquel` | Names the deictic distance |
| "That dog over there **(far away)** is very big." | `Aquel` | Same |
| "This lady **(near me)** is very kind." | `Esta` | Same |
| "I like tomatoes **(tomatoes in general)**." | `los` | Names the generic trigger for the definite article |

A parenthetical can spoil even inside a point where English is otherwise neutral
— `(a current condition)` on a `ser`/`estar` blank is the proof — so **all 125 are
judged regardless of their point's triage verdict**.

### Signal 2 — points where English encodes the distinction

One triage call per glossed grammar point (~70 points) answers a single question:
does English encode the distinction this blank tests? A "no" excludes every row
in that point from row-level judgement, with the reasoning recorded. A "yes" sends
that point's rows to row-level judgement.

This is where the cost saving lives, and it is also the design's main risk: a
spoiled row inside a "no" point is caught only if it has a parenthetical. That
trade is accepted deliberately — the alternative is 1,568 row-level calls — and
the excluded points are listed in the report so a later pass can revisit any of
them cheaply.

---

## Components

### `packages/ai/src/gloss-spoilage.ts`

Modelled directly on `packages/ai/src/collapse-triage.ts`: an **in-repo** prompt
(not registered in Langfuse — a dev-time aid run by a human, exactly like the
collapse triage), its own version constant, a forced tool call, and typed
verdicts.

```ts
export const GLOSS_SPOILAGE_PROMPT_VERSION = 'gloss-spoilage@2026-08-12';
export const GLOSS_SPOILAGE_TOOL_NAME = 'report_gloss_verdict';
export const GLOSS_SPOILAGE_MODEL = 'claude-sonnet-4-6';

/** Signal 2: does English mark the distinction this point's blanks test? */
export type PointTriageVerdict = {
  englishEncodesDistinction: boolean;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
};

/** Row-level judgement. */
export type GlossVerdict = {
  verdict: 'spoiled' | 'legitimate' | 'borderline';
  /** The exact substring that leaks, or null when nothing does. */
  offendingSpan: string | null;
  /** The gloss as it should read, or null to drop the gloss entirely. */
  proposedGloss: string | null;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
};

export async function triageGlossPoint(client, input): Promise<PointTriageVerdict>;
export async function judgeGlossRow(client, input): Promise<GlossVerdict>;
```

The prompt states the distinction verbatim from the anti-leak rule: a gloss may
convey **meaning** the learner converts into a form; it may not state the rule
**trigger or outcome**. It carries the legitimate/spoiler examples above as
few-shot anchors, since the line between them is the whole judgement.

### `packages/ai/scripts/audit-gloss.ts`

A read-only author-run CLI in the `audit:collapse` / `qa:sample` family. Loads
glossed approved cloze rows, runs Signal 2 per point, then Signal 1 + surviving
points' rows through `judgeGlossRow`, and writes JSON + markdown to
`./audit-runs/<name>.{json,md}`.

Flags: `--language`, `--cefr`, `--grammar-point`, `--limit`, `--max-cost-usd`,
`--out`, `--dry-run`. Registered as `audit:gloss` in `packages/ai/package.json`
and the root `package.json`, with the `dotenv -e .env` prefix its sibling DB CLIs
use.

**Never writes to the pool.** Detection and remedy stay separate: the report
carries a `proposedGloss` per spoiled row, and the repair is a reviewed second
step.

### Tests

`packages/ai/scripts/audit-gloss.test.ts` and
`packages/ai/src/gloss-spoilage.test.ts` cover the pure functions — argument
parsing, the parenthetical extractor, the point-exclusion logic (a "no" verdict
must exclude that point's non-parenthetical rows and retain its parenthetical
ones), and cost accumulation. The LLM calls are stubbed; no test spends budget.

---

## Verification

The judgement is the deliverable, so it is verified against known answers before
any of its verdicts are trusted.

A committed fixture, `packages/ai/scripts/fixtures/gloss-spoilage-cases.json`,
holds **10 real production rows** from the tables above — 6 known spoilers
(`(a current condition)`, `(right now)`, `(temporary feeling)`, `(located)`,
`(far away)`, `(tomatoes in general)`) and 4 known-legitimate
(`(female)` ×2, `(formal)`, `(all)`). A `--check-fixture` mode runs the row judge
over them and reports precision and recall.

**Gate: all 6 spoilers flagged and all 4 legitimate rows passed**, on 3 draws each
(30 calls, ~$0.30). Anything less and the sweep is not trusted — a false positive
here means trimming a gloss that was doing real disambiguation work, which
silently makes an exercise ambiguous. Nondeterminism is measured rather than
assumed, per the n≥10 lesson recorded in
`docs/analysis/qa-sample-findings-2026-08-11.md`.

Signal 2 is spot-checked the same way: `es-a1-ser-estar-basic` must come back
`englishEncodesDistinction: false` and `es-a1-demonstratives` `true`.

## Cost

| Stage | Calls | Est. |
|---|---:|---:|
| Fixture gate | 30 | ~$0.30 |
| Signal 2 point triage (~70 points) | ~70 | ~$0.70 |
| Signal 1 + surviving rows | ~150–250 | ~$1.50–2.50 |
| **Total** | | **~$2.50–3.50** |

A full `revalidate:cloze` over all 1,568 rows would cost ~$15–30 **and** demote
every flagged row (`contextSpoilsAnswer` is a rejection veto) while nightly
generation is paused in prod (#615) — shrinking cells with nothing to refill them.
That is why this is a separate read-only audit rather than a revalidation pass.

## Remedy — out of scope here, shaped for the follow-up

Confirmed spoilers are repaired by **trimming the gloss**, not by demotion: drop
the offending parenthetical, or drop the whole gloss where it is not load-bearing.
This keeps pool size intact while generation is paused and leaves the row valid,
since the sentence still tests the point. It is the same shape as #639's 19-row
repair: per-row rollback captured first, targeted `content_json` writes,
`review_status` / `demotion_reason` / mastery untouched.

Two cases need care in that follow-up and are flagged now:

- **A load-bearing gloss cannot simply be trimmed.** Where the parenthetical is
  the only thing forcing the reading, removing it makes the blank ambiguous —
  trading a spoiled exercise for an underdetermined one. Such rows need the
  sentence strengthened instead, which is authoring work, not a data edit. The
  report must distinguish these, so `judgeGlossRow` returns
  `proposedGloss: null` only when dropping is genuinely safe.
- **The 43-row B1/B2 tail** carries a gloss the generator is told not to
  produce above A2. Dropping it there is likely right on policy grounds alone,
  independent of spoilage.

## Out of scope, recorded

- **Changing generation policy on when to emit a gloss.** The Class B rows in
  #639 (a gloss over-specifying a FORM point) hint the A1–A2 mandate is too broad,
  but that is a curriculum decision with its own evidence needs.
- **Non-cloze types.** `glossEn` is a `ClozeContent` field; nothing else carries it.
- **Dev-branch pool.** The audit reads whichever `DATABASE_URL` it is given; the
  intended target is prod.
