# ES B1/B2 Curriculum — PCIC Alignment + B&B Coverage (Design)

**Date:** 2026-07-06
**Status:** Approved pending user review
**Predecessor:** `2026-07-06-es-a1-a2-pcic-curriculum-design.md` (PR #528, merged) — same methodology; carried-over decisions are not re-argued here.
**Sources:**
- Level placement: [PCIC — Gramática, Inventario B1-B2](https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/02_gramatica_inventario_b1-b2.htm), parsed with the same deterministic table-column extraction as the A1/A2 cycle (52 tables; `<td headers="…b1|…b2">`). Scraped text stays out of the repo.
- Reverse coverage + content grounding: Butt & Benjamin 6th ed. markdown corpus at `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md`.

## Problem

ES B1/B2 hold only 5 + 5 grammar points — a fraction of PCIC's B1-B2 inventory —
while A1/A2 now carry 22 + 27 PCIC-aligned points. This cycle brings B1/B2 to
the same standard: PCIC-derived inventory, B&B reverse-coverage audit, and
B&B-grounded content.

## Decisions (user-approved 2026-07-06)

1. All existing 10 B1/B2 keys survive unchanged — rescopes only, **no DB migration** this cycle.
2. Inventory: 14 new B1 + 18 new B2 points (PCIC-derived + 3 B&B-audit additions), totals **B1 19 / B2 23**.
3. Grammar only: the existing B1/B2 vocab/dictation/free-writing umbrellas stay untouched.
4. Same pipeline as A1/A2: B&B chapter grounding per point, one drillable contrast per point, theory categories + test mirrors, one `CURRICULUM_VERSION_ES` bump, one PR, subagent-driven implementation with linguistic-accuracy reviews.

## B&B reverse-coverage audit note

The audit swept all 44 B&B chapters against the draft. Its raw report was run
against a **stale pre-merge es.ts** (local main before PR #528 was pulled), so
its top candidates (por/para, personal a, -mente, double negation) were false
gaps — all shipped at A2 in the prior cycle. Surviving after filtering against
the real 49-point A1/A2 set: **cleft sentences (B2)**, **appreciative suffixes
(B2, recognition-capped)**, **deber vs deber de (B1)**, plus four scope
corrections folded into the tables below. Rejected again as
lexical-not-grammatical: none new (tener-idioms and saber/conocer remain
rejected from the prior audit). Excluded as C1+: future subjunctive, pretérito
anterior, -ra-for-conditional variants, ello, voseo detail, word order (its
productive slice lives in `es-b2-clitic-advanced`).

## Section 1 — Existing points: keeps and rescopes (no key changes)

| Key | Action |
|---|---|
| `es-b1-present-subjunctive` | Rescope: add independent uses — ojalá (que), quizá/tal vez + subj (PCIC 9.2.1 B1). Noun-clause triggers stay. |
| `es-b1-conditional` | Rescope to PCIC B1 values: courtesy (¿podrías?), modesty (yo diría), advice (deberías) + forms incl. irregular stems. Hypothetical (si pudiera, iría) is B2 (owned by `es-b2-past-subjunctive` / `es-b2-complex-conditionals`); reported-future (dijo que vendría) is B2 consecutio per PCIC 9.1.5 and stays OUT of the B1 reported-speech point's scope. |
| `es-b1-llevar-time-expressions` | Widen to a duration/time toolkit: + tardar en + inf, dentro de + period (B&B ch. 36). llevar + gerund and hace…que stay the core. |
| `es-b1-relative-clauses` | Rescope to PCIC B1: que/quien opposition (a quien for human objects), donde with expressed antecedent, restrictions (*Juan que vive aquí), indicative in all tenses. Explicativas and el que + preposition move to `es-b2-relative-clauses-advanced`. |
| `es-b1-passive-se` | Unchanged. |
| `es-b2-past-subjunctive` | Unchanged (PCIC 9.2.2 places imperfect subjunctive at B2). |
| `es-b2-compound-tenses` | Rescope narrowed to **future perfect** (habré llegado: anteriority to a future action + probability-in-past habrá tenido). Pluperfect moves to new `es-b1-pluperfect` (PCIC 9.1.8 = B1). |
| `es-b2-conditional-perfect` | Unchanged. |
| `es-b2-complex-conditionals` | Unchanged. |
| `es-b2-nuanced-ser-estar` | Unchanged (PCIC 12.1 B2). |

## Section 2 — New B1 points (14)

Finite-tense points carry the ES person coverageSpec at B-level floors
`{ '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 }` (matching the
existing ES B1/B2 points). Starred = additionally `conjugationSuitable: true`.

| # | Key | Scope | PCIC | B&B chapters | Category |
|---|---|---|---|---|---|
| 1 | `es-b1-futuro-simple`\* | Futuro imperfecto paradigm + irregular stems (tendré, sabré, haré, diré); absolute future; futuro de probabilidad (Serán las once) | 9.1.4 B1 | 16, 17 | tenses |
| 2 | `es-b1-pluperfect` (coverageSpec only) | había + participle; anteriority to a past reference point (Cuando llegamos ya se había ido) | 9.1.8 B1 | 18 | tenses |
| 3 | `es-b1-past-narration` | Imperfecto/indefinido interplay in narration: background vs event (Iba por la calle y me encontré…), conato (Iba a salir cuando sonó…), simultaneity; al + infinitivo (Al llegar, lo vi) | 9.1.2 B1, 15.3.1 B1 | 17 (esp. imperfect/preterite contrast), 22 (al + inf) | tenses |
| 4 | `es-b1-imperative-negative-pronouns` | Negative imperative = subjunctive + proclitic pronouns (No te vayas); multi-clitic enclisis on affirmative (díselo, dámelas) with accent rules | 9.3 B1 | 21, 14 | moods |
| 5 | `es-b1-subjunctive-adverbial` | Subjunctive in temporal clauses with future reference (cuando llegues / *cuando llegarás, antes de que llueva, después de que hablen) + final para que + subj | 9.2.1 B1, 15.3.1 B1, 15.3.5 B1 | 20, 36 | moods |
| 6 | `es-b1-reported-speech` | Indirect statements with tense shift (Dijo que tenía sueño; Pensé que estabas cansado); imperative → que + presente de subjuntivo (Dice que me siente) | 9.1.2 B1, 9.2.1 B1 | 17, 20 (search index for "reported"/consecutio) | syntax |
| 7 | `es-b1-deber-obligation-probability` | deber + inf (obligation) vs deber de + inf (probability/conjecture); deberías for advice | 9.1.5 B1 (deberías); 12.1 B2 lists deber de — placed B1 with the pair | 25 (§ modal auxiliaries) | pairs |
| 8 | `es-b1-aspectual-periphrases` | dejar de, ponerse a, estar a punto de + inf; seguir + gerundio. (volver a / acabar de stay at A2 — do not re-teach) | 12.1 B1 | 19, 25 (search "periphras") | syntax |
| 9 | `es-b1-verb-preposition-regime` | Prepositional regime verbs: hablar de, pensar en, soñar con, depender de…; double complementation (me invitó a cenar) | 12.2.5 B1 | 38 (verb+preposition sections) | syntax |
| 10 | `es-b1-discourse-connectors` | sin embargo; o sea que, así (es) que; fronted causal como (Como no venías, empecé…); por + infinitivo causal; concessive aunque + indicative | 14.3 B1, 15.3.4 B1, 15.3.7 B1, 15.3.9 B1 | 37 | syntax |
| 11 | `es-b1-superlatives-comparisons` | Relative superlative el más/menos … de; elative -ísimo; igual de … que; más/menos de + quantity | 2.5 B1, 6.1 B1, 15.3.8 B1 | 6 | syntax |
| 12 | `es-b1-que-vs-cual` | qué vs cuál/cuáles (¿Cuál quieres? / *¿Cuál libro…?); preposition + interrogative (¿Con quién…? ¿De qué…?); adónde | 7.3 B1, 8.8 B1 | 28 | pairs |
| 13 | `es-b1-ser-estar-uses` | Impersonal ser (Es tarde, Es de noche); estar de + occupation (Está de camarero); estar a + prices/dates; parecer + adj vs parece que | 12.1 B1 | 33, 34 | pairs |
| 14 | `es-b1-indirect-questions` | Indirect interrogatives: no sé si ir, no sé qué hacer, pregúntale dónde está; si/qué/cuándo/dónde + clause or infinitive | 9.4.1 B1 | 28, 37 | syntax |

## Section 3 — New B2 points (18)

| # | Key | Scope | PCIC | B&B chapters | Category |
|---|---|---|---|---|---|
| 1 | `es-b2-relative-clauses-advanced` | Explicativas (…, que es mi vecina,); el/la/los/las que + preposition (la casa de la que te hablé); quien(es) with/without antecedent; donde relatives; indicative/subjunctive contrast (busco un libro que sea…) | 7.2 B2, 15.2 B2, 9.2.1 B2 | 39 | syntax |
| 2 | `es-b2-subjunctive-compound` | Perfect subjunctive (No es verdad que haya escrito…; cuando se haya marchado) + pluperfect subjunctive forms (hubiera/hubiese hecho) | 9.2.3–9.2.4 B2 | 16, 20 | moods |
| 3 | `es-b2-subjunctive-negated-opinion` | no creo que + subj vs creo que + ind; no es cierto/verdad que + subj; negated dicción (No me dijo que hubiera venido) | 9.2.1 B2, 15.1.2 | 20 | moods |
| 4 | `es-b2-subjunctive-temporal-concessive` | en cuanto, tan pronto como, apenas, una vez que, hasta que, mientras + subj (posteriority); concessive aunque / a pesar de que + subj (known info, non-factual); por mucho/más que | 9.2.1 B2, 15.3.1 B2, 15.3.9 B2 | 20, 36 | moods |
| 5 | `es-b2-passive-voice` | ser + participle action passive (Las puertas fueron abiertas a las 10) vs estar + participle result; agreement; obligatory definite subjects; postverbal bare-noun subjects (Se venden pisos / Han llegado trenes) | 13.3 B2, 12.1 B2, 9.4.3 B2, 13.2 B2 | 32 | syntax |
| 6 | `es-b2-verbs-of-change` | ponerse, quedarse, hacerse, volverse + convertirse en, llegar a ser — which "become" for which change type | 12.1 B2 | 31 | syntax |
| 7 | `es-b2-se-middle-accidental` | Middle se (Se abrió la ventana); accidental/dative-of-interest se me/te (Se me perdió tu dinero); irse vs ir | 7.1.4 B2 | 30, 32 | pronouns |
| 8 | `es-b2-clitic-advanced` | Neuter lo as attribute pro-form (Lo soy / Lo está); obligatory doubling with fronted OD (Los libros los tiene Juan); leísmo de persona acceptance (Le vimos [a Luis]) | 7.1.2 B2, 12.2.2 B2 | 14, 15 | pronouns |
| 9 | `es-b2-conditional-connectors` | por si (acaso); siempre que / siempre y cuando / con tal de que / a condición de que + subj; salvo si / excepto si + ind; a no ser que / salvo que + subj | 15.3.6 B2 | 29 | moods |
| 10 | `es-b2-consecutives-intensity` | tan … que, tanto/a/os/as … que, tanto que; de manera/modo que; por lo tanto, por consiguiente | 15.3.7 B2 | 37, 6 | syntax |
| 11 | `es-b2-sino-adversatives` | pero vs sino / sino que (No es antipático sino tímido); no obstante | 14.3 B2 | 37 (search "sino") | pairs |
| 12 | `es-b2-causal-connectors` | ya que, puesto que (fronted or postposed), debido a que; enunciation causals with porque (Están en casa, porque veo luz) | 15.3.4 B2 | 37 | syntax |
| 13 | `es-b2-lo-nominalizer` | lo + adjective (lo interesante, lo mejor); lo de + NP (lo de ayer); lo que clauses; lo + adj + que intensifier (lo inteligente que es); el porqué | 2.6 B2, 3.1 B2 | 8, 40 | syntax |
| 14 | `es-b2-comparatives-advanced` | más/menos … de lo que; superior/inferior a; el doble de / tres veces más; igual que; más N que N (más libros que revistas) | 2.5 B2, 6.1 B2, 15.3.8 B2 | 6 | syntax |
| 15 | `es-b2-gerund-participle-constructions` | Adverbial gerund (Aprende leyendo; Me lo confesó yendo por la calle); nada más + inf; una vez + participle (Una vez estudiado el problema); predicative participle (Encontré la tienda cerrada) | 9.4.2–9.4.3 B1/B2, 15.3.1 B2 | 24, 23, 22 | syntax |
| 16 | `es-b2-quantifiers-advanced` | cualquier / cualquiera distribution; partitives (la mitad / un tercio de); multiplicatives (el doble de, tres veces más); tres de cada cinco; attenuating algo + adj | 6.1 B2 | 10, 11 | syntax |
| 17 | `es-b2-cleft-sentences` | ser-focus clefts: Fue Juan quien/el que llamó; Es aquí donde…; Lo que necesito es…; relator agreement (quien/donde/como per focus type) | 12.2.1 B2 (Él es quien tiene la culpa) | 41 | syntax |
| 18 | `es-b2-appreciative-suffixes` | Diminutive -ito/-cito (affective + lexicalized), augmentative -ón/-azo, pejorative -ucho; recognition-oriented — production capped at core -ito/-ón (B&B cautions against learner experimentation) | 2.2 B2 (apreciativos) | 43 | morphology |

## Section 4 — Mechanics

- `es.ts`: insert new B1 points after the existing B1 section's points, new B2 after existing B2 points (before the vocab umbrellas), in table order; apply the Section-1 rescopes; bump `CURRICULUM_VERSION_ES` to the implementation date with a changelog paragraph.
- `curriculum/index.ts`: `PER_LANGUAGE_GRAMMAR_MIN.ES` → `{ A1: 22, A2: 27, B1: 19, B2: 23 }`.
- `curriculum.test.ts`: Spanish counts B1 ≥ 19, B2 ≥ 23 (title update).
- `theory-categories.ts` + test mirror: 32 new mappings per the Category columns.
- Flags: only `es-b1-futuro-simple` gets `conjugationSuitable`; it and `es-b1-pluperfect` get the B-level person coverageSpec (floors 15). No other optional fields unless the single-construction rule clearly applies at implementation time (multi-construction points are never `sentenceConstructionSuitable`).
- No prompt edits ⇒ no Langfuse push. No new coverage-floor sums beyond the existing 75 (5×15) ⇒ **no pool-status whitelist change** (verify during gates).
- No DB migration (no key changes).
- Overlap discipline (binding for implementers): volver a / acabar de / soler / tener que / hay que live at A2 (`es-a2-periphrases-obligation-aspect`); por/para, personal a, -mente, double negation live at A2; -ísimo now lives at B1 (`es-b1-superlatives-comparisons`) — the A2 comparatives point still excludes it; deber de probability belongs to `es-b1-deber-obligation-probability`, NOT the futuro-de-probabilidad point.

## Section 5 — Rollout

Fresh worktree from the **pulled** origin/main (the stale-main audit misread is
the cautionary tale — every subagent works from the worktree path). Full
lint/typecheck/test gates; one PR, squash-merged. Post-merge: scheduler
enumerates ~65 new cells behind the A1/A2 backlog under the daily budget cap;
theory batch generation for the new points; spot-check per-cell approval rates
after the first run.

## Out of scope

- Themed vocab / dictation / free-writing umbrella expansion for B1/B2.
- C1/C2 anything (out of round-1 levels).
- DE curriculum (still reduced).
- ni siquiera, exclamative cómo/cuánto refinements, estar + gerundio nuances — folded or deferred; revisit in a future audit if drill data shows gaps.
