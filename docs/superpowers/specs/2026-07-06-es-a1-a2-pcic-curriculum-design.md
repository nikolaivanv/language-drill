# ES A1/A2 Curriculum — PCIC Alignment (Design)

**Date:** 2026-07-06
**Status:** Approved pending user review
**Sources:**
- Level placement: [Plan Curricular del Instituto Cervantes — Gramática, Inventario A1-A2](https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/02_gramatica_inventario_a1-a2.htm) (PCIC)
- Content grounding: Butt & Benjamin, *A New Reference Grammar of Modern Spanish*, 6th ed., parsed markdown at `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md` (B&B; see its `index.json` / section anchors)

## Problem

The ES A1/A2 curriculum in `packages/db/src/curriculum/es.ts` has been entirely
commented out since 2026-05-10 ("TEMPORARILY REDUCED") and, even dormant, holds
only 4 A1 + 5 A2 grammar points. TR meanwhile received full textbook parity
(~27 A1 + ~22 A2 points plus vocab/dictation/free-writing umbrellas). This
change restores ES A1/A2 at full PCIC-aligned coverage and re-enables prod
generation for those cells.

## Decisions already made (user-approved)

1. **Restore + generate** — uncomment/expand ES A1/A2; the scheduler starts
   filling the pool at the next nightly run, paced by the global budget cap.
2. **Full surface parity** — grammar + vocab umbrellas + dictation +
   free-writing, like TR.
3. **TR-like granularity** — one drillable contrast per point (21 A1 + 23 A2),
   collectively covering every PCIC A1/A2 section; not 1:1 with PCIC subsections.
4. **Re-level to PCIC with key migration** — where PCIC clearly places a live
   B1 point at A2, rename the key and migrate DB references.
5. **One PR** — curriculum, code ripples, and the key-rename migration land
   together with a single `CURRICULUM_VERSION_ES` bump.
6. **Content grounding** — every point's `description`, `examplesPositive`,
   `examplesNegative`, and `commonErrors` is authored against the relevant
   B&B chapter(s), the way TR points were grounded in Göksel & Kerslake.
   PCIC governs *what level* a point sits at; B&B governs *what the point says*.

## PCIC extraction method (repeatable, not committed)

The PCIC page is a set of HTML tables, one per inventory subsection, each with
an A1 column (`<td headers="…a1">`) and an A2 column (`<td headers="…a2">`).
Level attribution below was derived by parsing those columns directly (curl +
a small Python HTML-to-text pass), not from an LLM summary — early WebFetch
summaries misattributed levels (e.g. placed the past tenses at A1; they are
A2). The scraped text stays out of the repo (Instituto Cervantes copyright);
re-run the extraction against the URL above if needed.

Key placements that drive this design:

| PCIC placement | Consequence |
|---|---|
| All past tenses (imperfecto 9.1.2, indefinido 9.1.3, perfecto 9.1.6) are **A2**; A1 verb = presente regular + ser/estar/haber/ir | A1 has no past tense; perfecto joins A2 as a new point |
| Imperative is entirely **A2** (9.3 A1 column is empty) | No A1 imperative point |
| Gerundio / estar + gerundio is **A2** (9.4.2, 12.1) | No A1 progressive point |
| Comparatives (2.5, 6.1, 15.3.8) are **A2** | `es-b1-comparatives-superlatives` re-levels to A2 |
| Basic restrictive `que` relatives are **A1** (7.2, 15.2) | New A1 point; B1 relative-clauses point (quien/donde/lo que) unchanged |
| OD/OI clitic paradigms, personal `a`, tonic pronouns are **A2** | Three A2 pronoun points |
| `gustar` with `me` (1sg OI) is **A1**; encantar/doler + full OI series + reduplication are **A2** | A1 gets `gustar-basic`; dormant `es-a2-gustar-type-verbs` stays A2 |

## Section 1 — A1 grammar inventory (21 points)

Reused dormant keys are marked *(reused)* — content is rewritten
PCIC/B&B-grounded either way. PCIC refs in parens; B&B chapters cited per
point during implementation.

**Nouns & agreement**
1. `es-a1-noun-gender` — masc. -o / fem. -a, other vowels/consonants, heteronyms (padre/madre), la foto/la mano abbreviation-feminines (PCIC 1.2; B&B ch. 1)
2. `es-a1-noun-plural` — -s / -es, país→países (PCIC 1.3; B&B ch. 2)
3. `es-a1-gender-agreement` *(reused)* — noun–adjective gender+number agreement, gentilicios, postnominal position (PCIC 2.2–2.4, 10.3; B&B ch. 4–5)

**Determiners & pronouns**
4. `es-a1-articles` *(reused)* — el/la/los/las, un/una/unos/unas, al/del contractions; article obligatory with gustar-subjects, incompatible with impersonal haber (PCIC 3.1–3.3; B&B ch. 3)
5. `es-a1-demonstratives` — este/ese/aquel paradigms + esto/eso/aquello, spatial deixis, no co-occurrence with article (PCIC 4; B&B ch. 6)
6. `es-a1-possessives-atonic` — mi/tu/su/nuestro/vuestro, prenominal, no article, `su` ambiguity (PCIC 5; B&B ch. 8)
7. `es-a1-subject-pronouns` — paradigm incl. usted/ustedes; pro-drop: absence as norm, presence for contrast (PCIC 7.1.1; B&B ch. 11)
8. `es-a1-interrogatives` — qué, quién, cuánto/-a/-os/-as, dónde, cómo, por qué; total (yes/no) questions (PCIC 7.3, 8.8, 8.9, 13.3; B&B ch. 24, 37)

**Verbs**
9. `es-a1-present-indicative-regular` *(reused)* — -ar/-er/-ir paradigms; `conjugationSuitable: true` + person coverageSpec (PCIC 9.1.1; B&B ch. 13)
10. `es-a1-present-irregular-core` — ser, estar, haber, ir in the present (PCIC 9.1.1 "irregularidades propias"; B&B ch. 13)
11. `es-a1-ser-estar-basic` *(reused)* — ser for identity/class/origin/time vs estar for location + bien/mal (PCIC 12.1; B&B ch. 33)
12. `es-a1-hay-estar` — impersonal hay vs está/están; hay+indefinite / estar+definite (PCIC 3.1, 3.3, 13.3; B&B ch. 34)
13. `es-a1-gustar-basic` — me/te gusta(n) + noun/infinitive; definite article on the liked noun (PCIC 7.1.3, 12.1, 15.1.1; B&B §30.7 gustar-type)
14. `es-a1-querer-poder-infinitive` — querer/poder + infinitive; infinitive as subject (Hablar español es útil); creo que + indicative (PCIC 15.1.1, 15.1.2; B&B ch. 22, 30)

**Quantity**
15. `es-a1-numbers-ordinals` — cardinals incl. gender variation (doscientas), ordinals to 10.º (PCIC 6.1; B&B ch. 10)
16. `es-a1-quantifiers-muy-mucho` — poco/mucho/bastante with agreement; the muy vs mucho opposition (PCIC 6.1, 8.2; B&B ch. 9, 35)

**Sentence & connectors**
17. `es-a1-negation-tampoco` — no + verb; sí/no; también/tampoco polarity pairing (PCIC 6.2, 8.2, 8.5; B&B ch. 27)
18. `es-a1-relative-que-basic` — restrictive que-relatives, subject/OD function, present indicative (PCIC 7.2, 15.2; B&B ch. 39)
19. `es-a1-noun-modifiers-de` — el libro de español, possessive de, del; casa con jardín (PCIC 10.2; B&B ch. 38.2)
20. `es-a1-coordination-basic` — y, ni, o, pero, uno…otro (PCIC 14.1–14.4; B&B ch. 36)
21. `es-a1-porque-para` — porque + indicative, para + infinitive, por qué vs porque (PCIC 15.3.4, 15.3.5; B&B ch. 38, 41)

## Section 2 — A2 grammar inventory (23 points)

Finite-tense points carry a person-axis `coverageSpec` with floors
`{ '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 }` — the ES-precedent
person set (no 2pl, matching the existing ES B1/B2 points) at the A-level
floor TR uses (5, vs 15 at B levels).
Starred points additionally get `conjugationSuitable: true` (single-construction
full-paradigm finite tenses, per the TR flagging criteria; seed kind `verb`).

**Verb tenses & forms**
1. `es-a2-present-irregular-stem-changes`\* — e→ie, o→ue, e→i; saber/dar; orthographic changes (PCIC 9.1.1 A2; B&B ch. 13 + verb tables)
2. `es-a2-preterite-regular`\* *(reused)* — indefinido regular paradigms, punctual past (PCIC 9.1.3; B&B ch. 14)
3. `es-a2-preterite-irregular`\* *(reused)* — tener/hacer/estar stems; ser/ir; ver/dar (PCIC 9.1.3; B&B ch. 13–14)
4. `es-a2-imperfect`\* *(reused)* — description + habit; ser/ir/ver; contrast with indefinido (PCIC 9.1.2; B&B §14.5)
5. `es-a2-preterito-perfecto` — haber + participle, irregular participles, present-relevance markers (ya, todavía no, hoy) (PCIC 9.1.6, 9.4.3; B&B §14.8)
6. `es-a2-imperative-affirmative` — tú/vosotros regular, di/haz/pon/sal, usted/ustedes, enclitics (cómpralo) (PCIC 9.3; B&B ch. 21)
7. `es-a2-estar-gerundio` — gerund formation, estar + gerundio, enclitic on gerund (PCIC 9.4.2, 12.1; B&B ch. 23, §19.1)
8. `es-a2-ir-a-future` — ir a + infinitive; present with future value (PCIC 9.1.1 A2, 12.1; B&B §17.6, §19.2)
9. `es-a2-periphrases-obligation-aspect` — tener que, hay que, acabar de, empezar a, volver a, soler; clitic-position alternation (PCIC 12.1; B&B ch. 19, 25)

**Pronouns**
10. `es-a2-direct-object-pronouns` — lo/la/los/las + neuter lo; enclisis/proclisis; alternation in periphrases (PCIC 7.1.2; B&B ch. 12–13)
11. `es-a2-indirect-object-pronouns-se` — le/les; le→se before lo (se lo doy); clitic doubling; dative uses (PCIC 7.1.3, 12.2.3; B&B ch. 12, §12.6)
12. `es-a2-tonic-pronouns-prepositions` — mí/ti, conmigo/contigo, "a mí me gusta" reduplication (PCIC 7.1.6; B&B §11.5)
13. `es-a2-personal-a` — OD of person takes a (He visto a Almudena; Lo vi / \*Vi a él) (PCIC 12.2.2; B&B ch. 26)
14. `es-a2-reflexive-verbs` *(reused)* — reflexive pronouns + daily-routine verbs (PCIC 7.1.4, 13.3; B&B ch. 30)
15. `es-a2-gustar-type-verbs` *(reused)* — encantar, doler, interesar; plural agreement; reduplication (PCIC 7.1.3, 12.1, 12.2.3; B&B §30.7)

**Determiners & quantity**
16. `es-a2-articles-use` — anaphoric/generic use; el + tonic a (el aula); inalienable possession (me duele la cabeza); bare nouns (bebe agua); profession without article (Es profesora) (PCIC 3.1–3.3, 5; B&B ch. 3)
17. `es-a2-possessives-tonic` — mío/tuyo/suyo; el mío; "Es mío" (PCIC 5; B&B ch. 8)
18. `es-a2-todo-otro-quantifiers` — todo + obligatory determiner; otro (no un otro); demasiado; nada/nadie (PCIC 6.1; B&B ch. 9)
19. `es-a2-comparatives-superlatives` ← **re-leveled from `es-b1-comparatives-superlatives`** — más/menos…que, tan/tanto…como, mejor/peor/mayor/menor. Description trimmed to A2 scope: the -ísimo clause is dropped (not A2 in PCIC) (PCIC 2.5, 6.1, 15.3.8; B&B ch. 5)
20. `es-a2-temporal-clauses` — cuando + present (habitual); antes de / después de + infinitive; desde / desde que / desde hace; hasta; ¿cuándo? (PCIC 15.3.1, 8.2, 8.8; B&B ch. 32, §14.6)
21. `es-a2-si-present-conditional` — si + present, present/imperative apodosis; si vs sí (PCIC 15.3.6; B&B ch. 29)
22. `es-a2-exclamatives-impersonals` — ¡Qué + adj/adv!; exclamative/exhortative sentences; impersonal hace (weather), estamos a X (PCIC 7.4, 11.2, 13.3, 12.1; B&B ch. 24, 27)
23. `es-a2-connectors` — e for y, u for o; por eso, entonces (PCIC 14.1, 14.2, 15.3.7; B&B ch. 36, 42)

### B1/B2 adjustments

- `es-b1-comparatives-superlatives` → `es-a2-comparatives-superlatives` (key
  rename + DB migration; see Section 4). Theory category mapping moves with it.
- `es-b2-compound-tenses` — description narrowed to pluperfect / future
  perfect / conditional perfect (present perfect now lives at A2); gains
  `prerequisiteKeys: ['es-a2-preterito-perfecto']`. No key change.
- `es-b1-llevar-time-expressions` — unchanged. Its "hace…que" mention overlaps
  the new A2 temporal point; deliberate, documented overlap (its center of
  gravity, llevar + gerundio, is B1).
- Restore the two commented-out prerequisites:
  `es-b1-present-subjunctive` → `es-a1-present-indicative-regular`;
  `es-b2-nuanced-ser-estar` → `es-a1-ser-estar-basic`.
- `sentenceConstructionSuitable` is set only on single-construction points
  (per the established rule); decided point-by-point at implementation.

## Section 3 — Vocab, dictation, free-writing umbrellas

- **Vocab (5+5, TR theme parity):**
  A1: `es-a1-vocab-family-people`, `es-a1-vocab-food-drink`,
  `es-a1-vocab-home-objects`, `es-a1-vocab-city-places`,
  `es-a1-vocab-weather-clothing`.
  A2: `es-a2-vocab-work-school`, `es-a2-vocab-city-shopping`,
  `es-a2-vocab-health-body`, `es-a2-vocab-travel-nature`,
  `es-a2-vocab-time-daily-routine`.
  The dormant `es-a2-everyday-vocab` commented block is deleted (superseded).
- **Dictation:** `es-a1-dictation`, `es-a2-dictation` — same shape as ES
  B1/B2 dictation umbrellas; target per current TR practice (30).
- **Free-writing (3+3), topics distinct from the six existing ES B1 topics:**
  A1: *Mi familia*, *Mi casa*, *Un día de mi semana* (informal/neutral).
  A2: *Mis últimas vacaciones* (exercises the new past tenses),
  *Mi mejor amigo/a*, *Mi barrio*.

## Section 4 — Mechanics & migration

- `packages/db/src/curriculum/es.ts`: remove the "TEMPORARILY REDUCED" header;
  author the full inventory; bump `CURRICULUM_VERSION_ES` to `2026-07-06` with
  a doc-comment noting the PCIC alignment (clears any scheduler suppression).
- `packages/db/src/curriculum/index.ts`: `PER_LANGUAGE_GRAMMAR_MIN.ES` →
  `{ A1: 21, A2: 23, B1: 5, B2: 5 }` (B1 drops by one — comparatives moved);
  update the stale restoration comment.
- `packages/db/src/curriculum/curriculum.test.ts`: re-enable the ES per-level
  count assertions.
- `packages/db/scripts/seed-exercises.ts`: restore the three commented ES
  entries in `SEED_KEY_TO_GRAMMAR_POINT` — `es-cloze-a2-1` →
  `es-a2-preterite-irregular`, `es-translation-a2-1` →
  `es-a2-gustar-type-verbs`, and `es-vocab-a2-1` remapped from the deleted
  `es-a2-everyday-vocab` to the thematically closest new A2 vocab umbrella
  (pick by inspecting that seed exercise's content).
- `packages/shared/src/theory-categories.ts` (+ test): add category mappings
  for every new es-a1/a2 grammar key; move the comparatives mapping to the
  new key.
- **Drizzle migration** (forward-only) for the re-level, all
  `WHERE … = 'es-b1-comparatives-superlatives'`:
  - `exercises`: `grammar_point_key` → new key, `difficulty` → `A2` (both in
    one UPDATE so the dedup index stays unique);
  - `user_grammar_mastery`: `grammar_point_key` (PK column);
  - `theory_topics`: `grammar_point_key`;
  - `error_observations`: `host_grammar_point_key`, `error_grammar_point_key`;
  - `fluency_attempts`: `grammar_point_key` (denormalized, nullable);
  - `spaced_repetition_cards`: `item_id` where `item_type = 'grammar_point'`.
  (Correction from review: `user_exercise_history` has no grammar-key
  columns — it references exercises by id only.)
  `generation_jobs` history rows stay untouched: the scheduler derives need
  from approved-pool counts, so the migrated A2 pool suppresses regeneration
  naturally (verify this query path during implementation before merging).
- No prompt-template edits ⇒ no Langfuse push, no prompt-version bumps.

## Section 5 — Rollout & verification

1. Implementation on a worktree branch (`.claude/worktrees/…`), full
   `pnpm lint && pnpm typecheck && pnpm test` before push; the curriculum
   invariants test is the main gate (key format, ≥2 positive / ≥1 negative
   examples, ≤300-char descriptions, prerequisite resolution, coverageSpec
   legality, per-language minimums).
2. One PR, squash-merged. Migration runs via deploy.yml before CDK deploy.
3. Scheduler picks up the ~55 new cells at the next ~04:00 UTC run; the
   global daily budget cap paces pool-filling over several nights — no manual
   trigger needed.
4. Post-merge: run the theory batch generation for the new grammar points
   (grammar-only theory pool; the renamed comparatives point keeps its
   migrated theory row).
5. Spot-check after the first nightly run: approval rates per new cell on the
   admin pool page; any low-yield cells get the usual prompt/curriculum
   iteration loop.

## Testing

- Existing invariants suite covers structural validity of all new entries.
- Update the counts assertions (ES A1 21 / A2 23 / B1 5 / B2 5).
- `theory-categories.test.ts` completeness check forces category mappings.
- Migration: verify with a dry-run against a Neon throwaway branch (NOT the
  shared dev branch — per-PR CI forks inherit dev's schema).
- `seed-exercises.test.ts` covers the restored seed mappings.

## Out of scope

- DE A1/A2 restoration (still TEMPORARILY REDUCED).
- ES B2 expansion / any B1/B2 re-audit beyond the three adjustments above.
- -ísimo / superlative-absolute point (B1 territory; future B1 audit).
- Negative imperative (needs subjunctive; B1).
