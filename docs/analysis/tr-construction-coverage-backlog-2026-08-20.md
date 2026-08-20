# TR construction-coverage backlog — 2026-08-20

The TR counterpart of `es-construction-coverage-backlog-2026-08-19.md`. Generated
from `pnpm audit:constructions --language TR`, run against **production** in
per-CEFR chunks (`tr-a1-` / `tr-a2-` / `tr-b1-` / `tr-b2-2026-08-20` in
`packages/ai/audit-runs/`), prompt `construction-coverage@2026-08-18`, seed
`default`, sample cap 24.

Scope on prod: **89 grammar points**, 142 cloze/translation cells, 4,646 approved
rows, plus 778 approved `sentence_construction` rows across 16 cells that the
audit does not read at all (`IN_SCOPE_TYPES` is cloze + translation).

## Why this is not a replay of the ES sequence

Three things differ, and all three were found by checking the audit's output
against the pool rather than by trusting it.

### 1. The audit is `coverageSpec`-blind

`enumeratePointConstructions` reads a point's *description* and never consults
its `coverageSpec`. **38 of 89 TR grammar points carry a spec** (ES had far
fewer), so a large fraction of TR findings are constructions an axis already
owns — and acting on them would undo work that spec was added to do.

The sharpest case is `tr-a1-vowel-harmony`. Its `case` spec
(accusative/dative/ablative) was added after the 2026-07-17 audit found the
translation pool **43/43** "X-lar ve Y-ler" plural pairs. The pool now reads
accusative 5 / dative 7 / ablative 6 / **plural 0** — the spec working exactly as
designed. The 2026-08-20 audit reports `2-way-harmony-plural` at 0/19 and
proposes declaring it a must-represent variant, which would push the pool back
into the collapse the spec fixed. It also proposes `2-way-harmony-locative`,
which `VALIDATION_SYSTEM_PROMPT_TEMPLATE` names as its **worked example of a
draft to reject** on this very point (and whose floor was deliberately removed in
#660).

### 2. Declaring both mechanisms sends two MUSTs into one prompt

There is **no guard** between them. `scheduler.ts` attaches `coverageTargets`
whenever `cell.grammarPoint.coverageSpec` exists, with no check for variant
seeding; `buildUserPrompt` then renders `renderCoverageBlock(...)` and the
variant's "This exercise MUST target the following sub-construction" into the
same draft prompt. On a point where the two speak to the *same* dimension the
draft is asked for contradictory things.

This is why **all five pre-existing TR variant points carry no `coverageSpec`** —
`tr-a2-gibi-kadar`, `tr-a2-causal-connectors`, `tr-a2-reported-speech`,
`tr-a2-adversative-connectors`, `tr-b1-olarak`. The #631 authors avoided the
overlap rather than resolving it.

The ES resolution (#677: delete the spec, let variants own the axis) **does not
generalize to TR**, because many TR spec'd points are `conjugationSuitable` and
their *conjugation* cell seeds from that axis — variants only reach
cloze/translation/SC. Removing the `case` spec from `tr-a1-ablative-dative`
tripped `curriculum.test.ts` ("conjugationSuitable point must have person, case,
or number axis") immediately.

**Working rule adopted here:**

| spec axis | vs. sub-construction variants | action |
|---|---|---|
| `person`, `polarity` | orthogonal — a draft can be both "2sg" and "fixed-case dative verb" | author alongside, keep the spec |
| `case`, `number`, `comparison` | often *is* the dimension the variants encode | check per point; defer if the spec is load-bearing |

### 3. Per-axis floors cannot express a cross-axis requirement

`tr-a1-imperative` is the proof, and the audit found it without understanding it.
Its pool is **10 rows of 2sg+affirmative and 10 rows of 2pl+negative, and nothing
else**, in both cells. Every floor is satisfied — 2sg 10≥8, 2pl 10≥8, affirmative
10≥10, negative 10≥8 — because `decideCoverageTargets` water-fills each axis
*independently*. A pool covering only the diagonal of the 2×2 grid passes
completely while the learner never sees `Gelin!` or `Gelme!`. No floor value
would have caught it.

Here person and polarity genuinely *are* the morphological axes of the
imperative, and the point is not `conjugationSuitable`, so the ES resolution
applies: the spec is removed and the four cells of the grid become four variants.

## A1 — done

27 of 28 points enumerated · **33 findings over 20 points** · $1.53.
**14 authored, 6 rejected or deferred.**

### Authored

| point | what the pool showed |
|---|---|
| `tr-a1-negation` | 24/24 in BOTH cells are the `-mIyor` fusion; negative past `-mAdI` 0, all three time adverbs 0 |
| `tr-a1-plural-suffix` | 24/24 translation and 20/20 cloze are the plain affix; both OMISSION constructions (after a numeral, after a quantifier) 0, each owning a commonError |
| `tr-a1-present-continuous` | 16 consonant-final + 8 low-vowel-raising = the whole cell; the t→d voicing stems (git-, et-) 0, habitual 0 |
| `tr-a1-imperative` | the 2×2 diagonal described above; 2pl-positive and 2sg-negative both 0 |
| `tr-a1-questions` | 17/19 are mI on a nominal predicate; the `-DI`-past frame (person stays on the verb, mI bare) 0, focus-mI 0, WH 0/17 in cloze |
| `tr-a1-degil` | contrastive 9 and noun-predicate 7 of 24; the LOCATIVE predicate the description names is 1, adjective 2 |
| `tr-a1-var-yok` | existential 14, possessive 6; past `vardı/yoktu` 0 in both cells |
| `tr-a1-accusative-definite-object` | 19/19 definite common-noun objects; the unmarked indefinite, the proper name and the pronoun all 0 — two of them own commonErrors |
| `tr-a1-genitive-possessive` | 17/20 the bare frame; possessive-with-`var` — how Turkish says "he has a car" — 0 in both cells |
| `tr-a1-instrumental-ile` | 11 consonant-stem + 8 vowel-buffer; the pronoun frame (genitive stem first: *benimle*) 1 |
| `tr-a1-ki-relativizer` | 20/20 the locative modifier; standalone `benimki` 0 and the `dünkü/bugünkü` harmony exception 0 |
| `tr-a1-postpositions-once-sonra` | 18/20 noun+ablative; the bare time-span "ago/later" reading 0 |
| `tr-a1-beri-dir` | `-DIr` 12 and `-DEn beri` + named point 8; `-DEn beri` + measured span 0 — the overlap the point exists to teach |
| `tr-a1-clock-time-dates` | both DATE constructions 0 in both cells, on a point called "Clock time and **dates**"; cloze also 0 for geçe and kala |

Every affected cell resolves to a target already in the `admin.test.ts`
allow-list (A1 20, or 24 where six variants raise the floor) — verified by
resolving `resolveCellTargetFor` over the curriculum, not by arithmetic.

### Rejected or deferred, with reasons

| point | why |
|---|---|
| `tr-a1-vowel-harmony` | the `case` spec owns it and is working; the proposal would regress the July fix and re-request a draft class the validator is told to reject (see above) |
| `tr-a1-possessive-suffixes` | **classifier artifact.** Audit reports `poss-3sg` 0/24; `coverage_tags` on prod show 4 rows, with every person value present. No gap |
| `tr-a1-personal-suffixes` | real but thin (3sg 1 of 28 translation, floor 5) and owned by the existing `person` spec, which regeneration will chase. Also note 3sg copular is **Ø** — an unrealizable-floor risk of the `de-b1-n-declension` kind |
| `tr-a1-ablative-dative` | **blocked.** Its variants are all case-implying, but the point is `conjugationSuitable` so the `case` spec cannot be removed. Needs per-type coverage scoping, or a conjugation-only axis, before it can be authored |
| `tr-a1-dili-past` | its only non-colliding construction is the question form; a one-variant list would pin 100% of drafts to it. Affirmative/negative would collide with the existing `polarity` axis |
| `tr-a1-demonstratives` | the gap is the standalone nominative *pronoun*, hidden inside a `nominative` floor that determiners and `burası` satisfy. A variant list would contend with the `case` spec that fixed this point's own 40/40 collapse in July |

### Not clean findings

- `tr-a1-numbers-ordinals` — **enumeration fault**, both attempts (`id
  'ordinal-suffix-incI' must be kebab-case`). Never examined; needs a re-run.
- `tr-a1-personal-pronouns` — both cells `enumeration-suspect` (>33% unresolved),
  so no finding was raised. Correct behaviour; the construction list was wrong.
- Thin cells skipped: `tr-a1-beri-dir:cloze` (1 row), `tr-a1-stem-changes:cloze`
  (1 row, and the point is `clozeUnsuitable`).

## A2 / B1 / B2 — pending

A2 returned **24 findings** ($1.54) and is triaged next. B1 and B2 are running.

## Operational note

The first attempt at a single full-language sweep **hung**: 79 minutes elapsed,
6s of CPU, two established HTTPS sockets, and — because the CLI logs nothing
between startup and its final summary, and writes its report only at the end —
zero output and no artifact. Re-running per CEFR level made each chunk ~25
minutes and independently recoverable. Worth a progress line in the CLI.
