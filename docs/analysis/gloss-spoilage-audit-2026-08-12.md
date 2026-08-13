# Gloss-spoilage sweep — findings (2026-08-12)

First run of `pnpm audit:gloss` against production. Read-only; no pool writes.

**Headline: 86 of 1,512 glossed cloze rows carry a gloss that gives the answer
away.** 54 are a parenthetical to delete. **32 cannot be fixed by editing the
gloss** — and for two grammar points the problem is the gloss policy itself, not
the individual rows.

---

## What was run

```
pnpm audit:gloss --max-cost-usd 8 --out prod-gloss-2026-08-12
```

Prod (`twilight-smoke-01114337` / `br-green-waterfall-ancrvpr5`),
prompt `gloss-spoilage@2026-08-12`, **cost $3.32, not capped**.
Artifacts: `packages/ai/audit-runs/prod-gloss-2026-08-12.{json,md}` (gitignored;
the JSON carries every per-row verdict, reasoning and proposed gloss).

| | |
|---|---:|
| Approved cloze rows with a `glossEn` key | 1,568 |
| — of which usable (non-empty string) | **1,512** |
| — skipped: `glossEn` present but empty string | **56** |
| Grammar points triaged (1 call each) | 144 |
| Points **excluded** by triage | **109** (76%) |
| Rows selected for row-level judgement | 509 |
| Rows actually judged | **502** (7 failed — see below) |

### The two-signal design paid for itself

Triage excluded 109 of 144 points, which is why this cost $3.32 rather than the
~$15 a blanket re-judgement of all 1,512 rows would have. The exclusions are
argued from English/L2 structural mismatch, not guessed — e.g. `tr-a1-degil`
(30 rows, high confidence):

> "English nominal negation ('is not', 'am not') is a single construction with no
> structural parallel to the Turkish değil/yok distinction or the
> placement/agreement rules being tested, so the English gloss cannot [reveal it]"

**And the second signal caught what point-level triage alone would have missed.**
`tr-a2-mis-evidential` was *excluded* (25 rows) — yet it produced **17 spoiled
findings**, the most of any point, because its parenthetical rows are judged
regardless of their point's verdict. Its glosses say things like "(I was told)"
and "(You heard about it, didn't see it.)", which is exactly the evidential
meaning `-miş` encodes. A point-triage-only sweep would have reported zero here.

---

## Findings

| Verdict | Rows |
|---|---:|
| legitimate | 414 |
| **spoiled** | **86** |
| borderline | 2 |

By language: TR 45, ES 36, DE 5.

### Class A — a parenthetical to delete (54 rows, `loadBearing: false`)

The offending span is an add-on; removing it leaves the gloss intact and the
sentence still forces the reading. These are data edits.

| Point | Spoiled | Example gloss → offending span |
|---|---:|---|
| `tr-a2-mis-evidential` | 16 of 17 | "My friend really liked that museum **(I was told)**." → `beğenmiş` |
| `es-a2-saber-poder-ability` | 4 of 9 | "I can't **(don't know how to)** use a computer well." → `sé` |
| `es-a1-demonstratives` | 3 of 6 | (deictic-distance parentheticals) |
| `es-a1-ser-estar-basic` | 4 | "(a current condition)" / "(right now)" / "(temporary feeling)" |

### Class B — the leak is in the sentence, not a parenthetical (32 rows, `loadBearing: true`)

Deleting nothing helps: the gloss's own wording names the answer, so these need
the gloss rewritten or the exercise reworked. **Authoring work, not data edits.**

| Point | Load-bearing | Why |
|---|---:|---|
| `tr-a1-numbers-ordinals` | **10 of 10** | English ordinals *are* the answer: "our room is on **the fifth floor**" → `beşinci` |
| `es-a2-saber-poder-ability` | 5 of 9 | "Do you **know how to** play the guitar?" → `Sabes` |
| `tr-a1-accusative-definite-object` | 3 | definiteness stated where the sentence already forces it |
| `es-a1-demonstratives` | 3 | proximal/distal named in prose |
| `es-a2-ir-a-future`, `es-b1-aspectual-periphrases` | 2 each | |
| 7 further points | 1 each | |

### The finding worth more than the row list

For two points, **any faithful English gloss names the answer**, because English
lexicalises what the L2 grammaticalises:

- **`tr-a1-numbers-ordinals` — 10 of 10 spoiled rows are load-bearing.** An
  English ordinal ("the fifth floor") is a direct translation of `beşinci`. The
  tool's own proposals resort to "floor five" / "floor 5", i.e. rewriting to a
  cardinal to dodge the word — which changes the English rather than fixing the
  exercise.
- **`es-a2-saber-poder-ability` — 5 of 9 load-bearing.** English distinguishes
  "know how to" (saber) from "can" (poder) lexically. A gloss faithful to the
  meaning names the verb; a gloss that says only "can" removes the distinction the
  blank tests and leaves it ambiguous. One proposal does exactly that.

So for these points the right fix is **not to gloss them at all** and to force the
reading in-sentence instead — a change to generation policy, not a data repair.
That is direct evidence for the question the design spec logged as out of scope:
the A1–A2 gloss mandate is too broad, and specifically wrong for lexical-choice
points where English marks the distinction.

### Borderline (2)

`tr-a2-enumerator-tane` "I bought five **(pieces of)** bread" and
`tr-a1-demonstratives` "This **(place)** is my school". Both parentheticals sit
between a vocabulary aid and a structural hint. Left unresolved deliberately.

---

## What this run does **not** cover

- **7 rows were selected but never judged**, all with the same cause: the model
  returned `loadBearing: true` with `proposedGloss: null`, which the parser
  rejects (a load-bearing gloss cannot simply be deleted). The rule is right, but
  rejecting the whole verdict turns "the model could not propose a replacement"
  into *no finding at all* — the signal is lost rather than degraded. Six of the
  seven are `es-a1-coordination-basic`, one `de-a1-personal-pronouns`. Accepting
  such a verdict as `borderline` would preserve it; recorded as a follow-up.
- **1,003 rows in excluded points with no parenthetical were never judged.** That
  is the deliberate design trade: a spoiled row inside an excluded point is caught
  only if it has a parenthetical. The full excluded-point list with per-point
  reasoning and confidence is in the JSON, so any point can be revisited cheaply.
  Nine exclusions were `medium` confidence rather than `high` — those are the
  first place to look if this is ever re-run.
- **The 56 empty-string glosses** (`glossEn: ""`) were skipped, not judged. They
  are not a spoilage risk, but a field written empty rather than omitted is a
  small data-quality defect worth a separate cleanup.
- **Judgement is a nondeterministic LLM call at n=1 per row.** The gate measured
  the judge at n=3 on 11 held-out cases (precision 1.00, recall 1.00), but each
  sweep verdict here is a single draw. Any row acted on individually should be
  re-checked; the counts are reliable in aggregate, not per-row.

## Trust in the judge

The gate that authorises these verdicts is documented in
`.superpowers/sdd/2026-08-12-gloss-spoilage-audit/task-5-report.md`. Its history
matters, because the first version of it was invalid:

| Gate run | Result | What it established |
|---|---|---|
| 1 | 1.00 / 1.00 | **Invalid** — all 10 fixture cases' glosses or spans were embedded in the judge's own prompt as worked examples |
| 2 | 0.83 / 1.00 | On genuinely held-out rows. The gap from run 1 is the contamination effect, measured |
| re-score | 1.00 / 1.00 | The one false positive was a mislabel by the plan author, not a judge error; corrected with the reasoning recorded in the fixture |
| 4 | **1.00 / 1.00** | 11 held-out cases including a control for the *sanctioned* definiteness gloss, which the judge correctly left alone |

Total spend validating the judge: ~$0.70. The contamination was caught by an
implementer, not by the plan or its reviews.

## Recommended next steps, in order

1. **Repair the 54 Class A rows** — delete the offending span via targeted
   `content_json` writes, per-row rollback captured first, `review_status` /
   `demotion_reason` / mastery untouched. This is the same shape as the 19-row
   repair in #639, which worked.
2. **Decide the generation-policy question for `tr-a1-numbers-ordinals` and
   `es-a2-saber-poder-ability`** before touching their rows. Editing individual
   glosses there treats a symptom.
3. **Leave the remaining Class B rows** until 2 is settled — they need authoring,
   and the tool's proposed glosses for them are suggestions, not fixes.
4. Optionally re-run with the 7 failed rows handled as `borderline`, and revisit
   the nine `medium`-confidence exclusions.
