# coverageSpec audit — every spec-less grammar point, triaged (2026-07-17)

_Follow-up to the `tr-a1-imperative` collapse (PR #588): the point shipped
without a coverageSpec and its prod pool converged to 100% affirmative,
~95% bare-stem 2sg — both promised halves of the point (2pl `-(y)In`,
negative `-mA`) untested, caught only by a learner. This audit swept **all
191 grammar points** (TR 72, ES 119; DE curriculum currently disabled) and
triaged every spec-less one, plus checked existing specs for missing axes.
Method + criteria: `docs/curriculum-authoring.md`. Three independent
reviewers (TR / ES A1-A2 / ES B1-B2), verdicts grounded in each entry's own
description/examples/commonErrors text._

**Headline: 26 points need a spec (7 high-confidence), 3 existing specs have
a missing axis, ~90 are legitimately fine without one, 5 stay excluded
(2026-06-12 rotation-eval degradations).**

## Tier 1 — high confidence, collapse actively likely

| key | cefr | proposed axes+floors | why |
|---|---|---|---|
| `es-a1-present-irregular-core` | A1 | person {1sg:5,2sg:5,3sg:5,1pl:5,3pl:5} | Full ser/estar/ir paradigms are the content; the only conjugation-paradigm point in ES A1/A2 with NO spec. Likely wants `conjugationSeedWords: ['ser','estar','ir']` too. |
| `es-a2-imperative-affirmative` | A2 | person {2sg:10, 3sg:8, 3pl:8} | Direct analogue of the TR imperative collapse: tú vs usted/ustedes are different morphologies (imperative vs subjunctive-based). No polarity (negative imperative = separate B1 point). |
| `es-a2-reflexive-verbs` | A2 | person {1sg:5,2sg:5,3sg:5,1pl:5,3pl:5} | me/te/se/nos agreement is the point; commonError `*nos levanta` is a person mismatch. |
| `es-a1-possessives-atonic` | A1 | person {1sg:5,2sg:5,3sg:5,1pl:5} | mi/tu/su/nuestro possessor paradigm (TR sibling already has a person spec). |
| `es-a2-gustar-type-verbs` | A2 | person {5×5} + number {singular:8, plural:8} | Full experiencer series me/te/le/nos/les IS the A2 delta; `*me duele los pies` is the number trap. |
| `tr-a2-optative` | A2 | person {1sg:8, 1pl:8} + polarity {affirmative:10, negative:8} | Exact sibling of the fixed imperative: -(y)AyIm / -(y)AlIm two-person paradigm + negative -mA claimed in description. |
| `tr-a2-spatial-postpositions` | A2 | case {locative:12, dative:9, ablative:9} | "location -DA / motion-to -(y)A / motion-from -DAn" 3-case split is the core; collapse to static locative expected. |
| `tr-b1-participles-dik-acak` | B1 | person {6×5} | The possessive-agreement paradigm on -DIK/-(y)AcAK relatives IS the point (okuduğum/gideceğimiz). |
| `tr-b1-reason-digi-icin` | B1 | person {6×5} (+ optional polarity 18/12) | "subordinate verb carries the possessive agreement"; commonError is dropping it. |
| `tr-a1-personal-pronouns` | A1 | case {nom:3,acc:3,dat:4,gen:4,loc:2,abl:2} + person {1sg:5,2sg:5,3sg:5} | The irregulars (bana/sana, benim/bizim, -n- buffer onu/ona/onda) live at specific person×case cells. |
| `es-b1-imperative-negative-pronouns` | B1 | polarity {affirmative:8, negative:10} | Point is built on the proclisis-negative vs enclisis-affirmative contrast (díselo vs no se lo digas). |
| `es-b2-nosotros-imperative` | B2 | polarity {affirmative:8, negative:8} | Sentémonos (-s drop + enclitic) vs no nos sentemos (proclitic) — commonError 3 is exactly this trap. |
| `es-b1-reciprocal-se` | B1 | person {1pl:8, 3pl:8} | nos vs se reciprocal; commonError `*mi hermano y yo me ayudamos`. Plural-only partial floors. |

## Tier 1b — existing specs missing a claimed axis

| key | current | add | why |
|---|---|---|---|
| `tr-a1-future` | person 6×5 | polarity {affirmative:6, negative:6} | "Negative raises -mA: gelmeyecek" is claimed core; every sibling finite tense (present-cont, dili-past, aorist, real-conditional, -iyordu) has polarity — future is the only one without. **High confidence.** |
| `es-a2-preterito-perfecto` | person 5×5 | polarity {affirmative:10, negative:8} | todavía-no contexts are inherently negative and claimed ("time markers ya, todavía no"). Low confidence — participle irregularity is polarity-independent. |
| `tr-a2-aorist` | person 6×8 + polarity 6/6 | sentenceType {declarative:20, interrogative:10} | Offers (Çay içer misin?) are claimed core; fused -Ir mI surfaces. Low confidence — grows an already-grown cell. |

## Tier 2 — medium confidence (real claim, softer collapse risk)

TR: `tr-a2-relative-an` polarity 18/12 (negative -mAyAn claimed);
`tr-a2-reflexive-reciprocal-pronouns` person 6×5 (kendim/kendin/kendisi);
`tr-a1-questions` person {1sg:3,2sg:5,3sg:4,1pl:3,2pl:5} (fused miyim/misin);
`tr-a1-vowel-harmony` case {acc,dat,loc,abl ×4} (forces both harmony
patterns); `tr-a1-demonstratives` case {nom:6,acc:5,dat:5} (-n- buffer bunu/
buna); `tr-a2-indefinite-pronouns` polarity 12/12 (NPI kimse/hiçbiri vs
biri/herkes); `tr-a1-gore-bence` person {16 partial} (bence/sence/bizce).

ES A1/A2: `es-a1-gustar-basic` number 8/8 + person {1sg:8,2sg:8};
`es-a1-gender-agreement` number 6/6; `es-a1-articles` number 6/6;
`es-a1-subject-pronouns` person 5×4; `es-a1-negation-tampoco` polarity
{aff:6, neg:12} (también is the floor-needing half); `es-a1-telling-time`
number {sg:6, pl:8} (es la una vs son las tres);
`es-a2-direct-object-pronouns` number 8/8; `es-a2-indirect-object-pronouns-se`
number 8/8; `es-a2-tonic-pronouns-prepositions` person {1sg:8,2sg:8,3sg:6}
(mí/ti/conmigo/contigo/sí); `es-a2-possessives-tonic` person {4×6}.

ES B1/B2: `es-b2-subjunctive-negated-opinion` polarity {neg:10, aff:8} (the
mood flip IS the point; affirmative floor forces the indicative half);
`es-b2-aspectual-se` person 5×5 (`*se comí` trap); `es-b2-se-middle-accidental`
number 8/8 (`*se le cayó las llaves`); `es-b2-passive-voice` number 8/8
(fueron abiertas); `es-b1-nominalizers` number 8/8 (el que/los que);
`es-b2-cuyo` number 8/8 (cuyo/cuyos).

## Tier 3 — low confidence / flagged caveats

`tr-a1-plural-suffix` number 8/8 (singular = "quantified context" reading is
a stretch); `tr-a1-instrumental-ile` person {1sg:3,2sg:3,3sg:3} (benimle/
seninle/onunla); `tr-a2-purpose-icin-uzere` polarity {aff:12, neg:6}
(-mAmAk için; multi-construction otherwise); `tr-a2-ability-necessity`
polarity is genuinely core (yapamam vs yapmam) but the cell is eval-excluded
and its in-file note says fix the context-spoil issue first — A/B via
`eval:gen` before touching.

## Stays excluded (2026-06-12 rotation eval; test-enforced for person)

`tr-a1-var-yok`, `tr-a1-locative` (has number already), `tr-a2-mis-evidential`,
`tr-a2-ability-necessity` (see Tier 3), `es-b1-passive-se` (number agreement
is claimed — `*se vende coches` — but no axis proposed without a fresh eval).

## OK without a spec (~90 points)

Full per-point reasoning lives in the audit transcripts; the buckets, with
canonical examples:

- **Lexical / invariant**: connectors (tr-a2-causal/adversative, es-b1/b2
  connector sets), fixed postpositions (tr-a2-gibi-kadar, tr-b1-olarak),
  invariant suffixes (tr-a1-ki-relativizer), diacritic pairs.
- **Lemma-choice points** (axis not in vocabulary): ser/estar, por/para,
  saber/poder, hay/estar, muy/mucho, deber/deber-de, verbs-of-change,
  aspectual periphrases, gradual gerund.
- **Meaning-contrast points**: past-narration, preterite-imperfect-meaning,
  conditional-conjecture, nuanced-ser-estar, adjective-position.
- **Multi-construction / pinning-ambiguous**: reported speech (both
  languages), tr-a2-converbs/nominalization, es-a2-periphrases,
  es-b2-clitic-advanced, es-b2-relative-clauses-advanced.
- **Single-value by definition**: es-b1-impersonal-plural (3pl), es-a1-hay
  (3sg), tr-a1-genitive-possessive (3sg -(s)I head), es-a1-noun-plural
  (all-plural), es-b1-collective-agreement (mandates singular).
- **Diversity via another mechanism**: numbers-ordinals both languages
  (elicitationSeedValues), tr-a1-stem-changes / tr-a2-pekistirme /
  es-b2-appreciative-suffixes (lexical identity rotation).
- **Trigger points** where person floors would distract from the tested
  mood-selection skill: es-b1-subjunctive-adverbial, es-b2-subjunctive-
  temporal-concessive / -compound.

## Known vocabulary limitations surfaced by the audit

- **No gender axis** — ES agreement points (gender-agreement, DOPs, cuyo,
  nominalizers) can only pin their number half.
- **No lemma/construction axis** — choice-between-words points are
  unpinnable by design (seed rotation is the mechanism there).
- Dative-experiencer person (me/te/le with 3rd-person verbs) is expressible
  only where the pronoun itself realizes person (gustar-type: yes; se-middle
  datives: no — verb person is always 3rd).

## DE

Curriculum disabled since 2026-05-10 (`de.ts` fully commented out). When the
planned A1–B2 curriculum lands (`docs/superpowers/plans/2026-07-12-de-a1-b2-
curriculum.md`), author specs at creation time per
`docs/curriculum-authoring.md` — obvious candidates: verb conjugation
paradigms (person), Wechselpräpositionen (case accusative/dative), noun
plurals (number), negation (polarity), separable verbs.

## Rollout notes

- Tier 1 + tr-a1-future fit one PR: specs + one `CURRICULUM_VERSION_TR`/`_ES`
  bump. Floors above are sized to house style; sums that exceed the level
  target (noted inline) grow their cells deliberately.
- Cells already at target need `pnpm demote:pool` after deploy or floors
  never fire (see the retrofit section of `docs/curriculum-authoring.md`).
  Check per-cell approved counts before deciding which to demote.
- Tier 2/3 should go through `pnpm propose:coverage-spec --with-pool-stats`
  + a look at actual pool distributions before committing floors wholesale.
