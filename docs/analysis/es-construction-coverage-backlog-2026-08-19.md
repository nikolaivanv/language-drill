# ES construction-coverage backlog — 2026-08-19

Generated from `pnpm audit:constructions --language ES` (report `es-full-2026-08-19`, prompt `construction-coverage@2026-08-18`, seed `default`, sample cap 24), then re-grouped 2026-08-19 by what each point actually needs.

**Not every finding is authoring work.** A point whose variants are already declared is collapsed because its pool PREDATES them — the remedy there is the retrofit repass PR #631 never ran, not a second variant list. The three buckets below are ordered by how much work they are.

**Retrofit order, whichever bucket:** merge the curriculum edit → `push-prompts` per env → `backfill:variant-seeds` **before** demotion (legacy rows carry no `seedWord`, so `pickVariantSeeds` reads them as zero coverage and would spread new drafts evenly, deepening the skew) → `demote:pool --reason pool-hygiene` for headroom. Never `--reason quality` — that revokes learners' credit for past attempts.

**Nightly pre-generation is paused in prod (#672)** precisely so variants can land first. Demoting before it resumes creates headroom nothing refills.

**Before acting on a row, check it against the pool by hand.** The classifier labels what a row *tests*, not what it contains, so when constructions nest the specific one absorbs the general one's rows. A `0` beside a high-share sibling can mean "never tested on its own" rather than "absent". Two constructions the audit proposed have already been rejected on exactly these grounds (`clitic-shift` on the A2 periphrases, `gender-agreement`/`usted-register` on the direct object pronouns): each was orthogonal to the variant axis rather than a member of it.

## Scope

- Points enumerated: **110 / 114** in scope · judged single-construction: **2**
- Findings: **162** across **90** points
- Needs authoring: **11** · needs topping up: **4** · needs only the repass: **75**

### Never examined — re-run after the enumeration fixes in #673

- `es-a2-diacritic-pairs` — id 'tu-tú' must be kebab-case
- `es-a2-si-present-conditional` — constructions must be an array
- `es-b2-conditional-connectors` — constructions must be an array
- `es-b2-correlative-comparison` — constructions must be an array

## Bucket A — no variants declared: author them

These points declare no `constructionVariants` at all. Author a list, then repass.

### AUTHOR-1. `es-b2-adjective-position` — Adjective position and meaning

- **B2** · mechanism: **construction-variants** · cells: translation (1 of 5)
- Under-represented:
  - `postnominal-literal-meaning` — Postnominal position yields literal/physical meaning — **0/24**

### AUTHOR-2. `es-b2-nuanced-ser-estar` — Nuanced ser vs. estar

- **B2** · mechanism: **construction-variants** · cells: translation (1 of 3)
- Under-represented:
  - `resultant-state-estar-past-participle` — Resultant-state estar + past participle — **0/24**

### AUTHOR-3. `es-b2-reported-speech-backshift` — Reported speech — full backshift

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 5)
- Under-represented:
  - `command-to-imperfect-subjunctive` — Reported command → Imperfect subjunctive — **0/24**

### AUTHOR-4. `es-b2-causal-connectors` — Formal causal connectors: ya que, puesto que, debido a que, enunciative porque

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 4), translation (1 of 4)
- Under-represented:
  - `debido-a-que` — debido a que (formal causal alternative) — **1/24**
  - `ya-que-puesto-que` — ya que / puesto que (formal 'since/given that') — **1/24**

### AUTHOR-5. `es-a2-gustar-type-verbs` — Gustar-type verbs (extended)

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 4)
- Under-represented:
  - `a-tonic-reduplication` — a + tonic pronoun/name reduplication for clarification or contrast — **1/24**

### AUTHOR-6. `es-a2-preterite-irregular` — Preterite — irregular verbs

- **A2** · mechanism: **coverage-spec** · cells: cloze (1 of 3)
- Under-represented:
  - `preterite-ser-ir-fui` — Shared preterite of ser/ir (fui/fuiste/fue/fuimos/fuisteis/fueron) — **1/24**

### AUTHOR-7. `es-b1-nominalizers` — Nominalizers el de / el que ("the one...")

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 5), translation (1 of 5)
- Under-represented:
  - `adjective-nominalizer` — Article/determiner + adjective (adjectival nominalizer) — **1/24**

### AUTHOR-8. `es-b1-ser-estar-uses` — Ser/estar special uses: impersonal time, estar de + occupation, estar a + price/date

- **B1** · mechanism: **construction-variants** · cells: translation (1 of 5)
- Under-represented:
  - `impersonal-ser-time` — Impersonal ser for time/period of day — **1/24**

### AUTHOR-9. `es-b2-cleft-sentences` — Cleft sentences: ser-focus with relator agreement

- **B2** · mechanism: **construction-variants** · cells: translation (1 of 7)
- Under-represented:
  - `cleft-time-cuando` — Time-focus cleft with cuando — **1/24**

### AUTHOR-10. `es-b2-past-subjunctive` — Past (imperfect) subjunctive

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 3)
- Under-represented:
  - `counterfactual-si-clause` — Counterfactual 'si' clause with imperfect subjunctive + conditional — **1/24**

### AUTHOR-11. `es-b2-subjunctive-compound` — Compound subjunctive: perfect and pluperfect

- **B2** · mechanism: **construction-variants** · cells: translation (1 of 3)
- Under-represented:
  - `pluperfect-subjunctive-hubiera-hubiese-participle` — Pluperfect subjunctive: hubiera/hubiese + participle (non-si-clause uses) — **1/24**

## Bucket B — variants declared but incomplete: add the missing ones

These already declare some variants; the audit found constructions the existing list does not cover. Add only the missing ones — do not restate the existing.

### TOP-UP-1. `es-a2-periphrases-obligation-aspect` — Obligation and aspect periphrases

- **A2** · mechanism: **construction-variants** · cells: cloze (5 of 8), translation (6 of 8)
- Under-represented:
  - `empezar-a-infinitive` — empezar a + infinitive (to begin doing) — **0/24**
  - `soler-infinitive` — soler + infinitive (habitual action, present/imperfect only) — **0/24**
  - `clitic-shift` — Optional clitic shift (verlo vs. lo + conjugated verb) — **0/24**
  - `recien-participle` — recién + past participle (newly/just done) — **0/24**
  - `hay-que-infinitive` — hay que + infinitive (impersonal necessity) — **0/24**
  - `volver-a-infinitive` — volver a + infinitive (to do again) — **0/24**
  - `tener-que-infinitive` — tener que + infinitive (personal obligation) — **1/24**

### TOP-UP-2. `es-a2-por-para` — Por vs. para

- **A2** · mechanism: **construction-variants** · cells: cloze (4 of 8), translation (5 of 8)
- Under-represented:
  - `por-duration` — Por = duration of time — **0/24**
  - `por-means-channel` — Por = means / channel / agent — **0/24**
  - `por-fetch-ir-venir` — Por = fetching after ir/venir (a por) — **0/24**
  - `por-movement-location` — Por = movement through / vague location — **0/24**
  - `por-exchange` — Por = exchange / substitution — **1/24**

### TOP-UP-3. `es-a2-estar-gerundio` — Estar + gerundio

- **A2** · mechanism: **construction-variants** · cells: cloze (3 of 9), translation (2 of 9)
- Under-represented:
  - `gerund-formation-y-insertion` — Gerund with y-insertion (leyendo, creyendo) — **0/24**
  - `gerund-formation-stem-change` — Gerund with stem change (durmiendo, pidiendo) — **0/24**
  - `enclitic-pronoun-on-gerund` — Enclitic pronoun(s) attached to the gerund (leyéndolo) — **0/24**
  - `gerund-formation-regular` — Regular gerund formation (-ando/-iendo) — **0/24**

### TOP-UP-4. `es-b2-verbs-of-change` — Verbs of becoming: ponerse, quedarse, hacerse, volverse, convertirse en, llegar a ser

- **B2** · mechanism: **construction-variants** · cells: cloze (3 of 8), translation (4 of 8)
- Under-represented:
  - `hacerse-voluntary-conversion` — hacerse + noun/adjective (voluntary lasting conversion) — **0/24**
  - `resultar-unexpected-outcome` — resultar + noun/adjective (unexpected outcome or impression) — **0/24**
  - `quedarse-resultant-state` — quedarse + adjective/participle (state left by an event) — **1/24**
  - `ponerse-brief-change` — ponerse + adjective (brief mood/appearance change) — **1/24**

## Bucket C — variants already declared: repass only, do NOT author

These already declare at least as many variants as the audit enumerated. **No authoring is needed.** Their pools were generated before the variants existed, so they need `backfill:variant-seeds` + `demote:pool --reason pool-hygiene` and a regeneration pass — the #631 repass that was never run.

### REPASS-1. `es-b1-present-subjunctive` — Present subjunctive

- **B1** · mechanism: **construction-variants** · cells: cloze (6 of 9), translation (6 of 9)
- Under-represented:
  - `subj-with-ojala` — Subjunctive after ojalá (que) — **0/24**
  - `subj-with-quiza-tal-vez` — Subjunctive after quizá / tal vez — **0/24**
  - `indicative-after-a-lo-mejor` — Indicative (not subjunctive) after a lo mejor — **0/24**
  - `noun-de-que-subj` — Subjunctive in noun + de que clauses (la esperanza de que llueva) — **0/24**
  - `fronted-el-hecho-de-que-subj` — Subjunctive in fronted el (hecho de) que clauses — **0/24**
  - `que-wish-command` — Independent que-wishes / third-person commands (¡Que te vaya bien!; Que entre) — **0/24**

### REPASS-2. `es-a1-negation-tampoco` — Negation with no, sí/no answers, and también/tampoco

- **A1** · mechanism: **construction-variants** · cells: cloze (4 of 6), translation (5 of 6)
- Under-represented:
  - `pre-verb-negation-no` — Sentence negation: no before the verb — **0/20**
  - `si-no-short-answers` — Sí/No as short answers to yes/no questions — **0/20**
  - `confirmation-tag-no` — Confirmation tag ¿no? — **0/20**
  - `ya-no-no-longer` — Ya no for 'no longer' — **0/20**
  - `tambien-agreement-affirmative` — También to agree with an affirmative statement — **0/18**

### REPASS-3. `es-b1-llevar-time-expressions` — Duration and time-span expressions

- **B1** · mechanism: **construction-variants** · cells: cloze (4 of 6), translation (5 of 6)
- Under-represented:
  - `hacia-period-que-imperfect` — hacía + period + que + imperfect (past-shifted ongoing) — **0/24**
  - `tardar-en-infinitive` — tardar + en + infinitive (time taken to do something) — **0/24**
  - `dentro-de-period` — dentro de + period (time from now) — **0/24**
  - `past-tense-durante-period` — past tense + (durante) + period (completed duration) — **0/24**
  - `hace-period-que-present` — hace + period + que + present indicative — **0/24**

### REPASS-4. `es-a2-direct-object-pronouns` — Direct object pronouns

- **A2** · mechanism: **construction-variants** · cells: cloze (4 of 8), translation (5 of 8)
- Under-represented:
  - `dop-enclisis-imperative` — Enclisis on positive imperative (Cómpralo) — **0/24**
  - `dop-periphrastic-shift` — Periphrastic clitic climbing / enclisis alternation (lo voy a comprar / voy a comprarlo) — **0/24**
  - `dop-gender-agreement` — Gender/number agreement of lo/la/los/las with replaced noun — **0/24**
  - `dop-neuter-lo` — Neuter lo replacing a whole idea or clause — **0/24**
  - `dop-enclisis-infinitive` — Enclisis on infinitive (verlo) — **0/24**

### REPASS-5. `es-b2-consecutives-intensity` — Consecutive clauses of intensity: tan/tanto…que, de manera que, por lo tanto

- **B2** · mechanism: **construction-variants** · cells: cloze (4 of 6), translation (3 of 6)
- Under-represented:
  - `tanto-que-verb` — verb + tanto que (invariable, modifying a verb) — **0/24**
  - `de-manera-modo-que-indicative` — de manera/modo que + indicative (result) — **0/24**
  - `por-lo-tanto-formal-connectors` — por lo tanto / por consiguiente (formal connectors) — **0/24**
  - `suficiente-bastante-demasiado-para-inf` — suficiente(s)/bastante/demasiado… (como) para + infinitive — **0/24**

### REPASS-6. `es-b1-discourse-connectors` — Discourse connectors: sin embargo, o sea que, causal como, por + infinitivo, aunque + indicative

- **B1** · mechanism: **construction-variants** · cells: cloze (2 of 9), translation (4 of 9)
- Under-represented:
  - `o-sea-que-asi-que-resumptive` — Resumptive o sea que / así (es) que (so / in other words) — **0/24**
  - `por-infinitivo` — Causal por + infinitive (por no molestarte) — **0/24**
  - `sin-embargo` — Adversative sin embargo (however) — **0/24**
  - `fronted-causal-como` — Fronted causal como + clause (Como no venías, …) — **0/24**

### REPASS-7. `es-a1-noun-gender` — Noun gender

- **A1** · mechanism: **construction-variants** · cells: cloze (3 of 8), translation (3 of 8)
- Under-represented:
  - `heteronym-pairs` — Heteronym pairs (el padre / la madre, el capital / la capital) — **0/19**
  - `profession-o-a-feminisation` — Profession nouns: -o → -a feminisation (el arquitecto / la arquitecta) — **0/19**
  - `invariable-profession-nouns` — Invariable profession/role nouns with article marking sex (el/la juez, la persona, la víctima) — **0/19**

### REPASS-8. `es-a1-noun-plural` — Noun plural

- **A1** · mechanism: **coverage-spec** · cells: cloze (3 of 10), translation (3 of 10)
- Under-represented:
  - `plural-es-stressed-final-s` — Plural -es after stressed final -s (país → países) — **0/17**
  - `plural-invariable-unstressed-vowel-s` — Invariable plural for nouns in unstressed vowel + s (lunes, crisis) — **0/17**
  - `plural-z-to-c-spelling` — Spelling change z → c before -es (lápiz → lápices) — **0/17**

### REPASS-9. `es-a2-exclamatives-impersonals` — Exclamatives with qué and impersonal weather expressions

- **A2** · mechanism: **construction-variants** · cells: cloze (3 of 6), translation (3 of 6)
- Under-represented:
  - `que-noun` — ¡Qué + bare noun! — **0/24**
  - `que-exhortative` — Fixed exhortative ¡Que + subjunctive! — **0/24**
  - `estar-a-temperatura` — Estamos a + number + grados — **0/24**
  - `hacer-weather` — Impersonal hacer + weather noun/adjective — **1/24**

### REPASS-10. `es-a2-mente-adverbs` — Adverbs in -mente

- **A2** · mechanism: **construction-variants** · cells: cloze (4 of 6), translation (3 of 6)
- Under-represented:
  - `mente-invariable-base` — -mente on invariable adjective form — **0/24**
  - `mente-coordination-drop` — -mente dropped from all but last coordinated adverb — **0/24**
  - `suppletive-bien-mal` — Suppletive adverbs bien / mal — **0/24**
  - `adjective-adverb-set-verbs` — Invariable adjective-adverbs with set verbs (hablar claro, etc.) — **0/24**

### REPASS-11. `es-a2-present-irregular-stem-changes` — Present indicative — irregular stem changes

- **A2** · mechanism: **construction-variants** · cells: cloze (4 of 8), translation (2 of 8)
- Under-represented:
  - `irregular-yo-saber-dar` — Suppletive/irregular yo-forms: sé, doy — **0/24**
  - `orthographic-yo-ger-gir-guir` — Orthographic yo-form change: -ger/-gir → -jo; -guir → -go (cojo, sigo) — **0/24**
  - `boot-iar-uar-accent` — Stressed accent in boot of -iar/-uar verbs (envío, actúo) — **0/24**
  - `boot-uir-y-insertion` — y-insertion in boot of -uir verbs (construyo, construyes…) — **0/24**

### REPASS-12. `es-b1-aspectual-periphrases` — Aspectual periphrases: dejar de, ponerse a, estar a punto de, seguir + gerundio

- **B1** · mechanism: **construction-variants** · cells: cloze (2 of 7), translation (4 of 7)
- Under-represented:
  - `quedarse-acabar-gerundio` — quedarse / acabar + gerundio (resultative/completive) — **0/24**
  - `tener-participle-agreement` — resultative tener + agreeing participle — **0/24**
  - `ponerse-a-infinitivo` — ponerse a + infinitivo (inceptive) — **0/24**
  - `dejar-de-infinitivo` — dejar de + infinitivo (cessative) — **1/24**

### REPASS-13. `es-b2-clitic-advanced` — Advanced clitics: neuter lo, fronted-object doubling, leísmo de persona

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 7), translation (3 of 7)
- Under-represented:
  - `ello-after-preposition` — Neuter ello as prepositional complement — **0/24**
  - `le-with-specific-verbs-inanimate-subject` — Le for human object with creer/pegar/obedecer or inanimate subject — **0/24**
  - `leismo-de-persona-masculine` — Accepted leísmo de persona for masculine human direct objects — **0/24**

### REPASS-14. `es-a2-articles-use` — Article use and omission

- **A2** · mechanism: **construction-variants** · cells: cloze (2 of 9), translation (4 of 9)
- Under-represented:
  - `el-before-tonic-a-feminine` — el/un before tonic-a feminine nouns (el aula, el águila) — **0/24**
  - `zero-article-mass-plural-unspecified` — Zero article with unspecified mass/plural nouns (Bebe agua) — **0/24**
  - `definite-article-clothing-possessions` — Definite article for clothing/body-part actions (se puso el abrigo) — **0/24**
  - `definite-article-days-of-week` — Definite article with days of the week (el lunes / los lunes) — **1/24**
  - `generic-definite-article-abstract-mass` — Generic definite article with abstract/mass nouns (El chocolate es malo) — **1/24**

### REPASS-15. `es-a1-coordination-basic` — Basic coordinators: y, o, pero, ni, unos...otros

- **A1** · mechanism: **construction-variants** · cells: translation (3 of 5), cloze (1 of 5)
- Under-represented:
  - `coordinator-y` — y (and) linking two items or clauses — **0/20**
  - `coordinator-o` — o (or) linking two items or clauses — **0/20**
  - `coordinator-ni-ni` — ni...ni / no...ni joining two negated elements — **0/20**
  - `correlative-unos-otros` — unos...otros contrasting two parts of a group — **0/19**

### REPASS-16. `es-b1-reported-speech` — Reported speech: backshift, no-shift, and reported commands

- **B1** · mechanism: **construction-variants** · cells: cloze (2 of 3), translation (2 of 3)
- Under-represented:
  - `present-zone-no-shift` — No backshift after present-zone reporting verb (including perfect) — **0/24**
  - `reported-command-que-subjunctive` — Reported command with que + present subjunctive — **0/24**

### REPASS-17. `es-a1-ser-estar-basic` — Ser and estar (basic contrast)

- **A1** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (1 of 6)
- Under-represented:
  - `ser-identity-profession-nationality-origin` — Ser for identity, profession, nationality, or origin — **0/20**
  - `ser-material-de` — Ser + de + material — **0/20**

### REPASS-18. `es-b1-passive-se` — Passive and impersonal "se"

- **B1** · mechanism: **construction-variants** · cells: cloze (2 of 4), translation (2 of 4)
- Under-represented:
  - `impersonal-se-human-object-le-les` — Impersonal se with human object (se le/les) — **0/24**
  - `uno-se-pronominal-impersonal` — Uno + pronominal verb for impersonal (avoiding *se se) — **0/24**

### REPASS-19. `es-b2-comparatives-advanced` — Advanced comparatives: de lo que, superior/inferior a, el doble de, igual que

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (2 of 6)
- Under-represented:
  - `superior-inferior-a` — superior/inferior a (Latin-root comparatives with 'a') — **0/24**
  - `bare-mas-n-que-n` — más/menos N que N (bare noun-vs-noun comparison) — **0/24**

### REPASS-20. `es-b2-se-middle-accidental` — Middle se and accidental se (dative of interest)

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 3), translation (1 of 3)
- Under-represented:
  - `middle-se-spontaneous` — Middle se (spontaneous/subjectless event) — **0/24**
  - `nuance-se-motion-verbs` — Nuance-adding se on motion verbs (irse, venirse, caerse, salirse) — **0/24**

### REPASS-21. `es-a1-porque-para` — Porque, para + infinitive, and por qué

- **A1** · mechanism: **construction-variants** · cells: cloze (2 of 3), translation (1 of 3)
- Under-represented:
  - `por-que-interrogative` — por qué (two words) in questions and indirect questions — **0/20**
  - `porque-indicative` — porque + indicative verb (stating a cause) — **1/20**

### REPASS-22. `es-b1-impersonal-plural` — Impersonal third-person plural for unspecified agents

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 3), translation (1 of 3)
- Under-represented:
  - `impersonal-uno-una` — uno/una + 3sg verb for generic agent — **0/24**

### REPASS-23. `es-b1-que-vs-cual` — Qué vs. cuál/cuáles

- **B1** · mechanism: **construction-variants** · cells: cloze (3 of 6), translation (2 of 6)
- Under-represented:
  - `preposition-fronting` — Preposition fronted before interrogative (no stranding) — **0/24**
  - `que-definition-category` — Qué + ser for definition/category — **1/24**
  - `que-before-noun` — Qué (not cuál) directly before a noun — **1/24**

### REPASS-24. `es-a1-quantifiers-muy-mucho` — Quantifiers and muy vs. mucho

- **A1** · mechanism: **construction-variants** · cells: cloze (1 of 3)
- Under-represented:
  - `mucho-after-verb` — mucho as invariable adverb after a verb — **0/16**

### REPASS-25. `es-b1-imperative-negative-pronouns` — Negative imperative and clitic pronoun placement

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 3)
- Under-represented:
  - `affirmative-imperative-enclitic-multi-accent` — Affirmative imperative with two enclitics and written accent (díselo, dámelas) — **0/24**


### REPASS-26. `es-a2-imperative-affirmative` — Affirmative imperative

- **A2** · mechanism: **construction-variants** · cells: cloze (3 of 6), translation (2 of 6)
- **Note (2026-08-19):** the point's `person` coverageSpec (2sg 10 / 3sg 8 / 3pl 8) was REMOVED when the variants were authored — three of them hard-code a person, so the two mechanisms would emit contradictory MUSTs into the same draft prompt. Do not restore it while the variants stand.
- Under-represented:
  - `imperative-vosotros` — Vosotros imperative (hablad, comed, vivid) — **0/24**
  - `imperative-usted-ustedes` — Usted/ustedes imperative built on present subjunctive (hable, hablen) — **0/24**
  - `imperative-enclitic-pronoun` — Enclitic pronoun attachment (cómpralo, dímelo) — **0/24**

### REPASS-27. `es-a2-indefinites-double-negation` — Indefinite/negative pairs and double negation

- **A2** · mechanism: **construction-variants** · cells: cloze (2 of 8), translation (3 of 8)
- Under-represented:
  - `algunos-de-phrase` — 'algunos de los…' quantifying a de-phrase (vs. *unos de los…) — **0/24**
  - `ni-siquiera` — 'ni siquiera' = 'not even' (pre-verbal, no 'no' needed) — **0/24**
  - `adverbial-nada-not-at-all` — Adverbial nada = 'not at all' (No me gusta nada) — **1/24**

### REPASS-28. `es-a2-personal-a` — Personal a

- **A2** · mechanism: **construction-variants** · cells: cloze (3 of 7), translation (2 of 7)
- Under-represented:
  - `personal-a-omitted-indefinite` — Omission of personal a before an unspecified/indefinite person — **0/24**
  - `personal-a-tonic-pronoun-clitic` — a + tonic pronoun requires the clitic (Lo vi a él) — **0/24**
  - `personal-a-alguien-nadie-quien` — Obligatory personal a before alguien, nadie, quién — **1/24**

### REPASS-29. `es-b1-superlatives-comparisons` — Superlatives and comparisons: el más/menos…de, -ísimo, igual de…que, más/menos de

- **B1** · mechanism: **construction-variants** · cells: cloze (3 of 5), translation (3 of 5)
- Under-represented:
  - `elative-isimo-adjective` — Elative suffix -ísimo on adjectives — **0/24**
  - `elative-isimo-adverb` — Elative -ísima- infixed in -mente adverbs / irregular forms (lejísimos, cerquísima) — **0/24**
  - `equality-igual-de-que` — Equality comparison: igual de + adj + que — **0/24**

### REPASS-30. `es-b1-verb-preposition-regime` — Verb + preposition regime

- **B1** · mechanism: **construction-variants** · cells: cloze (3 of 8), translation (2 of 8)
- Under-represented:
  - `adj-prep-regime` — Fixed prepositional regime of adjectives (amable con, harto de) — **0/24**
  - `prep-retained-before-que` — Governed preposition retained before que-clause (de que / queísmo) — **0/24**
  - `prep-infinitive-not-gerund` — Infinitive (not gerund) after any preposition — **1/24**

### REPASS-31. `es-a1-gender-agreement` — Noun-adjective agreement

- **A1** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (2 of 6)
- Under-represented:
  - `invariable-gentilicio-agreement` — Invariable gentilicio (e.g. marroquí — no -a added) — **0/18**
  - `invariable-compound-colour-adjectives` — Invariable compound/noun-derived colour adjectives (e.g. naranja, verde oscuro) — **0/18**

### REPASS-32. `es-a1-querer-poder-infinitive` — Querer and poder with the infinitive

- **A1** · mechanism: **construction-variants** · cells: cloze (2 of 3), translation (2 of 3)
- Under-represented:
  - `infinitive-as-subject-masc-sg-adjective` — Infinitive (or clause) as subject → masculine singular adjective agreement — **0/19**
  - `creer-que-indicative` — creer que + indicative — **0/19**

### REPASS-33. `es-b1-preterite-imperfect-meaning` — Meaning-changing preterite vs. imperfect

- **B1** · mechanism the audit proposed: **coverage-spec** · cells: cloze (2 of 6), translation (2 of 6)
- **Authored as `constructionVariants`, not a coverage spec** (2026-08-19): the audit's axis was one value per verb, and each verb here is a distinct meaning contrast the point teaches rather than lexical variety. A new coverage axis name would also have to be threaded through `renderCoverageBlock` and `legalAxesFor` by hand. Do not add a spec on top.
- Under-represented:
  - `tener-pret-vs-imperf` — tener: tuve (got/received) vs. tenía (had) — **0/24**
  - `estar-pret-vs-imperf` — estar: estuvo (state finally reached) vs. estaba (was/ongoing) — **0/24**

### REPASS-34. `es-b2-passive-voice` — Passive voice: ser vs estar + participle

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 7), translation (2 of 7)
- Under-represented:
  - `se-passive-postverbal-bare-noun` — se-passive with postverbal bare-noun subject — **0/24**
  - `sin-por-a-medio-infinitive-passive` — sin/por/a medio + infinitive with passive force — **0/24**

### REPASS-35. `es-b2-perception-verbs` — Ver/oír + infinitive or gerund

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 5), translation (2 of 5)
- Under-represented:
  - `perception-verb-que-clause` — ver/oír que + finite clause (neutral alternative) — **0/24**
  - `le-dative-infinitive-own-object` — le oír/ver + infinitive with its own object (dative clitic) — **0/24**

### REPASS-36. `es-a2-connectors` — Connectors: e/u substitution, por eso, entonces

- **A2** · mechanism: **construction-variants** · cells: translation (4 of 5), cloze (2 of 5)
- Under-represented:
  - `y-exception-hie` — y retained before hie- glide (exception) — **0/24**
  - `o-to-u-substitution` — o → u before o-/ho- — **0/24**
  - `luego-vs-entonces-temporal` — luego (afterwards) vs. entonces (at that moment / in that case) — **0/24**
  - `y-to-e-substitution` — y → e before /i/ sound — **1/24**

### REPASS-37. `es-a2-imperfect` — Imperfect

- **A2** · mechanism: **construction-variants** · cells: cloze (2 of 5), translation (3 of 5)
- Under-represented:
  - `imperfect-preterite-contrast` — Imperfect vs. preterite contrast (background vs. completed event) — **0/24**
  - `courtesy-imperfect` — Courtesy imperfect for polite requests (Quería…) — **0/24**
  - `imperfect-background-description` — Imperfect for background states / descriptions — **1/24**

### REPASS-38. `es-a2-reflexive-verbs` — Reflexive verbs

- **A2** · mechanism: **construction-variants** · cells: cloze (3 of 6), translation (2 of 6)
- Under-represented:
  - `reflexive-pronoun-attached-nonfinite` — Reflexive pronoun attached to infinitive, gerund, or positive imperative — **0/24**
  - `inherently-pronominal-verbs` — Always-pronominal verbs (quejarse, atreverse a) — **0/24**
  - `reflexive-preverbal-pronoun` — Reflexive pronoun before conjugated verb — **1/24**

### REPASS-39. `es-a2-temporal-clauses` — Temporal clauses: cuando, antes de, después de, desde, hasta

- **A2** · mechanism: **construction-variants** · cells: translation (3 of 8), cloze (1 of 8)
- Under-represented:
  - `desde-point-in-time` — desde + calendar/clock point (starting point) — **0/24**
  - `desde-hace-duration` — desde hace + duration (length of time) — **0/24**
  - `hasta-until` — hasta + time expression (until/up to) — **1/24**

### REPASS-40. `es-a2-tonic-pronouns-prepositions` — Tonic pronouns after prepositions

- **A2** · mechanism: **construction-variants** · cells: cloze (2 of 5), translation (3 of 5)
- **Note (2026-08-19):** the point's `person` coverageSpec (1sg 8 / 2sg 8 / 3sg 6) was REMOVED when the variants were authored — mí/ti and conmigo/contigo are 1sg/2sg by definition and sí/consigo is 3sg, so person is what distinguishes the forms rather than an orthogonal axis, and the two mechanisms would emit contradictory MUSTs. Do not restore it.
- Under-represented:
  - `exception-prepositions-subject-form` — Subject-form pronouns after exception prepositions (entre, según, hasta, incluso) — **0/24**
  - `reflexive-third-si-consigo` — Reflexive third-person sí (mismo) / consigo — **0/24**
  - `conmigo-contigo-fusion` — Mandatory conmigo / contigo fusion with con — **1/24**

### REPASS-41. `es-a1-possessives-atonic` — Possessive adjectives (short forms)

- **A1** · mechanism: **construction-variants** · cells: translation (1 of 6), cloze (2 of 6)
- **Note (2026-08-19):** the possessor paradigm IS this point's `person` coverageSpec, which is KEPT; only the three constructions orthogonal to possessor person were declared as variants. `su-disambiguation-de-pronoun` was deliberately NOT declared — de + pronoun only disambiguates the third person, so it would fight the spec. It stays served by the spec's 3sg ordinals; if it is still absent after the repass, the fix is a seed pool, not a variant.
- Under-represented:
  - `su-disambiguation-de-pronoun` — Disambiguating su with de + pronoun (la camisa de él) — **0/18**
  - `nuestro-vuestro-gender-number` — nuestro/vuestro – gender AND number agreement — **0/10**

### REPASS-42. `es-a2-cada-mismo` — Cada and mismo

- **A2** · mechanism: **construction-variants** · cells: cloze (2 of 5), translation (1 of 5)
- Under-represented:
  - `cada-invariable` — Invariable distributive cada (+ singular noun / + numeral + plural noun) — **0/24**
  - `mismo-emphatic` — Emphatic pronoun + mismo/misma (yo mismo, ella misma) — **0/24**

### REPASS-43. `es-b2-gerund-participle-constructions` — Adverbial gerund, nada más + infinitive, and predicative participle clauses

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (1 of 6)
- Under-represented:
  - `como-gerund-como-si` — como + gerund (≈ como si) — **0/24**
  - `una-vez-participle-prior-event` — una vez + participle (prior completed event) — **0/24**

### REPASS-44. `es-b2-subjunctive-negated-opinion` — Subjunctive after negated opinion and assertion

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 4), translation (2 of 4)
- **Note (2026-08-19):** the point's `polarity` coverageSpec (negative 10 / affirmative 8) was REMOVED when the variants were authored — every construction here is defined by its polarity. The affirmative half (`creo que` + indicative) is now its own variant, which is why the contrast survives the removal. Do not restore the spec.
- Under-represented:
  - `negated-verb-of-saying-past-subjunctive` — Negated verb of saying + past subjunctive (no me dijo que hubiera…) — **0/24**
  - `no-es-cierto-verdad-que-subjunctive` — no es cierto/verdad que + subjunctive — **0/24**

### REPASS-45. `es-b2-subjunctive-temporal-concessive` — Subjunctive in temporal and concessive connectors

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (2 of 6)
- Under-represented:
  - `temporal-connector-indicative-past-habitual` — Temporal connector + indicative (past/habitual reference) — **0/24**
  - `reduplicative-subjunctive` — Reduplicative subjunctive (pase lo que pase, vaya donde vaya, le guste o no) — **0/24**

### REPASS-46. `es-b2-quantifiers-advanced` — Advanced quantifiers: cualquier(a), partitives, multiplicatives, algo + adjective

- **B2** · mechanism: **construction-variants** · cells: cloze (4 of 8), translation (2 of 8)
- Under-represented:
  - `cualquiera-standalone-pronoun` — cualquiera as standalone pronoun — **0/24**
  - `ratio-tres-de-cada` — Ratio: N de cada N + noun — **0/24**
  - `partitive-fraction` — Partitive: la mitad de / un tercio de + noun phrase — **1/24**
  - `multiplicative-doble-de` — Multiplicative: el doble de + noun phrase — **1/24**

### REPASS-47. `es-b2-relative-clauses-advanced` — Advanced relative clauses

- **B2** · mechanism: **construction-variants** · cells: cloze (3 of 7), translation (1 of 7)
- Under-represented:
  - `explicativa-comma-relative` — Non-restrictive (explicativa) relative clause set off by commas — **0/24**
  - `donde-relative` — donde relative clause — **0/24**
  - `indicative-vs-subjunctive-relative` — Indicative vs. subjunctive in relative clauses (specific vs. non-specific antecedent) — **1/24**
  - `lo-que-relative` — lo que (neuter relative / free relative) — **1/24**

### REPASS-48. `es-a1-articles` — Definite and indefinite articles

- **A1** · mechanism: **construction-variants** · cells: cloze (2 of 5), translation (1 of 5)
- **Note (2026-08-19):** the `number` coverageSpec is KEPT — four of the eight claimed forms are plural — and four of the five variants are number-free. The exception is `contraction-al-del` (al/del contract the masculine singular `el` only); its directive tells the draft to carry any plural coverage target on another noun instead, so the one place the two mechanisms touch is resolved in the directive.
- Under-represented:
  - `contraction-al-del` — Mandatory contractions al and del — **0/20**
  - `definite-article-gender-number` — Definite articles el/la/los/las — **0/19**
  - `hay-no-article` — Omission of article after impersonal hay — **1/20**

### REPASS-49. `es-b2-lo-nominalizer` — Lo as nominalizer: lo + adjective, lo de, lo que, lo + adj + que

- **B2** · mechanism: **construction-variants** · cells: cloze (2 of 6), translation (2 of 6)
- Under-represented:
  - `lo-adj-abstract-noun` — lo + adjective (abstract nominalizer) — **0/24**
  - `lo-que-relative` — lo que relative clause — **0/24**
  - `lo-de-noun-phrase` — lo de + noun phrase — **1/24**

### REPASS-50. `es-a1-demonstratives` — Demonstratives

- **A1** · mechanism: **construction-variants** · cells: translation (1 of 5), cloze (1 of 5)
- Under-represented:
  - `demonstrative-pronoun-neuter` — Neuter demonstrative pronoun (esto/eso/aquello) — **0/19**
  - `demonstrative-pronoun-gendered` — Demonstrative pronoun replacing a noun (este/ese/aquel without noun) — **0/13**

### REPASS-51. `es-a2-preterito-perfecto` — Pretérito perfecto

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 6), translation (2 of 6)
- Under-represented:
  - `haber-plus-irregular-participle` — haber + irregular past participle — **0/24**
  - `haber-plus-regular-participle` — haber + regular past participle — **1/24**

### REPASS-52. `es-b1-deber-obligation-probability` — Deber + infinitivo vs. deber de + infinitivo

- **B1** · mechanism: **construction-variants** · cells: translation (2 of 5), cloze (1 of 5)
- Under-represented:
  - `deberias-softened-advice` — deberías + infinitivo (softened advice) — **0/24**
  - `modal-haber-participle-past` — modal + haber + participio (past reference) — **0/24**

### REPASS-53. `es-b2-gradual-gerund` — Ir/venir + gerundio (gradual action)

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 3), translation (2 of 3)
- Under-represented:
  - `andar-gerundio-intermittent` — andar + gerundio (intermittent/habitual action) — **0/24**
  - `venir-gerundio-up-to-now` — venir + gerundio (process up to now) — **1/24**

### REPASS-54. `es-b2-nosotros-imperative` — Nosotros imperative (¡Empecemos!)

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 5), translation (1 of 5)
- **Note (2026-08-19):** the point's `polarity` coverageSpec (affirmative 8 / negative 8) was REMOVED when the variants were authored — every variant hard-codes a polarity, so the two mechanisms would emit contradictory MUSTs. The shares subsume the floors (~27 affirmative / ~14 negative at the B2 target of 50). Do not restore it.
- Under-represented:
  - `nosotros-imperative-negative` — Negative nosotros imperative with preverbal pronoun — e.g. No nos sentemos — **0/24**
  - `nosotros-imperative-affirmative-nos-clitic` — Affirmative nosotros imperative + enclitic nos with -s drop — e.g. Sentémonos — **0/24**

### REPASS-55. `es-a1-interrogatives` — Question words

- **A1** · mechanism: **construction-variants** · cells: translation (1 of 4), cloze (1 of 4)
- Under-represented:
  - `yes-no-question-intonation-inversion` — Yes/no question via intonation or inversion (no helper verb) — **0/20**

### REPASS-56. `es-a1-subject-pronouns` — Subject pronouns

- **A1** · mechanism: **coverage-spec** · cells: cloze (1 of 7), translation (1 of 7)
- **Note (2026-08-19):** four proposed constructions (`nosotros-nosotras-gender`, `tu-vs-usted-register`, `no-pronoun-for-things`, `vosotros-vs-ustedes`) were NOT declared — each pins the possessor/subject person that this point's `person` coverageSpec already floors at 4 per person, and the last is a dialect choice rather than a construction. The spec is kept; only the three person-free constructions became variants.
- Under-represented:
  - `pronoun-omission-default` — Default omission of subject pronoun — **0/20**

### REPASS-57. `es-a2-comparatives-superlatives` — Comparatives

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 5), translation (1 of 5)
- **Note (2026-08-19):** the point's `comparison` coverageSpec (comparative 14 / less 8 / equative 8) was REMOVED when the variants were authored — four of the five variants encode a comparison value. The variants are strictly finer: the spec's single `equative` value is split into the `tan…como` and `tanto…como` halves, which is the collapse this finding is about. `curriculum.test.ts` now asserts the absence. Do not restore it.
- Under-represented:
  - `equality-noun-verb` — Equality with nouns/verbs: tanto/a/os/as … como — **0/24**

### REPASS-58. `es-a2-hace-ago` — Hace + time period = "ago"

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 2), translation (1 of 2)
- Under-represented:
  - `desde-hace-duration` — Desde hace + period (ongoing duration) — **0/24**

### REPASS-59. `es-a2-indirect-object-pronouns-se` — Indirect object pronouns and se

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 5), translation (1 of 5)
- Under-represented:
  - `clitic-order-se-first` — Fixed clitic cluster order: se > te/os > me/nos > lo/la/los/las — **0/24**

### REPASS-60. `es-a2-ir-a-future` — Ir a + infinitive

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 2), translation (1 of 2)
- Under-represented:
  - `present-indicative-future-marker` — Present indicative + future time expression (mañana salgo) — **0/24**

### REPASS-61. `es-a2-preterite-strong-stems` — Preterite — strong stems (pude, puse, dije...)

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 4), translation (1 of 4)
- Under-represented:
  - `i-stem-preterite` — I-stem strong preterites (quise, vine) — **0/24**

### REPASS-62. `es-b1-ser-location-events` — Ser for the location of events

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 3), translation (1 of 3)
- Under-represented:
  - `ser-event-time` — Ser for the time of an event — **0/24**

### REPASS-63. `es-b1-subjunctive-adverbial` — Subjunctive in adverbial clauses

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 5), translation (1 of 5)
- Under-represented:
  - `sin-que-subjunctive` — sin que + subjunctive (different subjects) — **0/24**

### REPASS-64. `es-b2-complex-conditionals` — Complex conditional sentences

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 3), translation (1 of 3)
- Under-represented:
  - `past-counterfactual-hubiera-result` — Si + pluperfect subjunctive → hubiera + participle (result clause) — **0/24**

### REPASS-65. `es-b2-conditional-perfect` — Conditional perfect

- **B2** · mechanism: **construction-variants** · cells: cloze (1 of 3), translation (1 of 3)
- Under-represented:
  - `conditional-perfect-standalone` — Standalone conditional perfect (hypothetical past) — **0/24**

### REPASS-66. `es-b2-cuyo` — Relative possessive cuyo

- **B2** · mechanism: **coverage-spec** · cells: cloze (1 of 4), translation (1 of 4)
- Under-represented:
  - `cuyo-vs-que-su-calque` — cuyo instead of *que + possessive (que sus novelas) — **0/24**

### REPASS-67. `es-a1-present-indicative-regular` — Present indicative (regular verbs)

- **A1** · mechanism: **coverage-spec** · cells: translation (2 of 6), cloze (1 of 6)
- **Note (2026-08-19):** the audit also enumerated the three conjugation classes (-ar/-er/-ir). They were NOT declared as variants: a row is simultaneously a class AND a use, so only one can be the single label coverage is measured on, and the USE axis was chosen (the conjugation cell keeps verb seeding, which varies the classes). If the -er gap survives the repass it is a seed-pool problem, not a missing variant.
- Under-represented:
  - `present-indicative-er-verbs` — Present indicative: -er verbs (comer) — **0/22**
  - `present-indicative-ar-verbs` — Present indicative: -ar verbs (hablar) — **1/22**

### REPASS-68. `es-a1-locative-prepositions` — Locative prepositional phrases

- **A1** · mechanism: **construction-variants** · cells: translation (1 of 6)
- Under-represented:
  - `bare-adverbs-no-de` — Bare locative adverbs without de (fuera, dentro, arriba, abajo) — **0/19**

### REPASS-69. `es-a1-noun-modifiers-de` — Noun modifiers with de and con

- **A1** · mechanism: **construction-variants** · cells: translation (1 of 4)
- Under-represented:
  - `de-attribute-price-age-measurement` — Attribute de for price, age, or measurement — **0/18**

### REPASS-70. `es-a2-preterite-yo-spelling` — Preterite — yo-form spelling changes (-qué/-gué/-cé)

- **A2** · mechanism: **coverage-spec** · cells: translation (1 of 4)
- **Note (2026-08-19):** the rare -guar → -güé class is deliberately NOT a fourth variant. `targetOverride: 15` wins outright over the variant floor and is tied to the curated `conjugationSeedWords` list, which holds no -guar verb; the curriculum invariant requires targetOverride ≥ 4 × variants, which a fourth (16) would break.
- Under-represented:
  - `gar-gue` — -gar → -gué (e.g. llegar → llegué) — **0/12**

### REPASS-71. `es-a2-saber-poder-ability` — Saber vs. poder for ability

- **A2** · mechanism: **construction-variants** · cells: translation (1 of 3)
- Under-represented:
  - `poder-infinitive-circumstantial` — Poder + infinitive (circumstantial ability / permission) — **0/24**

### REPASS-72. `es-a2-todo-otro-quantifiers` — Todo, otro, demasiado, nada/nadie

- **A2** · mechanism: **construction-variants** · cells: cloze (1 of 6)
- Under-represented:
  - `todo-with-determiner` — todo/toda/todos/todas + article/possessive/demonstrative — **0/24**

### REPASS-73. `es-b1-futuro-simple` — Future simple

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 3)
- Under-represented:
  - `futuro-probabilidad` — Future of probability (epistemic future) — **0/24**

### REPASS-74. `es-b1-indirect-questions` — Indirect questions: si, qué, cuándo, dónde + clause or infinitivo

- **B1** · mechanism: **construction-variants** · cells: cloze (1 of 4)
- Under-represented:
  - `indirect-yn-si-infinitive` — Indirect yes/no question with si + infinitive (same subject) — **0/24**

### REPASS-75. `es-b1-past-narration` — Past narration: imperfecto/indefinido interplay

- **B1** · mechanism: **construction-variants** · cells: translation (1 of 3), cloze (1 of 3)
- Under-represented:
  - `al-infinitivo-simultaneous` — Al + infinitivo for 'on/when doing X' — **0/24**
