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

### 3. `decideCoverageTargets` can only ever request `lcm(m, n)` of `m × n` combinations

**This is a live bug in the coverage controller, found via two of the findings
below. It is not construction-variant work and is not fixed here.**

`decideCoverageTargets` builds an independent water-filled sequence per axis and
then zips them **index-wise**:

```ts
for (let i = 0; i < need; i++) {
  const target: CoverageTarget = {};
  for (const axis of activeAxes) target[axis] = perAxisSeq[axis]![i];
  coverageTargets.push(target);
}
```

Water-filling makes each sequence cycle through its own values in order, so the
zip only ever emits `lcm(m, n)` of the `m × n` combinations. For **two 2-value
axes that is 2 of 4** — a hard diagonal the pool can never escape, no matter how
many rows are generated or what the floors are set to.

Two TR points are exactly this shape, and both show the signature — suspiciously
*equal* counts on precisely two cells of a 2×2 grid, in both cell types:

| point | axes | prod pool (both cells) | never requested |
|---|---|---|---|
| `tr-a1-imperative` | person(2sg,2pl) × polarity(aff,neg) | 2sg+aff **10**, 2pl+neg **10** | `Gelin!` (2pl positive), `Gelme!` (2sg negative) |
| `tr-a2-optative` | person(1sg,1pl) × polarity(aff,neg) | 1sg+aff **15**, 1pl+neg **15** | 1pl positive (`gidelim`), 1sg negative |

Every floor on both points is satisfied. The learner never sees half the
paradigm.

It is not limited to 2×2. At 6×2 the zip reaches only 6 of 12 combinations, and
`tr-a1-future` confirms the prediction: its five dominant cells are exactly the
parity diagonal (1sg-aff 5, 2sg-neg 5, 3sg-aff 5, 1pl-neg 4, 2pl-aff 4, 3pl-neg
5) with just 2 stray rows off it, phase drift across batches accounting for
those. `tr-a1-dili-past` is more mixed for the same reason — differing floors and
`need` values across many batches shift the phase.

**24 of the 38 spec'd TR points carry two or more axes**, so this is not
marginal. A fix would enumerate the cartesian product and water-fill over
*combinations* when the axes are small enough, rather than zipping independent
per-axis sequences. Worth its own PR and its own review.

For `tr-a1-imperative` and `tr-a2-optative` the variant mechanism routes around
it — person and polarity genuinely *are* those points' morphological axes, and
neither point is `conjugationSuitable`, so the ES resolution applies: the spec
comes off and the cells of the grid become variants, each a per-draft MUST.

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

## A2 — done

28 of 28 points enumerated, a clean run — 0 enumeration errors, 0
enumeration-suspect cells · **24 findings over 18 points** · $1.54.
**13 authored, 1 topped up, 1 rejected, 2 repass-only.**

### Authored

| point | what the pool showed |
|---|---|
| `tr-a2-clitics-da-bile` | 22/24 scalar `bile`; the additive `dA` the point is named for is 1, the `X dA Y dA` enumerative 0 |
| `tr-a2-converbs` | `-mAdAn` 14 + `-(y)Ip` 10 = the whole cell; `-(y)ArAk` and `-(y)A…-(y)A`, both in the title, 0 |
| `tr-a2-correlative-conjunctions` | `ne…ne` 17, `ya…ya` 7; `hem…hem` and `ister…ister` both 0 |
| `tr-a2-distributive` | 24/24 the plain "… each"; the reduplicated "X by X" 0 |
| `tr-a2-enumerator-tane` | 24/24 numeral+tane+noun; `kaç tane` 0, and the OPTIONALITY of tane 0 |
| `tr-a2-indefinite-pronouns` | `herkes` 12 + NPIs 12 = the whole cell; existential `biri(si)` 0, case-inflected `hepsi` 0 |
| `tr-a2-nominalization` | 23/24 the `-mAk` infinitive; the different-subject `-mA`+possessive is 1, `-(y)Iş` 0 |
| `tr-a2-past-copula` | 24/24 `-(y)DI`; `vardı/yoktu` 0 and evidential `-(y)mIş` — half the title — 0 |
| `tr-a2-purpose-icin-uzere` | 24/24 `-mAk için`; negative purpose, different-subject `-mAsI için`, and both senses of `-mAk üzere` all 0 |
| `tr-a2-relative-an` | positive 14 + negative 10 = the whole cell; suppletive `olan` 0 and headless `-(y)An` 0 |
| `tr-a2-ability-necessity` | necessity `-mAlI` 20 of 24; the ABILITY half the title names first is 2 positive / 1 negative, lexical `lazım/gerek` 0 |
| `tr-a2-ca-suffix` | 21/24 the manner adverb; the language-name adverbial — half the title — is 1 |
| `tr-a2-mis-evidential` | 22/23 the verbal `-mIş`; the copular `-(y)mIş` is 1 |

### Topped up

`tr-a2-gibi-kadar` already declared four variants; the `o kadar / öyle … ki`
result frame was **0/24 in both cells** and undeclared, though it sits in the
point's own `examplesPositive`. Added as a fifth. The audit also reported
`-mIş gibi` at 0, which the existing curriculum comment already documents as
**deliberately excluded** — it has its own B2 point (`tr-b2-as-if-gibi`) listing
this one as a prerequisite. No change there.

### Two more `coverageSpec`s removed

Both were added 2026-07-17 and are *currently working*, so removal had to be an
improvement rather than a regression:

- `tr-a2-indefinite-pronouns` (`polarity` 12/12, pool now 12/12) — the NPIs
  require a negative verb **by definition**, so a per-draft "MUST use
  kimse/hiçbiri" and a per-ordinal "target affirmative" contradict each other in
  one prompt. One NPI variant at share 3 of 13 guarantees the negative half more
  directly than the floor did, and six non-NPI variants guarantee the positive
  half the floor was originally added to rescue.
- `tr-a2-relative-an` (`polarity` 18/12, pool now 14/10) — `-(y)An` vs `-mAyAn`
  *is* the polarity axis. The negative variant carries share 3 of 10 to keep
  roughly the 40% weight the floor asked for.

### Rejected

`tr-a2-suffix-order-buffers` — the proposed `-n-`-buffer-before-case variant is a
**property** of any 3sg/3pl possessive + case row, not a member of a disjoint
axis, and it would collide with both the `person` and `case` axes the point
already carries.

### Repass-only (bucket C)

`tr-a2-adversative-connectors` (`ancak/yalnız` at 1/24) and
`tr-a2-causal-connectors` (clause-final `çünkü` at 1/24) both **already declare**
the construction the audit flagged. Their pools predate the declaration, so they
need only the label + demote repass — no authoring.

### Rejections carried across both batches

Running total, by class: non-disjoint properties (`-n-` buffer, `-y-` buffer,
`-s-` buffer, bare-converb, same-subject, `saat`-optional, `çeyrek`-adjacent,
`-CA` harmony) · prohibitions no single draft can realize (mass-noun rejection,
"both halves obligatory") · constructions that are the point's *alternatives*
rather than the point itself (bare-adjective adverb, `bir şekilde` periphrasis) ·
and "contrast X with Y" directives that a single-answer exercise cannot express
(`dA` vs locative `-DA`).

## B1 — done

16 of 16 points enumerated, clean run · **12 findings over 9 points** · $0.77.
**8 authored, 1 repass-only.**

| point | what the pool showed |
|---|---|
| `tr-b1-abstract-postpositions` | 15/24 bare noun + postposition; the GENITIVE PRONOUN frame, where the postposition shifts its own possessive (`benim hakkımda`), is 0 in cloze — the point's one real trap |
| `tr-b1-conditional-irrealis` | 21/23 the `-sAydI` counterfactual; `keşke`+`-sA`, copular `-(y)sA`, tensed `-(y)sA`, the deliberative question and the `-sA dA` concessive all 0 or 1 in both cells |
| `tr-b1-participles-dik-acak` | 22/24 `-DIK`+possessive with an explicit head; prospective `-(y)AcAK` — the other half of the title — is 2, headless 0 |
| `tr-b1-passive-voice` | agent `tarafından` 14, plain allomorphy 9; the IMPERSONAL passive on an intransitive (`Burada sigara içilmez`) 0 |
| `tr-b1-reason-digi-icin` | 24/24 `-DIğI için`; future cause `-(y)AcAğI için` 0 in translation, formal `-DIğIndAn` 0 |
| `tr-b1-converb-while-yken` | 17/24 verbal `-ken`; the NOMINAL `-ken` (`çocukken`) is 1, contrastive "whereas" 0 |
| `tr-b1-copula-ol` | thin and lopsided across eight frames; dynamic `ol-` "became" is 1 and existential `ol-` 0 — the contrast the description ends on |
| `tr-b1-obligation-periphrases` | 19/24 `-mAk zorunda`; the mild `-mAm gerek/lazım/şart` end of the scale is 1 |

`tr-b1-olarak` **already declares** the flagged construction
(`derived-adjective-adverb`, measured at 1/24) — repass only, no authoring.

## B2 — done

16 of 17 points enumerated · **7 findings over 6 points** · $0.59.
**6 authored.**

| point | what the pool showed |
|---|---|
| `tr-b2-aspectual-verbs` | 19/24 `-(y)Ip dur-`; `-(y)Iver`, the ONLY fully productive member per the description, is 2 and `-(y)Akal` 0 |
| `tr-b2-compound-evidential-rivayet` | 16/24 `-Iyormuş`; the point claims "the copula on ANY tense base" and the others are 6, 1, 0 |
| `tr-b2-concessive` | 24/24 `-mAsInA rağmen`; BOTH other frames in the title are 0, so the hâlde/rağmen case contrast the point teaches is untested |
| `tr-b2-instead-of` | `-mAktAnsA` 17, `-AcAğInA` 7, `-AcAğI yerde` 0 |
| `tr-b2-reported-directives` | reported NECESSITY — which switches to `-DIK` because it reports a fact, the contrast the description turns on — is 0 |
| `tr-b2-as-if-gibi` | 23/24 `-mIş gibi`; the `-(I)yormuş gibi` ongoing-pretence frame is 1 |

`tr-b2-compound-evidential-rivayet` was routed by the audit to `coverage-spec`,
but its missing items are TENSE BASES — orthogonal to the `person`/`polarity`
spec it carries, which must stay because the point is `conjugationSuitable`. It
is authored as variants with the spec left in place.

**Enumeration fault:** `tr-b2-compound-past-hikaye` was never examined (`id
'past-necessitative-maliydı' must be kebab-case`, both attempts) — the same fault
class as `tr-a1-numbers-ordinals`. Both need a re-run.

## Totals

| level | points enumerated | findings | authored | rejected / deferred | repass-only | cost |
|---|---|---|---|---|---|---|
| A1 | 27 of 28 | 33 over 20 pts | 14 | 6 | 0 | $1.53 |
| A2 | 28 of 28 | 24 over 18 pts | 13 (+1 topped up) | 1 | 2 | $1.54 |
| B1 | 16 of 16 | 12 over 9 pts | 8 | 0 | 1 | $0.77 |
| B2 | 16 of 17 | 7 over 6 pts | 6 | 0 | 0 | $0.59 |
| **total** | **87 of 89** | **76 over 53 pts** | **41 (+1)** | **7** | **3** | **$4.43** |

**46 TR points now declare `constructionVariants`** (5 pre-existing + 41 new).
Every affected cell resolves to a target already in the `admin.test.ts`
allow-list.

Five `coverageSpec`s were removed where the spec and the variants spoke to the
same dimension: `tr-a1-imperative`, `tr-a2-indefinite-pronouns`,
`tr-a2-relative-an` (all three not `conjugationSuitable`). Two more were
attempted and reverted — `tr-a1-ablative-dative` is `conjugationSuitable` and the
invariant test caught it.

## What is NOT done

1. **The prod repass has not run.** Sized read-only against prod 2026-08-20:

   | type | approved rows on variant points | points | already carry a `seedWord` |
   |---|---|---|---|
   | cloze | 885 | 34 | 860 |
   | translation | 1,571 | 46 | 1,505 |
   | sentence_construction | 374 | 8 | **27** |
   | **total** | **2,830** | **46** | 2,392 |

   At the ES run's measured rate (5,432 rows / $7.86 ≈ $0.00145 per row) the
   labelling pass is roughly **$4**. Note the `seedWord` counts are the LEGACY
   frequency-band seeds, not variant ids — `backfill:variant-seeds` overwrites
   them, and the rollback artifact is the only record of the originals, so the
   run must be `--name`d and the artifact archived outside
   `packages/db/backfill-runs/` (gitignored).

   Order, per the ES record: **merge and deploy first**, then `push-prompts`
   verification, then snapshot a Neon branch, then `backfill:variant-seeds`,
   then capture row ids into `docs/analysis/`, then `demote:pool --reason
   pool-hygiene` (never `quality` — that revokes learners' credit). The deploy
   must precede the demotion because the generation Lambda needs the variant
   lists live before headroom is opened. These four batches are unmerged.

2. **The sentence_construction tail is proportionally worse than ES's.** Of the
   374 approved SC rows on variant-declaring points, only **27 carry a
   `seedWord` at all** — 347 are the unlabelled legacy pool. That is precisely
   the input `pickVariantSeeds` reads as "no variant is covered anywhere", whose
   answer is to spread drafts evenly instead of chasing gaps. `seedKindFor` has
   routed SC to variant seeding since #652 and `backfill:variant-seeds` gained
   SC in #687, so the tooling is ready. ES hit this with 2 cells and 148 rows;
   TR has 8 affected cells and 374.
3. **Two points never examined** — `tr-a1-numbers-ordinals` and
   `tr-b2-compound-past-hikaye`, both kebab-case enumeration faults.
4. **`tr-a1-ablative-dative` is blocked** on the spec/variant collision.
5. **The `decideCoverageTargets` zip bug is unfixed** (see above). It is the
   larger finding here and deserves its own PR.
6. **Nothing is verified as an outcome.** As with ES, "pools become diverse" is
   unmeasurable until regeneration resumes — and nightly pre-generation is still
   PAUSED (#672).

## Operational note

The first attempt at a single full-language sweep **hung**: 79 minutes elapsed,
6s of CPU, two established HTTPS sockets, and — because the CLI logs nothing
between startup and its final summary, and writes its report only at the end —
zero output and no artifact. Re-running per CEFR level made each chunk ~25
minutes and independently recoverable. Worth a progress line in the CLI.
