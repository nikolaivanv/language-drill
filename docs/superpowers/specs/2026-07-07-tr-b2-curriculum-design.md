# TR B2 Curriculum — Yedi İklim Alignment + G&K Coverage (Design)

**Date:** 2026-07-07
**Status:** Approved pending user review
**Predecessor:** `2026-06-19-tr-b1-curriculum-design.md` (PR #… B1, merged) — same
methodology (grouped-by-function grain, author-time Göksel & Kerslake grounding,
one `CURRICULUM_VERSION_TR` bump, one PR). The B1 spec explicitly deferred B2 to
"a separate later cycle" that "reuses this structure and the same two sources."
This is that cycle. Carried-over decisions are not re-argued here.

**Sources:**
- **Sequencing/scope:** Yedi İklim B2 syllabus (Dil Bilgisi topics, Units 1–8),
  supplied as the exam inventory.
- **Grammar content & § anchors:** Göksel & Kerslake, _Turkish: A Comprehensive
  Grammar_ (markdown at
  `/Users/seal/dev/language-tools/Turkish/turkish-grammar-book/turkish-grammar-md`).
  Author-time grounding — cited sections are read while authoring each point's
  `description` / `examplesPositive` / `examplesNegative` / `commonErrors`; the
  anchors are recorded as code comments (matching A1/A2/B1).

## Problem

TR B2 holds **0** grammar points; A1/A2/B1 carry 27 + 22 + 11. This cycle brings
B2 to the same standard as B1: a Yedi İklim-derived inventory grouped by
function, deduped against the live A1–B1 set, a G&K reverse-coverage audit, and
G&K-grounded content — mirroring the ES #528/#529 methodology the user cited.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Granularity | **Grouped by function** (cluster near-synonymous suffixes into one functional point), matching the A2/B1 grain. |
| Scope | **B2 grammar only.** Like ES #529, this cycle adds grammar points and leaves non-grammar cells alone. TR has **no** B2 vocab/dictation/free-writing umbrellas today and this cycle does **not** add them (that would be a "full new level" cycle like TR B1; the user's brief and the cited PRs are grammar-point expansions). Flagged as an easy follow-up if a full B2 level is wanted. |
| Book grounding | **Author-time** grounding in Göksel & Kerslake; anchors as code comments. |
| Dedup | Every B2 point is a **new** function vs A1–B1. Where the exam re-lists an already-taught exponent (e.g. `-mAdAn`, `-(y)An`, `-DIK/-AcAK` relatives), only the **new** slice enters B2 (see dedup notes). |
| Migration | **No key renames, no rescopes of existing points** → no DB migration. Additive only. |

## Grammar points from the exam (17, grouped by function, deduped vs A1–B1)

Finite/tense points carry the TR person coverageSpec at the B1 floors
(`person {1sg…3pl}: 5`, `polarity {affirmative: 18, negative: 12}`) and
`conjugationSuitable: true`, matching `tr-b1-past-continuous-iyordu`. Multi-
construction points are **not** `sentenceConstructionSuitable` (same reasoning as
`tr-b1-conditional-irrealis`). `clozeUnsuitable` is set where a whole-word blank
is structurally under-constrained (bipartite/clause-linking) — confirmed per
point below and against the B1 run experience.

| # | Key | Covers (Yedi İklim unit) | New vs A1–B1 | Göksel & Kerslake §§ | Cat |
|---|-----|--------------------------|--------------|----------------------|-----|
| 1 | `tr-b2-participle-aorist` | **-Ar/-Ir/-mAz** (+ receding **-AsI**) adjectival participle: akar su, çıkmaz sokak, inanılmaz (U1) | new participle type | §7.2.1.1, §25.4.1(iv) | syntax |
| 2 | `tr-b2-participle-mis` | **-mIş** resultative adjectival participle: pişmiş yemek, okunmuş kitap (U2) | new (vs A2 finite evidential -mIş) | §25.4.1(i), §25.4.1.1, §7.2.1.1 | syntax |
| 3 | `tr-b2-converb-until` | **-AnA kadar / -(y)IncAyA kadar** "until" + **-mAksIzIn** "without" (formal) (U1) | new (vs A2 -mAdAn) | §26.3.16(vii), §26.3.8(iv) | syntax |
| 4 | `tr-b2-compound-past-hikaye` | Past copula **-(y)DI** on all TAM: -mIştI/-ArdI/-AcAktI/-mAlIydI/-sAydI (U1) | new (B1 has only -Iyordu) | §8.3.2, §8.2.3.3, §21.2.1/.3, §21.4 | tenses |
| 5 | `tr-b2-compound-evidential-rivayet` | Evidential copula **-(y)mIş** on all TAM: -Iyormuş/-ArmIş/-AcAkmIş/-mAlIymIş (U2) | new (A2 has only finite -mIş) | §8.3.2, §21.4.3 | tenses |
| 6 | `tr-b2-temporal-when` | **-DIğI(ndA)/-AcAğI zaman/sırada** + **-(y)IncA** "when / at the time that" (U2, U4) | new | §26.3.16(i)(ii), §26.2.3(iv) | syntax |
| 7 | `tr-b2-proportion-assoon` | **-DIkçA** "the more…", **-Ar…-mAz** "as soon as" (U4) | new | §26.3.11, §26.3.16(iv)(viii) | syntax |
| 8 | `tr-b2-duration-throughout` | **boyunca / süresince / -DIğI sürece** "throughout / as long as" (U4) | new | §17.3.2(.1), §26.3.16(ix) | syntax |
| 9 | `tr-b2-causal-subordinate` | **-DIğI için/-DIğIndAn, -AcAğI için/-AcAğIndAn** "because" (U5) | new subordinate clause (vs A2 çünkü/için connectors) | §26.3.14 | syntax |
| 10 | `tr-b2-reported-statements` | Indirect statements: **-DIK/-AcAK + poss + acc** olduğunu söyledi (U3) | new (vs A2 basic reported-speech) | §24.4.3(.1), §24.4.7 | syntax |
| 11 | `tr-b2-reported-questions` | Indirect questions: **-Ip …-mADIğInI** / wh + -DIK/-AcAK (U3) | new | §24.4.3.2 | syntax |
| 12 | `tr-b2-reported-directives` | Reported commands/requests/wishes + necessity: **-mAsInI istemek/söylemek**, -mAsI gerektiğini (U3, U5) | new | §24.4.2.2 | syntax |
| 13 | `tr-b2-double-voice` | **Birleşik çatı**: causative-of-causative, causative+passive, reciprocal+causative (U6) | new (stacks B1 single voices) | §13.2.4, §13.2.1.1, §8.2.1 | morphology |
| 14 | `tr-b2-concessive` | **-DIğI hâlde, -mAsInA rağmen, -A rağmen** "although / despite" (U6) | new | §26.3.3, §17.2.2(v) | syntax |
| 15 | `tr-b2-instead-of` | **-mAk yerine / -mAktAnsA / -AcAğInA / -AcAğI yerde** "instead of / rather than" (U7) | new | §26.3.15, §26.3.10 | syntax |
| 16 | `tr-b2-conditional-formal` | **-DIğI takdirde / -mAsI hâlinde / -mAsI durumunda** formal conditionals (U7) | new (vs B1 -sA conditionals) | §27.6.1, §26.3.4 | moods |
| 17 | `tr-b2-aspectual-verbs` | **-(y)Iver / -Ip dur / -Ip kal / -(y)Akal / -(y)Ayaz / -(y)Agel** aspectual compound verbs (U8) | new | §13.3.1.1, §8.2.3.2, §13.3 | syntax |

### Dedup notes (binding for implementers)

- **Participles.** A2 owns subject `-(y)An`; B1 owns non-subject `-DIK/-AcAK`
  relatives. B2 adds only the remaining adjectival participles: the aorist
  `-Ar/-mAz` (+ receding `-AsI`) as a bare tenseless attributive (#1), and
  resultative `-mIş` (#2). `-AsI` "worthy of" is marked ∇ receding in G&K — teach
  it at **recognition** level (frozen forms: kahrolası, görülesi), not productive.
- **`-mIş`.** A2 `tr-a2-mis-evidential` is the **finite** evidential predicate;
  B2 #2 is the **attributive** participle (reduced `-mIş olan`); B2 #5 is the
  **copular** `-(y)mIş` stacked on other TAM bases. Three genuinely distinct uses.
- **"without".** A2 `tr-a2-converbs` owns `-mAdAn`; B2 #3 adds only the formal
  twin `-mAksIzIn` (paired with the "until" converbs, its natural U1 cluster).
- **Compound past.** B1 `tr-b1-past-continuous-iyordu` is ONE cell of the `-(y)DI`
  paradigm; B2 #4 generalizes the copula to `-mIştI/-ArdI/-AcAktI/-mAlIydI/-sAydI`
  under the single §8.3.2 rule. `-Iyordu` itself stays owned by B1 (referenced,
  not re-taught).
- **Temporal.** A2 owns `-mAdAn önce/-DIktAn sonra`; B1 owns `-(y)ken`. `-(y)IncA`
  "when" is **not** in A2 (which is only önce/sonra) — the exam lists it at B2, so
  it enters with the "when" cluster (#6). `-DIğI zaman` (listed in both U2 and U4)
  is a single point (#6).
- **Causal.** A2 `tr-a2-causal-connectors` owns coordinating `çünkü / -DAn dolayı`
  and the postposition `için` on a noun; B2 #9 is the **subordinate** `-DIK/-AcAK
  + için/-DAn` clause only.
- **Reported necessity** (U5 "gereklilik kipinin dolaylı anlatımı") folds into
  #12 as `-mAsI gerektiğini söyledi` (the necessity proposition reported as a
  fact) — no separate point.

### Morphology caveat corrected against G&K

Yedi İklim U8 labels the "almost" auxiliary `-I yazmak`; G&K shows it takes the
**-(y)A** converb (düş**e**yazdı, not \*düşü-yazdı) → authored as `-(y)Ayaz`. Noted
in the point's comment.

## Reverse-coverage audit (G&K → curriculum gaps)

The sweep covered all 28 G&K chapters. Each top candidate was **verified against
the live `tr.ts`** (the ES #528 audit's cautionary tale — a stale-tree audit
produced false gaps). All confirmed genuine. Following the #529 precedent (a
B1/B2 cycle adds audit points only at the levels in scope), the **two clean
B2-level findings are INCLUDEd in this cycle**; the confirmed **A1/A2/B1 gaps are
real and recommended for a follow-up cycle** but are **not** silently folded into
established lower levels here (that carries count/DB implications those levels own).

### Included this cycle (B2)

| # | Key | Construction | G&K | Cat |
|---|-----|--------------|-----|-----|
| 18 | `tr-b2-dir-generalizing` | Generalizing / assumption copula **-DIr**: evdedir "she's probably home", su 100 derecede kaynar → …kaynamaktadır (formal/neutral generalization) | §8.3.3, §21.4.1.1 | moods |
| 19 | `tr-b2-as-if-gibi` | **(sanki) …-mIş gibi** "as if": hayalet görmüş gibi, sanki duymuyormuş gibi | §26.1.5, §26.3.8 | syntax |

### Confirmed gaps — recommended follow-up (NOT in this cycle)

Verified absent from `tr.ts`; each leaves ordinary sentences unformable. Belong to
a lower-level cycle (their level in brackets), so deferred with a recommendation:

- **Spatial relational postpositions** ön/arka/üst/alt/iç/yan/ara + POSS + case
  (evin önünde, masanın üstünde) — **[A1/A2]** §17.3.1. Biggest single gap; only
  locative -DA is taught. **High priority.**
- **Nominal/adjectival past & evidential copula** -(y)DI/-(y)mIş on non-verbal
  predicates (hastaydım, öğrenciydi, hastaymış) — **[A2]** §8.3.2/§21.3.4.
  (Past var/yok is covered; the copular predicate past is only alluded to in a
  `tr-a1-dili-past` commonError.)
- **Suppletive copula ol-** for TAM outside present/past (öğretmen olacağım,
  evde olmalıyım) — **[B1]** §12.1.1.3. Systematic hole in the copula paradigm.
- **Additive clitic dA** "too/also/and" (ben de, hem X hem Y'den distinct) —
  **[A1/A2]** §11.1.1.2. Very high frequency.
- **-lI "with/having" / -sIz "without"** derivational (şekerli/şekersiz, işsiz) —
  **[A2]** §7.2.2.2. -sIz has no equivalent in the set.
- **bile "even"** focus clitic — **[A2/B1]** §11.1.1.1. Lighter.
- **tane** enumerator (üç tane elma, kaç tane) — **[A2]** §15.8. Lighter.
- **olarak** "as / in the capacity of" (+ adverbializer) — **[B1]** §16.1.9. Lighter.

Rejected (auditable): abstract group-2 postpositions (hakkında teach as vocab;
sayesinde/yüzünden overlap covered causals), subordinator **ki** (overlaps
reported speech/purpose; productive use is C1/literary), discourse **ise/oysa/
yoksa** (register-heavy, served by the B2 concessive set), **değil mi?** tags
(thin değil+mI combination), **bura-/şura-/ora-** (lexical; demonstratives+case),
numeral+singular noun (thin sub-case), **-CAsInA** suffixal "as if" (literary
near-duplicate of #19), **-lIk** (derivational/lexical), fractions/percent
(numeral notation, not grammar).

## Non-grammar cells

**None this cycle** (grammar-only, per the scope decision). TR B2 has no vocab /
dictation / free-writing umbrellas; adding them is deferred.

## Per-point flags (proposed; refined during authoring)

- `conjugationSuitable` + person/polarity `coverageSpec`: the two finite compound-
  tense points (#4 `compound-past-hikaye`, #5 `compound-evidential-rivayet`).
- `clozeUnsuitable`: clause-linking / bipartite points where a single whole-word
  blank is under-constrained — the converb/subordinator points (#3, #6, #7, #8,
  #9, #14, #15, #16), the three reported-speech points (#10–#12, a clause is the
  answer), `double-voice` (#13, allomorph + free TAM under-constrains the blank,
  as with the B1 voices), and `aspectual-verbs` (#17, converb+auxiliary is
  bipartite). Participles (#1, #2) and the finite compound tenses (#4, #5) keep
  cloze. Confirmed per point during authoring; adjust from first-run data.
- `sentenceConstructionSuitable`: OFF for all multi-construction points (the
  norm here). Considered only for a genuinely single-construction point.
- `prerequisiteKeys`: wired to the nearest A1–B1 ancestor(s) per point (e.g.
  #4 → `tr-b1-past-continuous-iyordu`; #10 → `tr-b1-participles-dik-acak`,
  `tr-a2-reported-speech`; #13 → the four B1 voice points).

## coverageSpec

Finite points (#4, #5): `person {1sg…3pl}` × `polarity` at B1 floors. Other
points are count-only (no categorical axis) unless a natural axis emerges during
authoring (e.g. participle type for #1/#2). Authored per-point, human-reviewed.

## Enable mechanics

In `packages/db/src/curriculum/tr.ts`, `index.ts`,
`packages/shared/src/theory-categories.ts` (+ test mirror), `curriculum.test.ts`:

1. Append the B2 grammar points to `tr.ts` after the last B1 grammar point
   (`tr-b1-participles-dik-acak`), before the vocab umbrellas, in table order.
2. `PER_LANGUAGE_GRAMMAR_MIN.TR.B2: 0 → <final count>` in `index.ts`.
3. Bump `CURRICULUM_VERSION_TR` to `2026-07-07` — **mandatory**: clears the
   scheduler's low-yield/saturation suppression and signals the new cells.
4. Add one `KEY_TO_CATEGORY` entry per new point in `theory-categories.ts` and
   the mirrored `EXPECTED_KEY_CATEGORY` in `theory-categories.test.ts`.
5. `curriculum.test.ts`: update the TR count test (`grammar.B2` `toBe(0)` →
   `toBe(<count>)`, title), and extend the closed-set clozeUnsuitable list +
   its "…exactly these N points" title.
6. After editing db source, run `pnpm build` (turbo) before any single-package
   vitest run (stale `db/dist` gotcha), then `pnpm lint` / `pnpm typecheck` /
   `pnpm test` (`turbo run test --concurrency=1`).

No `ExerciseType` enum changes → no exhaustiveness ripple.

## Verification

- `assertCurriculumInvariants` + updated `curriculum.test.ts` green.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` (`turbo --concurrency=1`) green,
  after `pnpm build`.
- Post-merge: theory rows auto-approved; first scheduler run produces non-trivial
  approved counts per B2 cell at an acceptable flag rate (TR runs hot).

## Out of scope (this cycle)

- TR B2 vocab / dictation / free-writing umbrellas (full-level follow-up).
- Runtime injection of G&K text into generation prompts (retrieval + prompt
  version bump; future enhancement).
- C1/C2 (out of round-1 levels); DE curriculum (still reduced).
