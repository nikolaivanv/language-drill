# Exercise Pool Diversity Audit

_A data audit of the approved exercise pool (production Neon branch, 2026-06-13)
for **axis collapse**: cells where the generator concentrated on the
unmarked/most-frequent member of a paradigm or closed set, leaving the rest of
the grammar point's domain untested. Follow-up to the grammatical-person audit
that produced PR #272 (person rotation); this catalogues every other axis found
or suspected._

## The failure mode

LLM generation gravitates to the statistically dominant realisation of a
construction. Per-item validation cannot catch this: every individual draft
looks fine; the failure is **distributional**, visible only across a cell's
batch. Two prior instances are already fixed in the pipeline:

- `tr-a1-vowel-harmony` over-concentrated on the plural suffix → batch-level
  coverage rule in the generation system prompt (2-way/4-way slots, plural
  capped at 50%).
- Person/number across all TR tense cells ≥90% 3sg → per-draft person rotation
  in the user prompt + 1.5× target raise (PR #272).

This audit asks: where else does the same thing happen?

## Method

SQL classification of `correctAnswer` / `sentence` / `expectedWord` over all
`auto-approved` + `manual-approved` exercises, per cell, with hand-verification
of ambiguous regex buckets (Turkish morphology is suffix-classified; multiword
Spanish answers are classified by auxiliary). Sample sizes are whole-cell
unless noted.

---

## Confirmed findings (ordered by severity)

### 1. `es-b2-compound-tenses` cloze — construct narrowing (worst finding)

**47/50 answers are the bare auxiliary** (`había`, `he`, `habrá`…); the
participle is displayed in the sentence. Consequences:

- Irregular participles (*hecho, visto, dicho, escrito, puesto, vuelto,
  abierto, roto, muerto*) are **never produced by the learner** — zero
  occurrences in answers.
- The cell silently narrowed from "compound tenses" (auxiliary + participle
  formation) to "auxiliary tense selection". Mastery credit recorded for this
  grammar point overstates what was demonstrated.

This is not a skew but a **blank-placement** problem. Fix shape: a generation
rule requiring the whole verb phrase (or at least the participle) to be the
blank in some share of the batch, with irregular-participle quota.

### 2. `tr-a1-plural-suffix` cloze — rule-subcase collapse

The cell covers two subcases: produce `-lAr`, and *suppress* it after
numerals. The pool is dominated by the suppression subcase — most answers are
**singular** nouns (*elma, kadın, kalem, portakal, toplantı, çocuk*). Only
2/18 answers are actual plural forms, and both are front-vowel `-ler`
(*çiçekler, öğrenciler*): **back-vowel `-lar` production is absent
entirely.**

### 3. TR vocab umbrellas — noun-only vocabulary

A 25-word random sample of `tr-a2-everyday-vocab` is **100% nouns** (*su,
araba, otobüs, aile, yağmur, domates, kahvaltı, tren, bal, bisiklet, kar,
kahve, kanepe, çay, muz, durak, süpürge, şapka*…). No verbs, no adjectives,
no adverbs. Spot-checks of other umbrellas show the same pattern. Active
vocabulary at A2+ depends at least as much on verbs/adjectives as on concrete
nouns; the entire vocab-recall system currently drills one word class.

### 4. `tr-a2-aorist` — function and polarity collapse

- **0/30 question forms.** The aorist's offer/request use (*Çay içer misin?*)
  is named explicitly in the curriculum description and is the single most
  conversationally useful aorist function. Absent.
- 28/30 affirmative. The negative's irregularity (*-mAz*, with 1sg *-mAm* /
  1pl *-mAyIz* — also named in the description) is barely touched; the two
  negatives present are 3sg *-mAz*.

### 5. `tr-a1-questions` — particle harmony half-covered

Particle answers cover only `mi/mı` (+`misin/mısın`). The rounded variants
**`mu/mü` never appear**, so half the 4-way harmony paradigm — the actual
grammar point — is untested. (Small cell, n=8, which makes the gap cheap to
fix.)

### 6. `tr-a1-locative` — consonant assimilation undertested

14 voiced `-da/-de` vs **3** voiceless `-ta/-te` answers. The
voiceless-assimilation variant (*kitapta, sokakta, ağaçta*) is the part
learners actually get wrong.

### 7. `es-b2-past-subjunctive` — `-ra` monoculture

**50/50 answers use the `-ra` form; `-se` never appears.** Like the vosotros
omission (now documented in `PERSON_ROTATION_BY_LANGUAGE`), favouring `-ra`
is a defensible production default — `-se` is largely literary — but at B2 the
learner should at least *meet* `-se`. Currently an accident, not a decision;
should become one (either documented exclusion or a small `-se` quota).

### 8. `es-b1-conditional` — function skew (moderate)

33/50 sentences are si-clause hypotheticals. Politeness (*¿podrías…?*),
conjecture (*serían las ocho*), and future-in-the-past beyond *dijo que*
frames are underrepresented. Not broken — reported-speech frames exist — but
the conversationally high-value politeness function is thin.

### 9. `tr-a2-ability-necessity` — modality skew (moderate)

Necessity (`-mElİ`) outnumbers ability (`-Abil`) 2:1; impossibility
(`-AmA-`) appears only in a handful of items. (This cell is also excluded
from person rotation pending its spoil-trap fix — see PR #272 — so it needs a
combined treatment.)

### 10. `es-b1-present-subjunctive` — trigger-type gap (mild)

Good variety across verb and impersonal triggers (*espero/quiero/dudo que, es
importante/necesario/posible que, me alegra*), but **conjunction triggers**
(*para que, antes de que, cuando* + future reference) are absent. Those are
the B1→B2 bridge uses.

### Healthy counter-example

`es-b1-passive-se` is well balanced on the singular/plural agreement axis
(18 *se vende*-type vs 31 *se venden*-type) — the axis most prone to error.
Included to show the audit discriminates; not every cell is broken.

---

## Structural risks — German (no real pool yet)

The DE pool is still seed-only. The same collapse pattern is predictable on
these axes; cheaper to constrain *before* first generation than to re-pass:

| Cell | Likely collapse |
|---|---|
| `de-a2-akkusativ/dativ-prepositions` | masculine `den/dem` over-representation (the only gender where case is visually marked); *mit/für* dominating the preposition sets |
| `de-b1-two-way-prepositions` | *in/auf* dominance; motion-Akkusativ vs location-Dativ imbalance |
| `de-a2-perfekt-with-haben/sein` | weak `ge-…-t` participles over strong `ge-…-en` (*gegangen, gefahren*) and separable/inseparable variants (*aufgemacht* vs *besucht*) |
| `de-b1-relative-pronouns` | nominative/accusative `der/die/das` over dative and genitive (*dessen/deren*) |
| `de-b1-modal-verbs-past` | *müssen/können/wollen* over *dürfen/sollen/mögen* |
| `de-b2-konjunktiv-ii` | *würde*-paraphrase over synthetic forms (*wäre, hätte, käme*); present counterfactuals over past (*hätte gemacht*) |

---

## The general taxonomy

Six recurring diversity axes, plus one distinct failure type:

1. **Person/number** — fixed by PR #272's rotation.
2. **Morphophonological variants** — harmony classes (`mu/mü`), consonant
   assimilation (`-ta/-te`), buffer consonants. Findings 5, 6.
3. **Regular vs irregular members** — participles, stem changes, irregular
   negatives. Findings 1, 4; DE Perfekt risk.
4. **Polarity** — affirmative skew everywhere outside the dedicated negation
   cell. Finding 4.
5. **Sentence type** — declarative skew; questions exist almost only in the
   questions cell. Finding 4.
6. **Function** of polyfunctional forms — aorist offers, conditional
   politeness, subjunctive conjunction triggers. Findings 4, 8, 10.
7. **Word class** (vocab cells) — noun monoculture. Finding 3.

And separately: **construct narrowing via blank placement** (finding 1) —
not a skew on a content axis but a drift in *what the learner produces*.

## Recommended mechanisms (all precedented in the pipeline)

| Mechanism | Precedent | Fits |
|---|---|---|
| Per-draft user-prompt rotation by ordinal (cache-safe, deterministic, seed-phased) | person rotation (PR #272) | word class for vocab cells; function for aorist/conditional; particle variants; modality |
| Batch-level coverage rule in the system prompt | `tr-a1-vowel-harmony` constraint | plural-cell subcase mix; locative `-TA` quota; polarity/sentence-type quotas |
| Blank-placement rule + quota | new, but same prompt surface | compound-tenses full-form answers with irregular-participle share |
| Documented deliberate exclusion | vosotros note in `PERSON_ROTATION_BY_LANGUAGE` | `-se` past subjunctive (if excluded rather than quota'd) |
| Validator soft flag (`flaggedReasons`) for aggregation | `'cell over-concentrated on plural suffix'` | regression monitoring on any of the above |

Every change should follow the PR #272 playbook: cross-commit `eval:gen` on a
cell dataset before scale-up, target raise (or re-pass per the
prompt-update-and-revalidate runbook) for already-saturated cells, and a
`GENERATION_PROMPT_VERSION` bump scoped to what actually changed.

## Priority order

1. **Vocab word-class rotation** — one mechanism, every vocab cell benefits;
   pairs with a quota in the umbrella descriptions (e.g. ≥30% verbs).
2. **Compound-tenses blank-placement rule** — mastery signal is currently
   miscalibrated, not just thin.
3. **Aorist function/polarity rotation** (questions + irregular negatives) —
   highest conversational value per token.
4. **Plural-cell subcase rebalance** and **locative/question-particle
   harmony quotas** — small cells, cheap.
5. **`-se` decision** for past subjunctive; **conjunction-trigger quota** for
   present subjunctive.
6. **DE pre-emptive constraints** before DE generation is enabled.
