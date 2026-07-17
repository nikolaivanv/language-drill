# DE curriculum — reverse-coverage audit vs Hammer's German Grammar (2026-07-12)

The "pass in the opposite direction" before authoring the DE A1–B2 curriculum
(analogous to `tr-curriculum-gk-coverage-audit-2026-06-20.md` for TR): instead
of working forward from the coursebook TOCs, we walked **Hammer's German
Grammar and Usage** (Martin Durrell, 7th ed.) chapter by chapter and checked
which A1–B2-appropriate topics are **missing or only implicitly covered** in
the Goethe-proxy inventory (`de-menschen-toc-inventory.md`, from Hueber
*Menschen* A1–B1 + *Sicher!* B2).

Book source (markdown mirror, with index):
`/Users/seal/dev/language-tools/German/german-grammar-book/german-grammar-md`.
Deep-links below are `chapters/<file>.md#anchor`.

Baseline: the current `packages/db/src/curriculum/de.ts` is **entirely
commented out** (disabled 2026-05-10) and holds only 20 draft points
(4 A1 / 5 A2 / 6 B1 / 5 B2 grammar + 3 vocab). The forward pass will re-author
from the Menschen/Sicher inventory; this audit lists what that inventory
*doesn't* name, so the authoring plan can include them deliberately.

## Overall verdict

The Menschen/Sicher TOCs cover Hammer's core system well: articles, cases,
adjective declension, the full tense/mood/passive ladder, subordinate clauses,
two-way prepositions, word formation. The gaps are of two kinds:

1. **Usage rules the coursebooks teach but never name in a TOC line** (zero
   article with professions, *nicht* vs *kein*, *nach/zu/in* for "to",
   *seit* + present). These are exactly the persistent production errors our
   evaluator should target — they must become explicit points or they'll be
   skipped.
2. **B2 topics Sicher! under-names** (subjective modals beyond *sollen*,
   double-infinitive order with modal Perfekt/KII).

## HIGH — should become explicit grammar points

- **Zero article with professions, nationalities and predicates** ("Ich bin
  Lehrer", not \*"ein Lehrer"; "Sie ist Deutsche") — §4.8, esp. 4.8.2
  (chapters/04-the-articles.md#4-8-2), plus 4.8.3 zero article for "some/any".
  A1. Classic EN-interference error; the TOC names the article paradigms
  (A1 L4/L5) but never the no-article rule.
- **Negation: position of *nicht* + *nicht* vs *kein*** — §19.6
  (chapters/19-word-order.md#19-6) and §5.5.16
  (chapters/05-other-determiners-and-pronouns.md#5-5-16). A1–A2. The TOC has
  "Negation mit *nicht*" (A1 L2) and "Negativartikel *kein*" (A1 L5) as
  separate atoms, but neither the choice rule nor the placement rules
  (final-field, before predicate complements, constituent negation) is ever
  named — and *nicht* placement is a top-3 persistent production error.
- **German equivalents of English "to": *nach / zu / in / an / auf* +
  destination** ("nach Berlin", "zur Arbeit", "in die Schweiz", "ans Meer") —
  §18.5 (chapters/18-prepositions.md#18-5). A2. The TOC touches fragments
  (*am Meer/ans Meer* A2 L17, *Woher? vom/aus dem* A2 L19) but never the
  system for choosing the goal preposition. Highest-frequency preposition
  error for EN speakers; pairs with the existing two-way-prepositions point
  but is not the same skill (choice of preposition, not choice of case).
- ***seit* + present tense (up-to-now contexts)** ("Ich wohne seit drei
  Jahren hier", not \*"habe … gewohnt") — §12.1.2
  (chapters/12-the-tenses.md#12-1-2) and §18.2.7
  (chapters/18-prepositions.md#18-2-7). A2–B1. The TOC has *seit(dem)* only
  as a conjunction item (A2 L22); the tense-choice rule — the actual
  EN-interference trap — is never named.
- **Subjective (epistemic) modal verbs beyond *sollen*** — *müssen* =
  deduction ("Er muss krank sein"), *dürfte* = probability, *können/könnte* =
  possibility, *wollen* = claim ("Er will nichts gewusst haben") — §15.2.2,
  §15.5.2, §15.7.2 (chapters/15-the-modal-auxiliaries.md#15-5-2). B2.
  Sicher! names only "subjektive Bedeutung des Modalverbs *sollen*" (L8);
  the full epistemic set is a standard Goethe B2 topic and a distinct
  production skill (incl. the modal + perfect infinitive pattern).
- **Modal verbs in Perfekt / Konjunktiv II past: double-infinitive order**
  ("Ich habe kommen müssen", "Er hätte es machen können") — §15.1.1
  (chapters/15-the-modal-auxiliaries.md#15-1-1), §11.3.2, §19.1.3
  (chapters/19-word-order.md#19-1-3). B2. The TOC has KII past (B1 L10) and
  Präteritum modals (A2 L20), but the infinitive-for-participle rule and the
  verb-cluster order (auxiliary *before* the double infinitive in subordinate
  clauses: "…, dass er es hätte machen können") appear nowhere.

## MEDIUM — add as points or fold into planned points (decide in forward pass)

- ***aber* vs *sondern*** ("nicht …, sondern …") — §17.1.1
  (chapters/17-conjunctions-and-subordination.md#17-1-1). A2. Taught by every
  coursebook, named by none of the TOC lines.
- **Basic indefinite pronouns at A2: *man*, *jemand/niemand*,
  *etwas/nichts*, *alles/alle*** — §5.5, esp. 5.5.18 *man*
  (chapters/05-other-determiners-and-pronouns.md#5-5-18), 5.5.15, 5.5.9,
  5.5.22. The inventory has Indefinitpronomen only at B2 (Sicher L11) —
  far too late for *man*, which is also the workhorse passive alternative.
  Suggest: basic set at A2; keep the B2 point for the long tail
  (*irgend-*, *mancher*, *mehrere*, *sämtlich*).
- ***was für ein* vs *welch-*** — §5.3.2
  (chapters/05-other-determiners-and-pronouns.md#5-3-2). A2–B1. TOC covers
  *welch-* (A2 L21) only.
- **Directional adverbs *hin/her* and compounds** (*hinein/heraus/hinauf/
  herunter*, *hin und zurück*, prefixed verbs) — §7.2
  (chapters/07-adverbs.md#7-2). A2–B1. A German-specific system entirely
  absent from the TOCs.
- **Time-adverb triad *schon / noch / erst* (+ *erst* vs *nur*)** — §7.3.1
  (chapters/07-adverbs.md#7-3-1), §9.1.12. B1. High-frequency, contrastive
  with EN, absent from TOCs.
- **Adjective declension after indefinites/quantifiers** (*alle guten
  Freunde* vs *viele gute Freunde*) — §6.1.4
  (chapters/06-adjectives.md#6-1-4). B1. The TOC's three declension lessons
  stop at the three article classes; the quantifier row is where advanced
  learners keep slipping. Could fold into the planned declension points as a
  fourth cell or stand alone.
- **Definite article + dative (reflexive) for body parts/clothing** ("Ich
  wasche mir die Hände", "Er zieht sich die Jacke an") — §4.6
  (chapters/04-the-articles.md#4-6), §16.4.3, §2.5.3. B1. Standard German
  pattern replacing the EN possessive; not named anywhere in the TOCs.
- **German equivalents of the EN progressive** (*gerade*, *beim* + Infinitiv,
  *dabei sein, zu*) — §12.5 (chapters/12-the-tenses.md#12-5). B1.
  Production-relevant for EN speakers; absent from TOCs.
- ***es gibt* + accusative vs *es ist/sind*** — §16.2.5
  (chapters/16-verbs-valency.md#16-2-5). A1. Small but exam-staple; the TOC's
  first *es* item is B1 L17 ("Ausdrücke mit es"). Either an early narrow point
  or an explicit sub-item of the B1 *es* point pulled down to A1.
- **Measurement/quantity phrases** ("zwei Kilo Tomaten", "ein Glas Wein" —
  no *von*, no plural on the measure noun) — §1.2.8
  (chapters/01-nouns.md#1-2-8), §2.7. A2. Everyday shopping language; the
  A2 vocab column has "Verpackung und Gewichte" but the grammar rule is
  unnamed.
- **Genitive vs *von*-paraphrase** — §2.4 (chapters/02-case.md#2-4). B1–B2.
  Register rule; best folded into the planned genitive point
  (B1 L12 / draft `de-b2-genitive-prepositions`) rather than standing alone.
- ***sobald*, *solange*, *sooft*** — §17.3.6
  (chapters/17-conjunctions-and-subordination.md#17-3-6). B1. Fold into the
  temporal-conjunction point (TOC has *bevor/während/bis/seitdem/nachdem/als/
  wenn* but not these three).
- **Adverbial order in the Mittelfeld (time–reason–manner–place)** — §19.5
  (chapters/19-word-order.md#19-5). B1–B2. Sicher L1 names "Mittelfeld im
  Hauptsatz"; make sure the authored B2 point actually includes the TeKaMoLo
  default and pronoun-object ordering (§19.4), which the B1 TOC handles only
  as "Stellung der Objekte" (A2 L15).
- ***bekommen*-passive** ("Er bekommt das Buch geschenkt") — §13.4.2
  (chapters/13-the-passive.md#13-4-2). B2. Check whether the authored
  "alternatives to the passive" point (Sicher L10) includes it; if not, add.
- **Modal particles II (B2 extension): *halt*, *eben*, *mal*, *schon*,
  *wohl*, *bloß/nur*** — §9.1 (chapters/09-modal-particles.md#9-1). B1 L19
  covers *denn/doch/eigentlich/ja*; Sicher adds none. Spoken-German
  differentiator; recognition-capped like ES appreciative suffixes.
- ***wissen* vs *kennen* (vs *können*)** — §15.3.3
  (chapters/15-the-modal-auxiliaries.md#15-3-3). A2. Lexical contrast with a
  grammatical footprint (clause vs NP complement); cheap to author, very
  common error.

## LOW / deferred — noted, not planned for A1–B2

- **Pronouns of address *du/ihr/Sie* pragmatics** — §3.3. Register choice;
  belongs in evaluator context, not a drillable point.
- **Free datives / dative of advantage** — §2.5.2. C1-leaning.
- **Apposition case agreement** — §2.6. C1.
- ***derjenige*, *derselbe*, *jener*** — §5.1.3–5.1.5. Low frequency at B2;
  *derjenige* mainly as relative-clause antecedent (touched by generalizing
  relatives, Sicher L7).
- **Rare indefinites** (*etliche*, *sämtlich*, *lauter*, *jedweder*,
  *meinesgleichen*, *unsereiner*) — §5.5. C1+.
- **Semi-auxiliaries *scheinen/pflegen/drohen zu*** — §11.2.4. B2/C1
  borderline; revisit if B2 pool needs depth.
- **Nachfeld placement** — §19.8. Beyond the B2 "Mittelfeld" point, C1.
- ***gehören*-passive** — §13.4.7. Regional/colloquial.
- **EN '-ing' contrast catalogue** — §11.6. Meta-contrastive; its useful
  content is distributed across the zu-infinitive, nominalization and
  progressive-equivalents points.
- **Adjectives governing cases** (*mir wichtig*, genitive adjectives) —
  §6.3. Fold examples into dative-verbs/valency material; C1 as a system.
- **Noun gender long tail** (two-gender nouns, meaning-differentiating
  gender §1.1.10–11) — keep the draft `de-a1-noun-gender` scoped to the
  productive suffix rules.
- **Orthography: capitalization (§21.2), *ss/ß* (§21.4.1), comma rules
  (§21.5)** — enforced by the evaluator on every written answer already;
  comma-before-subordinate-clause could become a commonError entry on the
  subordinate-conjunction points instead of a standalone point.
- **Pronunciation/phonetics chapters** — out of app scope (no accent work).

## Notes for the forward (authoring) pass

- **Level reconciliation needed:** Menschen introduces several systems
  earlier than the current draft places them — Wechselpräpositionen at A2
  (draft: B1), present passive at A2 L14 (draft: B1 `de-b1-passive-werden`),
  Konjunktiv II *würde/könnte/sollte* at A1/A2 (draft: B2). Follow the
  coursebook (= exam expectation): introductory point at the Menschen level,
  full-system point at the draft's level (mirrors the ES restrictive/advanced
  relative-clause split from PR #529).
- The draft's `de-a1-noun-gender` and `de-a1-v2-word-order` have no explicit
  TOC line — keep both; they are load-bearing prerequisites.
- Hammer has no per-level tagging, so CEFR placements above follow the
  Menschen/Sicher sequencing where a neighbouring topic exists, else Goethe
  exam convention.
- Not audited here: vocab umbrellas (the inventory's Wortfelder consolidation
  stands on its own) and the free-writing/dictation tracks.
