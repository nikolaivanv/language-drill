# TR curriculum — reverse-coverage audit vs Göksel & Kerslake (2026-06-20)

A "pass in the opposite direction": instead of authoring grammar points forward
from Yedi İklim, we walked the **Göksel & Kerslake** reference grammar
(_Turkish: A Comprehensive Grammar_) and checked which A1–B1-appropriate topics
are **missing or only partially covered** in `packages/db/src/curriculum/tr.ts`.

Book source (markdown mirror, with index): `/Users/seal/dev/turkish-grammar-book/turkish-grammar-md`.
Deep-links below are `chapters/<file>.md#anchor`.

## Authored in this pass (CURRICULUM_VERSION_TR → 2026-06-20b)

| New point | Level | Book grounding | Closes |
|---|---|---|---|
| `tr-a1-stem-changes` (consonant softening k→ğ/p→b/t→d/ç→c **+ vowel drop** şehir→şehri, akıl→aklı, omuz→omzum) | A1 | §2.1, §2.3 | HIGH #1 (softening) + the explicit vowel-drop request |
| `tr-a2-indefinite-compound` (belirtisiz isim tamlaması: şehir merkezi vs şehrin merkezi; case stacks via -n-) | A2 | §10.2 (contrast §14.4) | The "şehir merkezi" gap behind the failed translation |
| `tr-a2-suffix-order-buffers` (ordering template + y/n/s buffers + su/ne) | A2 | §6.1.3, §6.2, §6.3, §8.1, §8.1.3 | The comprehensive stacking/buffer reference |
| `tr-a2-optative` (-(y)AyIm / -(y)AlIm "let me / let's") | A2 | §21.4.4.3, §8.2.3.1 | HIGH (suggestions/offers — not covered by imperative) |
| `tr-a2-indefinite-pronouns` (biri/herkes/hiçbir/kimse/hepsi; negative-polarity rule) | A2 | §18.6, §20.5.2–.3, §12.2.2 | HIGH (everyday quantifiers + negation interaction) |

`tr-a2-suffix-order-buffers` is `clozeUnsuitable` (a single whole-word blank
cannot capture a meta-ordering rule); its value is the auto-generated theory
page plus translation practice on multi-suffix words.

## Round 2 (CURRICULUM_VERSION_TR → 2026-06-20c)

Authored: `tr-a2-consonant-doubling` (§2.2), `tr-b1-real-conditional` (open
-(I)rsA, §27.2.1.1), `tr-a2-reflexive-reciprocal-pronouns` (kendi + birbiri,
§18.1.2/.4), `tr-a2-distributive` (-(ş)Ar, §15.7.3). Folded into existing
points: -(y)Iş manner-vs--mIş (→ `tr-a2-nominalization`), headless relatives
(→ `tr-a2-relative-an`, `tr-b1-participles-dik-acak`), de-/ye- vowel raising
(→ `tr-a1-future`). The items marked ✅ below were closed in this round.

## Remaining gaps (not yet authored) — triage list

### HIGH

- ✅ **Consonant doubling / gemination** (hak→hakkı, his→hissi, sır→sırrım) — §2.2
  (chapters/02-sound-changes-produced-in-the-stem-by-suffixation.md#2-2).
  **DONE round 2** → `tr-a2-consonant-doubling`.
- ✅ **Full conditional range** beyond `tr-b1-conditional-irrealis` — open/real
  conditionals (aorist + -sA, olursa) — Chapter 27
  (chapters/27-conditional-sentences.md). **DONE round 2** →
  `tr-b1-real-conditional`. (Generic/habitual conditional subtypes still open.)

### MEDIUM

- ✅ **kendi — adjectival/own + reflexive/emphatic** — §18.1.2
  (chapters/18-pronouns.md#18-1-2). **DONE round 2** →
  `tr-a2-reflexive-reciprocal-pronouns`.
- ✅ **birbiri "each other"** as a productive pronoun — §18.1.4. **DONE round 2**
  (same point as kendi).
- ✅ **-(y)Iş single-act / manner nominalization** (yürüyüş, gidiş) — §8.5.2.1.
  **DONE round 2** — folded into `tr-a2-nominalization` (manner-vs--mIş error).
- **Short/long vowel alternation** (zaman→zama:nım) — §2.4. A1–A2, lexical.
  Deferred: pronunciation-only, no written-production signal.
- ✅ **Vowel raising before -y- suffixes** (de-→diyen, ye-→yiyecek) — §2.6.
  **DONE round 2** — folded as a commonError on `tr-a1-future`. (The wider §2.6
  raising is pronunciation-only and stays out.)
- **Word order & focus/backgrounding** (preverbal focus, postverbal
  backgrounding) — Chapter 23 (chapters/23-word-order.md). B1, comprehension.
  Deferred: many valid orders → cloze/translation would flag as ambiguous.
- ✅ **Headless relative clauses** (gelen "the one who came", okuduğum "the one I
  read") — §25.3. **DONE round 2** — folded as examples into `tr-a2-relative-an`
  and `tr-b1-participles-dik-acak`.
- **Definiteness & specificity as a system** (bir / accusative / plural /
  possessive interplay) — Chapter 22. B1, currently scattered. Deferred:
  meta-topic, better as a theory survey than a production cell.

### LOW (reading comprehension / narrow / B2-leaning)

- ✅ **Distributive -şar/-şer** (beşer, birer) — §15.7.3. **DONE round 2** →
  `tr-a2-distributive`.
- **Finite relative clauses with `ki`** — §25.6. B1–B2.
- **Truncated relatives — `olan` omission** — §25.4.1.1. B1–B2.
- **Case stacking on -ki** (evdekinde) — §8.1.4. B1–B2 (mentioned in
  `tr-a2-suffix-order-buffers` examples).
- **Restrictive vs non-restrictive relatives** — §25.2. B1–B2.
- **Noun clauses -DIK/-(y)AcAK + case** (gittiğimi söyledim) — Chapter 24. B2.
- **Modal clitic `imiş`** (vs evidential -mIş) — §11.1. B1–B2.

## Notes

- The book treats consonant softening and vowel drop together in Chapter 2 as
  "sound changes produced in the stem by suffixation"; we mirrored that by
  bundling both into `tr-a1-stem-changes` rather than two thin points.
- Both halves of the compound contrast already exist now: definite/genitive
  (`tr-a1-genitive-possessive`, §14.4) and indefinite/bare
  (`tr-a2-indefinite-compound`, §10.2).
