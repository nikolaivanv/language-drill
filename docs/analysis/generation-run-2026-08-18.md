# Generation Run Analysis — 2026-08-18

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises` + `usage_events`._

## TL;DR

Fifth run since the cron resumed (#646). **120 cells, zero failures, 173 approved, $20.90, ~32 min.** Credits held.

Approval fell hard, **52.1% → 36.6%**, the worst of the post-resume series, and cost per approved row is now **$0.121** (was $0.081, $0.057, $0.043, $0.033). This time the collapse has a *named cause* and it is largely self-inflicted: **the `CURRICULUM_VERSION_ES` bump in #664**.

- **#656 is verified in production and it worked exactly as designed.** Conjugation `context-spoils-answer` went **18 → 1** on 59 requested drafts. Run-wide spoils fell 40 → 14. Rec #1 from 08-17: **closed.**
- **The ES bump released the entire low-yield backlog in one night.** A `CURRICULUM_VERSION_<LANG>` bump clears *both* `skip-low-yield` and target-reached suppression for **every cell in the language**. 14 ES cells that had not run on 08-17 woke up at once: ES requests **67 → 159** while ES approval fell **59.7% → 23.3%**. ES alone accounts for **~12 of the 15.5-point** run-level approval drop. These are cells that were suppressed *because* they generate badly — releasing them together buys one expensive night of churn.
- **The #664 reported-speech retrofit half-landed: the generator obeyed, the validator refused.** 51 of 55 drafts came from the two previously-unrealized variants — the retrofit's whole point, and it worked. But **37 of 51 were flagged, 0 rejected**, and 22 carry `grammar-point-mismatch`. Cause: the point's `name` is still **"Reported speech (present-to-past)"**, and every validator note reasons from that string — *"the target grammar point is 'Reported speech (present-to-past)', which requires a PAST-tense reporting verb"* — even while acknowledging the description now licenses the no-shift case. #664 updated the description and forgot the title. Classic generate↔validate contract split.
- **A second, independent defect in the same retrofit:** `present-report-command-subjunctive` clozes are **person-indeterminate by construction** — "El técnico dice que ___ (apagar)" admits `apagues` / `apague` / `apaguemos` / `apaguen`. 11 of 15 flagged, and the validator explicitly says the grammar point *is* correctly hit. This is the #611/#633 determinacy family, not the name bug.

---

## Run overview

One scheduled run, **04:00:11 → 04:32:41 UTC** (~32.5 min), **120 cells enqueued, 120 succeeded, 0 failed.**

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 475 | 647 | **173** | 158 | 142 | 47 | **$20.90** |

Approval% below = approved / decided, where decided = approved + flagged + rejected = **473**. **36.6% approval, 33.4% flagged, 30.0% rejected.** Of the 142 rejects, **47 are dedup give-ups**; excluding them, quality approval is **40.6%** (vs 57.4% on 08-17).

Cost per approved exercise **$0.121**. Draft churn **647 produced for 475 slots (1.36×)**, essentially flat on yesterday's 1.34×.

Pool after the run: **26,002 approved** (25,659 auto + 343 manual), 8,489 flagged, 4,032 demoted.

| Pool by language | Approved (auto + manual) | Flagged | Demoted |
|---|---|---|---|
| ES | 10,754 + 32 | 3,068 | 1,847 |
| DE | 8,215 + 84 | 1,809 | 225 |
| TR | 6,680 + 227 | 3,612 | 1,960 |

ES approved is **down 13** on 08-16 despite +37 approvals — the #665 pool-hygiene demotion removed 50 rows (`10,799 − 50 + 37 = 10,786`, exact). `pool-hygiene` demotions rose 3,588 → **3,638**; `quality` (384) and `learner-flag` (10) are unchanged.

### Per-language

| Lang | Cells | Req | Prod | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|---|
| de | 75 | 204 | 291 | 98 | **48.5%** | 39 | 65 | 26 | $10.53 |
| es | 20 | 159 | 188 | 37 | **23.3%** | 84 | 38 | 6 | $5.37 |
| tr | 25 | 112 | 168 | 38 | **33.9%** | 35 | 39 | 15 | $5.00 |

The DE/ES positions from 08-17 have **inverted**: DE 285 → 204 requests (its own bump, #658, burned down on 08-17), ES 67 → 159. DE and TR both softened too (53.5% → 48.5%, 41.0% → 33.9%), so this is not purely an ES story — but ES supplies the bulk of it. Holding ES at its 08-17 rate over today's 159 decided drafts would put the run at **~48.8%** instead of 36.6%.

### Per surface

| Type | Cells | Req | Prod | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|---|
| cloze | 50 | 195 | 206 | 81 | 41.5% | 70 | 44 | 1 | $7.92 |
| translation | 34 | 119 | 157 | 40 | 33.6% | 57 | 22 | 8 | $5.19 |
| vocab_recall | 25 | 100 | 154 | 42 | 42.0% | 22 | 36 | 15 | $4.35 |
| **conjugation** | 10 | 59 | **128** | **9** | **15.8%** | 9 | 39 | **23** | $3.34 |
| sentence_construction | 1 | 2 | 2 | 1 | 50.0% | 0 | 1 | 0 | $0.10 |

Conjugation produced **2.2 drafts per slot** and approved 9. Three DE cells inside it requested 30 and approved **zero** for $1.90 — detail below.

### Per level

| | de a1 | de a2 | de b1 | de b2 | es a1 | es a2 | es b1 | es b2 | tr a1 | tr a2 | tr b1 | tr b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cells | 17 | 31 | 19 | 8 | 5 | 1 | 8 | 6 | 14 | 3 | 3 | 5 |
| req | 46 | 86 | 55 | 17 | 21 | 6 | **97** | 35 | 61 | 15 | 13 | 23 |
| appr | 13 | 46 | 26 | 13 | 3 | 2 | 27 | 5 | 20 | 5 | 3 | 10 |
| appr% | 28.3 | 54.8 | 47.3 | **76.5** | **14.3** | 33.3 | 27.8 | **14.3** | 32.8 | 33.3 | 23.1 | 43.5 |

`de:b2` is again the best block (76.5%). `es:b1` carries 97 of the run's 475 requests on its own — 51 of them the reported-speech retrofit.

### Post-resume trend

| Day | Cells ok/failed | Req | Approved | Appr% | Flag% | Rej% | Cost | $/approved | Runtime |
|---|---|---|---|---|---|---|---|---|---|
| **08-18** | **120 / 0** | 475 | **173** | **36.6%** | **33.4%** | 30.0% | **$20.90** | **$0.121** | 32 min |
| 08-17 | 120 / 0 | 435 | 225 | 52.1% | 20.8% | 27.1% | $18.20 | $0.081 | 31 min |
| 08-16 | 116 / 4 | 527 | 321 | 61.0% | 23.8% | 15.2% | $18.38 | $0.057 | 27 min |
| 08-15 | 120 / 0 | 1,118 | 733 | 65.8% | 19.4% | 14.8% | $31.31 | $0.043 | 35 min |
| 08-14 | 37 / 83 | 732 | 511 | 69.9% | 17.1% | 13.0% | $17.00 | $0.033 | 18 min |
| 07-24 | 120 / 0 | 663 | 426 | 64.3% | 16.7% | 19.0% | $19.21 | $0.045 | 25 min |

The direction flipped back: yesterday rejects nearly doubled while flags improved; today **flags** did the damage (20.8% → 33.4%) while rejects rose only 3 points. 84 of the 158 flags are ES, and 37 of those are one point.

### Credit health

No `failed` jobs, no credit errors. `usage_events` shows **17 `ai_evaluation` rows** on 08-17 evening (20:22 → 22:25 UTC), each written only after the Claude call returns — the account is live and the learner path works.

Still **no alarm** on `generation_jobs.status='failed'` and no balance check. Carried unactioned since 06-19.

---

## The ES curriculum bump released the whole low-yield backlog in one night

`CURRICULUM_VERSION_ES` went to `2026-08-18` in #664. `curriculum_version` on today's ES jobs confirms it propagated. The intended effect was to un-stick `es-b1-reported-speech` for the retrofit. The actual effect is language-wide: `decideEnqueue` clears **both** `skip-low-yield` and target-reached suppression on a version mismatch, for every cell in the language.

20 ES cells ran today and 20 ran on 08-17, but only **6** are the same cells. Split that way, the collapse is entirely in the newly-released half — the six repeat cells performed *identically* on both nights:

| | Req | Approved | Appr% |
|---|---|---|---|
| 6 cells that ran on 08-17 **and** 08-18 — on 08-17 | 25 | 8 | 32% |
| the same 6 cells — on 08-18 | 25 | 8 | **32%** |
| 14 cells released today by the bump | 134 | 29 | **21.6%** |

The 14 newly-released cells, ranked by requests:

| Cell | Req | Appr | Flag | Rej |
|---|---|---|---|---|
| `es:b1:cloze:es-b1-reported-speech` | 26 | 9 | 17 | 0 |
| `es:b1:translation:es-b1-reported-speech` | 25 | 5 | 20 | 0 |
| `es:b1:cloze:es-b1-impersonal-plural` | 12 | 3 | 3 | 6 |
| `es:b1:cloze:es-b1-influence-verbs-infinitive` | 11 | 3 | 6 | 2 |
| `es:b2:cloze:es-b2-se-middle-accidental` | 11 | 3 | 6 | 2 |
| `es:b1:translation:es-b1-impersonal-plural` | 10 | 2 | 6 | 2 |
| `es:b2:cloze:es-b2-sino-adversatives` | 8 | **0** | 1 | 7 |
| `es:a2:cloze:es-a2-tonic-pronouns-prepositions` | 6 | 2 | 4 | 0 |
| `es:b2:translation:es-b2-comparatives-advanced` | 5 | **0** | 4 | 1 |
| `es:b1:cloze:es-b1-imperative-negative-pronouns` | 5 | 1 | 2 | 2 |
| `es:b2:translation:es-b2-sino-adversatives` | 4 | **0** | 3 | 1 |
| `es:b1:cloze:es-b1-que-vs-cual` | 4 | 1 | 2 | 1 |
| `es:b2:cloze:es-b2-consecutives-intensity` | 4 | **0** | 3 | 1 |
| `es:a1:translation:es-a1-ser-estar-basic` | 3 | **0** | 2 | 1 |

This is a **selection effect, not a regression**: a cell is suppressed precisely because its last run approved <3, so a language-wide release enqueues an adversarially-selected batch of the worst cells simultaneously. $5.37 bought 37 ES rows.

The operational lesson is that a `CURRICULUM_VERSION` bump is a blunt instrument. It is the only lever that clears suppression (08-17 rec #1b), so every point-scoped curriculum edit drags the whole language's backlog with it. Worth considering a per-point version or an explicit un-suppress list, so a one-point retrofit costs one cell's worth of churn instead of a language's.

---

## The #664 reported-speech retrofit: the generator obeyed, the validator did not

#664 declared three `constructionVariants` on `es-b1-reported-speech` (the pool was 96/99 `dijo que` + imperfect) and stopped translation sources pre-resolving the backshift. #665 recorded the retrofit artifacts and demoted 50 rows (25 cloze + 25 translation, all `past-report-imperfect-backshift`, `pool-hygiene`) to open the deficit. Tonight's 51 requests are that deficit, exactly.

**Stage 1 of the retrofit succeeded outright.** 51 of 55 drafts targeted the two previously-unrealized variants:

| Variant | Drafts | Approved | Flagged | Appr% |
|---|---|---|---|---|
| `present-report-command-subjunctive` | 32 | 8 | 24 | **25%** |
| `perfect-report-present-retained` | 16 | 4 | 12 | **25%** |
| `past-report-imperfect-backshift` | 3 | 2 | 1 | 67% |

Before tonight the pool had **1** present-command row and **0** perfect-retained rows across both surfaces. It now has 13 and 4. The `constructionVariants` mechanism does what it was built to do.

**Stage 2 failed, on two separate mechanisms.** Note that **all 37 losses are `flagged`, none `rejected`** — every row is still in the table and recoverable.

### Defect 1 — the point's `name` still says "present-to-past" (translation, 20/20 flagged)

Every flagged translation carries `grammar-point-mismatch`, and the validator notes quote the title as the authority:

> _"the target grammar point is **'Reported speech (present-to-past)'**, which requires a PAST-tense reporting verb triggering backshift … The reference translation uses a PRESENT-tense reporting verb ('pide') with a present subjunctive reported clause ('que enviemos'). This is a reported command with a present-zone reporting verb — it tests 'que + present subjunctive for reported commands' but does NOT test the present-to-past shift that is the declared grammar point."_

One note is explicit that the description was read and overruled by the title:

> _"The grammar-point description **does mention** 'Dice que te sientes' (present-zone reporting verb, no shift) as a positive example, **but the core pedagogical target is the PAST-tense shift**; a present-tense reporting verb with no shift does not expose the key learner errors listed…"_

#664 rewrote `description`, `examplesPositive`, `examplesNegative` and `commonErrors` — and left `name: 'Reported speech (present-to-past)'` (`packages/db/src/curriculum/es.ts:2481`). The generator reads the variant directives; the validator anchors on the name. This is the **generate↔validate contract split** in its purest form: the generation fix is nullified because validation still rejects the shape.

Sample flagged drafts, all correct Spanish, all on-variant:

| Source | Reference | Variant |
|---|---|---|
| "The bank is asking us to send the signed documents before Friday." | `El banco pide que enviemos los documentos firmados antes del viernes.` | present-command |
| "My grandmother asks that we visit her every Sunday." | `Mi abuela pide que la visitemos todos los domingos.` | present-command |
| "My sister has told me that the heating is broken." | `Mi hermana me ha dicho que la calefacción está rota.` | perfect-retained |
| "The doctor has warned us that the patient needs rest." | `El médico nos ha avisado de que el paciente necesita descanso.` | perfect-retained |

The last two are the Butt & Benjamin 17.8 case #664 was written to add. They are textbook-correct and were flagged for not being the thing the title names.

**Fix:** rename to something tense-zone-neutral (e.g. `'Reported speech: backshift and tense zones'`), keeping the `key` unchanged; bump `CURRICULUM_VERSION_ES`. Then the 37 stored rows are a promote candidate — the same evidentiary shape (`a specific validator over-flag bug was fixed`) that justified `revalidate:sc-promote`, though that script is hard-scoped to `type = 'sentence_construction'` and would need widening rather than reuse.

### Defect 2 — reported-command clozes are person-indeterminate (cloze, 11/15 flagged)

Independent of the name. Cloze flags on this point are `ambiguous` (16), not `grammar-point-mismatch` (2), and the mechanism is uniform:

> _"El técnico dice que ___ el ordenador antes de instalar la actualización. (apagar)"_ — _"the blank requires a present subjunctive form of 'apagar', but the visible sentence does not specify the subject of the reported command. 'apagues' (2sg), 'apague' (3sg/usted), 'apaguemos' (1pl), and 'apaguen' (3pl/ustedes) are all grammatically and contextually valid fills … **enumeration would not cure this** because the forms differ in person/referent (not mere surface synonyms)."_

And crucially:

> _"The grammar point (reported command with 'dice que' + present subjunctive) **is correctly targeted**, but the person ambiguity makes the item unusable as a cloze without revision."_

A reported command leaves the addressee implicit in a way a reported statement does not, so the new variant is *structurally* prone to this. One draft compounds it — "El jefe dice que todos ___ el informe" is ambiguous between indicative (reported statement) and subjunctive (reported command) as well as between persons.

This is the same family as **#611** (tense determinacy) and **#633** (polarity determinacy): a cloze blank needs an in-stem anchor that forces exactly one form. The generation prompt needs a determinacy rule for reported commands — an explicit addressee cue (`nos dice que…`, `nos pide que…`, an overt `nosotros`), enforced when the variant is `present-report-command-subjunctive`.

### Where the point stands now

| Surface | Approved rows | backshift | present-command | perfect-retained | Legacy |
|---|---|---|---|---|---|
| cloze | 33 | 24 | 5 | 3 | 1 |
| translation | 30 | 25 | 4 | 1 | 0 |

Against the #664 target of ~50 rows per cell with a 3 : 2 : 1 variant split (25 / 17 / 8), both new variants are still well short and the deficit will re-request tomorrow — into the same 25% wall, at roughly the same $1.33/night, until the name is fixed. **This is the most time-sensitive item in the doc.**

---

## #656 verified in production — and what it revealed underneath

`context-spoils-answer` by surface, 08-17 (pre-fix) vs 08-18 (post-fix):

| Surface | 08-17 | 08-18 |
|---|---|---|
| **conjugation** | **18** | **1** |
| cloze | 12 | 5 |
| translation | 6 | 3 |
| vocab_recall | 4 | 5 |
| **total** | **40** | **14** |

Conjugation drafts requested were comparable (74 → 59), so the drop is real, not a volume artifact. The paired probe's 0/16 was optimistic and yesterday's post-fix CLI run's 40% was pessimistic; the scheduled run lands at **1 spoil on 59 conjugation drafts**. **Rec #1 from 08-17: closed, verified in production.** (Cloze and translation also halved — plausibly the label change in the shared user-prompt scaffold, but the sample is small; not claiming it.)

The fix removed the wrong veto. It did not make the cells good.

### `de-a2-adjective-declension-zero` is a curriculum problem, not a validator one

| Run | Req | Appr | Rej | `context-spoils` |
|---|---|---|---|---|
| **08-18** | 9 | **0** | 4 | **1** |
| 08-17 CLI (post-fix) | 15 | 6 | 6 | — |
| 08-17 scheduled | 16 | 1 | 15 | 14 |
| 08-14 | 18 | 2 | 15 | 14 |

The spoils veto is gone (14 → 1) and the cell still approved **0 of 9**. `coverage_outcome` is 0-for-everything: genitive 0/5, nominative 0/3, accusative 0/1. Five flagged drafts survive in the table, and all five say the same thing — the *construction itself* is marginal:

> _"the genitive-without-article construction ('kalten Getränks') is extremely rare in modern spoken and written German; it is an archaic/literary register form that native speakers almost never produce … 'Der Preis kalten Getränks war im Stadion sehr hoch' sounds stilted and unnatural."_

> _"'Wegen neuer Adresse müssen wir Sie erneut anrufen' is grammatically correct but sounds unnatural … Zero-article strong declension after 'wegen' is far more natural with **abstract nouns or mass nouns** (e.g. 'wegen schlechten Wetters', 'wegen mangelnder Erfahrung'). Using a concrete singular count noun here may teach a pattern that learners will rarely encounter."_

> _"'Wichtige Wahrheit steht oft am Anfang jedes Lehrbuches' is unnatural and borderline ungrammatical … native speakers would say 'Eine wichtige Wahrheit steht…'."_

> _"the genitive-without-article construction is so rare and literary that it arguably exceeds what an A2 learner would realistically need … This specific sub-construction may be better placed at B2+."_

The generator is picking **concrete singular count nouns** (`Getränk`, `Adresse`, `Code`, `Programm`, `Wahrheit`). Zero-article strong declension is natural with mass nouns, abstracts and plurals (`frische Luft`, `schlechten Wetters`, `mangelnder Erfahrung`, `neue Programme`) — the same shape as 08-17 rec #7 for `de-b1-n-declension`: constrain the seed nouns instead of letting the generator choose. Two flags also question the A2 placement.

Lifetime this cell is now **156 requested, 21 approved (13.5%)** over 8 runs. It is the strongest `targetOverride` / re-level candidate in the pool.

### `de-b1-n-declension` regressed

| Run | Req | Prod | Appr | Rej | Dedup | `coverage_outcome.case` |
|---|---|---|---|---|---|---|
| **08-18** | 10 | 19 | **1** | 9 | 3 | acc 0/2, gen 1/3, dat 0/5 |
| 08-17 | 17 | 26 | 7 | 10 | 3 | acc 3/5, gen 3/6, dat 1/6 |
| 08-16 | 18 | 32 | 1 | 16 | 4 | nom 0/13, acc 1/5 |

Six `low-quality-reject`, zero flags — nothing stored to read. The #655 fix (dropping the unrealizable `nominative` floor) is not undone: the dead axis is still absent and the cell is no longer spending drafts on it. But **8/27 across the two post-fix nights** is a more honest reading than yesterday's 7/17, and 08-17's result was partly luck. The exemplar-noun constraint (08-17 rec #7 — `Junge, Kollege, Student, Herr, Mensch, Nachbar` instead of generator choice) is now the obvious next move, and it is the same edit as the one above for `-declension-zero`.

---

## `es-b1-impersonal-plural` generates three constructions, none of them the declared one

New this run, and squarely the **PR #664 defect class** the `audit:constructions` tool on the current branch was built to find. 22 requested across cloze + translation, 5 approved. Every flagged translation targets a *neighbouring* impersonal construction:

> _"The reference translation uses **impersonal 'tú'** (ves, sientes) … rather than the target grammar point, which is the impersonal third-person plural … The acceptable answers all preserve the impersonal-tú structure, confirming the exercise consistently targets the wrong construction for this cell."_

> _"The reference translation uses **'uno/una + 3sg verb'** (generic impersonal), which is a related but distinct construction from the impersonal third-person PLURAL … The grammar-point description does mention 'uno/una + 3sg' as a related generic, but the cell key is 'es-b1-impersonal-plural'."_

The point's description lists `se`, `uno/una + 3sg` and informal impersonal `tú` as *related generics*; the generator treats them as licensed targets. English sources like "When you live alone, you learn to do everything yourself" invite exactly the wrong rendering — and the validator adds a second flag because four structurally distinct Spanish renderings are all valid, so `acceptableAnswers` cannot cure it either.

Same remedy shape as #664: name the constructions the point *must* represent and constrain the English source so it forces the bare 3pl ("They say the restaurant is very good" → `Dicen que…`). This is a live test case for `audit:constructions` — it would have surfaced this point without a nightly run.

Adjacent, smaller: `es-b1-influence-verbs-infinitive` (3/11) flags are the **tense-determinacy** class again — `siempre` licenses both `hace` and `hacía` with no present anchor — plus a `permitir`/`dejar` lexical alternation the point itself covers but the draft doesn't list.

---

## Dedup exhaustion: unchanged, unactioned, $1.60/night

47 give-ups; 19 from the two DE Präteritum cells carried in 08-17 rec #2, still unactioned.

| Cell | Req | Prod | Appr | Dedup | Cost |
|---|---|---|---|---|---|
| `de:a2:conjugation:de-a2-praeteritum-modals` | 14 | **50** | **0** | 12 | $1.01 |
| `de:a1:conjugation:de-a1-praeteritum-sein-haben` | 7 | **28** | **0** | **7 (all)** | $0.59 |
| `de:b1:conjugation:de-b1-n-declension` | 10 | 19 | 1 | 3 | $0.50 |
| `tr:a1:vocab_recall:tr-a1-vocab-family-people` | 7 | 16 | 2 | 3 | $0.34 |
| `tr:a1:vocab_recall:tr-a1-vocab-food-drink` | 6 | 15 | 1 | 3 | $0.33 |
| `tr:a1:vocab_recall:tr-a1-vocab-transport-places` | 6 | 15 | **0** | 3 | $0.32 |

`de-a1-praeteritum-sein-haben` produced 28 drafts for 7 slots and collided on all 7 for the second night running — **0 approved across two consecutive runs, 56 drafts, ~$1.15**. The two Präteritum cells alone burned **$1.60 for zero rows.** This remains the cheapest recommendation in the series and it has now been carried three days.

---

## Rejection reasons

| Reason | 08-18 | 08-17 | 08-16 | Rate of decided (08-18) |
|---|---|---|---|---|
| `low-quality-reject` | **78** | 43 | 44 | 16.5% |
| `context-spoils-answer` | **14** | 40 | 22 | 3.0% |
| `answer-stem-overlap` | 3 | 1 | 1 | 0.6% |
| `seed-target-mismatch` | 1 | 0 | 0 | 0.2% |

The spoils/`lqr` trade is the story: **spoils −26, `lqr` +35**. Part of that is #656 letting conjugation drafts past the hard veto so they get judged on quality instead (conjugation `lqr` 15), but the larger part is the ES backlog — ES contributes 31 of the 78, DE 27, TR 20.

Reasons sum to 96 against `rejected_count` 142; 47 of those rejects are dedup give-ups which contribute no reason by contract, leaving **~1 unattributed** — the cleanest accounting in the series.

### Flag codes (158 flagged rows; a row can carry several)

| Code | 08-18 | 08-17 | 08-16 |
|---|---|---|---|
| `validator-note` | 460 | — | — |
| `low-quality-flag` | **147** | 77 | 114 |
| `ambiguous` | **98** | 61 | 80 |
| `grammar-point-mismatch` | **58** | 13 | 22 |
| `level-mismatch` | 9 | 12 | 29 |

`grammar-point-mismatch` **4.5×'d**, and it is concentrated: 20 on `es-b1-reported-speech` translation, 4+3 on `es-b1-impersonal-plural`, 3 on `es-b2-sino-adversatives`, 2 each on a long tail. Both leaders are "the pool realizes a construction the point does not declare (or vice versa)" — the audit class.

`ambiguous` (98) is 20.7% of decided drafts, up from 14.1%. 40 of the 98 are ES cloze, 16 of those the reported-speech person-indeterminacy. Outside reported-speech it is diffuse (max 6 per point) — no single new mechanism. Yesterday's rec #3 (vocab_recall definition specificity) is unmoved: vocab_recall `ambiguous` is 18 across all three languages, mostly TR.

---

## Coverage-directed generation

46 of 120 cells (38%) carried a `coverage_outcome`, covering 161 of 475 requested drafts.

| | Cells | Req | Appr | Flag | Rej | Appr% of decided |
|---|---|---|---|---|---|---|
| With `coverageSpec` | 46 | 161 | 57 | 41 | 61 | **35.8%** |
| Without | 74 | 314 | 116 | 117 | 81 | **36.9%** |

Within 1.1 points, the same null result as 08-16 and 08-17: **axis-directed requesting costs nothing in aggregate.** Three consecutive runs is enough to call this settled.

Note the reported-speech cells sit in the *no-spec* group — `constructionVariants` are not a `coverageSpec` and do not emit a `coverage_outcome`, so the retrofit's variant realization is only visible via `content_json.seedWord`. Worth wiring variants into `coverage_outcome` so a retrofit's progress is readable from `generation_jobs` alone rather than by hand-querying the pool.

---

## Weakest cells (req ≥ 4, approval < 50%)

| Cell | Req | Prod | Appr | Rej | Dedup | Dominant mechanism |
|---|---|---|---|---|---|---|
| `es:b1:cloze:es-b1-reported-speech` | 26 | 29 | 9 | 0 | 0 | **17 flagged — person-indeterminacy** |
| `es:b1:translation:es-b1-reported-speech` | 25 | 26 | 5 | 0 | 0 | **20 flagged — stale point name** |
| `de:a2:conjugation:de-a2-praeteritum-modals` | 14 | 50 | **0** | 12 | 12 | closed answer space |
| `es:b1:cloze:es-b1-impersonal-plural` | 12 | 15 | 3 | 6 | 1 | wrong construction generated |
| `es:b2:cloze:es-b2-se-middle-accidental` | 11 | 11 | 3 | 6 flag | 0 | newly released, ambiguous |
| `es:b1:cloze:es-b1-influence-verbs-infinitive` | 11 | 11 | 3 | 2 | 0 | tense determinacy |
| `es:b1:translation:es-b1-impersonal-plural` | 10 | 14 | 2 | 2 | 0 | wrong construction generated |
| `de:a1:cloze:de-a1-zero-article` | 10 | 10 | **0** | 6 | 0 | 4 × spoils (gloss) — chronic |
| `de:b1:conjugation:de-b1-n-declension` | 10 | 19 | 1 | 9 | 3 | regressed; 6 × lqr |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 9 | 9 | **0** | 4 | 0 | **marginal construction** |
| `es:b2:cloze:es-b2-sino-adversatives` | 8 | 8 | **0** | 7 | 0 | 7 × lqr, newly released |
| `de:a1:conjugation:de-a1-praeteritum-sein-haben` | 7 | 28 | **0** | 7 | **7** | closed answer space |
| `tr:b1:conjugation:tr-b1-causative-voice` | 7 | 7 | 2 | 4 | 0 | 4 × lqr |
| `es:a1:vocab_recall:es-a1-vocab-family-people` | 7 | 10 | 2 | 4 | 1 | saturated umbrella |
| `de:a1:vocab_recall:de-a1-vocab-family-people` | 7 | 7 | 2 | 4 | 0 | saturated umbrella |
| `tr:a1:vocab_recall:tr-a1-vocab-transport-places` | 6 | 15 | **0** | 6 | 3 | dedup exhaustion |
| `tr:b2:cloze:tr-b2-compound-past-hikaye` | 6 | 6 | 1 | 5 | 0 | 4 × lqr, 1 × overlap |

Standing caveat: a low *daily* approval% on a topped-up cell is churn against a near-full pool. What is unusual today is how many of these are **first-appearance** cells released by the version bump — they are not chronic, they are simply being seen for the first time in weeks.

`de-a1-zero-article` is worth calling out: it went **0/10** with 4 spoils, its worst run yet (lifetime **98 requested, 17 approved, 17.3%**). #656 did not touch it — this is the `glossEn` spoilage class (08-17 rec #6), where faithful English *must* supply the article German drops.

---

## Unrealizable floors, refreshed

Every `(point, axis, value)` since 2026-07-01 with ≥15 requested and <15% approved. One new entry.

| Point | Axis | Value | Runs | Req | Appr | % |
|---|---|---|---|---|---|---|
| `de:b1:de-b1-n-declension` | case | nominative | 12 | 145 | 3 | 2.1% — **fixed, frozen** |
| `es:b2:es-b2-subjunctive-negated-opinion` | polarity | affirmative | 5 | 73 | 0 | **0.0%** |
| `es:b1:es-b1-imperative-negative-pronouns` | polarity | affirmative | 5 | 66 | 1 | 1.5% |
| `es:a2:es-a2-present-irregular-stem-changes` | person | 1pl | 12 | 61 | 6 | 9.8% |
| `tr:a1:tr-a1-locative` | number | plural | 9 | 36 | 3 | 8.3% |
| `tr:b1:tr-b1-causative-voice` | polarity | affirmative | 6 | 33 | 4 | 12.1% |
| `tr:a1:tr-a1-vocab-food-drink` | wordClass | verb | 5 | 27 | 1 | 3.7% |
| `de:a1:de-a1-vocab-food-drink` | wordClass | verb | 5 | 26 | 1 | 3.8% |
| `de:a1:de-a1-vocab-food-drink` | wordClass | adjective | 4 | 22 | 1 | 4.5% |
| `es:a1:es-a1-present-yo-go` | person | 3sg | 3 | 21 | 0 | **0.0%** |
| `es:a1:es-a1-present-yo-go` | person | 3pl | 3 | 18 | 0 | **0.0%** |
| `tr:a1:tr-a1-vowel-harmony` | case | locative | 7 | 17 | 2 | 11.8% — **dropped in #660** |
| **`tr:a1:tr-a1-possessive-suffixes`** | person | **3pl** | 7 | 15 | 1 | **6.7%** |

`n-declension.nominative` and `vowel-harmony.locative` are both frozen (fixed in #655 / #660) and will age out of the 07-01 window. The remaining eleven are live, and 08-17 rec #4 is unchanged: `suppressedFor` in `coverage-decision.ts` suppresses only on *exactly zero* approvals in the *single most recent* batch, so none of these can ever be caught automatically.

---

## Sentence construction

One cell, **2 requested, 1 approved** (`de:a2:sentence_construction:de-a2-perfekt-with-haben`; the other draft was `low-quality-reject`). Post-resume cumulative: **247 of 256 requested (96.5%) across five runs.** SC remains the healthiest surface by a wide margin. `tr:b2` SC is still structurally frozen at 14 approved / 15 flagged (`tr-b2-double-voice`, `targetOverride: 15`), unchanged since 07-23. Nothing to act on.

---

## Recommendations

1. **~~Rename `es-b1-reported-speech` and re-promote the flagged rows~~ — DONE 2026-08-18.** Renamed to **"Reported speech: backshift, no-shift, and reported commands"**, keeping the `key`. Three corrections to what this recommendation originally said:

   (a) **No `CURRICULUM_VERSION_ES` bump, and the original advice to bump was wrong.** `grammarPointName` is a runtime `{{var}}` (`validation-prompts.ts:272`), so the rename ships with the code deploy — no `push-prompts`, no `VALIDATION_PROMPT_VERSION` bump. And both cells approved ≥3 today, so neither is `skip-low-yield`-suppressed and both are below target: they are requested tonight regardless. A bump would have bought nothing and re-released the whole ES backlog for a second night (rec #6).

   (b) **The effect is real but smaller than "37 rows", and it needed a paired baseline to see.** `revalidate:sc-promote` was generalized to `revalidate:promote` (`--type` required; `--grammar-point` required for every type but `sentence_construction`) and dry-run over the point's flagged translations in both arms, identical rows:

   | Arm | Promotable |
   |---|---|
   | old name `Reported speech (present-to-past)` | **15 / 40** |
   | new name | **28 / 40** |

   The 15-row baseline is the confound this recommendation missed: a re-score promotes ~37% of flagged rows on its own, because the current validator no longer upholds older flags. The rename's own contribution is **+9 to +13** (the applied run promoted 24, the dry-run before it 28 — the validator is not deterministic across runs, so read the arm gap, not any single pair).

   (c) **Applied to translation only: 24 rows promoted to `manual-approved`.** The cell went **30 → 54 approved**, above its ~50 target, so it stops being requested — and the variant mix landed almost exactly on #664's intended 3 : 2 : 1 quota (25 / 15 / 8 against 25 / 17 / 8). The retrofit is complete for translation. Rollback artifact (all 40 candidate rows' prior state plus the 24 written ids) is committed at `docs/analysis/run-artifacts/es-b1-reported-speech-promote-2026-08-18.json`, because `revalidate:promote` writes none of its own and `packages/db/backfill-runs/` is gitignored.

   **Cloze was deliberately not applied.** Its arm dry-ran 11 promotable of 35 — at or below the re-score baseline — which corroborates rec #2: the cloze losses are person-indeterminacy, not the name. Promoting on a re-score with no identified fixed bug is exactly what the new `--grammar-point` guard exists to prevent. Cloze stands at 33 approved and keeps generating.

2. **Add a determinacy rule for reported commands to the cloze generation prompt.** `present-report-command-subjunctive` blanks admit 2sg/3sg/1pl/3pl and the validator states enumeration cannot cure it. Require an explicit addressee anchor (`nos dice que…`, `nos pide que…`, overt `nosotros`) when that variant is active. Same family as #611 / #633. A/B with `eval:gen` before merge. Independent of rec 1 — fixing the name alone leaves the cloze cell at ~40%.

3. **Constrain the seed nouns on both German declension cells.** `de-a2-adjective-declension-zero` (0/9 today, **21/156 lifetime**) fails because the generator picks concrete singular count nouns (`Getränk`, `Adresse`, `Code`, `Programm`) for a construction that is only natural with mass/abstract nouns and plurals; five independent validator notes say so, and two question the A2 placement. `de-b1-n-declension` (1/10, regressed from 7/17) needs its canonical exemplar list (`Junge, Kollege, Student, Herr, Mensch, Nachbar`). One edit shape, two cells. Consider re-levelling the zero-article genitive to B2 or `targetOverride`-ing the cell while the seeds are fixed.

4. **`targetOverride` the saturated cells.** Third time carried. `de-a1-praeteritum-sein-haben` is now **0 approved over two consecutive nights on 56 drafts**; `de-a2-praeteritum-modals` 0/14 on 50 drafts. Together $1.60/night for nothing. Add the three saturated `vocab_recall` umbrella cells (`es-a1-vocab-family-people`, `de-a1-vocab-family-people`, `tr-a1-vocab-transport-places`).

5. **Run `audit:constructions` on ES before the next curriculum edit.** `es-b1-impersonal-plural` is a second, unprompted instance of the exact PR #664 defect class — the pool realizes `uno + 3sg` and impersonal `tú` while the point declares the bare 3pl. The tool on the current branch is built for this and would find it without waiting for a nightly run. Good first real target.

6. **Make curriculum-version bumps narrower, or stage them.** A `CURRICULUM_VERSION_<LANG>` bump clears suppression for the whole language, so a one-point retrofit dumped 14 backlogged ES cells into one $5.37 night at 18.7% approval. Either scope the version to a point (or a set), or accept the pattern and schedule bumps on nights where the churn is affordable. Related to 08-17 rec #1b, which asked the opposite question (should a *prompt* version also clear suppression) — the two want a single design decision about what un-suppresses what.

7. **~~Emit `constructionVariants` realization into the run record~~ — PARTLY DONE 2026-08-18.** The validator now reports the variant a draft actually realizes, persisted as `content_json.realizedVariant`, so drift between the variant a draft was *asked* for (`seedWord`) and the one it *delivered* is queryable without a `backfill:variant-seeds` classification pass. **Still open:** this labels new drafts only — the existing pool is unchanged — and variants still do not appear in `generation_jobs.coverage_outcome`, so a cell mid-retrofit still reads as failing there.

   Shipped alongside the fix for the asymmetry itself: the validator was never told which sub-construction the generator had been directed to produce, so it judged every draft against the point's most prototypical pattern — the mechanism behind rec #1, but present on all **32** variant points, not just this one. Paired dry-runs over 91 flagged rows on three points in three languages:

   | Cell | Rows | Variant withheld | Variant fed |
   |---|---|---|---|
   | `es-b1-reported-speech` cloze | 35 | 11 | **15** |
   | `de-b2-adversative-connectors` cloze | 17 | 7 | **14** |
   | `tr-a2-causal-connectors` translation | 39 | 4 | **10** |
   | **total** | **91** | **22 (24%)** | **39 (43%)** |

   And it is specific rather than a blanket loosening — on the reported-speech cell, `perfect-report-present-retained` recovers **3/5** while the person-indeterminate `present-report-command-subjunctive` rows stay flagged at **2/11** (that is rec #2, which this does not and should not fix), with the legacy word-seeded rows unmoved as a control.

   **The 39 recoverable rows were NOT promoted** — a pool-wide variant repass across 32 points is a separate decision from the code fix, and a far larger blast radius than the single cell in rec #1.

8. **Triage the eleven live unrealizable floors** and do the `suppressedFor` trailing-window change in `coverage-decision.ts` as its own PR. Unchanged from 08-17 rec #4; new entry this run is `tr-a1-possessive-suffixes` `person: 3pl` (1/15).

9. **Alarm on `generation_jobs.status='failed'` and on Anthropic credit exhaustion.** Carried unactioned since 06-19. Five clean runs in a row is not coverage; the same key backs learner-facing `POST /exercises/:id/submit`.

10. **Handle the DE zero-article gloss policy** (`de-a1-zero-article`, **0/10 today, 17/98 lifetime**, 4 spoils). Unchanged from 08-17 rec #6 — a generation-policy decision about which frames may be blanked, not an `acceptableAnswers` widening.
