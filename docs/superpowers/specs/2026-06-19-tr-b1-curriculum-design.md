# TR B1 Curriculum — Design Spec

_Date: 2026-06-19. Status: approved design, pre-implementation._

## Goal

Add **Turkish B1** to the production curriculum, theory pool, and exercise pool,
matching the depth and cell taxonomy of the existing live TR A1/A2 levels. This
is the first of a two-cycle TR expansion; **B2 is a separate later cycle**.

Grounding sources:
- **Sequencing/scope:** Yedi İklim B1 syllabus (`/Users/seal/dev/turkish-grammar-book/Yedi İklim/B1`).
- **Grammar content & theory:** Göksel & Kerslake, _Turkish: A Comprehensive
  Grammar_ (markdown at `/Users/seal/dev/turkish-grammar-book/turkish-grammar-md`,
  section anchors cited per point below). **Author-time grounding** — the cited
  sections are read while authoring each point's `description` / `examplesPositive`
  / `examplesNegative` / `commonErrors` / `coverageSpec`; the anchors are recorded
  as code comments. Theory is generated from that richer curriculum content via
  the existing pipeline (no theory-prompt or retrieval changes this cycle).

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Granularity | **Grouped by function** (cluster near-synonymous suffixes into one functional point), matching the current TR A2 grain |
| Scope | **B1 first, full cycle** (curriculum → theory → pool), then a separate B2 cycle |
| Non-grammar cells | **Full parity with A1/A2**: ~5 vocab umbrellas + 1 dictation + 3 free-writing |
| Book grounding | **Author-time** grounding in Göksel & Kerslake; anchors as code comments |
| Old commented B1/B2 drafts | **Not restored.** B1 draft block replaced with freshly authored points; B2 draft block left untouched for next cycle |

## Grammar points (10, grouped by function, deduped vs A2)

Yedi İklim B1 is voice-heavy (çatı across units 2/4/5/6); 4 of 10 points are
voice. Each voice is a distinct function with its own morphology and coverageSpec,
so they stay separate rather than clustered.

| # | Key | Covers (Yedi İklim unit) | New vs A2 | Prereq | Göksel & Kerslake §§ |
|---|-----|--------------------------|-----------|--------|----------------------|
| 1 | `tr-b1-converb-while-yken` | **-(y)ken** "while/when" (U1) | new | `tr-a2-converbs` | §26.3 (adverbial, time), §8.5.2.2 |
| 2 | `tr-b1-past-continuous-iyordu` | **-(I)yordu** past continuous / şimdiki zamanın hikâyesi (U1) | new | `tr-a1-present-continuous`, `tr-a1-dili-past` | §21.3.1–.2 (imperfective), §21.2.1 |
| 3 | `tr-b1-reciprocal-voice` | **-(I)ş** reciprocal / işteş çatı (U2) | new | — | §8.2.1.4, §13.2.3.2, birbir- §18.1.4 |
| 4 | `tr-b1-conditional-irrealis` | **-sA / -sAydI / -(y)sA + keşke** wish, counterfactual, conditional copula (U3) | new | `tr-a1-dili-past` | Ch 27 (§27.1.1, §27.2.3, §27.2.4), wishes §21.4.4.1 |
| 5 | `tr-b1-causative-voice` | **-DIr/-Ir/-t/-Ar** ettirgen çatı (U4) | new | — | §8.2.1.1, §13.2.1 |
| 6 | `tr-b1-since-converb` | **-(y)AlI / -DIğIndAn beri / -DI…-AlI** "since doing" (U4) | new | `tr-a1-beri-dir` | §26.3 (time), §8.5.2.2 |
| 7 | `tr-b1-reflexive-voice-kendi` | **reflexive -n-/-l- + "kendi"** (U5) | new | — | §8.2.1.3, §13.2.3.1, kendi §18.1.2.2 |
| 8 | `tr-b1-obligation-periphrases` | **-mAk zorunda (kal-)/gerek-/lazım/şart** (U5) | new slice (A2 has -mAlI) | `tr-a2-ability-necessity` | §21.4.2.2 |
| 9 | `tr-b1-passive-voice` | **passive -l-/-n-** (U6) | new | — | §8.2.1.2, §13.2.2 |
| 10 | `tr-b1-participles-dik-acak` | **non-subject relative -DIK/-AcAK + possessive** (U7) | new slice (A2 has -An) | `tr-a2-relative-an` | Ch 25 (§25.1.1, §25.4) |

**Dedup notes:**
- **-mAlI** is already at A2 (`tr-a2-ability-necessity`); B1's necessity point is the
  obligation *periphrases* (-mAk zorunda/gerek/lazım/şart), built on top.
- **-(y)An** subject relative is already at A2 (`tr-a2-relative-an`); B1's participle
  point is the *non-subject* -DIK/-AcAK relatives + possessive only.
- **Reported speech / dolaylı anlatım** stays at A2 (`tr-a2-reported-speech`); the full
  Yedi İklim treatment is B2 — B1 does not touch it.

**Dropped from the old draft** (per "don't restore"): `tr-b1-causal-conjunctions`
— Yedi İklim places causal converbs (-DIğI için) at **B2**, and A2 already covers
causal connectors. Unit 8 (Genel Tekrar) is review, not a cell.

## Non-grammar cells

Register for free-writing: **neutral** (B1 narrates and gives opinions).

| Kind | Key | Theme (Yedi İklim B1) |
|------|-----|------------------------|
| vocab | `tr-b1-vocab-media-news` | Haberler / basın (U1) |
| vocab | `tr-b1-vocab-opinions-society` | görüş / yorum / toplum (U2) |
| vocab | `tr-b1-vocab-education-career` | eğitim / kariyer (U3–4) |
| vocab | `tr-b1-vocab-emotions-relationships` | duygular / ilişkiler (U4–5) |
| vocab | `tr-b1-vocab-abstract-concepts` | soyut isimler (B1 abstract nouns) |
| dictation | `tr-b1-dictation` | — |
| free-writing | `tr-b1-fw-an-opinion` | express an opinion (Bence…) |
| free-writing | `tr-b1-fw-a-past-experience` | narrate a memory (drills -(I)yordu) |
| free-writing | `tr-b1-fw-a-plan-or-hope` | plans / wishes (drills -sA, future) |

→ **15 cells get theory pages** (10 grammar + 5 vocab), matching A2 (theory = 14
grammar + 5 vocab).

## Per-point flags (proposed; refined during authoring)

- `sentenceConstructionSuitable`: `converb-while-yken`, `causative-voice`,
  `passive-voice`, `participles-dik-acak`, `since-converb`, `obligation-periphrases`
  (single-construction). **OFF** for `conditional-irrealis` — 3 moods are
  structurally ambiguous, same reasoning that kept it off `tr-a2-reported-speech`.
- `conjugationSuitable`: `past-continuous-iyordu`, `causative-voice`,
  `passive-voice`, `obligation-periphrases` (morphology across persons/valency).
- `personRotation`: finite points (`past-continuous-iyordu`, `conditional-irrealis`,
  `obligation-periphrases`).
- `clozeUnsuitable`: none anticipated; set per-point only if an answer leaks.

## coverageSpec

Authored per-point via `pnpm propose:coverage-spec --grammar-point <key>
--with-pool-stats` and human-reviewed (the established Pool Coverage Controller
flow) — not hand-fixed in this spec. Expected axes:

- Finite points (`past-continuous`, `conditional`, `obligation`): person {1sg…3pl} ×
  polarity {affirmative/negative}, as in existing finite cells.
- Voice points (`causative`, `passive`, `reflexive`, `reciprocal`): polarity × tense
  (present/past); person less central.
- Participles (`participles-dik-acak`): participle type {-DIK / -AcAK} × (optionally)
  case-role of the head.
- Converbs (`yken`, `since`): same-subject vs separate-subject × polarity.

## Enable mechanics

In `packages/db/src/curriculum/tr.ts` and `packages/db/src/curriculum/index.ts`:

1. Replace the commented B1 draft block (`tr.ts` ~§1214–1356) and B1 vocab draft
   (~§1682–1713) with the 10 authored grammar points + 5 vocab + dictation + 3 FW.
   Leave the B2 draft block untouched (next cycle).
2. `PER_LANGUAGE_GRAMMAR_MIN.TR.B1: 0 → 10` in `index.ts`.
3. Bump `CURRICULUM_VERSION_TR` to `2026-06-19` — **mandatory**: clears the
   scheduler's low-yield/saturation suppression and signals the new cells. A
   prompt-version bump would NOT clear suppression.
4. Update the per-level count assertion in `curriculum.test.ts`; pass
   `assertCurriculumInvariants`.
5. After editing db source, run `pnpm build` (turbo) before any single-package
   vitest run (stale `db/dist` resolution gotcha), then `pnpm lint` / `pnpm
   typecheck` / `pnpm test` (use `turbo run test --concurrency=1` — the full
   suite flakes under parallel load).

No `ExerciseType` enum changes → no exhaustiveness ripple across ai/lambda/web/shared.

## Generation (post-merge / deploy)

- **Theory (Layer 2):** `pnpm generate:theory --batch-seed` for the 15 cells →
  verify each row lands **auto-approved**, not flagged (a plain `generate:theory`
  no-ops on the partial unique index; `--batch-seed` is required for fresh rows).
- **Exercise pool (Layer 3):** the ~04:00 UTC scheduler picks up the new B1 cells
  once deployed + version-bumped; or force with the on-demand admin generation
  trigger (Tier 2 #6). Each grammar point fans to cloze + translation +
  (sentence_construction if suitable) + (conjugation if suitable); vocab →
  vocab_recall; dictation → dictation; FW → free_writing. Watch first-run yield +
  flag rate (TR runs hot — ~50% flagged on cloze/translation at A1/A2).

## Verification

- `assertCurriculumInvariants` + updated `curriculum.test.ts` green.
- `pnpm lint` / `pnpm typecheck` / `pnpm test` (`turbo --concurrency=1`) green,
  after `pnpm build`.
- After deploy: theory rows auto-approved; first scheduler run produces non-trivial
  approved counts per B1 cell at an acceptable flag rate.

## Out of scope (this cycle)

- TR B2 (separate cycle; reuses this structure and the same two sources).
- Runtime injection of G&K text into the theory/exercise generation prompts
  (possible future enhancement; would need a retrieval step + prompt version bump).
- ES A1–A2 and DE A1–B2 (tracked in `docs/curriculum-coverage-expansion.md`).
