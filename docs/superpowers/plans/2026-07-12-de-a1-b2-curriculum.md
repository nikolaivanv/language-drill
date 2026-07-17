# DE A1–B2 Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the full DE A1–B2 grammar curriculum (98 grammar points + 3 restored vocab umbrellas) in `packages/db/src/curriculum/de.ts`, re-enabling the language that was disabled on 2026-05-10.

**Architecture:** Data-only change plus its ripple: `de.ts` entries, `PER_LANGUAGE_GRAMMAR_MIN`, curriculum count tests, `SEED_KEY_TO_GRAMMAR_POINT`, and the theory-category map (source + test mirror). Point design comes from `docs/analysis/de-menschen-toc-inventory.md` (Goethe proxy) + `docs/analysis/de-curriculum-hammer-coverage-audit-2026-07-12.md` (HIGH + MEDIUM gaps), with the approved level split: introductory point at the Menschen level, full-system point higher (ES PR #529 precedent).

**Tech Stack:** TypeScript data modules, Vitest, `GrammarPoint` contract in `packages/shared/src/curriculum-types.ts`, invariants in `packages/db/src/curriculum/index.ts` (`assertCurriculumInvariants`).

## Global Constraints

- Every entry satisfies `assertCurriculumInvariants`: key `^de-(a1|a2|b1|b2)-[a-z0-9-]+$`, level matches key infix, `description.length <= 300`, `examplesPositive >= 2`, `examplesNegative >= 1` each starting `*`, `commonErrors >= 1`, prerequisites resolve in-language.
- `CURRICULUM_VERSION_DE` → `'2026-07-12'` in the same commit as the entries (CLAUDE.md rule), with a doc-comment paragraph explaining the bump (ES file style).
- Descriptions in English; German examples with correct orthography (ß/umlauts, noun capitalization).
- `sentenceConstructionSuitable` only on single-construction points ([[sentence-construction-multi-construction-unsuitable]]).
- `conjugationSeedWords` only on `'verb'`-kind closed-set points or `'predicate-nominal'` (invariant 9g); German needs no predicate-nominal points.
- Reuse the 15 surviving draft keys unchanged (no DB orphans beyond the one deliberate drop below); **`de-b1-modal-verbs-past` is dropped** — superseded by `de-a2-praeteritum-modals` (Menschen A2 L20 placement). Update `de-b2-konjunktiv-ii`'s `prerequisiteKeys` accordingly.
- Work in a worktree under `.claude/worktrees/` off fresh `origin/main` ([[main-checkout-carries-overlapping-wip]]); copy `/.env` + `apps/web/.env` in; `pnpm install`; assert branch before every commit ([[workspace-branch-flips-to-main]]).
- Gates before PR: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` ([[package-typecheck-excludes-tests]], [[pnpm-test-infra-parallel-flake]]).

---

## Curriculum design (the authoritative point list)

Sources: `M-A1/A2/B1 L<n>` = Menschen lesson; `S L<n>` = Sicher! lesson; `H §x` = Hammer section; `AUDIT-H/M` = Hammer audit HIGH/MEDIUM item. Flags: `conj` = conjugationSuitable (+person floors), `SC` = sentenceConstructionSuitable, `noCloze` = clozeUnsuitable, `tgt=N` = targetOverride, `seeds[...]` = conjugationSeedWords. KEEP = existing draft key retained (rescope noted).

### A1 — 18 grammar points

1. `de-a1-present-regular` — Present tense: regular conjugation. Endings -e/-st/-t/-en/-t/-en; -e- epenthesis on t/d stems (arbeitest, findet); -s/-z stems (heißt); -eln (sammle). [M-A1 L1–2; H §10.1.2] conj, person floors {1sg:5, 2sg:5, 3sg:5, 1pl:5, 3pl:5}, SC.
2. `de-a1-present-irregular` — Present tense: sein/haben/werden/wissen + stem-changing verbs (e→i sprechen/geben/nehmen/essen, e→ie lesen/sehen, a→ä fahren/schlafen/laufen/tragen). Change only in 2sg/3sg. [M-A1 L3; H §10.1.3] conj, seeds[sein, haben, werden, wissen, sprechen, essen, geben, nehmen, helfen, treffen, lesen, sehen, fahren, schlafen, laufen, tragen, waschen], person floors {2sg:8, 3sg:8} (diagnostic persons), prereq: present-regular.
3. `de-a1-noun-gender` — KEEP as drafted (suffix rules -ung/-heit/-keit → die, -chen/-lein → das, -er agents → der).
4. `de-a1-plural-formation` — Plural types: -e(+uml), -er(+uml), -(e)n, -s, zero(+uml); -n plural for -e nouns. [M-A1 L6; H §1.2].
5. `de-a1-articles-nominative` — KEEP; rescope description to include negative article kein/keine. [M-A1 L4–5; H §4.1].
6. `de-a1-accusative` — Accusative for direct objects: only masculine changes (den/einen/keinen/meinen). [M-A1 L6; H §2.2] prereq: articles-nominative.
7. `de-a1-dative` — Dative article forms dem/der/dem/den+-n; after location prepositions (wo? in der Stadt) and dative verbs (helfen, danken, gefallen, gehören, schmecken). [M-A1 L13/15; H §2.5, §16.4.2] prereq: accusative.
8. `de-a1-personal-pronouns` — Personal pronoun paradigm nom/acc/dat (ich–mich–mir …); er/es/sie for inanimates by gender; du/ihr/Sie address. [M-A1 L4/15/20; H §3.1, §3.3].
9. `de-a1-possessive-articles` — mein/dein/sein/ihr/unser/euer/Ihr; ein-word endings in nom + acc; sein vs ihr by possessor gender. [M-A1 L3/14, M-A2 L1; H §5.2].
10. `de-a1-questions` — W-questions (wer/was/wo/wohin/woher/wann/wie/warum) with V2; yes/no questions with V1; ja/nein/doch answers. [M-A1 L1/3; H §5.3, §19.1] SC.
11. `de-a1-v2-word-order` — KEEP as drafted (V2, fronting, verb bracket). [M-A1 L7–8; H §19.1–19.2].
12. `de-a1-negation` — nicht vs kein: kein negates indefinite/bare nouns; nicht placement (clause-final for verbs, before predicate adjectives/complements, before the focused constituent). [AUDIT-H; M-A1 L2/5; H §19.6, §5.5.16].
13. `de-a1-zero-article` — No article for professions/nationalities after sein/werden (Ich bin Lehrerin), plural indefinites ("some/any"), materials/languages. [AUDIT-H; H §4.8].
14. `de-a1-modal-verbs-present` — können/wollen/müssen/dürfen/sollen/mögen + möchte-forms: sg irregularities (kann/kannst), verb bracket with final infinitive. [M-A1 L7/9/17/18/21; H §15.1] conj, seeds[können, wollen, müssen, dürfen, sollen, mögen], person floors {1sg:5, 2sg:5, 3sg:5}, SC.
15. `de-a1-imperative` — Sie-imperative (Gehen Sie!), du-imperative (Geh!/Nimm!/Fahr!), ihr-imperative (Geht!); sein (Sei/Seid/Seien Sie). [M-A1 L18/20; H §14.1.1].
16. `de-a1-temporal-prepositions` — Time: am + day/part-of-day, um + clock, im + month/season, von … bis, ab, vor/nach/in + dative, für + accusative. [M-A1 L8/11/12/16; H §4.5, §18].
17. `de-a1-es-gibt` — es gibt + accusative for existence; contrast with sein. [AUDIT-M; H §16.2.5] tgt=12.
18. `de-a1-praeteritum-sein-haben` — war/hatte (+ es gab): the only A1 simple-past forms. [M-A1 L19; H §10.2.2] conj, seeds[sein, haben], person floors {1sg:3, 3sg:3}, tgt=15.

### A2 — 29 grammar points

1. `de-a2-perfekt-with-haben` — KEEP (SC already set).
2. `de-a2-perfekt-with-sein` — KEEP.
3. `de-a2-past-participle-formation` — ge-…-t weak / ge-…-en strong (with ablaut), no ge- for inseparable + -ieren verbs, -ge- inside separables (eingekauft). [M-A1 L19 + M-A2 L1; H §10.2] prereq: perfekt-with-haben.
4. `de-a2-akkusativ-prepositions` — KEEP.
5. `de-a2-dativ-prepositions` — KEEP.
6. `de-a2-separable-prefix-verbs` — KEEP.
7. `de-a2-two-way-prepositions-core` — an/auf/hinter/in/neben/über/unter/vor/zwischen: accusative for direction (wohin?), dative for location (wo?). [M-A2 L2; H §18.3] (Placement-verb pairs stay in the B1 point.)
8. `de-a2-adjective-declension-indefinite` — After ein/kein/possessives (mixed declension). [M-A2 L4; H §6.1].
9. `de-a2-adjective-declension-definite` — After der/das/die (weak declension: -e/-en). [M-A2 L5; H §6.1.2].
10. `de-a2-adjective-declension-zero` — No article (strong declension: adjective carries the article ending; frischer Fisch, mit kaltem Wasser). [M-A2 L9; H §6.1.2–6.1.3].
11. `de-a2-weil-deshalb` — Cause with weil (verb-final) vs consequence with deshalb (inversion); denn (position 0). [M-A2 L8; H §17.4, §19.1] SC.
12. `de-a2-dass-clauses` — dass-complement clauses, verb-final; comma. [M-A2 L10; H §17.2.1] SC.
13. `de-a2-wenn-als` — als = single past event; wenn = repeated/present/future events and conditions. [M-A2 L12/13; H §17.3.1] pairs-type contrast.
14. `de-a2-indirect-questions` — ob for yes/no, W-word for information questions; verb-final. [M-A2 L16; H §14.4.4].
15. `de-a2-relative-clauses-nom-acc` — der/das/die relatives in nominative + accusative; verb-final; commas. [M-A2 L23; H §5.4.1] prereq: articles.
16. `de-a2-reflexive-verbs` — sich-verbs with accusative reflexive (sich freuen, sich duschen); mich/dich/sich forms. [M-A2 L11; H §3.2, §16.3.5].
17. `de-a2-praeteritum-modals` — konnte/musste/durfte/wollte/sollte/mochte: umlaut drop + -te; final infinitive. Replaces the dropped B1 draft. [M-A2 L20; H §10.6] conj, seeds[können, müssen, dürfen, wollen, sollen, mögen], person floors {1sg:4, 3sg:4}, SC.
18. `de-a2-konjunktiv-ii-polite` — würde + infinitive, könnte/sollte/hätte gern for wishes, suggestions, polite requests (no conditionals yet). [M-A1 L24 + M-A2 L7; H §14.5.3] prereq: modal-verbs-present.
19. `de-a2-passive-present` — Present werden-passive (Das Päckchen wird gepackt); focus on process, agent optional. [M-A2 L14; H §13.1] SC.
20. `de-a2-verb-preposition-complements` — Verbs with fixed prepositions (warten auf + A, sich interessieren für, träumen von); question/pronoun adverbs worauf/darauf for things vs preposition + pronoun for people. [M-A2 L18; H §16.5, §3.5].
21. `de-a2-comparison` — Comparative -er / superlative am -sten with umlaut (älter, größer); irregular gut/gern/viel; als vs (genauso) wie. [M-A1 L22; H §6.5] (A2 per PCIC-analog placement, matching ES re-level.)
22. `de-a2-nicht-sondern` — sondern after negation (corrective "but"), aber elsewhere; nicht nur … sondern auch preview. [AUDIT-M; H §17.1.1] pairs-type contrast.
23. `de-a2-indefinite-pronouns-basic` — man (+ one-verb 3sg), jemand/niemand, etwas/nichts, alles/alle. [AUDIT-M; H §5.5.18/.15/.9/.22].
24. `de-a2-lassen` — lassen + infinitive: have something done (Ich lasse mein Fahrrad reparieren), permit (Sie lässt ihn fahren); Lass uns … suggestions. [M-A2 L21; H §13.4.6, §11.3.1].
25. `de-a2-destination-prepositions` — "to": nach + city/country, zu + person/institution, in + enterable place (acc), an + edge/water (acc), auf + island/event. [AUDIT-H; M-A2 L17/19; H §18.5] prereq: two-way-prepositions-core.
26. `de-a2-seit-present` — seit/schon + present for started-in-past-still-true states (Ich wohne seit drei Jahren hier — never Perfekt). [AUDIT-H; H §12.1.2, §18.2.7] tgt=12.
27. `de-a2-wissen-kennen` — wissen + clause (facts) vs kennen + NP (acquaintance) vs können (skills). [AUDIT-M; H §15.3.3] pairs-type contrast.
28. `de-a2-demonstratives-welch` — dies- (declined like der), demonstrative der/das/die, question article welch-, was für ein. [M-A2 L21; AUDIT-M; H §5.1, §5.3].
29. `de-a2-dative-accusative-objects` — Two-object verbs (geben, schenken, zeigen): noun objects dat-before-acc; pronoun objects acc-before-dat; pronouns before nouns. [M-A2 L15; H §19.4] noCloze (order rule — a blank cannot test ordering).

### B1 — 25 grammar points

1. `de-b1-praeteritum` — Full Präteritum: weak -te-, strong ablaut, mixed verbs (brachte, wusste); written-narrative register vs spoken Perfekt. [M-A2 L24 + M-B1 L2; H §10.2, §12.2.2] conj, person floors {1sg:5, 3sg:5, 3pl:5}, prereq: praeteritum-modals.
2. `de-b1-relative-pronouns` — KEEP; rescope to dative/genitive (dessen/deren) and preposition + relative (mit dem, auf die); nom/acc now lives at A2. prereq: de-a2-relative-clauses-nom-acc.
3. `de-b1-dass-clause-perfekt` — KEEP (verb clusters in subordinate clauses: participle + auxiliary order).
4. `de-b1-two-way-prepositions` — KEEP; rescope to placement-verb pairs stellen/stehen, legen/liegen, setzen/sitzen, hängen (tr./intr.), stecken + case choice. prereq: de-a2-two-way-prepositions-core.
5. `de-b1-passive-werden` — KEEP; rescope to Präteritum passive (wurde eingeführt), Perfekt passive (ist eingeführt worden), passive with modals (muss gemacht werden); agent von vs durch. [M-B1 L21/22; H §13.1.1, §13.3] prereq: de-a2-passive-present.
6. `de-b1-subordinate-conjunctions` — KEEP; rescope list to obwohl/trotzdem contrast, da, während, bevor, falls, sobald, solange, seitdem, bis. [M-B1 L4/6/8; AUDIT-M sobald/solange; H §17.3–17.6] SC stays.
7. `de-b1-plusquamperfekt-nachdem` — hatte/war + participle; nachdem with tense-sequence rule (Plusquamperfekt → Präteritum/Perfekt). [M-B1 L11; H §12.4, §17.3.4] SC.
8. `de-b1-futur-i` — werden + infinitive for predictions/promises/resolutions; present + adverb for scheduled future; wohl + Futur = assumption. [M-B1 L5; H §12.3].
9. `de-b1-konjunktiv-ii-past` — hätte/wäre + participle: counterfactual past conditionals, regrets, missed opportunities. [M-B1 L10; H §14.3.1] SC, prereq: de-a2-konjunktiv-ii-polite.
10. `de-b1-zu-infinitive` — zu-infinitive after verbs (versuchen, vergessen), nouns (Lust, Zeit), adjectives (wichtig); comma rules; nicht/nur brauchen + zu; bare infinitive with modals/gehen/sehen/hören/lassen contrast. [M-B1 L7/16; H §11.2–11.3].
11. `de-b1-um-zu-damit` — Purpose: um … zu (same subject) vs damit (different subject). [M-B1 L24; H §14.5.2, §17.5.1] SC.
12. `de-b1-statt-ohne-zu` — (an)statt … zu / ohne … zu + infinitive; (an)statt dass / ohne dass for different subjects. [M-B1 L23; H §11.2.6].
13. `de-b1-two-part-conjunctions` — nicht nur … sondern auch, sowohl … als auch, weder … noch, entweder … oder, zwar … aber, je … desto/umso (+ comparative, word order). [M-B1 L15/18/19; H §17.1] noCloze (bipartite: the other half leaks the blank).
14. `de-b1-genitive` — Genitive case: -(e)s masculine/neuter, adjective declension, proper-name -s, common genitive prepositions trotz/wegen/innerhalb/außerhalb; von-paraphrase register note. [M-B1 L12/13/21; H §1.3.5, §2.3–2.4] prereq: de-a2-adjective-declension-definite.
15. `de-b1-n-declension` — Weak masculines (der Junge/Kollege/Student/Herr/Mensch/Name): -(e)n in every case except nom sg. [M-B1 L1; H §1.3.2].
16. `de-b1-adjectives-as-nouns` — der/die Bekannte, ein Deutscher, das Wichtigste, etwas Neues/nichts Besonderes: noun capitalization + adjective declension retained. [M-B1 L1; H §6.2].
17. `de-b1-participles-as-adjectives` — Partizip I (faszinierende Einblicke) and Partizip II (versteckte Talente) as attributive adjectives with normal declension. [M-B1 L14; H §11.5.1] prereq: past-participle-formation.
18. `de-b1-comparison-attributive` — Declined comparative/superlative attributes (ein besseres Angebot, der schönste Tag) + declension after alle/viele/einige/manche/wenige. [M-B1 L9; AUDIT-M §6.1.4; H §6.5, §6.1.4] prereq: de-a2-comparison.
19. `de-b1-reason-consequence-connectors` — darum/deswegen/daher/aus diesem Grund (consequence, inversion) vs nämlich (reason, position 3, never first); vs weil/da. [M-B1 L13; H §7.4.3, §17.4] prereq: de-a2-weil-deshalb.
20. `de-b1-es-expressions` — Impersonal/placeholder es: weather (es regnet), es geht mir, es tut mir leid, es gibt review, correlate es (Es freut mich, dass …) and when es drops. [M-B1 L17; H §3.6, §16.2.4].
21. `de-b1-modal-particles-basic` — denn (questions), doch (contradiction/encouragement), eigentlich (by-the-way), ja (shared knowledge), mal (softener). [M-B1 L19; H §9.1] noCloze (several particles fit most blanks), tgt=15.
22. `de-b1-dative-reflexive-body` — Definite article + dative (reflexive) for body parts/clothing: Ich wasche mir die Hände; Er zieht sich die Jacke an. [AUDIT-M; H §4.6, §16.4.3] tgt=15.
23. `de-b1-hin-her` — Direction from speaker (hin) vs toward speaker (her); compounds hinein/heraus/hinauf/herunter (+ colloquial rein/raus); wohin/woher split (Wo kommst du her?). [AUDIT-M; H §7.2].
24. `de-b1-schon-noch-erst` — schon (already), noch (still), erst (only/not until), noch nicht / nicht mehr pairs; erst vs nur. [AUDIT-M; H §7.3.1, §9.1.12] pairs-type contrast.
25. `de-b1-progressive-equivalents` — English progressive → gerade, (gerade) dabei sein, zu + Inf, beim + nominalized infinitive. [AUDIT-M; H §12.5] tgt=15.

### B2 — 26 grammar points

1. `de-b2-konjunktiv-ii` — KEEP; rescope to the full meaning system: unreal conditions (present), wishes (Wenn ich doch …!), unreal comparisons (als ob + KII), verb-first conditionals (Hätte ich Zeit, …); würde vs synthetic forms (käme, wüsste). [S L3/L6; H §14.2–14.3, §14.5.1] prereq updated → de-b1-konjunktiv-ii-past.
2. `de-b2-konjunktiv-i` — KEEP (indirect speech; KII fallback; indirect questions/commands with solle/möge). [S L7; H §14.4].
3. `de-b2-genitive-prepositions` — KEEP; rescope to the formal long tail: aufgrund, anhand, bezüglich, hinsichtlich, infolge, anlässlich, mangels, (an)statt, während; colloquial dative drift flagged in formal writing. prereq: de-b1-genitive.
4. `de-b2-extended-attributes` — KEEP. [S L12; H §6.1.6] prereq: de-b1-participles-as-adjectives.
5. `de-b2-nominalization` — KEEP; rescope to verbal↔nominal style transformations (nominalized infinitives/adjectives, beim Lesen, zur Verbesserung) as Sicher's Nominalisierung units. [S L5/L8; H §11.4, §20.2].
6. `de-b2-zustandspassiv` — sein-passive (Das Fenster ist geöffnet) vs werden-passive (wird geöffnet): result state vs process. [S L2; H §13.2] pairs-type contrast, prereq: de-b1-passive-werden.
7. `de-b2-passive-alternatives` — man, sich lassen (lässt sich lösen), -bar adjectives, sein + zu + Inf, bekommen-passive; subjectless passive (Es wird getanzt / Ihm wird geholfen — dative stays). [S L10; AUDIT-M bekommen; H §13.4, §13.1.4].
8. `de-b2-subjective-modals` — Epistemic modals: muss (certain), dürfte (probable), könnte/kann (possible), soll (hearsay), will (claim); + Infinitiv II for past reference (Er muss krank gewesen sein). [AUDIT-H; S L8; H §15.2.2, §15.5.2, §15.6.3, §15.7.2].
9. `de-b2-modal-perfect-word-order` — Perfekt of modals (hat kommen müssen), KII past with modals (hätte machen können), verb-cluster order in subclauses (…, dass er es hätte machen können). [AUDIT-H; H §15.1.1, §11.3.2, §19.1.3] noCloze (order rule), prereq: de-b1-konjunktiv-ii-past.
10. `de-b2-futur-ii` — werden + Infinitiv II: completed-by-then future and past conjecture (Er wird es vergessen haben). [S L5; H §12.3] prereq: de-b1-futur-i, tgt=15.
11. `de-b2-causal-connectors` — Causal three ways: weil/da (subclause), denn/nämlich/deshalb-family (main clause), wegen/aufgrund + gen (nominal). [S L2; H §17.4] prereq: de-b1-reason-consequence-connectors.
12. `de-b2-temporal-connectors` — Temporal relations verbal↔nominal: während/bevor/nachdem/seit/bis ↔ während/vor/nach/seit/bis zu + noun; bei + nominalization. [S L4; H §17.3, §18].
13. `de-b2-conditional-connectors` — Conditions: wenn/falls, verb-first clauses, bei + noun, im Falle (+gen), es sei denn, sonst/andernfalls. [S L3/L8; H §14.3.2–14.3.3].
14. `de-b2-concessive-connectors` — Concession: obwohl/obgleich, trotzdem/dennoch, trotz + gen, zwar … aber, selbst wenn, so + adj + auch. [S L8; H §17.6].
15. `de-b2-consecutive-connectors` — Result: sodass / so … dass, folglich/infolgedessen, zu … als dass (+ KII). [S L9; H §17.5.2–17.5.3].
16. `de-b2-modal-connectors` — Means/manner: indem, dadurch dass, durch + noun/nominalization; ohne dass/ohne zu as negative-manner. [S L11; H §17.7] prereq: de-b1-statt-ohne-zu.
17. `de-b2-adversative-connectors` — Contrast: während (adversative), wohingegen, im Gegensatz zu/dagegen/hingegen; jedoch/allerdings. [S L12; H §17.1.1, §17.3.7].
18. `de-b2-dass-equivalents` — dass-clause ↔ zu-infinitive (subject-identity rules) ↔ nominal phrase; obligatory/optional correlates (es, darauf/damit …, dass). [S L3; H §17.2, §11.2.2–11.2.3].
19. `de-b2-relatives-advanced` — was after alles/etwas/nichts/superlatives and whole clauses, wo(r)+prep relatives, generalizing wer/was …, (der)jenige, der. [S L7; H §5.4.3–5.4.5] prereq: de-b1-relative-pronouns.
20. `de-b2-noun-verb-collocations` — Funktionsverbgefüge: eine Entscheidung treffen, zur Verfügung stehen, in Frage kommen, Bescheid geben, sich Mühe geben; verb-noun bond + article choice. [S L5/L9; H §19.7.2].
21. `de-b2-fixed-prepositions` — Nouns and adjectives with fixed prepositions (die Angst vor, der Grund für, stolz auf, abhängig von, verantwortlich für) + da(r)-correlate clauses. [S L6/L7; H §6.4, §16.5] prereq: de-a2-verb-preposition-complements.
22. `de-b2-indefinite-pronouns` — irgend-family (irgendjemand, irgendwo, irgendein-), mancher, mehrere, einige, sämtliche, beide, einer/keiner as pronouns (declension). [S L11; H §5.5].
23. `de-b2-word-formation` — Noun suffixes (-ung, -heit/-keit, -schaft, -nis), noun/adjective prefixes (un-, miss-, ur-), adjective suffixes (-lich, -ig, -isch, -bar, -los, -voll), adverb -weise, Fugen-s in compounds. [S L1/2/3/4/9/12; H §20].
24. `de-b2-mittelfeld-word-order` — Mittelfeld: pronoun cluster before nouns, TeKaMoLo default for adverbials, nicht placement II, Nachfeld basics. [S L1; AUDIT-M §19.4–19.5; H §19] noCloze (order rule).
25. `de-b2-text-reference-words` — Verweiswörter: dabei/dazu/damit/dafür anaphora, dies/das across sentences, solch-/derartig, hier + preposition. [S L3; H §3.5, §5.1] noCloze (multiple reference words fit most blanks), tgt=15.
26. `de-b2-modal-particles-advanced` — halt/eben (resignation), wohl (supposition), schon (concessive reassurance), bloß/nur (warnings/wishes), etwa (alarmed question). [AUDIT-M; H §9.1] noCloze, tgt=12, prereq: de-b1-modal-particles-basic.

### Vocab umbrellas — restore the 3 drafts unchanged

`de-a2-housing-vocab`, `de-b1-environment-vocab`, `de-b2-academic-noun-vocab` (needed by `SEED_KEY_TO_GRAMMAR_POINT`). The full Wortfelder-derived vocab track (plus dictation / free-writing / paraphrase umbrellas) is a **follow-up PR** — out of scope here.

---

### Task 1: Worktree + baseline

**Files:** none (setup).

- [ ] **Step 1:** `git -C /Users/seal/dev/language-drill status --porcelain` — if dirty, leave it; the worktree isolates us.
- [ ] **Step 2:** `git -C /Users/seal/dev/language-drill worktree add .claude/worktrees/de-curriculum -b feat/de-a1-b2-curriculum origin/main`
- [ ] **Step 3:** Copy env files: `cp /Users/seal/dev/language-drill/.env .claude/worktrees/de-curriculum/.env && cp /Users/seal/dev/language-drill/apps/web/.env .claude/worktrees/de-curriculum/apps/web/.env` (skip a source that doesn't exist).
- [ ] **Step 4:** `cd .claude/worktrees/de-curriculum && pnpm install && pnpm build`
- [ ] **Step 5:** Baseline green: `pnpm --filter @language-drill/db test` — expect pass.

### Task 2: Author A1 (18 points) + file scaffolding

**Files:**
- Modify: `packages/db/src/curriculum/de.ts` (whole file rewrite)

**Interfaces:** Produces the 18 A1 `GrammarPoint` literals per the design list above; restores `import { CefrLevel, Language } from '@language-drill/shared';` and the `const DE = Language.DE; const { A1, A2, B1, B2 } = CefrLevel;` destructure; deletes the "TEMPORARILY DISABLED" header; sets `CURRICULUM_VERSION_DE = '2026-07-12'` with a doc-comment paragraph (ES style) describing the re-enable.

- [ ] **Step 1:** Rewrite `de.ts` header + A1 section. Each entry follows the ES house style (see `es.ts:123–210`): 2–3 positive examples, 1–2 `*`-prefixed negatives, 2–4 commonErrors naming the concrete wrong form, flags exactly as the design list specifies. Keep the three KEEP-drafts' text, applying only the noted rescopes.
- [ ] **Step 2:** Run `pnpm --filter @language-drill/db test -- curriculum` — the counts test still expects DE disabled; expect ONLY that failure (invariants must pass). Fix any invariant failure now.
- [ ] **Step 3:** Commit `feat(curriculum): DE A1 grammar points (18)` — after asserting `git branch --show-current` = `feat/de-a1-b2-curriculum`.

### Task 3: Author A2 (29 points)

**Files:** Modify: `packages/db/src/curriculum/de.ts`

- [ ] **Step 1:** Append the A2 section per the design list (5 KEEPs verbatim + 24 new).
- [ ] **Step 2:** Same test run; same expectation (only the disabled-counts test red).
- [ ] **Step 3:** Commit `feat(curriculum): DE A2 grammar points (29)`.

### Task 4: Author B1 (25 points)

**Files:** Modify: `packages/db/src/curriculum/de.ts`

- [ ] **Step 1:** Append B1 per design list — 5 KEEPs with the noted rescopes (relative-pronouns, two-way-prepositions, passive-werden, subordinate-conjunctions get new descriptions/examples; dass-clause-perfekt verbatim). `de-b1-modal-verbs-past` is NOT carried over.
- [ ] **Step 2:** Test run as above.
- [ ] **Step 3:** Commit `feat(curriculum): DE B1 grammar points (25)`.

### Task 5: Author B2 (26 points) + vocab umbrellas

**Files:** Modify: `packages/db/src/curriculum/de.ts`

- [ ] **Step 1:** Append B2 per design list (5 KEEPs, rescopes as noted, `de-b2-konjunktiv-ii.prerequisiteKeys` → `['de-b1-konjunktiv-ii-past']`) + the 3 vocab umbrellas verbatim from the draft.
- [ ] **Step 2:** Test run.
- [ ] **Step 3:** Commit `feat(curriculum): DE B2 grammar points (26) + restored vocab umbrellas`.

### Task 6: Ripple — enable DE everywhere

**Files:**
- Modify: `packages/db/src/curriculum/index.ts:110-119` (PER_LANGUAGE_GRAMMAR_MIN + comment)
- Modify: `packages/db/src/curriculum/curriculum.test.ts` ("German is fully disabled" test + header comments ~line 632-641)
- Modify: `packages/db/scripts/seed-exercises.ts` (uncomment the 9 DE entries in SEED_KEY_TO_GRAMMAR_POINT)

- [ ] **Step 1:** `PER_LANGUAGE_GRAMMAR_MIN.DE = { A1: 18, A2: 29, B1: 25, B2: 26 }`; update the stale comment block above it.
- [ ] **Step 2:** Replace the disabled-test with a parity test mirroring the ES/TR shape: grammar floors (>=18/29/25/26), `vocab` toBe(3), `dictation` toBe(0) — comment that dictation/free-writing/paraphrase umbrellas are the follow-up PR.
- [ ] **Step 3:** Uncomment the DE seed-map entries (`de-cloze-a2-1` → `de-a2-perfekt-with-sein` … `de-vocab-b2-1` → `de-b2-academic-noun-vocab` — all 9 keys survive in the new design). Check how `de-free-writing-b1-city-vs-country` (seed-exercises.ts:630) is mapped; if it needs a grammar-point key and has none, map or exclude it deliberately and note why.
- [ ] **Step 4:** `grep -rn "de\.ts\|TEMPORARILY\|DE.*disabled\|disabled.*DE" packages/ infra/ apps/ --include="*.ts" -i | grep -v dist | grep -v node_modules` — restore any other DE gating found (e.g. onboarding language lists, scheduler tests, `curriculum.test.ts:108` cross-language example). Fix what the grep surfaces.
- [ ] **Step 5:** `pnpm --filter @language-drill/db test` — everything green now.
- [ ] **Step 6:** Commit `feat(curriculum): enable DE — floors, counts test, seed map`.

### Task 7: Theory-category map

**Files:**
- Modify: `packages/shared/src/theory-categories.ts` (KEY_TO_CATEGORY + doc comment saying DE is now live)
- Modify: `packages/shared/src/theory-categories.test.ts` (EXPECTED_KEY_CATEGORY mirror)

- [ ] **Step 1:** Add all 98 DE grammar keys to both maps. Category assignments: tense/aspect points → `tenses`; Konjunktiv/imperative/conditional points → `moods`; contrast points (wenn-als, wissen-kennen, nicht-sondern, schon-noch-erst, zustandspassiv, seit-present, wenn/als) → `pairs`; declension/case points (accusative, dative, genitive, n-declension, adjective declensions, plural) → `cases` or `morphology` (inflection classes → `morphology`; case usage → `cases`); word-order/clause/conjunction/infinitive points → `syntax`; pronoun/article points → `pronouns`/`articles`; word-formation → `morphology`; passives → `syntax` (match ES precedent for es passives — check `es-b1-passive-se` binding first and follow it).
- [ ] **Step 2:** `pnpm --filter @language-drill/shared test` — green.
- [ ] **Step 3:** Commit `feat(theory): category map for the DE curriculum`.

### Task 8: Linguistic-accuracy review (ES PR #529 precedent)

- [ ] **Step 1:** Dispatch 4 parallel review subagents (one per level), each given the level's `de.ts` slice + access to the Hammer markdown, with the brief: verify every German example is grammatical and idiomatic, every negative example is actually wrong, every commonError is real and correctly described, descriptions match the named scope, orthography (ß/umlauts/capitalization/commas) is correct. Report findings as file:line + fix.
- [ ] **Step 2:** Apply confirmed fixes; re-run `pnpm --filter @language-drill/db test`.
- [ ] **Step 3:** Commit `fix(curriculum): DE linguistic review fixes`.

### Task 9: Gates + PR

- [ ] **Step 1:** `pnpm lint && pnpm typecheck` — zero failures.
- [ ] **Step 2:** `pnpm turbo run test --concurrency=1` — zero failures ([[pnpm-test-infra-parallel-flake]]); if stale-dist phantoms appear: `rm -rf infra/lambda/dist` ([[lambda-stale-dist-test-files]]).
- [ ] **Step 3:** Push branch; `ghp pr create` with a body covering: point counts per level, the split decisions, the dropped `de-b1-modal-verbs-past` key, follow-up scope (vocab/dictation/free-writing/paraphrase umbrellas, theory batch generation), post-merge operator checklist (no Langfuse push needed; scheduler enumerates ~200 new DE cells paced by the budget cap; run theory generation for DE after pools build).

## Self-review notes

- Spec coverage: every Menschen/Sicher consolidated-inventory grammar item maps to a point above or is deliberately absorbed (A1 word-formation items → de-b2-word-formation covers the system; A1 numbers/ordinals → deferred, ES-style numbers point possible later; montags-adverbs → vocab-track material; A2 temporal preps über/von…an/zwischen → absorbed as examples into de-a1-temporal-prepositions' commonErrors during authoring or dropped as low-value). All 6 audit HIGH items have points (zero-article, negation, destination-prepositions, seit-present, subjective-modals, modal-perfect-word-order). Audit MEDIUMs: all included except measurement-phrases (deferred, noted in audit doc).
- The dropped key `de-b1-modal-verbs-past` may orphan stale pool rows from the pre-2026-05-10 era — acceptable; DE pool is stale and small.
- Key format check: all new keys match `^de-(a1|a2|b1|b2)-[a-z0-9-]+$`.
- Prerequisite graph resolves: every referenced key exists in the lists above, same language.
