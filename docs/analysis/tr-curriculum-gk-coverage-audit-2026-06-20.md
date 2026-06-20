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

## Remaining gaps (not yet authored) — triage list

### HIGH

- **Consonant doubling / gemination** (hak→hakkı, his→hissi, sır→sırrım) — §2.2
  (chapters/02-sound-changes-produced-in-the-stem-by-suffixation.md#2-2). A1–A2,
  ~20–30 lexical items, dictionary-marked. Same family as `tr-a1-stem-changes`;
  could fold in or stand alone.
- **Full conditional range** beyond `tr-b1-conditional-irrealis` — open/real
  conditionals (aorist + -sA, olursa), generic/habitual conditionals — Chapter 27
  (chapters/27-conditional-sentences.md). B1.

### MEDIUM

- **kendi — adjectival/own use** (kendi şirketim) distinct from the reflexive
  pronoun — §18.1.2 (chapters/18-pronouns.md#18-1-2). Partially in
  `tr-b1-reflexive-voice-kendi`. A2–B1.
- **birbiri "each other"** as a productive pronoun (vs closed-set reciprocal
  voice) — §18.1.4. A2–B1. Touched in `tr-b1-reciprocal-voice`.
- **-(y)Iş single-act / manner nominalization** (yürüyüş, gidiş) split out from
  `tr-a2-nominalization` — §8.5.2.1. A2.
- **Short/long vowel alternation** (zaman→zama:nım) — §2.4. A1–A2, lexical.
- **Vowel raising before -y- suffixes** (de-→diyen, ye-→yiyecek) — §2.6. A2–B1.
- **Word order & focus/backgrounding** (preverbal focus, postverbal
  backgrounding) — Chapter 23 (chapters/23-word-order.md). B1, comprehension.
- **Headless relative clauses** (gelen "the one who came", okuduğum "the one I
  read") — §25.3. A2–B1, mostly comprehension.
- **Definiteness & specificity as a system** (bir / accusative / plural /
  possessive interplay) — Chapter 22. B1, currently scattered.

### LOW (reading comprehension / narrow / B2-leaning)

- **Distributive -şar/-şer** (beşer, birer) — §9.3 / Chapter 8. B1.
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
