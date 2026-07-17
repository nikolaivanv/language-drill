import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

const DE = Language.DE;
const { A1, A2, B1, B2 } = CefrLevel;

/**
 * Per-language curriculum version. Bump in the same commit as any edit to
 * this file's grammar entries (analogous to `*_PROMPT_VERSION` in
 * `packages/ai/src/`). The scheduler in `infra/lambda/src/generation/`
 * compares this to the value recorded on the most recent succeeded
 * generation_jobs row for each cell — when they differ, any
 * "saturated-dedup" or "low-yield" suppression on that cell clears, on the
 * assumption that the curriculum edit may have unblocked the search space.
 *
 * `2026-07-12`: DE re-enabled (disabled since 2026-05-10) and expanded to
 * full Menschen A1–B1 / Sicher! B2 parity: 18 A1 + 29 A2 + 25 B1 + 26 B2
 * grammar points plus the three restored vocab umbrellas. Sources:
 * `docs/analysis/de-menschen-toc-inventory.md` (Goethe proxy) and
 * `docs/analysis/de-curriculum-hammer-coverage-audit-2026-07-12.md` (Hammer
 * reverse-coverage audit; all HIGH and most MEDIUM gaps authored). 15 of the
 * 20 pre-disable draft keys are retained (5 with rescoped descriptions);
 * `de-b1-modal-verbs-past` is dropped — superseded by
 * `de-a2-praeteritum-modals` at the Menschen A2 L20 placement. Design/plan:
 * `docs/superpowers/plans/2026-07-12-de-a1-b2-curriculum.md`.
 *
 * `2026-07-16`: Hammer book-coverage gap triage applied
 * (`docs/analysis/de-gap-triage-2026-07-15.md`) before first enablement: 6 new
 * points (de-a1-numbers-ordinals, de-a2-measure-expressions,
 * de-a2-quantifiers-other, de-b1-articles-use,
 * de-b1-adjective-case-government, de-b2-verb-prefixes → 19 A1 + 31 A2 +
 * 27 B1 + 27 B2) and 28 fold amendments widening existing descriptions,
 * examples and commonErrors (reciprocal sich, gar nicht, wir-imperative and
 * sign infinitives, Mir-ist-kalt datives, derselbe/so ein, wobei, und zwar,
 * denn/dann, kosten + double accusative, seit + Präteritum, beinahe + KII
 * past, sodass spelling, Vorfeld topic note, FVG passives, wo-relatives,
 * -in derivation, -ns genitives, name apostrophes, predicate nominatives,
 * bare accusative time, als-role phrases, gern-ladder, stem-drop adjective
 * spelling, indefinite place adverbs, vorher/danach adverb tier).
 * 2026-07-17: authoring-time coverageSpec pass per docs/curriculum-authoring.md
 * (the tr-a1-imperative collapse, PR #588, made the spec decision mandatory
 * for new points): 35 specs added across A1 (5), A2 (13), B1 (12), B2 (5) —
 * declension/case paradigms (adjective endings ×3, n-declension, personal
 * pronouns, relatives, extended attributes), the wo?/wohin? two-way
 * contrasts, verb-person paradigms with German syncretism respected (1sg=3sg
 * Präteritum forms skipped; stem-change floors on 2sg/3sg only), imperative
 * persons (Sie/du/ihr/wir), and number floors where gender — not a coverage
 * axis — is the unpinnable residual. Two existing specs widened
 * (praeteritum-sein-haben +2pl per its own *ihr waren commonError;
 * b1-praeteritum +2sg — 1sg=3sg made "full paradigm" two surfaces). ~68
 * points deliberately spec-less (word-order rules, connector/lexical choice,
 * gender-only variation; de-a2-comparison's adjective-vs-adverb split needs
 * the vocab-only wordClass axis — unpinnable on grammar points). No pools
 * exist yet, so no demotes needed anywhere.
 * 2026-07-17a: DE nominal-inflection conjugation cells — flags the three
 * adjective-declension points + n-declension conjugationSuitable with
 * conjugationSeedKind 'noun' (TR nominal precedent). Targets are full NPs
 * (einen neuen Tisch) since German marks case on the article/adjective;
 * n-declension seeds from a curated closed weak-masculine pool (the noun
 * band would be off-target by definition — 'noun' now honors
 * conjugationSeedWords like 'verb' does). Case coverage axes drive the
 * per-draft case; the noun seed drives lexical variety; gender rides the
 * seeded noun. Bump enumerates the four new CONJUGATION cells.
 * 2026-07-17b: themed vocab umbrellas A1–B2 (17 new: 5 A1, 4 A2, 4 B1, 4 B2 —
 * each level keeps its prior broad umbrella as one theme). Re-enqueues the
 * three broad-umbrella cells and enqueues the 17 new vocab cells.
 */
export const CURRICULUM_VERSION_DE = '2026-07-17b';

const deCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1 (Menschen A1 + Hammer audit; 19 points)
  // ---------------------------------------------------------------------------
  {
    key: 'de-a1-present-regular',
    kind: 'grammar',
    name: 'Present tense: regular conjugation',
    description:
      'Present-tense endings -e/-st/-t/-en/-t/-en on regular verbs, with -e- inserted before -st/-t after stems in -t/-d (arbeitest, findet), only -t added after stems in -s/-ß/-z (du heißt), and -eln verbs dropping the stem e in the ich-form (ich sammle).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich wohne in Berlin und arbeite zu Hause.',
      'Findest du den Film gut?',
      'Wie heißt du?',
    ],
    examplesNegative: ['*Du arbeitst heute viel.', '*Er wohnen in Hamburg.'],
    commonErrors: [
      'Dropping the -e- insertion after t/d stems ("*du arbeitst", "*er findt" instead of "du arbeitest", "er findet").',
      'Adding a full -st after s/ß/z stems ("*du heißst" instead of "du heißt").',
      'Using the plural ending -en for er/sie/es ("*er wohnen in Hamburg").',
      'Using an English-style auxiliary "do" for questions and negation instead of plain verb-first/verb-second forms.',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a1-present-irregular',
    kind: 'grammar',
    name: 'Present tense: sein, haben, werden, wissen and stem-changing verbs',
    description:
      'Present tense of sein, haben, werden and wissen, plus stem-changing verbs in the du- and er/sie/es-forms: e→i (sprechen→spricht), e→ie (lesen→liest), a→ä (fahren→fährt). The stem change never appears in the ich-form or the plural.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Er fährt jeden Tag mit dem Bus.',
      'Du sprichst sehr gut Deutsch.',
      'Sie ist müde und hat Hunger.',
    ],
    examplesNegative: ['*Er fahrt jeden Tag mit dem Bus.', '*Du lest gern Bücher.'],
    commonErrors: [
      'Keeping the plain stem in the du/er forms ("*er fahrt", "*du sprechst" instead of "er fährt", "du sprichst").',
      'Extending the stem change to the ich-form or the plural ("*ich fähre", "*wir sprichen").',
      'Regularizing sein and haben ("*du habst" instead of "du hast").',
      'Regularizing wissen ("*du wisst", "*er wisst" instead of "du weißt", "er weiß").',
    ],
    prerequisiteKeys: ['de-a1-present-regular'],
    coverageSpec: {
      // 2sg/3sg only: those are the persons where the stem change surfaces —
      // the ich-form and the plural are regular for the a→ä / e→i(e) classes.
      axes: [{ name: 'person', floors: { '2sg': 8, '3sg': 8 } }],
    },
    conjugationSuitable: true,
    // Closed target set: the frequency band would hand the generator regular
    // verbs whose present-tense forms don't exercise the point.
    conjugationSeedWords: [
      'sein',
      'haben',
      'werden',
      'wissen',
      'sprechen',
      'essen',
      'geben',
      'nehmen',
      'helfen',
      'treffen',
      'lesen',
      'sehen',
      'fahren',
      'schlafen',
      'laufen',
      'tragen',
      'waschen',
    ],
  },
  {
    key: 'de-a1-noun-gender',
    kind: 'grammar',
    name: 'Noun gender (der/das/die)',
    description:
      'Memorising and applying the three grammatical genders of German nouns alongside common gender-derivation patterns (-ung → die, -chen → das, -er agent nouns → der) and the feminine suffix -in for female persons (der Lehrer → die Lehrerin, der Arzt → die Ärztin).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Wohnung', 'das Mädchen', 'die Lehrerin'],
    examplesNegative: ['*der Mädchen'],
    commonErrors: [
      'Overriding grammatical gender with natural gender ("*die Mädchen" as a singular instead of "das Mädchen").',
      'Ignoring suffix-based gender rules for -ung, -heit, -keit (all feminine).',
      'Treating English-cognate nouns as masculine without checking gender.',
    ],
  },
  {
    key: 'de-a1-plural-formation',
    kind: 'grammar',
    name: 'Noun plurals',
    description:
      'Noun plural classes: -e (der Tisch → Tische, often with umlaut: die Stadt → Städte), -er with umlaut (das Buch → Bücher), -(e)n (die Lampe → Lampen), -s (das Auto → Autos), and zero ending with or without umlaut (der Apfel → Äpfel); feminines in -e almost always take -n.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Die Bücher liegen auf dem Tisch.',
      'Wir haben zwei Autos und drei Fahrräder.',
    ],
    examplesNegative: ['*Ich brauche zwei Buchs.'],
    commonErrors: [
      'Adding English -s to every noun ("*die Buchs", "*die Stadts").',
      'Forgetting the umlaut in the plural ("*die Apfel" instead of "die Äpfel").',
      'Leaving the noun unchanged because a number word is present ("*drei Buch").',
    ],
  },
  {
    key: 'de-a1-articles-nominative',
    coverageSpec: {
      axes: [
        // kein/keine is a claimed core half and inflects (commonError *kein
        // Frau); unpinned drafts collapse to affirmative der/ein. Gender is
        // not a coverage axis — the der/die/das half stays unpinnable.
        { name: 'polarity', floors: { affirmative: 12, negative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Definite, indefinite and negative articles — nominative',
    description:
      'Choosing der/das/die, ein/ein/eine and the negative article kein/kein/keine for the subject of a sentence according to noun gender; the complement of sein/werden/bleiben also stays nominative (Er ist ein guter Lehrer — never accusative).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Der Hund schläft.',
      'Eine Frau steht an der Tür.',
      'Das ist kein Problem.',
    ],
    examplesNegative: ['*Das Hund schläft.'],
    commonErrors: [
      'Defaulting to "der" for unfamiliar nouns.',
      'Treating English-cognate nouns as masculine without checking gender.',
      'Failing to match kein to the noun\'s gender ("*kein Frau" instead of "keine Frau").',
      'Marking the complement of sein/werden as accusative ("*Er ist einen guten Lehrer" instead of "ein guter Lehrer").',
    ],
  },
  {
    key: 'de-a1-accusative',
    kind: 'grammar',
    name: 'Accusative case for direct objects',
    description:
      'Accusative marks the direct object: only the masculine forms change (der → den, ein → einen, kein → keinen, mein → meinen); feminine, neuter and plural forms look like the nominative.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['Ich sehe den Bus.', 'Sie hat einen Bruder und eine Schwester.'],
    examplesNegative: ['*Ich sehe der Bus.'],
    commonErrors: [
      'Leaving the masculine article in the nominative ("*Ich habe ein Hund" instead of "einen Hund").',
      'Over-applying -en to feminine or neuter objects ("*Sie hat einen Katze").',
      'Marking a fronted subject as accusative because it is not in first position.',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a1-dative',
    coverageSpec: {
      axes: [
        // The dative-plural den + -n (commonError *mit den Kinder) is a
        // distinct surface; pools collapse to singular without a floor.
        { name: 'number', floors: { singular: 12, plural: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Dative case: forms and core uses',
    description:
      'Dative forms dem/der/dem/den (+ -n on plural nouns unless the plural already ends in -n or -s) and einem/einer/einem, used after location prepositions answering wo? (in der Stadt) and with dative verbs like helfen, danken, gefallen, gehören, schmecken.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Wir wohnen in der Stadt.',
      'Das Fahrrad gehört dem Kind.',
      'Ich helfe meinen Eltern gern.',
    ],
    examplesNegative: ['*Ich helfe meine Eltern gern.'],
    commonErrors: [
      'Using accusative objects with dative verbs ("*Ich helfe dich" instead of "Ich helfe dir").',
      'Forgetting the extra -n on dative plural nouns ("*mit den Kinder" instead of "mit den Kindern").',
      'Using the accusative for a static location ("*Wir wohnen in die Stadt").',
    ],
    prerequisiteKeys: ['de-a1-accusative'],
  },
  {
    key: 'de-a1-personal-pronouns',
    coverageSpec: {
      axes: [
        // The ich–mich–mir case paradigm IS the point; nominative is the
        // model default, the acc/dat forms (commonError *Kannst du mich
        // helfen?) need floors.
        { name: 'case', floors: { nominative: 4, accusative: 8, dative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Personal pronouns (nominative, accusative, dative)',
    description:
      'Personal pronoun paradigm across cases (ich–mich–mir, du–dich–dir, er–ihn–ihm …); er/es/sie also refer to things according to grammatical gender; informal du/ihr vs formal Sie.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Der Tisch ist neu. Er war teuer.',
      'Ich sehe dich, aber ich helfe zuerst ihm.',
    ],
    examplesNegative: ['*Der Tisch ist neu. Es war teuer.'],
    commonErrors: [
      'Referring to all inanimate nouns with es instead of matching grammatical gender ("*Die Tasche? Es ist hier.").',
      'Confusing accusative and dative pronoun forms ("*Kannst du mich helfen?" instead of "mir").',
      'Mixing informal du and formal Sie within the same utterance.',
      'Referring to das Mädchen by natural gender right after the noun — grammatical es is preferred nearby ("Das Mädchen sagt, dass es müde ist"); sie takes over only at a distance.',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-a1-possessive-articles',
    coverageSpec: {
      axes: [
        // person = the possessor: all seven are claimed; the euer-declension
        // trap lives only at 2pl, the sein-vs-ihr trap at 3sg.
        { name: 'person', floors: { '1sg': 3, '2sg': 3, '3sg': 4, '1pl': 2, '2pl': 3, '3pl': 2 } },
        { name: 'case', floors: { nominative: 10, accusative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Possessive articles',
    description:
      'Possessive articles mein, dein, sein, ihr, unser, euer, Ihr with ein-word endings in nominative and accusative: the choice of sein vs ihr follows the possessor, the ending follows the possessed noun.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Das ist meine Schwester.',
      'Maria sucht ihren Schlüssel, und Peter sucht seinen.',
    ],
    examplesNegative: ['*Das ist mein Schwester.'],
    commonErrors: [
      'Choosing sein/ihr by the gender of the possessed noun instead of the possessor ("*Maria sucht seinen Schlüssel" for her own key).',
      'Dropping the feminine/plural ending ("*mein Schwester" instead of "meine Schwester").',
      'Failing to decline euer ("*euer Kinder" instead of "eure Kinder").',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a1-questions',
    kind: 'grammar',
    name: 'W-questions, yes/no questions and doch',
    description:
      'W-questions with wer, was, wo, wohin, woher, wann, wie, warum keep the verb in second position; yes/no questions put the finite verb first; doch answers a negative question positively.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Woher kommst du?',
      'Hast du heute Zeit?',
      'Hast du keine Zeit? — Doch, ich habe Zeit.',
    ],
    examplesNegative: ['*Wo du wohnst?'],
    commonErrors: [
      'Leaving the verb at the end or in third position in W-questions ("*Wo du wohnst?").',
      'Answering a negative question with ja instead of doch.',
      'Calquing English do-support instead of inverting ("*Tust du kommen heute?").',
    ],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a1-v2-word-order',
    kind: 'grammar',
    name: 'V2 word order in main clauses',
    description:
      'Placing the finite verb in the second position of a main clause, with the first position occupied by a single constituent (subject, time adverb, or object).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['Heute gehe ich ins Kino.', 'Ich gehe heute ins Kino.'],
    examplesNegative: ['*Heute ich gehe ins Kino.'],
    commonErrors: [
      'Calquing English SVO when a fronted adverb pushes the subject after the verb.',
      'Treating a clause-initial conjunction (und, aber, denn) as filling position 1 and inverting ("*Und gehe ich ins Kino" instead of "Und ich gehe ins Kino").',
    ],
  },
  {
    key: 'de-a1-negation',
    kind: 'grammar',
    name: 'Negation: nicht vs kein and the position of nicht',
    description:
      'kein negates nouns that would carry an indefinite or no article (Ich habe keine Zeit); nicht negates everything else and stands late in the clause — before predicate adjectives, prepositional complements or the specifically negated constituent; gar/überhaupt intensify a negation (gar nicht, gar keine Zeit, überhaupt nichts).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich habe kein Auto.',
      'Der Film ist nicht interessant.',
      'Ich komme heute nicht.',
      'Das gefällt mir gar nicht.',
    ],
    examplesNegative: ['*Ich habe nicht ein Auto.', '*Ich nicht komme heute.'],
    commonErrors: [
      'Using nicht ein instead of kein ("*Ich habe nicht ein Auto").',
      'Placing nicht directly after the subject, English-style ("*Ich nicht verstehe das").',
      'Putting nicht in the middle of the clause where it must stand at the end ("*Ich komme nicht heute" when the whole event is negated).',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a1-zero-article',
    kind: 'grammar',
    name: 'Zero article: professions, nationalities and indefinite plurals',
    description:
      'No article before professions, nationalities and religions after sein/werden (Ich bin Lehrerin, Er wird Arzt), before indefinite plurals and mass nouns (Wir haben Äpfel — English "some"), with languages, and in als-role phrases (als Kind, als Lehrerin arbeiten); the article returns with an adjective (Sie ist eine gute Ärztin).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich bin Lehrerin.',
      'Er wird Arzt.',
      'Wir haben Äpfel und Brot gekauft.',
      'Als Kind habe ich in Bonn gewohnt.',
    ],
    examplesNegative: ['*Ich bin eine Lehrerin.', '*Er wird ein Arzt.'],
    commonErrors: [
      'Inserting ein/eine before a bare profession or nationality by English interference ("*Ich bin ein Student").',
      'Adding an article to indefinite plurals or mass nouns where German uses none ("Wir brauchen Milch", not "*Wir brauchen eine Milch").',
      'Dropping the article even when the noun is qualified by an adjective ("*Sie ist gute Ärztin").',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a1-modal-verbs-present',
    kind: 'grammar',
    name: 'Modal verbs in the present + verb bracket',
    description:
      'Present tense of können, wollen, müssen, dürfen, sollen, mögen and the möchte-forms: irregular singular without endings in 1sg/3sg (ich kann, er kann), regular plural, and the verb bracket with the bare infinitive at the end of the clause; Sollen wir …? makes suggestions ("Shall we …?").',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich kann heute nicht kommen.',
      'Möchtest du einen Kaffee trinken?',
      'Wir müssen morgen früh aufstehen.',
      'Sollen wir eine Pause machen?',
    ],
    examplesNegative: ['*Er kannt gut schwimmen.', '*Ich will gehen nach Hause.'],
    commonErrors: [
      'Adding -t to the 3sg ("*er kannt", "*sie musst" instead of "er kann", "sie muss").',
      'Placing the infinitive right after the modal instead of clause-finally ("*Ich will gehen nach Hause").',
      'Keeping the umlaut of the infinitive in the singular ("*er könnt", "*sie müsst" instead of "er kann", "sie muss").',
      'Using zu before the infinitive after a modal ("*Ich muss zu arbeiten").',
      'Adding können to sensation verbs by English "can see/hear" interference ("Ich sehe das Meer" is the default, not "*Ich kann das Meer sehen").',
    ],
    prerequisiteKeys: ['de-a1-present-regular'],
    coverageSpec: {
      // The singular is where the irregular stem lives; plural forms are regular.
      axes: [{ name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5 } }],
    },
    conjugationSuitable: true,
    conjugationSeedWords: ['können', 'wollen', 'müssen', 'dürfen', 'sollen', 'mögen'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a1-imperative',
    coverageSpec: {
      axes: [
        // The exact TR-imperative failure mode (PR #588: collapsed to 100%
        // 2sg): Sie-imperative = 3pl, ihr = 2pl, wir-suggestion = 1pl — all
        // claimed by name/description and all distinct surfaces.
        { name: 'person', floors: { '2sg': 6, '2pl': 4, '3pl': 6, '1pl': 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Imperative (Sie, du, ihr)',
    description:
      'Imperatives: Sie-form with pronoun (Gehen Sie!), du-form without -st and usually without -e (Geh!, Nimm!, Fahr! — e→i(e) change kept, a→ä umlaut dropped), ihr-form = stem + -t (Geht!); sein is irregular (Sei ruhig!, Seien Sie …); wir-imperative for suggestions (Gehen wir!); public signs command with the bare infinitive (Nicht rauchen!, Bitte anschnallen!).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Nehmen Sie bitte Platz!',
      'Geh nach Hause und schlaf gut!',
      'Kommt her, Kinder!',
      'Gehen wir nach Hause!',
    ],
    examplesNegative: ['*Gehst nach Hause!', '*Fähr langsamer!'],
    commonErrors: [
      'Keeping the -st ending in the du-imperative ("*Gehst nach Hause!").',
      'Keeping the a→ä umlaut in the du-imperative ("*Fähr langsamer!" instead of "Fahr langsamer!").',
      'Dropping the e→i stem change ("*Nehm das Buch!" instead of "Nimm das Buch!").',
      'Omitting Sie in the formal imperative ("*Nehmen Platz, bitte!").',
    ],
    prerequisiteKeys: ['de-a1-present-irregular'],
  },
  {
    key: 'de-a1-temporal-prepositions',
    kind: 'grammar',
    name: 'Temporal prepositions',
    description:
      'Time prepositions: am + days/parts of the day (am Montag, am Abend), um + clock time, im + months/seasons, von … bis and ab for spans, vor/nach/in + dative and für + accusative for relative time (in einer Stunde, für zwei Tage); plain accusative time phrases take no preposition at all (jeden Tag, den ganzen Abend, nächste Woche, letzten Monat).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Der Kurs beginnt am Montag um neun Uhr.',
      'Im Sommer fahren wir ans Meer.',
      'Der Zug kommt in zehn Minuten.',
      'Wir bleiben den ganzen Tag zu Hause.',
    ],
    examplesNegative: ['*Ich habe an Montag Zeit.', '*Wir bleiben für den ganzen Tag zu Hause.'],
    commonErrors: [
      'Using the uncontracted an/in where am/im is required ("*an Montag", "*in Juli").',
      'Calquing English "at night" ("*an der Nacht" instead of "in der Nacht").',
      'Using um for days or dates ("*um Montag" instead of "am Montag").',
      'Inserting für into bare accusative duration phrases ("*für den ganzen Tag bleiben" instead of "den ganzen Tag bleiben").',
    ],
  },
  {
    key: 'de-a1-es-gibt',
    kind: 'grammar',
    name: 'es gibt + accusative',
    description:
      'es gibt + accusative for existence and availability (Es gibt einen Park in der Nähe); gibt stays invariable singular regardless of what follows; contrast with sein for the location of known items.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Es gibt hier einen guten Bäcker.',
      'Gibt es noch Karten für heute Abend?',
    ],
    examplesNegative: ['*Es gibt ein Park in der Nähe.', '*Es geben viele Restaurants.'],
    commonErrors: [
      'Using the nominative after es gibt ("*Es gibt ein Park" instead of "einen Park").',
      'Pluralizing the verb ("*Es geben viele Restaurants").',
      'Using es gibt to locate a known, specific item where sein is idiomatic ("Wo ist meine Brille?", not "*Wo gibt es meine Brille?").',
    ],
    prerequisiteKeys: ['de-a1-accusative'],
    targetOverride: 12,
  },
  {
    key: 'de-a1-praeteritum-sein-haben',
    kind: 'grammar',
    name: 'Präteritum of sein and haben (war, hatte)',
    description:
      'Simple-past forms war and hatte (plus es gab) — the standard way to talk about past states even in speech, where most other verbs use the Perfekt: ich war, du warst, er war; ich hatte, wir hatten.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Gestern war ich krank.',
      'Wir hatten keine Zeit.',
      'Früher gab es hier einen Markt.',
    ],
    examplesNegative: ['*Wir waren keine Zeit.', '*Ihr waren zu spät.'],
    commonErrors: [
      'Choosing war/hatte by calquing English "was" ("*Ich war Hunger" instead of "Ich hatte Hunger").',
      'Wrong person endings ("*ihr waren" instead of "ihr wart").',
      'Using the wordy Perfekt "ist gewesen / hat gehabt" where war/hatte is the idiomatic choice.',
    ],
    coverageSpec: {
      // 2pl floor added 2026-07-17: the entry's own commonError is
      // "*ihr waren instead of ihr wart" — unreachable without it.
      axes: [{ name: 'person', floors: { '1sg': 3, '3sg': 3, '2pl': 3 } }],
    },
    conjugationSuitable: true,
    conjugationSeedWords: ['sein', 'haben'],
    targetOverride: 15,
  },
  {
    key: 'de-a1-numbers-ordinals',
    kind: 'grammar',
    name: 'Numbers, ordinals and dates',
    description:
      'Cardinals with units-before-tens compounds written as one word (einundzwanzig), eins vs ein/eine before nouns, year-reading (1998 = neunzehnhundertachtundneunzig); ordinals in -te (2.–19.) / -ste (from 20.), irregular erste/dritte/siebte, written with a dot (der 8. Mai); dates with am + ordinal (am achten Mai), -mal adverbs (einmal, zweimal) and the decimal comma (2,5).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich habe am achten Mai Geburtstag.',
      'Das macht einundzwanzig Euro.',
      'Wir waren schon zweimal in Berlin.',
      'Heute ist der dritte Oktober.',
    ],
    examplesNegative: ['*Heute ist der dreite Oktober.', '*Das macht zwanzigundeins Euro.'],
    commonErrors: [
      'Regularizing the irregular ordinals ("*der dreite" instead of "der dritte"; standard "der siebte", not "*der siebente").',
      'Building number compounds tens-first, English-style ("*zwanzigundeins" instead of "einundzwanzig").',
      'Using the cardinal in dates ("*am acht Mai" instead of "am achten Mai").',
      'Reading years with tausend by English interference — 1998 is "neunzehnhundertachtundneunzig".',
    ],
  },
  // ---------------------------------------------------------------------------
  // A2 (Menschen A2 + Hammer audit; 31 points)
  // ---------------------------------------------------------------------------
  {
    key: 'de-a2-perfekt-with-haben',
    kind: 'grammar',
    name: 'Perfekt with haben',
    description:
      'Forming the present perfect with "haben + past participle" for transitive verbs and most intransitives, with the participle at the end.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich habe ein Buch gelesen.', 'Wir haben gestern gearbeitet.'],
    examplesNegative: ['*Ich bin ein Buch gelesen.'],
    commonErrors: [
      'Using sein with transitive verbs ("*ich bin ein Buch gelesen").',
      'Putting the past participle in the middle of the clause instead of the final position.',
    ],
    prerequisiteKeys: ['de-a1-present-regular'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a2-perfekt-with-sein',
    kind: 'grammar',
    name: 'Perfekt with sein',
    description:
      'Using "sein + past participle" for verbs of motion and change of state (gehen, fahren, kommen, werden) plus the exceptions bleiben and sein.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich bin nach Berlin gefahren.', 'Sie ist müde geworden.'],
    examplesNegative: ['*Ich habe nach Berlin gefahren.'],
    commonErrors: [
      'Defaulting to haben for motion verbs ("*ich habe gegangen").',
      'Forgetting that "sein" itself takes "sein" in the Perfekt ("*ich habe gewesen").',
    ],
    prerequisiteKeys: ['de-a2-perfekt-with-haben'],
  },
  {
    key: 'de-a2-past-participle-formation',
    kind: 'grammar',
    name: 'Past participle formation',
    description:
      'Participle shapes: weak ge-…-t (gemacht, gearbeitet), strong ge-…-en with ablaut (getrunken, geschrieben), no ge- for inseparable prefixes and -ieren verbs (verstanden, studiert), -ge- inside separable verbs (eingekauft, aufgestanden).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich habe den Brief geschrieben.',
      'Wir haben im Supermarkt eingekauft.',
      'Sie hat in Wien Medizin studiert.',
    ],
    examplesNegative: ['*Ich habe das nicht verstehen.', '*Er hat Deutsch gestudiert.'],
    commonErrors: [
      'Adding ge- to -ieren verbs ("*gestudiert" instead of "studiert").',
      'Adding ge- before inseparable prefixes ("*gebesucht", "*geverstanden").',
      'Using the weak -t shape on strong verbs ("*getrinkt" instead of "getrunken").',
      'Placing ge- before the separable prefix instead of inside ("*geeinkauft" instead of "eingekauft").',
    ],
    prerequisiteKeys: ['de-a2-perfekt-with-haben'],
  },
  {
    key: 'de-a2-akkusativ-prepositions',
    kind: 'grammar',
    name: 'Akkusativ prepositions',
    description:
      'Prepositions that always take the accusative: durch, für, gegen, ohne, um, bis. Article and adjective endings change accordingly.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich gehe durch den Park.', 'Das ist für meinen Bruder.'],
    examplesNegative: ['*Ich gehe durch dem Park.'],
    commonErrors: [
      'Using dative endings on accusative-only prepositions.',
      'Forgetting to change "der" to "den" in masculine accusative.',
    ],
    prerequisiteKeys: ['de-a1-accusative'],
  },
  {
    key: 'de-a2-dativ-prepositions',
    coverageSpec: {
      axes: [
        // The plural slot of dem/der/dem/den + the -n trap (*mit den
        // Kinder) starves without a floor — same shape as de-a1-dative.
        { name: 'number', floors: { singular: 14, plural: 10 } },
      ],
    },
    kind: 'grammar',
    name: 'Dativ prepositions',
    description:
      'Prepositions that always take the dative: aus, bei, mit, nach, seit, von, zu, gegenüber. Article forms shift to dem/der/dem/den.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich fahre mit dem Bus.', 'Sie kommt aus der Schweiz.'],
    examplesNegative: ['*Ich fahre mit den Bus.'],
    commonErrors: [
      'Using accusative endings after mit/nach/zu.',
      'Forgetting plural dative -n on the noun ("*mit den Kinder").',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-a2-separable-prefix-verbs',
    kind: 'grammar',
    name: 'Separable-prefix verbs',
    description:
      'Detaching the prefix of separable verbs (aufstehen, einkaufen, mitnehmen) and placing it at the end of the main clause.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich stehe um sieben Uhr auf.', 'Wir kaufen heute ein.'],
    examplesNegative: ['*Ich aufstehe um sieben Uhr.'],
    commonErrors: [
      'Failing to separate the prefix in main clauses.',
      'Separating the prefix in subordinate clauses, where it stays attached.',
    ],
    prerequisiteKeys: ['de-a1-v2-word-order'],
  },
  {
    key: 'de-a2-two-way-prepositions-core',
    coverageSpec: {
      axes: [
        // The wohin?-accusative vs wo?-dative contrast IS the point (ins vs
        // im); equal floors keep both halves of every pair in the pool.
        { name: 'case', floors: { accusative: 12, dative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Two-way prepositions: location vs direction',
    description:
      'an, auf, hinter, in, neben, über, unter, vor, zwischen take the accusative for direction (wohin? — Ich gehe in die Küche) and the dative for location (wo? — Ich bin in der Küche); contractions ins/im, ans/am.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich gehe in die Küche.',
      'Ich bin in der Küche.',
      'Häng das Bild über das Sofa.',
    ],
    examplesNegative: ['*Ich gehe in der Küche.'],
    commonErrors: [
      'Defaulting to the dative because the noun denotes a place, even with motion toward it ("*Ich gehe in der Schule").',
      'Choosing the case by the preposition instead of by the direction-vs-location question.',
      'Missing the standard contractions ("in dem Kino" for a plain location where "im Kino" is idiomatic).',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-a2-adjective-declension-indefinite',
    // Nominal conjugation cell (2026-07-17): declines a band-seeded noun into
    // a full NP (einen neuen Tisch) — case driven by the coverage axis below,
    // lexical variety by the noun seed, gender by the seeded noun.
    conjugationSuitable: true,
    conjugationSeedKind: 'noun',
    coverageSpec: {
      axes: [
        // ein neuer / einen neuen / mit einem neuen — three claimed case
        // cells with different endings. Gender is unpinnable (no axis).
        { name: 'case', floors: { nominative: 8, accusative: 8, dative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Adjective declension after ein/kein/possessives',
    description:
      'Mixed declension after ein-words: the adjective carries the gender signal where ein has no ending (ein neuer Tisch, ein neues Haus) and -en elsewhere (einen neuen Tisch, mit einem neuen Auto); feminine nominative/accusative takes -e (eine neue Lampe).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Das ist ein neuer Tisch.',
      'Sie hat ein schönes Haus gekauft.',
      'Ich suche eine günstige Wohnung.',
    ],
    examplesNegative: ['*Das ist ein neues Tisch.', '*Sie hat ein schöne Haus.'],
    commonErrors: [
      'Using -e everywhere ("*ein neue Tisch", "*ein neue Haus").',
      'Missing that the adjective must show the gender ein cannot ("*ein neuer Haus").',
      'Leaving the adjective bare before a noun ("*ein neu Tisch").',
      'Keeping the stem -e- of -el/-er adjectives when inflected ("*ein dunkeles Zimmer", "*ein teueres Auto" instead of "dunkles", "teures").',
      'Inflecting hoch with the -ch kept ("*ein hocher Turm" instead of "ein hoher Turm"), or declining endingless color loans ("*eine rosane Bluse" — rosa/lila stay bare).',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a2-adjective-declension-definite',
    // Nominal conjugation cell (2026-07-17): den neuen Tisch / die neuen
    // Tische — see -indefinite for the seeding/axis split.
    conjugationSuitable: true,
    conjugationSeedKind: 'noun',
    coverageSpec: {
      axes: [
        // -e in nominative singular vs -en everywhere else; the plural trap
        // (*die kleine Kinder) needs its own floor or pools collapse onto
        // nominative-singular -e.
        { name: 'case', floors: { nominative: 8, accusative: 8, dative: 6 } },
        { name: 'number', floors: { plural: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Adjective declension after der/das/die',
    description:
      'Weak declension after definite articles: -e in nominative singular (and feminine/neuter accusative), -en everywhere else (der neue Tisch, den neuen Tisch, die neuen Tische, mit dem neuen Auto).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Der neue Kollege ist sehr nett.',
      'Ich nehme den grünen Pullover.',
      'Die kleinen Kinder spielen im Garten.',
    ],
    examplesNegative: ['*Der neuer Kollege ist sehr nett.'],
    commonErrors: [
      'Doubling the article ending onto the adjective ("*der neuer Kollege", "*das kleines Kind").',
      'Using -e in the plural after die ("*die kleine Kinder" for "die kleinen Kinder").',
      'Forgetting -en in the masculine accusative ("*Ich nehme den grüne Pullover").',
    ],
    prerequisiteKeys: ['de-a2-adjective-declension-indefinite'],
  },
  {
    key: 'de-a2-adjective-declension-zero',
    // Nominal conjugation cell (2026-07-17): article-less NP with strong
    // endings (kaltem Wasser, frisches Brot) — see -indefinite.
    conjugationSuitable: true,
    conjugationSeedKind: 'noun',
    coverageSpec: {
      axes: [
        // Strong endings across cases (frischer/frisches, mit kaltem
        // Wasser — commonError *mit kalten Wasser); the claimed genitive
        // -en (trotz guten Wetters) gets a small floor.
        { name: 'case', floors: { nominative: 6, accusative: 6, dative: 8, genitive: 3 } },
      ],
    },
    kind: 'grammar',
    name: 'Adjective declension without an article',
    description:
      'Strong declension with no article: the adjective carries the article ending (frischer Fisch, frisches Brot, mit kaltem Wasser) except in the masculine/neuter genitive singular, which takes -en (trotz guten Wetters) — common with food, materials and plurals.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich trinke gern kalte Milch.',
      'Frisches Brot schmeckt am besten.',
      'Er duscht immer mit kaltem Wasser.',
    ],
    examplesNegative: ['*Ich trinke gern kalt Milch.', '*Frische Brot schmeckt gut.'],
    commonErrors: [
      'Leaving the adjective uninflected without an article ("*kalt Milch").',
      'Using weak -e/-en endings where the adjective must show the strong ending ("*mit kalten Wasser" instead of "mit kaltem Wasser").',
    ],
    prerequisiteKeys: ['de-a2-adjective-declension-definite'],
  },
  {
    key: 'de-a2-weil-deshalb',
    kind: 'grammar',
    name: 'Cause and consequence: weil vs deshalb (and denn)',
    description:
      'weil introduces a reason clause with the verb at the end; deshalb states the consequence and triggers inversion (deshalb + verb + subject); denn adds a reason with plain main-clause order.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich bleibe zu Hause, weil ich krank bin.',
      'Ich bin krank, deshalb bleibe ich zu Hause.',
      'Ich bleibe zu Hause, denn ich bin krank.',
    ],
    examplesNegative: ['*Ich bleibe zu Hause, weil ich bin krank.', '*Ich bin krank, deshalb ich bleibe zu Hause.'],
    commonErrors: [
      'Keeping verb-second order after weil ("*weil ich bin krank").',
      'Failing to invert after deshalb ("*deshalb ich bleibe zu Hause").',
      'Swapping the direction of weil (reason) and deshalb (consequence).',
      'Mixing up causal denn with temporal dann ("Ich blieb zu Hause, denn ich war krank" gives a reason; "Dann bin ich ins Bett gegangen" means "then").',
    ],
    prerequisiteKeys: ['de-a1-v2-word-order'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a2-dass-clauses',
    kind: 'grammar',
    name: 'dass-clauses',
    description:
      'Complement clauses with dass after verbs of saying, thinking and feeling: comma before dass, finite verb at the end of the clause.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich glaube, dass er heute kommt.',
      'Sie sagt, dass sie keine Zeit hat.',
    ],
    examplesNegative: ['*Ich glaube, dass er kommt heute.'],
    commonErrors: [
      'Keeping verb-second order inside the dass-clause ("*dass er kommt heute").',
      'Writing das instead of the conjunction dass.',
      'Omitting the comma before dass.',
    ],
    prerequisiteKeys: ['de-a1-v2-word-order'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a2-wenn-als',
    kind: 'grammar',
    name: 'wenn vs als',
    description:
      'als for a single completed event or period in the past (Als ich ein Kind war …); wenn for repeated events, present/future time and conditions (Immer wenn es regnet …; Wenn ich Zeit habe …). Both send the verb to the end.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Als ich ein Kind war, wohnten wir auf dem Land.',
      'Wenn ich Zeit habe, koche ich gern.',
      'Immer wenn es regnet, bleiben wir zu Hause.',
    ],
    examplesNegative: ['*Wenn ich ein Kind war, wohnten wir auf dem Land.'],
    commonErrors: [
      'Using wenn for a one-off past event ("*Wenn ich ein Kind war …").',
      'Using als for repeated past events ("Immer wenn …" is required, not "*Immer als …").',
      'Keeping verb-second order in the wenn/als clause.',
    ],
    prerequisiteKeys: ['de-a2-weil-deshalb'],
  },
  {
    key: 'de-a2-indirect-questions',
    kind: 'grammar',
    name: 'Indirect questions (ob, W-words)',
    description:
      'Indirect yes/no questions with ob, indirect information questions with the W-word (wie lange, wo, wann); the finite verb moves to the end (Ich weiß nicht, ob er kommt).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich weiß nicht, ob er heute kommt.',
      'Können Sie mir sagen, wie lange die Fahrt dauert?',
    ],
    examplesNegative: ['*Ich weiß nicht, ob kommt er heute.', '*Ich weiß nicht, wenn er kommt. (for "whether")'],
    commonErrors: [
      'Using wenn instead of ob for "whether" ("*Ich weiß nicht, wenn er kommt").',
      'Keeping question word order in the embedded clause ("*Können Sie mir sagen, wie lange dauert die Fahrt?").',
    ],
    prerequisiteKeys: ['de-a1-questions', 'de-a2-dass-clauses'],
  },
  {
    key: 'de-a2-relative-clauses-nom-acc',
    coverageSpec: {
      axes: [
        // Subject relatives are the natural default; the accusative relative
        // (commonError *der Film, der ich gesehen habe) needs an equal floor.
        { name: 'case', floors: { nominative: 12, accusative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Relative clauses: nominative and accusative',
    description:
      'Relative pronouns der/das/die matching the antecedent in gender/number and taking nominative or accusative according to their role inside the clause; verb-final order; commas around the clause.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Der Mann, der dort steht, ist mein Vater.',
      'Das Buch, das ich gerade lese, ist spannend.',
    ],
    examplesNegative: ['*Der Mann, der dort steht ist mein Vater.', '*Der Film, den gestern lief, war gut.'],
    commonErrors: [
      'Choosing the pronoun only by the antecedent and ignoring its role inside the clause ("*der Film, der ich gesehen habe").',
      'Forgetting verb-final order in the relative clause.',
      'Dropping the closing comma after the relative clause.',
    ],
    prerequisiteKeys: ['de-a1-accusative'],
  },
  {
    key: 'de-a2-reflexive-verbs',
    coverageSpec: {
      axes: [
        // The collapse default IS 3sg sich (commonError "*ich freue sich"),
        // so the floors sit on the non-sich persons; 3sg/3pl come free.
        { name: 'person', floors: { '1sg': 6, '2sg': 6, '1pl': 6, '2pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Reflexive verbs',
    description:
      'Verbs with an accusative reflexive pronoun (sich freuen, sich duschen, sich treffen): mich/dich/sich/uns/euch/sich; the pronoun follows the finite verb in main clauses. Plural subjects give the reciprocal "each other" reading (Wir treffen uns; Sie helfen sich) — formal einander (+ fused miteinander, voneinander), with gegenseitig as disambiguator.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich freue mich auf das Wochenende.',
      'Er duscht sich jeden Morgen.',
      'Wir treffen uns um acht.',
    ],
    examplesNegative: ['*Ich freue sich auf das Wochenende.'],
    commonErrors: [
      'Using sich for all persons ("*ich freue sich").',
      'Dropping the reflexive pronoun with obligatorily reflexive verbs ("*Ich freue auf das Wochenende").',
      'Misplacing the pronoun before the verb ("*Ich mich freue").',
      'Missing the reciprocal reading of plural sich ("Sie helfen sich" usually = each other; einander or gegenseitig makes it explicit).',
    ],
    prerequisiteKeys: ['de-a1-personal-pronouns'],
  },
  {
    key: 'de-a2-praeteritum-modals',
    kind: 'grammar',
    name: 'Modal verbs in the Präteritum',
    description:
      'Past-tense modals konnte, musste, durfte, wollte, sollte, mochte: umlaut dropped, -te- endings, final infinitive kept. The Präteritum is the idiomatic past for modals even in speech.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['Ich konnte gestern nicht kommen.', 'Wir mussten lange warten.'],
    examplesNegative: ['*Ich kann gestern nicht kommen.', '*Ich könnte gestern nicht kommen. (as plain past)'],
    commonErrors: [
      'Keeping the umlaut in the simple past ("*ich könnte" as a past statement — könnte is Konjunktiv II, not Präteritum).',
      'Using the Perfekt with modals where the Präteritum is idiomatic.',
      'Dropping the -te element ("*ich musst warten").',
    ],
    prerequisiteKeys: ['de-a1-modal-verbs-present'],
    coverageSpec: {
      axes: [{ name: 'person', floors: { '1sg': 4, '3sg': 4 } }],
    },
    conjugationSuitable: true,
    conjugationSeedWords: ['können', 'müssen', 'dürfen', 'wollen', 'sollen', 'mögen'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a2-konjunktiv-ii-polite',
    coverageSpec: {
      axes: [
        // Person-differentiated formulas: Ich hätte gern (1sg), Könntest
        // du (2sg), Könnten Sie / Sie sollten (3pl) — collapse to one
        // formula is likely without floors.
        { name: 'person', floors: { '1sg': 8, '2sg': 6, '3pl': 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Konjunktiv II for wishes and polite requests',
    description:
      'würde + infinitive, könnte, sollte and hätte (gern) for wishes, suggestions, advice and polite requests: Ich hätte gern …, Könntest du …?, Du solltest …. No conditional clauses yet — just the softened forms.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich hätte gern einen Kaffee.',
      'Könntest du mir kurz helfen?',
      'Du solltest mehr schlafen.',
    ],
    examplesNegative: ['*Ich habe gern einen Kaffee. (as an order)', '*Kannst du mir helfen könntest?'],
    commonErrors: [
      'Ordering with the blunt indicative where the polite form is expected ("Ich will einen Kaffee" instead of "Ich hätte gern …").',
      'Confusing konnte (past) with könnte (polite/hypothetical).',
      'Doubling würde with a modal ("*Würdest du mir helfen können?" for a simple request).',
    ],
    prerequisiteKeys: ['de-a1-modal-verbs-present'],
  },
  {
    key: 'de-a2-passive-present',
    coverageSpec: {
      axes: [
        // Both examplesPositive are singular "wird …" — plural passives
        // (werden + participle) are a distinct surface and the starved half.
        { name: 'number', floors: { singular: 12, plural: 10 } },
      ],
    },
    kind: 'grammar',
    name: 'Present passive (werden + participle)',
    description:
      'Process passive in the present: werden (conjugated) + past participle at the end (Das Päckchen wird gepackt); the agent is usually omitted; the accusative object becomes the subject.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Das Päckchen wird gepackt.',
      'In Deutschland wird viel Brot gegessen.',
    ],
    examplesNegative: ['*Das Päckchen ist gepackt werden.', '*Das Päckchen wird packen.'],
    commonErrors: [
      'Using the infinitive instead of the participle ("*wird packen" for "wird gepackt").',
      'Keeping the object in the accusative ("*Den Brief wird geschrieben").',
      'Confusing the process passive (wird gepackt) with the finished state (ist gepackt).',
    ],
    prerequisiteKeys: ['de-a2-past-participle-formation'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-a2-verb-preposition-complements',
    kind: 'grammar',
    name: 'Verbs with fixed prepositions + wo(r)-/da(r)-forms',
    description:
      'Verbs governing a fixed preposition and case (warten auf + A, sich interessieren für, träumen von, sich ärgern über); questions and back-references use worauf/darauf for things but preposition + pronoun for people (Auf wen wartest du?).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich interessiere mich für Geschichte.',
      'Worauf wartest du? — Auf den Bus.',
      'Auf wen wartest du? — Auf meinen Bruder.',
    ],
    examplesNegative: ['*Ich interessiere mich an Geschichte.', '*Auf was wartest du? (in careful usage)'],
    commonErrors: [
      'Choosing the preposition by translating from English ("*warten für", "*sich interessieren in").',
      'Using worauf/darauf for people ("*Worauf wartest du?" when asking about a person).',
      'Wrong case after the fixed preposition ("*Ich warte auf dem Bus").',
    ],
    prerequisiteKeys: ['de-a2-akkusativ-prepositions'],
  },
  {
    key: 'de-a2-comparison',
    // No coverageSpec: the two claimed halves — adjective comparison vs the
    // adverbial gern → lieber → am liebsten ladder — would want a wordClass
    // split, but wordClass is a vocab-only axis (invariant), and degree
    // (comparative vs superlative) has no axis at all. Both unpinnable.
    kind: 'grammar',
    name: 'Comparative and superlative',
    description:
      'Comparative in -er and superlative with am -sten, with umlaut in many monosyllables (alt → älter → am ältesten); irregular gut/besser/am besten, viel/mehr/am meisten; als after comparatives, (genauso) … wie for equality; the preference ladder gern → lieber → am liebsten with verbs (Ich trinke gern Tee, lieber Kaffee, am liebsten Kakao).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Berlin ist größer als Hamburg.',
      'Sie ist genauso alt wie ich.',
      'Am liebsten trinke ich Tee.',
    ],
    examplesNegative: ['*Berlin ist größer wie Hamburg.', '*Dieser Weg ist mehr lang.'],
    commonErrors: [
      'Using wie after a comparative ("*größer wie" instead of "größer als").',
      'Building the comparative analytically with mehr ("*mehr interessant" instead of "interessanter").',
      'Skipping the umlaut ("*alter" for "älter", "*am großten" for "am größten").',
    ],
  },
  {
    key: 'de-a2-nicht-sondern',
    kind: 'grammar',
    name: 'aber vs sondern',
    description:
      'sondern is the corrective "but" after an explicit negation, replacing the negated element (nicht X, sondern Y); aber contrasts without correcting; nicht nur … sondern auch adds to it.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich komme nicht aus Spanien, sondern aus Portugal.',
      'Der Kurs ist schwer, aber interessant.',
      'Sie spricht nicht nur Deutsch, sondern auch Türkisch.',
    ],
    examplesNegative: ['*Ich komme nicht aus Spanien, aber aus Portugal.'],
    commonErrors: [
      'Using aber after a negation where sondern corrects it ("*nicht aus Spanien, aber aus Portugal").',
      'Using sondern without a preceding negation ("*Der Kurs ist schwer, sondern interessant").',
    ],
    prerequisiteKeys: ['de-a1-negation'],
  },
  {
    key: 'de-a2-indefinite-pronouns-basic',
    coverageSpec: {
      axes: [
        // The declined forms are claimed content (jemanden/jemandem,
        // einen/einem for man); nominative man-frames are the default.
        { name: 'case', floors: { nominative: 10, accusative: 6, dative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Basic indefinite pronouns (man, jemand, etwas …)',
    description:
      'man + 3sg verb for general statements (Man darf hier nicht rauchen), jemand/niemand for people (accusative jemanden, dative jemandem), etwas/nichts for things, alles/alle; einen/einem as the accusative/dative of man.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Man darf hier nicht rauchen.',
      'Hast du etwas gehört? — Nein, nichts.',
      'Niemand war zu Hause.',
    ],
    examplesNegative: ['*Man dürfen hier nicht rauchen.', '*Niemanden war zu Hause.'],
    commonErrors: [
      'Using a plural verb with man ("*man dürfen").',
      'Replacing man with du/Sie in general statements by English interference.',
      'Combining nichts/niemand with another negation ("*Ich habe nichts nicht gehört").',
    ],
  },
  {
    key: 'de-a2-lassen',
    coverageSpec: {
      axes: [
        // The lässt stem change surfaces only at 2sg/3sg (commonError
        // *er lasst); other persons are regular and come free.
        { name: 'person', floors: { '2sg': 6, '3sg': 8 } },
      ],
    },
    kind: 'grammar',
    name: 'lassen + infinitive',
    description:
      'lassen with a bare infinitive: having something done (Ich lasse mein Fahrrad reparieren), letting someone do something (Sie lässt ihn fahren), and Lass uns … for suggestions; stem change lässt in 2sg/3sg.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich lasse mein Fahrrad reparieren.',
      'Meine Eltern lassen mich nicht ausgehen.',
      'Lass uns ins Kino gehen!',
    ],
    examplesNegative: ['*Ich lasse mein Fahrrad zu reparieren.', '*Er lasst mich fahren.'],
    commonErrors: [
      'Inserting zu before the infinitive ("*lasse … zu reparieren").',
      'Missing the stem change ("*er lasst" instead of "er lässt").',
      'Using a passive or machen-paraphrase where lassen is idiomatic ("Ich lasse mir die Haare schneiden", not "*Ich schneide meine Haare beim Friseur").',
    ],
    prerequisiteKeys: ['de-a1-modal-verbs-present'],
  },
  {
    key: 'de-a2-destination-prepositions',
    kind: 'grammar',
    name: 'Saying "to": nach, zu, in, an, auf',
    description:
      'Goal prepositions: nach + cities/countries without article (nach Berlin), zu + people and institutions (zum Arzt, zur Arbeit), in + enterable places and article-bearing countries (in die Schweiz), an + edges/water (ans Meer), auf + islands and events; nach Hause vs zu Hause.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Wir fliegen nach Italien.',
      'Ich gehe zum Arzt.',
      'Sie geht in die Schule.',
      'Im Sommer fahren wir ans Meer.',
    ],
    examplesNegative: ['*Ich gehe nach dem Arzt.', '*Wir fliegen zu Italien.'],
    commonErrors: [
      'Using nach for people or institutions ("*nach dem Arzt" instead of "zum Arzt").',
      'Using zu for countries and cities ("*zu Italien" instead of "nach Italien").',
      'Forgetting the article with countries that require one ("*nach Schweiz" instead of "in die Schweiz").',
      'Confusing nach Hause (motion) with zu Hause (location).',
    ],
    prerequisiteKeys: ['de-a2-two-way-prepositions-core'],
  },
  {
    key: 'de-a2-seit-present',
    kind: 'grammar',
    name: 'seit + present tense',
    description:
      'Situations that began in the past and still hold take the PRESENT tense with seit/schon (Ich wohne seit drei Jahren hier) where English uses the perfect; negated or repeated events take the Perfekt instead (Ich habe ihn seit Jahren nicht gesehen).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich lerne seit zwei Jahren Deutsch.',
      'Wir wohnen schon lange in Berlin.',
    ],
    examplesNegative: ['*Ich habe seit zwei Jahren Deutsch gelernt. (meaning "and still do")'],
    commonErrors: [
      'Using the Perfekt for an ongoing situation ("*Ich habe hier seit 2020 gewohnt" while still living there).',
      'Using für for duration-so-far ("*für zwei Jahre" instead of "seit zwei Jahren").',
    ],
    prerequisiteKeys: ['de-a2-dativ-prepositions'],
    targetOverride: 12,
  },
  {
    key: 'de-a2-wissen-kennen',
    kind: 'grammar',
    name: 'wissen vs kennen (vs können)',
    description:
      'wissen = to know facts, takes a clause (Ich weiß, wo er wohnt); kennen = to be familiar with, takes a noun phrase (Ich kenne den Film); können = mastered skills (Sie kann gut kochen).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich weiß, wo er wohnt.',
      'Ich kenne diesen Film.',
      'Sie kann gut kochen.',
    ],
    examplesNegative: ['*Ich kenne, wo er wohnt.', '*Ich weiß diesen Film.'],
    commonErrors: [
      'Using kennen with a clause ("*Ich kenne, wo er wohnt").',
      'Using wissen with a plain noun phrase ("*Ich weiß den Film").',
      'Using wissen for skills ("*Ich weiß kochen" instead of "Ich kann kochen").',
    ],
    prerequisiteKeys: ['de-a1-present-irregular'],
    targetOverride: 15,
  },
  {
    key: 'de-a2-demonstratives-welch',
    coverageSpec: {
      axes: [
        // Declined forms beyond the all-nominative examples are claimed
        // (denselben Fehler, im selben Haus); collapse risk is
        // nominative-only dieser/welcher.
        { name: 'case', floors: { nominative: 8, accusative: 8, dative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Demonstratives and question articles (dieser, welcher, was für ein)',
    description:
      'dieser/dieses/diese declined like the definite article; stressed der/das/die as demonstrative pronouns (Der ist gut!); welch-? asks about a known set, was für ein? about kind or quality; so ein / solch- express "such a" (so ein schöner Tag), derselbe "the same" fuses article + selb- (denselben Fehler, im selben Haus); jener is formal-written.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Dieser Käse schmeckt super.',
      'Welches Buch liest du gerade?',
      'Was für ein Auto hast du?',
    ],
    examplesNegative: ['*Dieses Käse schmeckt super.', '*Welch Buch liest du?'],
    commonErrors: [
      'Leaving dieser/welcher undeclined or with the wrong gender ending ("*dieses Käse", "*welch Buch").',
      'Confusing welch- (choice from a known set) with was für ein (kind/quality).',
      'Treating für in was für ein as a case assigner — the case comes from the noun\'s role, not from für.',
      'Splitting or half-declining derselbe ("*der selbe Fehler" in careful writing; masculine accusative is "denselben Fehler").',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a2-dative-accusative-objects',
    kind: 'grammar',
    name: 'Order of dative and accusative objects',
    description:
      'Two-object verbs (geben, schenken, zeigen, erklären): noun objects come dative before accusative (Ich gebe meinem Bruder das Buch); with two pronouns the accusative comes first (Ich gebe es ihm); pronouns precede noun objects.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich gebe meinem Bruder das Buch.',
      'Ich gebe es ihm.',
      'Ich zeige dir die Fotos.',
    ],
    examplesNegative: ['*Ich gebe das Buch meinem Bruder gern. (neutral order)', '*Ich gebe ihm es.'],
    commonErrors: [
      'Putting two pronouns in dative-first order ("*Ich gebe ihm es" instead of "Ich gebe es ihm").',
      'Calquing English "give the book to my brother" with an unneeded preposition ("*Ich gebe das Buch zu meinem Bruder").',
      'Giving kosten/fragen/lehren a dative person — they take two accusatives ("Das kostet mich viel Zeit", not "*Das kostet mir viel Zeit").',
    ],
    prerequisiteKeys: ['de-a1-dative'],
    // A bare blank cannot test constituent ORDER: any object fills the slot and
    // several orders are contextually licensed. Translation carries the point.
    clozeUnsuitable: true,
  },
  {
    key: 'de-a2-measure-expressions',
    kind: 'grammar',
    name: 'Measure and quantity expressions',
    description:
      'Masculine/neuter measure nouns stay singular after numerals (zwei Glas Bier, drei Stück Kuchen, 100 Gramm Käse) while feminine ones pluralize (zwei Tassen Kaffee); the measured noun follows directly, without von (eine Flasche Wasser); halb declines as an adjective vs the noun die Hälfte, plus anderthalb/zweieinhalb; distributive je (je zwei Karten) and distributive article (zweimal die Woche, drei Euro das Kilo).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Ich hätte gern zwei Glas Bier.',
      'Die Tomaten kosten drei Euro das Kilo.',
      'Sie hat eine halbe Stunde gewartet.',
      'Wir bekommen je zwei Karten.',
    ],
    examplesNegative: ['*eine Flasche von Wasser', '*Das kostet zwei Euros.'],
    commonErrors: [
      'Inserting von between measure and substance ("*eine Flasche von Wasser" — the nouns stand in apposition).',
      'Pluralizing masculine/neuter measure nouns ("*zwei Kilos Äpfel", "*drei Stücke Kuchen" in the measure reading; Euro also stays singular: "zwei Euro").',
      'Using the noun die Hälfte where the adjective halb is needed ("eine halbe Stunde", not "*eine Hälfte Stunde").',
    ],
    prerequisiteKeys: ['de-a1-numbers-ordinals'],
  },
  {
    key: 'de-a2-quantifiers-other',
    coverageSpec: {
      axes: [
        // The number-conditioned split is core: viel Zeit (undeclined mass)
        // vs viele Freunde (declined plural); jeder + sg verb vs alle + pl.
        { name: 'number', floors: { singular: 12, plural: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Quantifiers: jeder, alle, viel(e), ein paar, ander-',
    description:
      'jeder/jedes/jede declines like dieser and takes a singular verb, with alle as its plural counterpart; viel/wenig stay undeclined before mass nouns (viel Zeit, wenig Geld) but decline in the plural (viele Freunde, wenige Fehler); ein paar and ein bisschen/ein wenig are invariable (ein paar Freunde — but ein Paar Schuhe = a matched pair); ander- declines like an adjective (der andere Weg, etwas anderes).',
    cefrLevel: A2,
    language: DE,
    examplesPositive: [
      'Jeder Schüler bekommt ein Buch.',
      'Ich habe viele Freunde, aber wenig Zeit.',
      'Wir warten noch ein paar Minuten.',
      'Gibt es einen anderen Weg?',
    ],
    examplesNegative: ['*Jeder Schüler bekommen ein Buch.', '*Ich habe vielen Zeit.'],
    commonErrors: [
      'Using a plural verb with jeder ("*Jeder bekommen …" — singular, like English "every").',
      'Declining viel/wenig before mass nouns ("*vielen Zeit", "*weniges Geld").',
      'Capitalizing ein paar ("ein Paar Minuten" would mean a matched pair; "a few" is lowercase and invariable).',
      'Leaving ander- undeclined ("*ein ander Weg" instead of "ein anderer Weg").',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  // ---------------------------------------------------------------------------
  // B1 (Menschen B1 + Hammer audit; 27 points)
  // ---------------------------------------------------------------------------
  {
    key: 'de-b1-praeteritum',
    kind: 'grammar',
    name: 'Präteritum (full paradigm)',
    description:
      'Simple past of weak verbs (-te-: machte, arbeitete), strong verbs with ablaut (kam, ging, schrieb) and mixed verbs (brachte, wusste, dachte); no ending in 1sg/3sg. The written-narrative tense, while conversation prefers the Perfekt; seit + Präteritum marks a state still holding at that past time (Er wohnte seit 2010 in Köln).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Er kam spät nach Hause und sagte kein Wort.',
      'Wir arbeiteten damals in einer kleinen Firma.',
    ],
    examplesNegative: ['*Er kommte spät nach Hause.', '*Ich kamte zu spät.'],
    commonErrors: [
      'Regularizing strong verbs ("*er kommte", "*sie gehte" instead of "er kam", "sie ging").',
      'Adding a 3sg -t ("*er kamt" instead of "er kam").',
      'Mixing ablaut and -te ("*ich kamte", "*er schriebte").',
      'Using -te forms without the linking -e- after t/d stems ("*er arbeitte").',
    ],
    prerequisiteKeys: ['de-a2-praeteritum-modals'],
    coverageSpec: {
      // 2sg floor added 2026-07-17: 1sg = 3sg in the Präteritum (kam/machte),
      // so the old floors reached only two distinct surfaces — the -st ending
      // (du kamst, du arbeitetest) was unfloored despite "full paradigm".
      axes: [{ name: 'person', floors: { '1sg': 5, '2sg': 4, '3sg': 5, '3pl': 5 } }],
    },
    conjugationSuitable: true,
  },
  {
    key: 'de-b1-relative-pronouns',
    coverageSpec: {
      axes: [
        // dem/der/denen and dessen/deren are the claimed content; nom/acc
        // relatives live in the A2 prerequisite, so floors target dat/gen
        // only. number pins dem-vs-denen / dessen-vs-deren; gender
        // unpinnable.
        { name: 'case', floors: { dative: 8, genitive: 6 } },
        { name: 'number', floors: { singular: 8, plural: 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Relative clauses: dative, genitive and with prepositions',
    description:
      'Relative pronouns in the dative (dem/der/denen), the genitive (dessen/deren) and after prepositions (die Stadt, in der ich wohne): gender/number from the antecedent, case from the role inside the clause; the preposition moves in front of the pronoun.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Der Freund, dem ich oft helfe, wohnt in Köln.',
      'Die Stadt, in der ich wohne, ist sehr grün.',
      'Der Mann, dessen Auto vor der Tür steht, ist unser Nachbar.',
    ],
    examplesNegative: ['*Die Stadt, ich wohne in der, ist grün.', '*Der Mann, deren Auto dort steht, ist unser Nachbar.'],
    commonErrors: [
      'Stranding the preposition English-style ("*die Stadt, die ich wohne in").',
      'Choosing dessen/deren by the possessed noun instead of the antecedent ("*der Mann, deren Auto …").',
      'Using the dative plural denen incorrectly as a singular form.',
    ],
    prerequisiteKeys: ['de-a2-relative-clauses-nom-acc'],
  },
  {
    key: 'de-b1-dass-clause-perfekt',
    kind: 'grammar',
    name: 'dass-clauses with the Perfekt',
    description:
      'Embedding a Perfekt clause under "dass" so that both the past participle and the auxiliary go to the end, in that order.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich glaube, dass er das Buch gelesen hat.',
      'Sie sagt, dass wir zu spät gekommen sind.',
    ],
    examplesNegative: ['*Ich glaube, dass er hat das Buch gelesen.'],
    commonErrors: [
      'Keeping V2 order inside the dass-clause.',
      'Reversing the auxiliary–participle order ("*hat gelesen" final instead of "gelesen hat").',
    ],
    prerequisiteKeys: ['de-a2-perfekt-with-haben'],
  },
  {
    key: 'de-b1-two-way-prepositions',
    coverageSpec: {
      axes: [
        // The acc/dat alternation IS the point: transitive placement verbs
        // (auf den Tisch stellen) vs their stative partners (auf dem Tisch
        // stehen); equal floors keep both halves of every pair.
        { name: 'case', floors: { accusative: 10, dative: 10 } },
      ],
    },
    kind: 'grammar',
    name: 'Placement verbs: stellen/stehen, legen/liegen, hängen',
    description:
      'Verb pairs with two-way prepositions: transitive placement verbs take the accusative (stellen, legen, setzen, hängen, stecken — Ich stelle die Vase auf den Tisch), their stative partners take the dative (stehen, liegen, sitzen, hängen — Die Vase steht auf dem Tisch).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich stelle die Vase auf den Tisch. — Die Vase steht auf dem Tisch.',
      'Er legt das Buch auf das Regal. — Das Buch liegt auf dem Regal.',
    ],
    examplesNegative: ['*Ich stelle die Vase auf dem Tisch.', '*Die Vase steht auf den Tisch.'],
    commonErrors: [
      'Choosing the case by the noun instead of by placement-vs-state.',
      'Using legen/stellen interchangeably regardless of the object\'s orientation (upright → stellen, flat → legen).',
      'Using the transitive verb intransitively ("*Das Buch legt auf dem Tisch").',
    ],
    prerequisiteKeys: ['de-a2-two-way-prepositions-core'],
  },
  {
    key: 'de-b1-passive-werden',
    coverageSpec: {
      axes: [
        // All three examplesPositive are 3sg singular — plural passives
        // (wurden / sind … worden / müssen … werden) are distinct surfaces.
        // Tense/construction variety has no axis; person floors rejected
        // (1st/2nd-person passives are unnatural filler).
        { name: 'number', floors: { singular: 8, plural: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Passive: past tenses and with modals',
    description:
      'Passive beyond the present: Präteritum (wurde eingeführt), Perfekt with worden (ist eingeführt worden), and with modals (muss ausgefüllt werden); agent with von (people/causers), durch (means/intermediary).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Der Brief wurde gestern geschrieben.',
      'Das Gesetz ist 2002 eingeführt worden.',
      'Das Formular muss vollständig ausgefüllt werden.',
    ],
    examplesNegative: ['*Das Gesetz ist eingeführt geworden.', '*Das Formular muss ausgefüllt sein werden.'],
    commonErrors: [
      'Using geworden instead of worden in the passive Perfekt ("*ist eingeführt geworden").',
      'Ordering the verb cluster with the modal wrongly ("*muss werden ausgefüllt").',
      'Using bei or mit for the agent instead of von/durch.',
    ],
    prerequisiteKeys: ['de-a2-passive-present'],
  },
  {
    key: 'de-b1-subordinate-conjunctions',
    kind: 'grammar',
    name: 'Subordinating conjunctions and verb-final order',
    description:
      'Verb-final subordinate clauses with obwohl (vs main-clause trotzdem), da, während, bevor, falls, sobald, solange, seitdem and bis; the comma is obligatory, and a fronted subordinate clause counts as position 1 (verb next).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Obwohl es regnet, gehen wir spazieren.',
      'Ich rufe dich an, sobald ich zu Hause bin.',
      'Es regnet, trotzdem gehen wir spazieren.',
    ],
    examplesNegative: ['*Ich bleibe zu Hause, obwohl ich bin krank.', '*Obwohl es regnet, wir gehen spazieren.'],
    commonErrors: [
      'Keeping V2 order after the conjunction ("*obwohl ich bin krank").',
      'Failing to invert after a fronted subordinate clause ("*Obwohl es regnet, wir gehen …").',
      'Confusing subordinating obwohl with adverbial trotzdem ("*Trotzdem es regnet, gehen wir …").',
      'Confusing als (single past event) with wenn (repeated or future).',
    ],
    prerequisiteKeys: ['de-a2-weil-deshalb'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-b1-plusquamperfekt-nachdem',
    coverageSpec: {
      axes: [
        // hatte/hattest/hatten, war/warst/waren are distinct surfaces; 1sg
        // omitted (1sg = 3sg in Präteritum-based forms — no contrast).
        // hatte-vs-war is the verb's Perfekt auxiliary: lexical, unpinnable.
        { name: 'person', floors: { '2sg': 4, '3sg': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Plusquamperfekt and nachdem',
    description:
      'Past-before-past with hatte/war + participle; nachdem pairs the Plusquamperfekt with a Präteritum/Perfekt main clause (Nachdem wir gegessen hatten, gingen wir …) and the Perfekt with a present/future main clause (Nachdem ich gegessen habe, gehe ich …).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Nachdem wir gegessen hatten, gingen wir spazieren.',
      'Ich war schon eingeschlafen, als du angerufen hast.',
    ],
    examplesNegative: ['*Nachdem wir aßen, gingen wir spazieren.', '*Nachdem wir gegessen haben, gingen wir spazieren.'],
    commonErrors: [
      'Using the same tense in both clauses with nachdem ("*Nachdem wir aßen, gingen wir …").',
      'Choosing hatte vs war against the verb\'s Perfekt auxiliary ("*Ich hatte eingeschlafen").',
      'Overusing the Plusquamperfekt for simple past events without anteriority.',
    ],
    prerequisiteKeys: ['de-a2-perfekt-with-sein', 'de-b1-praeteritum'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-b1-futur-i',
    coverageSpec: {
      axes: [
        // werden is irregular exactly at 2sg/3sg (wirst/wird) and the
        // *ich werde fahre double-conjugation trap must be tested across
        // persons; unpinned drafts collapse to ich werde / er wird.
        { name: 'person', floors: { '1sg': 4, '2sg': 5, '3sg': 5, '1pl': 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Futur I',
    description:
      'werden + infinitive for predictions, promises and resolutions (Ich werde dich nie vergessen); plain present + time adverb for scheduled future events (Morgen fahre ich nach Köln); werden + wohl expresses an assumption.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich werde dich nie vergessen.',
      'Nächstes Jahr werden wir ein Haus bauen.',
      'Er wird wohl noch im Büro sein.',
    ],
    examplesNegative: ['*Ich werde fahre morgen nach Köln.', '*Morgen ich werde nach Köln fahren.'],
    commonErrors: [
      'Conjugating both verbs ("*ich werde fahre").',
      'Forcing Futur I where German idiomatically uses the present ("Morgen fahre ich …" is the neutral choice).',
      'Using wollen as a future auxiliary by English "will" interference ("*Ich will morgen arbeiten" for a plain prediction).',
    ],
    prerequisiteKeys: ['de-a1-present-irregular'],
  },
  {
    key: 'de-b1-konjunktiv-ii-past',
    coverageSpec: {
      axes: [
        // Counterfactual-regret prompts skew hard to 1sg (all three examples
        // are ich-anchored); hättest/wärst and hätten/wären are distinct
        // surfaces. hätte-vs-wäre mirrors the Perfekt auxiliary — lexical,
        // unpinnable.
        { name: 'person', floors: { '1sg': 5, '2sg': 4, '3sg': 5, '3pl': 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Konjunktiv II past (hätte/wäre + participle)',
    description:
      'Counterfactual past: hätte/wäre + past participle for missed opportunities, regrets and unreal past conditions (Wenn ich das gewusst hätte, wäre ich früher gekommen); auxiliary choice mirrors the Perfekt; beinahe/fast take this form for near-events (Ich wäre beinahe gefallen — I nearly fell).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Wenn ich das gewusst hätte, wäre ich früher gekommen.',
      'Ich hätte dich fast nicht erkannt!',
      'An deiner Stelle hätte ich anders reagiert.',
    ],
    examplesNegative: ['*Wenn ich das wusste, wäre ich früher gekommen.', '*Ich hätte früher gekommen.'],
    commonErrors: [
      'Using the indicative Präteritum in the wenn-clause ("*Wenn ich das wusste …").',
      'Choosing hätte for sein-verbs ("*ich hätte gekommen" instead of "ich wäre gekommen").',
      'Building a würde-form with a participle ("*ich würde gekommen").',
    ],
    prerequisiteKeys: ['de-a2-konjunktiv-ii-polite'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-b1-zu-infinitive',
    kind: 'grammar',
    name: 'Infinitive with zu',
    description:
      'zu-infinitive clauses after verbs (versuchen, vergessen, anfangen), nouns (Lust, Zeit, Angst) and adjectives (wichtig, schwierig); zu splits separable verbs (anzurufen); nicht/nur brauchen + zu; bare infinitive stays after modals and gehen/sehen/hören/lassen; the infinitive clause normally follows the main clause.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich habe vergessen, dich anzurufen.',
      'Es ist wichtig, jeden Tag zu üben.',
      'Du brauchst nicht zu kommen.',
    ],
    examplesNegative: ['*Ich habe vergessen, dich zu anrufen.', '*Ich muss zu arbeiten.'],
    commonErrors: [
      'Placing zu before instead of inside a separable verb ("*zu anrufen" for "anzurufen").',
      'Adding zu after modals ("*Ich muss zu arbeiten").',
      'Using an English gerund pattern instead of the zu-infinitive ("*Ich habe Lust schwimmend").',
    ],
    prerequisiteKeys: ['de-a2-separable-prefix-verbs'],
  },
  {
    key: 'de-b1-um-zu-damit',
    kind: 'grammar',
    name: 'Purpose: um … zu vs damit',
    description:
      'Purpose clauses: um … zu + infinitive requires identical subjects and is preferred there (Ich lerne Deutsch, um in Berlin zu arbeiten); damit + full clause is obligatory when the subjects differ (…, damit meine Kinder dort studieren können) and possible when they match.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich lerne Deutsch, um in Berlin zu arbeiten.',
      'Sie erklärt es langsam, damit alle sie verstehen.',
    ],
    examplesNegative: ['*Ich lerne Deutsch, um meine Kinder in Berlin arbeiten.', '*Ich lerne Deutsch, damit ich in Berlin zu arbeiten.'],
    commonErrors: [
      'Using um … zu with different subjects ("*…, um meine Kinder dort studieren").',
      'Putting zu into a damit-clause ("*damit ich zu arbeiten").',
      'Using für + infinitive by English interference ("*für zu arbeiten").',
    ],
    prerequisiteKeys: ['de-b1-zu-infinitive'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-b1-statt-ohne-zu',
    kind: 'grammar',
    name: '(an)statt/ohne … zu and (an)statt/ohne dass',
    description:
      'Infinitive clauses (an)statt … zu ("instead of doing") and ohne … zu ("without doing") with identical subjects; (an)statt dass / ohne dass with a full clause when the subjects differ.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Er ging, ohne ein Wort zu sagen.',
      'Statt zu helfen, schaute er nur zu.',
      'Sie half mir, ohne dass ich fragen musste.',
    ],
    examplesNegative: ['*Er ging ohne zu sagen ein Wort.', '*Er ging, ohne sagen ein Wort.'],
    commonErrors: [
      'Calquing the English gerund ("*ohne sagend").',
      'Word order inside the infinitive clause — the zu-infinitive must be final ("*ohne zu sagen ein Wort").',
      'Using ohne … zu when the subjects differ (needs ohne dass).',
    ],
    prerequisiteKeys: ['de-b1-zu-infinitive'],
  },
  {
    key: 'de-b1-two-part-conjunctions',
    kind: 'grammar',
    name: 'Two-part conjunctions',
    description:
      'Paired connectors: nicht nur … sondern auch, sowohl … als auch, weder … noch (negative without nicht), entweder … oder, zwar … aber, je … desto/umso (+ comparative; je-clause verb-final, desto-clause with inversion); und zwar appends a specification ("namely": Ich komme morgen, und zwar um acht).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Sie spricht nicht nur Spanisch, sondern auch Türkisch.',
      'Je mehr ich lerne, desto besser verstehe ich die Grammatik.',
      'Er isst weder Fleisch noch Fisch.',
    ],
    examplesNegative: ['*Er isst nicht weder Fleisch noch Fisch.', '*Je mehr ich lerne, desto ich verstehe besser.'],
    commonErrors: [
      'Adding nicht to weder … noch ("*isst nicht weder …").',
      'Wrong word order after desto — comparative + verb + subject ("*desto ich verstehe besser").',
      'Mixing the pairs ("*sowohl … oder", "*entweder … noch").',
    ],
    prerequisiteKeys: ['de-a2-nicht-sondern'],
    // Bipartite constructions leak the blank: the visible half identifies the
    // hidden half, so a cloze cell only tests recall of a fixed collocation.
    clozeUnsuitable: true,
  },
  {
    key: 'de-b1-genitive',
    kind: 'grammar',
    name: 'Genitive case',
    description:
      'Genitive for possession/attribution: des/der/des/der + -(e)s on masculine and neuter nouns (der Titel des Buches), adjective ending -en, proper-name -s (Marias Auto) — names already ending in s/ß/x/z take a bare apostrophe instead (Fritz’ Schwester); everyday genitive prepositions trotz, wegen, innerhalb, außerhalb; fixed temporal genitives (eines Tages); von-paraphrase in casual speech.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Der Titel des Buches gefällt mir.',
      'Trotz des schlechten Wetters gingen wir spazieren.',
      'Das ist Marias Auto.',
    ],
    examplesNegative: ['*Der Titel des Buch gefällt mir.', '*das Auto von des Mannes'],
    commonErrors: [
      'Dropping the -(e)s on masculine/neuter nouns ("*des Buch", "*des Mann").',
      'Using dative after wegen/trotz in formal writing ("*wegen dem Regen" — colloquial only).',
      'Stacking von onto a genitive ("*von des Mannes").',
      'Using an apostrophe in proper-name genitives ("*Maria\'s Auto" — German writes "Marias Auto").',
    ],
    prerequisiteKeys: ['de-a2-adjective-declension-definite'],
  },
  {
    key: 'de-b1-n-declension',
    // Nominal conjugation cell (2026-07-17): declines the weak masculine
    // itself (der Student → den Studenten). Weak masculines are a small
    // CLOSED class, so the curated pool below REPLACES the noun band —
    // an arbitrary band noun is off-target by definition.
    conjugationSuitable: true,
    conjugationSeedKind: 'noun',
    conjugationSeedWords: [
      'Student', 'Kollege', 'Herr', 'Junge', 'Name', 'Mensch', 'Kunde',
      'Nachbar', 'Präsident', 'Polizist', 'Journalist', 'Tourist', 'Experte',
      'Löwe', 'Affe', 'Bär', 'Held', 'Fotograf', 'Architekt', 'Patient',
    ],
    coverageSpec: {
      axes: [
        // The whole point is a case paradigm: -(e)n in every case except
        // nominative singular, plus genitive -ns (des Namens). The small
        // nominative floor covers the over-application trap (bare form).
        { name: 'case', floors: { nominative: 3, accusative: 7, dative: 7, genitive: 4 } },
      ],
    },
    kind: 'grammar',
    name: 'n-declension (weak masculine nouns)',
    description:
      'Weak masculines (der Junge, Kollege, Student, Herr, Mensch, Nachbar) take -(e)n in every case except the nominative singular (mit dem Kollegen, den Studenten); the Name subtype (Name, Gedanke, Wille) additionally takes -ns in the genitive (des Namens, des Gedankens), and das Herz mixes the patterns (dem Herzen, des Herzens).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich habe den neuen Kollegen gefragt.',
      'Kennst du Herrn Müller?',
      'Der Name des Studenten fehlt auf der Liste.',
    ],
    examplesNegative: ['*Ich habe den neuen Kollege gefragt.', '*Kennst du Herr Müller? (as object)'],
    commonErrors: [
      'Leaving the noun bare outside the nominative ("*den Kollege", "*mit dem Student").',
      'Forgetting Herrn in oblique cases ("*für Herr Müller").',
      'Over-applying -n to regular masculines ("*den Tischen" in the singular).',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-b1-adjectives-as-nouns',
    coverageSpec: {
      axes: [
        // Plural nominalizations are claimed (commonError "*die Deutsche
        // for the plural") and endings shift with case (einem Bekannten).
        // der-vs-ein article type and gender halves unpinnable.
        { name: 'number', floors: { singular: 8, plural: 6 } },
        { name: 'case', floors: { nominative: 5, accusative: 5, dative: 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Adjectives as nouns',
    description:
      'Nominalized adjectives and participles keep adjective declension but are capitalized: der/die Bekannte vs ein Bekannter, die Deutschen, das Wichtigste; neuter abstracts after etwas/nichts/viel take -es (etwas Neues, nichts Besonderes).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ein Bekannter von mir wohnt in Wien.',
      'Gibt es etwas Neues?',
      'Das Wichtigste kommt zum Schluss.',
    ],
    examplesNegative: ['*Ein Bekannte von mir wohnt in Wien.', '*etwas neues'],
    commonErrors: [
      'Freezing one form instead of declining ("*ein Bekannte", "*die Deutsche" for the plural).',
      'Lowercasing the nominalized adjective ("*etwas neues").',
      'Missing -es after etwas/nichts ("*etwas Neue").',
    ],
    prerequisiteKeys: ['de-a2-adjective-declension-definite'],
  },
  {
    key: 'de-b1-participles-as-adjectives',
    kind: 'grammar',
    name: 'Participles as adjectives',
    description:
      'Partizip I (infinitive + -d: die lachenden Kinder — ongoing) and Partizip II (das gekochte Ei — completed/passive) used attributively with regular adjective endings.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Die lachenden Kinder spielen im Hof.',
      'Ich nehme ein weich gekochtes Ei.',
      'Der Kurs bietet faszinierende Einblicke.',
    ],
    examplesNegative: ['*die lachende Kinder', '*das kochende Ei (meaning a boiled egg)'],
    commonErrors: [
      'Skipping the declension ending on the participle ("*die lachende Kinder").',
      'Using Partizip I where the meaning is completed/passive ("*das kochende Ei" for a boiled egg).',
      'Building Partizip I from something other than infinitive + -d ("lachend" is correct, "*lachtend" is not).',
    ],
    prerequisiteKeys: ['de-a2-past-participle-formation', 'de-a2-adjective-declension-definite'],
  },
  {
    key: 'de-b1-comparison-attributive',
    coverageSpec: {
      axes: [
        // The quantifier rule (alle guten vs viele gute) only exists in the
        // plural — a singular-collapsed pool never exercises it; declined
        // comparatives vary by case (mit größerem Interesse).
        { name: 'number', floors: { singular: 6, plural: 8 } },
        { name: 'case', floors: { nominative: 4, accusative: 5, dative: 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Attributive comparatives/superlatives + declension after quantifiers',
    description:
      'Declined comparative and superlative attributes (ein besseres Angebot, der schönste Tag, mit größerem Interesse) and adjective declension after quantifiers: weak -en after alle, strong endings after viele/einige/mehrere/wenige (alle guten Freunde vs viele gute Freunde).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Wir haben ein besseres Angebot bekommen.',
      'Das war der schönste Tag des Jahres.',
      'Viele gute Freunde haben geholfen — alle guten Ideen kamen von ihnen.',
    ],
    examplesNegative: ['*ein besser Angebot', '*alle gute Freunde'],
    commonErrors: [
      'Leaving the comparative undeclined in attributive position ("*ein besser Angebot").',
      'Using am -sten attributively ("*der am schönsten Tag" instead of "der schönste Tag").',
      'Strong endings after alle ("*alle gute Freunde") or weak after viele ("*viele guten Freunde" in standard usage).',
    ],
    prerequisiteKeys: ['de-a2-comparison', 'de-a2-adjective-declension-definite'],
  },
  {
    key: 'de-b1-reason-consequence-connectors',
    kind: 'grammar',
    name: 'Consequence and reason adverbs (darum, deswegen, nämlich …)',
    description:
      'Consequence adverbs darum/deswegen/deshalb/daher/aus diesem Grund typically open the clause and trigger inversion (they can also stand in the Mittelfeld); nämlich gives a reason and never stands first (Ich bleibe zu Hause, ich bin nämlich krank).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich war krank, deswegen bin ich zu Hause geblieben.',
      'Ich bleibe zu Hause, ich bin nämlich krank.',
      'Aus diesem Grund haben wir den Termin verschoben.',
    ],
    examplesNegative: ['*Nämlich ich bin krank.', '*Deswegen ich bin zu Hause geblieben.'],
    commonErrors: [
      'Fronting nämlich ("*Nämlich ich bin krank").',
      'Failing to invert after darum/deswegen/daher.',
      'Treating nämlich as "namely" only and missing its because-reading.',
    ],
    prerequisiteKeys: ['de-a2-weil-deshalb'],
  },
  {
    key: 'de-b1-es-expressions',
    kind: 'grammar',
    name: 'Expressions with es',
    description:
      'es as impersonal subject (es regnet, es ist spät, wie geht es dir?), fixed expressions (es tut mir leid, es gibt), and placeholder es for a following clause (Es freut mich, dass du kommst), which disappears when the clause is fronted.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Es regnet schon den ganzen Tag.',
      'Es freut mich, dass du kommst.',
      'Dass du kommst, freut mich.',
    ],
    examplesNegative: ['*Dass du kommst, es freut mich.', '*Mir tut leid.'],
    commonErrors: [
      'Keeping the placeholder es after fronting the clause ("*Dass du kommst, es freut mich").',
      'Dropping es from fixed impersonal expressions ("*Mir tut leid" instead of "Es tut mir leid").',
      'Calquing English "it" for weather with another pronoun.',
    ],
  },
  {
    key: 'de-b1-modal-particles-basic',
    kind: 'grammar',
    name: 'Modal particles I (denn, doch, eigentlich, ja, mal)',
    description:
      'Core spoken-German particles: denn softens questions (Was machst du denn?), doch marks contradiction or urging (Komm doch mit!), eigentlich adds a casual "by the way", ja marks shared knowledge or surprise (Du weißt ja, wie das ist; Das ist ja teuer!), mal casualizes requests (Guck mal!).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Was machst du denn hier?',
      'Komm doch mit!',
      'Das ist ja interessant!',
    ],
    examplesNegative: ['*Denn was machst du hier? (denn as a softening particle cannot be fronted)'],
    commonErrors: [
      'Fronting the particle ("*Denn was machst du?" — particles live in the Mittelfeld).',
      'Using denn outside questions in its particle sense.',
      'Omitting particles entirely, which makes requests and questions sound abrupt.',
    ],
    // Several particles are licensed in most slots, so a bare blank is
    // unrecoverable; translation + theory carry the point.
    clozeUnsuitable: true,
    targetOverride: 15,
  },
  {
    key: 'de-b1-dative-reflexive-body',
    coverageSpec: {
      axes: [
        // The mir/mich contrast is only audible at 1sg/2sg (dir/dich) —
        // 3sg sich is case-syncretic and tests nothing, so a 3sg-collapsed
        // pool is worthless. Sum 13 ≤ targetOverride 15.
        { name: 'person', floors: { '1sg': 4, '2sg': 3, '3sg': 4, '1pl': 2 } },
      ],
    },
    kind: 'grammar',
    name: 'Dative of involvement: body parts and benefactives',
    description:
      'With body parts and clothing German uses the definite article plus a dative (reflexive) pronoun instead of a possessive: Ich wasche mir die Hände; Er zieht sich die Jacke an; Sie hat ihm die Haare geschnitten. The same dative marks the affected person more widely: benefactive (Er trägt ihr den Koffer) and involuntary involvement (Mir ist die Tasse kaputtgegangen).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich wasche mir die Hände.',
      'Er zieht sich die Schuhe an.',
      'Die Mutter putzt dem Kind die Nase.',
      'Er trägt ihr den Koffer zum Auto.',
    ],
    examplesNegative: ['*Ich wasche mich die Hände.', '*Er zieht seine Schuhe sich an.'],
    commonErrors: [
      'Using the possessive by English interference ("*Ich wasche meine Hände" — grammatical but unidiomatic; the target pattern is "mir die Hände").',
      'Choosing the accusative reflexive instead of the dative ("*Ich wasche mich die Hände").',
    ],
    prerequisiteKeys: ['de-a2-reflexive-verbs'],
    targetOverride: 15,
  },
  {
    key: 'de-b1-hin-her',
    kind: 'grammar',
    name: 'Directional adverbs hin and her',
    description:
      'hin = away from the speaker, her = toward the speaker; compounds with prepositions (hinein/herein, hinaus/heraus, hinauf/herauf, hinunter/herunter; colloquial rein/raus/runter) and as separable prefixes; split questions Wo … hin? / Wo … her?.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Komm herein!',
      'Er ging die Treppe hinauf.',
      'Wo kommst du her? — Und wo gehst du hin?',
    ],
    examplesNegative: ['*Geh herein! (speaker is outside)', '*Komm hinein! (speaker is inside)'],
    commonErrors: [
      'Swapping the perspective — hin with motion toward the speaker and her with motion away.',
      'Dropping hin/her where the verb needs a direction ("*Er ging die Treppe" without hinauf/hinunter).',
      'Treating rein/raus as formal register (they are colloquial variants).',
    ],
    prerequisiteKeys: ['de-a2-separable-prefix-verbs'],
  },
  {
    key: 'de-b1-schon-noch-erst',
    coverageSpec: {
      axes: [
        // The negative pairs (noch nicht / nicht mehr) are named core
        // content and their confusion is a listed commonError;
        // default-affirmative generation starves exactly that contrast.
        // Sum 13 ≤ targetOverride 15.
        { name: 'polarity', floors: { affirmative: 8, negative: 5 } },
      ],
    },
    kind: 'grammar',
    name: 'schon, noch, erst',
    description:
      'The time-scalar triad: schon = already/earlier than expected, noch = still (noch nicht = not yet, nicht mehr = no longer), erst = only/not until (Er kommt erst um zehn); erst implies less/later than expected with more to come (erst drei Seiten), while nur is plain restriction.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Bist du schon fertig? — Nein, noch nicht.',
      'Er kommt erst um zehn Uhr.',
      'Sie wohnt nicht mehr hier.',
    ],
    examplesNegative: ['*Er kommt nur um zehn Uhr. (meaning "not until ten")', '*Ich bin noch nicht mehr fertig.'],
    commonErrors: [
      'Using nur for "not until" ("*Er kommt nur um zehn" instead of "erst um zehn").',
      'Confusing noch nicht (not yet) with nicht mehr (no longer).',
      'Dropping schon/noch and losing the expectation contrast the sentence needs.',
    ],
    targetOverride: 15,
  },
  {
    key: 'de-b1-progressive-equivalents',
    kind: 'grammar',
    name: 'Expressing the English progressive',
    description:
      'German has no progressive tense; ongoing actions use gerade (Ich lese gerade), (gerade) dabei sein, etwas zu tun, or beim + nominalized infinitive (Ich bin beim Kochen); the plain present otherwise covers both English simple and progressive.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich lese gerade ein gutes Buch.',
      'Sie ist gerade dabei, die Koffer zu packen.',
      'Ich bin beim Kochen.',
    ],
    examplesNegative: ['*Ich bin lesend ein Buch.', '*Ich bin ein Buch lesen.'],
    commonErrors: [
      'Calquing English be + -ing with sein + participle ("*Ich bin lesend").',
      'Overusing the am-progressive in formal writing ("Ich bin am Lesen" is colloquial/regional).',
      'Missing gerade where the ongoing nuance matters.',
    ],
    targetOverride: 15,
  },
  {
    key: 'de-b1-articles-use',
    kind: 'grammar',
    name: 'Article use: generalizations, names and abstracts',
    description:
      'Definite article in generalizations (Der Mensch ist ein Gewohnheitstier), with abstract/mass nouns in their general sense (Die Geduld ist eine Tugend — but partial: Er hat Geduld), with feminine/masculine/plural country names (die Schweiz, der Iran, die Niederlande); adjective-qualified proper names take the article (das heutige Deutschland); the article replaces a possessive with body and attribute nouns (Er hob die Hand).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Der Mensch ist ein Gewohnheitstier.',
      'Sie kommt aus der Schweiz.',
      'Das heutige Deutschland hat sechzehn Bundesländer.',
      'Er hob die Hand.',
    ],
    examplesNegative: ['*Sie kommt aus Schweiz.', '*Ich lerne das Deutsch.'],
    commonErrors: [
      'Dropping the article with feminine/plural country names ("*aus Schweiz", "*in Niederlande" instead of "aus der Schweiz", "in den Niederlanden").',
      'Adding an article to bare language names ("*das Deutsch lernen") — it returns only when qualified (das Deutsch der Verwaltung).',
      'Using a possessive where German prefers the plain article ("Er hob seine Hand" — idiomatic: "die Hand").',
      'Omitting the article before an adjective-qualified name ("*heutiges Deutschland ist …" instead of "das heutige Deutschland").',
    ],
    prerequisiteKeys: ['de-a1-zero-article'],
  },
  {
    key: 'de-b1-adjective-case-government',
    coverageSpec: {
      axes: [
        // The dative experiencer varies across persons in the entry's own
        // examples (Mir ist kalt / Ich bin dir dankbar / seinem Vater
        // ähnlich); collapse risk is mir-everywhere.
        { name: 'person', floors: { '1sg': 4, '2sg': 3, '3sg': 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Adjectives with dative complements; Mir ist kalt',
    description:
      'Adjectives taking a dative complement, mostly with sein: ähnlich, dankbar, behilflich, treu, wichtig, egal (Er sieht seinem Vater ähnlich); impersonal sensations use the subjectless dative pattern (Mir ist kalt/schlecht/langweilig — never "Ich bin kalt" for feeling cold); zu + adjective grades for the affected person (Das ist mir zu teuer); a small set takes the accusative (die Wartezeit leid, das Geld wert, die Arbeit gewohnt).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Mir ist kalt — mach bitte das Fenster zu.',
      'Er sieht seinem Vater sehr ähnlich.',
      'Das ist mir zu teuer.',
      'Ich bin dir sehr dankbar.',
    ],
    examplesNegative: ['*Ich bin kalt. (meaning "I feel cold")', '*Er sieht seinen Vater ähnlich.'],
    commonErrors: [
      'Calquing English "I am cold/hot" for sensations ("*Ich bin kalt" instead of "Mir ist kalt").',
      'Using the accusative with dative-governing adjectives ("*Er sieht seinen Vater ähnlich").',
      'Dropping the affected-person dative with zu, losing the personal-judgment reading ("Das ist zu teuer" is general; "Das ist mir zu teuer" is the personal verdict).',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  // ---------------------------------------------------------------------------
  // B2 (Sicher! + Hammer audit; 27 points)
  // ---------------------------------------------------------------------------
  {
    key: 'de-b2-konjunktiv-ii',
    coverageSpec: {
      axes: [
        // The synthetic-vs-würde decision plays out per person (hätte/
        // hättest/hätten…) and all three examples are 1sg/3sg; floors keep
        // 2sg counterfactuals and plural forms in the pool. Sum 32 ≤ 50.
        { name: 'person', floors: { '1sg': 8, '2sg': 6, '3sg': 8, '1pl': 4, '3pl': 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Konjunktiv II: the full meaning system',
    description:
      'Konjunktiv II across its meanings: unreal present conditions (Wenn ich Zeit hätte, würde ich kommen), unreal wishes (Wenn ich das doch wüsste!), unreal comparisons with als ob, and verb-first conditionals (Hätte ich Zeit, …); synthetic forms (käme, wüsste, ginge) vs würde + infinitive.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Wenn ich Zeit hätte, würde ich kommen.',
      'Er tut so, als ob er nichts wüsste.',
      'Hätte ich das gewusst, wäre ich zu Hause geblieben.',
    ],
    examplesNegative: ['*Wenn ich Zeit habe, würde ich kommen.', '*Wenn ich Zeit hätte, ich würde kommen.'],
    commonErrors: [
      'Pairing a real-conditional present indicative with a Konjunktiv II main clause.',
      'Using würde + infinitive in the wenn-clause where the synthetic form is standard ("wenn ich Zeit hätte", not "*wenn ich Zeit haben würde").',
      'Failing to invert after a fronted conditional clause ("*Hätte ich Zeit, ich würde kommen").',
      'Indicative after als ob in careful usage ("*als ob er nichts weiß").',
    ],
    prerequisiteKeys: ['de-b1-konjunktiv-ii-past'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'de-b2-genitive-prepositions',
    coverageSpec: {
      axes: [
        // Case is fixed (genitive) and gender unpinnable — number is the
        // one pinnable dimension: des + -s singular vs der + -Ø plural
        // (aufgrund des Wetters vs anhand der Daten).
        { name: 'number', floors: { singular: 10, plural: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Formal genitive prepositions',
    description:
      'Formal-register prepositions with the genitive: aufgrund, infolge, anhand, bezüglich, hinsichtlich, anlässlich, mangels, (an)statt, während, angesichts; dative substitution (wegen dem …) is colloquial and flagged in formal writing.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Aufgrund des schlechten Wetters wurde das Konzert abgesagt.',
      'Anhand der Daten lässt sich der Trend erklären.',
      'Während des Sommers reisen wir oft.',
    ],
    examplesNegative: ['*Aufgrund dem schlechten Wetter wurde das Konzert abgesagt.'],
    commonErrors: [
      'Using dative after these prepositions in formal writing ("*aufgrund dem Wetter").',
      'Forgetting the -s/-es genitive ending on masculine and neuter singular nouns.',
      'Overusing wegen in formal texts where aufgrund/infolge fits the register better.',
    ],
    prerequisiteKeys: ['de-b1-genitive'],
  },
  {
    key: 'de-b2-konjunktiv-i',
    coverageSpec: {
      axes: [
        // 3sg sei/habe vs 3pl→Konjunktiv-II backoff (sie haben → sie
        // hätten) vs 1sg (coincides → K2) are all distinct surfaces; the
        // claimed backoff rule never appears in a 3sg-collapsed pool.
        { name: 'person', floors: { '3sg': 12, '3pl': 10, '1sg': 4, '1pl': 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Konjunktiv I (reported speech)',
    description:
      'Konjunktiv I (er sage, er habe, er sei) for indirect speech in journalistic and formal registers; substitution by Konjunktiv II when forms coincide with the indicative; indirect questions (ob/W-word) and commands (solle, möge) in reported speech.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Der Minister sagte, er habe keine Zeit.',
      'Sie behauptet, sie sei krank.',
      'Er fragte, ob wir kämen, und sagte, wir sollten warten.',
    ],
    examplesNegative: ['*Der Minister sagte, er hat keine Zeit. (in formal news writing)'],
    commonErrors: [
      'Using the indicative in formal indirect speech.',
      'Failing to switch to Konjunktiv II when Konjunktiv I would coincide with the indicative ("sie haben" → "sie hätten").',
      'Backshifting tenses English-style instead of using the subjunctive system.',
    ],
    prerequisiteKeys: ['de-b2-konjunktiv-ii'],
  },
  {
    key: 'de-b2-extended-attributes',
    coverageSpec: {
      axes: [
        // "Inflect the participle for case, gender, and number" is the named
        // trap, yet both examples are nominative — den/dem/der … gekauften
        // need floors. Gender is the unpinnable residual.
        { name: 'case', floors: { nominative: 8, accusative: 8, dative: 8, genitive: 5 } },
        { name: 'number', floors: { singular: 8, plural: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Extended participial attributes',
    description:
      'Pre-nominal participial constructions ("der von uns gekaufte Wagen") that compress relative clauses into a single noun phrase — common in formal writing.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Der von uns gekaufte Wagen ist teuer.',
      'Die im Park spielenden Kinder sind laut.',
    ],
    examplesNegative: ['*Der gekaufte von uns Wagen ist teuer.'],
    commonErrors: [
      'Misordering the modifier elements before the participle.',
      'Failing to inflect the participle for case, gender, and number.',
    ],
    prerequisiteKeys: ['de-b1-relative-pronouns', 'de-b1-participles-as-adjectives'],
  },
  {
    key: 'de-b2-nominalization',
    kind: 'grammar',
    name: 'Nominalization and nominal style',
    description:
      'Turning verbs and adjectives into nouns (das Lesen, die Verbesserung, das Gute) and converting between verbal and nominal style: beim Lesen = während man liest, zur Verbesserung = um … zu verbessern; capitalization and neuter gender of nominalized infinitives.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Beim Lesen vergesse ich die Zeit.',
      'Zur Verbesserung der Qualität wurden neue Regeln eingeführt.',
      'Das Gute an dieser Idee ist die Einfachheit.',
    ],
    examplesNegative: ['*das lesen macht Spaß', '*die Lesen'],
    commonErrors: [
      'Failing to capitalise the nominalised form ("*das lesen").',
      'Assigning the wrong gender (nominalised infinitives are always neuter).',
      'Translating a nominal phrase word-for-word into clumsy verbal style instead of restructuring.',
    ],
    prerequisiteKeys: ['de-b1-zu-infinitive'],
  },
  {
    key: 'de-b2-zustandspassiv',
    kind: 'grammar',
    name: 'Zustandspassiv (sein-passive)',
    description:
      'sein + past participle for the resulting state (Das Fenster ist geöffnet) vs werden + participle for the process (Das Fenster wird geöffnet); past state with war; only sensible for verbs whose result persists.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Das Fenster ist geöffnet — es ist frisch hier.',
      'Der Tisch war schon gedeckt, als die Gäste kamen.',
    ],
    examplesNegative: ['*Das Fenster ist von Maria geöffnet, sieh mal! (agent with state reading)'],
    commonErrors: [
      'Using the sein-passive for an ongoing process ("*Das Haus ist gerade gebaut" instead of "wird gerade gebaut").',
      'Adding an agent phrase to a pure state ("ist geöffnet" resists "von Maria").',
      'Confusing the Zustandspassiv with the Perfekt of sein-verbs ("er ist gefahren" is active Perfekt, not a passive).',
    ],
    prerequisiteKeys: ['de-b1-passive-werden'],
  },
  {
    key: 'de-b2-passive-alternatives',
    kind: 'grammar',
    name: 'Passive alternatives and subjectless passives',
    description:
      'Alternatives to the werden-passive: man, sich lassen (Das Problem lässt sich lösen), -bar adjectives (lösbar), sein + zu + infinitive (Der Antrag ist bis Freitag einzureichen), bekommen-passive for dative recipients; subjectless passives (Es wird getanzt; Ihm wurde geholfen); formal Funktionsverbgefüge with passive meaning (Anwendung finden = angewendet werden).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Das Problem lässt sich leicht lösen.',
      'Der Antrag ist bis Freitag einzureichen.',
      'Ihm wurde sofort geholfen.',
      'Sie bekam das Buch geschenkt.',
    ],
    examplesNegative: ['*Er wurde geholfen.', '*Das Problem lässt sich leicht gelöst.'],
    commonErrors: [
      'Promoting a dative object to subject ("*Er wurde geholfen" instead of "Ihm wurde geholfen").',
      'Using a participle after sich lassen ("*lässt sich gelöst" — the pattern takes the infinitive).',
      'Reading sein + zu as ability only ("ist einzureichen" usually = must be handed in).',
    ],
    prerequisiteKeys: ['de-b1-passive-werden', 'de-a2-lassen'],
  },
  {
    key: 'de-b2-subjective-modals',
    kind: 'grammar',
    name: 'Subjective (epistemic) modal verbs',
    description:
      'Modals as speaker judgments: muss (near-certain deduction), dürfte (probable), könnte/kann (possible), soll (hearsay: reportedly), will (unverified self-claim); past reference with the perfect infinitive (Er muss krank gewesen sein; Sie will nichts gewusst haben).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Er muss krank gewesen sein — sein Auto stand den ganzen Tag vor dem Haus.',
      'Das dürfte stimmen.',
      'Der Zeuge will nichts gesehen haben.',
      'Das Restaurant soll ausgezeichnet sein.',
    ],
    examplesNegative: ['*Er musste krank gewesen sein. (for a present deduction about the past)'],
    commonErrors: [
      'Expressing a deduction about the past with a past-tense modal instead of modal + perfect infinitive ("Er muss … gewesen sein", not "*Er musste … sein").',
      'Confusing hearsay soll with obligation soll and self-claim will with future/intent will.',
      'Reading dürfte as permission — epistemically it grades probability.',
    ],
    prerequisiteKeys: ['de-a2-praeteritum-modals'],
  },
  {
    key: 'de-b2-modal-perfect-word-order',
    kind: 'grammar',
    name: 'Modal Perfekt and double-infinitive order',
    description:
      'Perfekt of modals uses the infinitive, not a participle (Ich habe kommen müssen); Konjunktiv II past with modals (Er hätte es machen können); in subordinate clauses the finite auxiliary precedes the double infinitive (…, dass er es hätte machen können).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Ich habe gestern arbeiten müssen.',
      'Du hättest mich anrufen können!',
      'Es ärgert mich, dass ich so lange habe warten müssen.',
    ],
    examplesNegative: ['*Ich habe gestern arbeiten gemusst.', '*…, dass ich so lange warten müssen habe.'],
    commonErrors: [
      'Using the participle gemusst/gekonnt after an infinitive ("*habe arbeiten gemusst").',
      'Putting the auxiliary last in subordinate clauses with a double infinitive ("*dass ich warten müssen habe" instead of "habe warten müssen").',
      'Avoiding the construction entirely and losing the counterfactual reading ("du konntest anrufen" ≠ "du hättest anrufen können").',
    ],
    prerequisiteKeys: ['de-b1-konjunktiv-ii-past'],
    // The point IS the cluster order — a single blank cannot test it.
    clozeUnsuitable: true,
  },
  {
    key: 'de-b2-futur-ii',
    kind: 'grammar',
    name: 'Futur II',
    description:
      'werden + perfect infinitive for what will be completed by a future point (Bis Montag werde ich den Bericht geschrieben haben) and — more often — for confident assumptions about the past (Er wird den Zug verpasst haben).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Bis Montag werde ich den Bericht geschrieben haben.',
      'Sie wird den Zug verpasst haben — deshalb ist sie nicht da.',
    ],
    examplesNegative: ['*Bis Montag werde ich den Bericht schreiben haben.', '*Er wird verpasst den Zug haben.'],
    commonErrors: [
      'Building the perfect infinitive with the bare infinitive ("*schreiben haben" instead of "geschrieben haben").',
      'Choosing haben/sein against the verb\'s Perfekt auxiliary ("*Sie wird angekommen haben").',
      'Missing the conjectural reading and translating it as pure future.',
    ],
    prerequisiteKeys: ['de-b1-futur-i'],
    targetOverride: 15,
  },
  {
    key: 'de-b2-causal-connectors',
    kind: 'grammar',
    name: 'Causal relations three ways (weil/da — denn — wegen/aufgrund)',
    description:
      'Expressing cause across styles: subordinate weil/da (verb-final), coordinating denn and adverbial deshalb/daher/folglich (main clauses), and nominal wegen/aufgrund + genitive with a nominalized noun (wegen des starken Regens = weil es stark regnete).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Da die Nachfrage gestiegen ist, wurden die Preise erhöht.',
      'Wegen des starken Regens fällt das Konzert aus.',
      'Die Nachfrage stieg, folglich wurden die Preise erhöht.',
    ],
    examplesNegative: ['*Wegen es stark regnete, fällt das Konzert aus.', '*Denn es regnete, blieben wir zu Hause.'],
    commonErrors: [
      'Putting a full clause after wegen ("*wegen es regnete") instead of a nominal phrase.',
      'Fronting a denn-clause (denn coordinates and cannot open the sentence pair).',
      'Failing to convert verb → noun when switching to nominal style ("wegen des Regens", not "*wegen regnen").',
    ],
    prerequisiteKeys: ['de-b1-reason-consequence-connectors', 'de-b2-nominalization'],
  },
  {
    key: 'de-b2-temporal-connectors',
    kind: 'grammar',
    name: 'Temporal relations: clause vs preposition',
    description:
      'Converting temporal clauses to nominal phrases and back: während/bevor/nachdem/seit/bis + clause ↔ während + G, vor/nach/seit/bis zu + D + (nominalized) noun; bei + D for simultaneity (beim Einsteigen = während man einsteigt); stand-alone adverbs vorher/zuvor and danach/anschließend link the events without a clause.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Nach dem Essen gingen wir spazieren. = Nachdem wir gegessen hatten, gingen wir spazieren.',
      'Beim Einsteigen bitte die Fahrkarte bereithalten.',
      'Vor der Abreise müssen wir noch packen.',
      'Wir haben gepackt. Danach sind wir losgefahren.',
    ],
    examplesNegative: ['*Nach wir gegessen hatten, gingen wir spazieren.', '*Während dem Konzert. (formal register)'],
    commonErrors: [
      'Using a preposition with a full clause ("*nach wir gegessen hatten" — needs nachdem).',
      'Confusing the conjunction nachdem with the preposition nach.',
      'Wrong case in the nominal variant (während + genitive in formal style, vor/nach + dative).',
    ],
    prerequisiteKeys: ['de-b1-plusquamperfekt-nachdem', 'de-b2-nominalization'],
  },
  {
    key: 'de-b2-conditional-connectors',
    kind: 'grammar',
    name: 'Conditional relations: wenn/falls, verb-first, bei + noun',
    description:
      'Conditions across styles: wenn/falls clauses, unintroduced verb-first conditionals (Sollten Sie Fragen haben, …), nominal bei + D / im Falle + G (bei schlechtem Wetter = wenn das Wetter schlecht ist), and es sei denn / sonst for exceptions.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Sollten Sie Fragen haben, melden Sie sich jederzeit.',
      'Bei schlechtem Wetter findet das Fest drinnen statt.',
      'Beeil dich, sonst verpassen wir den Zug.',
    ],
    examplesNegative: ['*Bei das Wetter ist schlecht, bleiben wir hier.', '*Wenn Sie sollten Fragen haben, …'],
    commonErrors: [
      'Combining wenn with the verb-first pattern ("*Wenn sollten Sie Fragen haben").',
      'Putting a clause after bei ("*bei das Wetter ist schlecht").',
      'Misreading es sei denn ("unless") as "that is".',
    ],
    prerequisiteKeys: ['de-b2-konjunktiv-ii'],
  },
  {
    key: 'de-b2-concessive-connectors',
    kind: 'grammar',
    name: 'Concessive relations (obwohl — trotzdem — trotz)',
    description:
      'Concession across styles: obwohl/obgleich clauses, main-clause trotzdem/dennoch with inversion, nominal trotz + genitive, two-part zwar … aber, and intensified selbst/auch wenn ("even if").',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Trotz des Verbots wurde weiter geraucht.',
      'Zwar war das Hotel teuer, aber es hat sich gelohnt.',
      'Selbst wenn du recht hast, solltest du höflicher sein.',
    ],
    examplesNegative: ['*Trotz es verboten war, wurde geraucht.', '*Obwohl war das Hotel teuer, …'],
    commonErrors: [
      'Putting a clause after trotz ("*trotz es verboten war" — needs obwohl).',
      'Treating trotzdem as a subordinating conjunction ("*Trotzdem es regnete, …" in standard German).',
      'Dropping the aber half after zwar.',
    ],
    prerequisiteKeys: ['de-b1-subordinate-conjunctions', 'de-b1-genitive'],
  },
  {
    key: 'de-b2-consecutive-connectors',
    kind: 'grammar',
    name: 'Consecutive relations (sodass, so … dass, infolgedessen)',
    description:
      'Result clauses: sodass (…, sodass wir absagen mussten), split so + adjective … dass (Es war so laut, dass …), main-clause folglich/infolgedessen/demzufolge with inversion, and negative-result zu … als dass (usually with Konjunktiv II).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Es regnete stark, sodass das Spiel abgebrochen wurde.',
      'Es war so laut, dass ich nichts verstehen konnte.',
      'Das Problem ist zu komplex, als dass man es schnell lösen könnte.',
    ],
    examplesNegative: ['*Es war so laut, sodass ich nichts verstehen konnte.', '*Es regnete stark, sodass wurde das Spiel abgebrochen.'],
    commonErrors: [
      'Doubling so with sodass ("*so laut, sodass" — the split pattern takes plain dass).',
      'V2 order inside the sodass-clause.',
      'Missing the Konjunktiv II that careful usage prefers after als dass ("…, als dass man es schnell lösen könnte").',
      'Spelling confusion: fused sodass and split so dass are both standard as the conjunction, but the so + adjective … dass pattern is never fused.',
    ],
    prerequisiteKeys: ['de-b1-subordinate-conjunctions'],
  },
  {
    key: 'de-b2-modal-connectors',
    kind: 'grammar',
    name: 'Modal relations: indem, dadurch dass, durch',
    description:
      'Expressing means/manner: indem + clause (Man lernt eine Sprache, indem man sie spricht), dadurch, dass … as its correlate variant, nominal durch + accusative (durch tägliches Üben), and negative-manner ohne dass/ohne … zu.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Man lernt eine Sprache, indem man sie täglich spricht.',
      'Durch tägliches Üben verbessert sich die Aussprache.',
      'Er verließ den Raum, ohne dass es jemand bemerkte.',
    ],
    examplesNegative: ['*Man lernt eine Sprache, indem spricht man sie.', '*Durch man übt täglich, …'],
    commonErrors: [
      'V2 order after indem.',
      'Putting a clause after durch ("*durch man übt").',
      'Confusing temporal indem (dated) with instrumental indem — modern usage is instrumental.',
    ],
    prerequisiteKeys: ['de-b1-statt-ohne-zu', 'de-b2-nominalization'],
  },
  {
    key: 'de-b2-adversative-connectors',
    kind: 'grammar',
    name: 'Adversative relations (während, wohingegen, dagegen)',
    description:
      'Contrasting two facts: adversative während/wohingegen clauses (Er ist sparsam, während sie gern Geld ausgibt), main-clause dagegen/hingegen/jedoch/allerdings, nominal im Gegensatz zu + dative, and spoken wobei for a qualifying afterthought (…, wobei der Service etwas langsam war).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Er ist sehr sparsam, während sie gern Geld ausgibt.',
      'Im Gegensatz zu seinem Bruder ist er eher ruhig.',
      'Die Miete ist hoch; dagegen sind die Nebenkosten günstig.',
      'Das Essen war gut, wobei der Service etwas langsam war.',
    ],
    examplesNegative: ['*Im Gegensatz zu sein Bruder ist er ruhig.', '*Er ist sparsam, während sie gibt gern Geld aus.'],
    commonErrors: [
      'V2 order in the während-clause.',
      'Wrong case after im Gegensatz zu (dative required).',
      'Reading adversative während as temporal "while" only.',
    ],
    prerequisiteKeys: ['de-b1-subordinate-conjunctions'],
  },
  {
    key: 'de-b2-dass-equivalents',
    kind: 'grammar',
    name: 'dass-clauses and their equivalents',
    description:
      'Replacing dass-clauses: zu-infinitive when the subjects are identical (Ich hoffe, dass ich … → Ich hoffe, … zu …), nominal phrases (Ich hoffe auf eine baldige Antwort), and obligatory/optional correlates (es, darauf/damit …, dass).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Ich hoffe, dich bald wiederzusehen.',
      'Wir freuen uns darauf, dass ihr uns besucht.',
      'Ich hoffe auf eine baldige Antwort.',
    ],
    examplesNegative: ['*Ich hoffe, dass ich dich bald wiederzusehen.', '*Wir freuen uns, dass ihr uns besucht, darauf.'],
    commonErrors: [
      'Mixing dass and the zu-infinitive in one clause ("*dass ich … wiederzusehen").',
      'Dropping an obligatory correlate ("Wir freuen uns darauf, dass …" — some verbs require da(r)+preposition).',
      'Using the zu-infinitive when the subjects differ.',
    ],
    prerequisiteKeys: ['de-b1-zu-infinitive', 'de-a2-verb-preposition-complements'],
  },
  {
    key: 'de-b2-relatives-advanced',
    kind: 'grammar',
    name: 'Advanced relative clauses (was, wo(r)-, wer)',
    description:
      'was as relative after alles/etwas/nichts/das and superlatives, and after whole clauses (…, was mich überrascht hat); wo(r) + preposition for clause antecedents; wo relativizes places and (colloquially) times (die Stadt, wo ich wohne; der Tag, an dem/wo …); generalizing wer …, (der) … ("whoever"); derjenige, der as heavy antecedent.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Alles, was er sagte, stimmte.',
      'Sie hat sofort geantwortet, was mich gefreut hat.',
      'Wer zu spät kommt, muss draußen warten.',
      'Das ist die Stadt, wo ich geboren wurde.',
    ],
    examplesNegative: ['*Alles, das er sagte, stimmte.', '*Sie hat sofort geantwortet, das mich gefreut hat.'],
    commonErrors: [
      'Using das instead of was after alles/etwas/nichts ("*alles, das …").',
      'Using a das-relative for a whole-clause antecedent ("*…, das mich gefreut hat" for "was …").',
      'Inserting an unneeded resumptive der after wer when cases match ("Wer zu spät kommt, muss …" needs no der).',
    ],
    prerequisiteKeys: ['de-b1-relative-pronouns'],
  },
  {
    key: 'de-b2-noun-verb-collocations',
    kind: 'grammar',
    name: 'Noun-verb collocations (Funktionsverbgefüge)',
    description:
      'Fixed noun-verb pairs of formal German: eine Entscheidung treffen, zur Verfügung stehen/stellen, in Frage kommen, Bescheid geben, sich Mühe geben, Kritik üben an, eine Rolle spielen — the noun carries the meaning, the verb and its article/preposition are fixed.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Wir müssen bald eine Entscheidung treffen.',
      'Der Raum steht Ihnen ab Montag zur Verfügung.',
      'Gib mir bitte Bescheid, wenn du ankommst.',
    ],
    examplesNegative: ['*eine Entscheidung machen', '*zur Verfügung sein'],
    commonErrors: [
      'Calquing English make ("*eine Entscheidung machen") or choosing the wrong light verb ("*einen Fehler tun").',
      'Swapping the fixed verb ("*zur Verfügung sein" instead of "stehen").',
      'Changing the fixed article or preposition ("*in der Frage kommen").',
    ],
  },
  {
    key: 'de-b2-fixed-prepositions',
    kind: 'grammar',
    name: 'Nouns and adjectives with fixed prepositions',
    description:
      'Nouns and adjectives governing a fixed preposition + case: die Angst vor + D, der Grund für + A, die Antwort auf + A, stolz auf + A, abhängig von + D, zufrieden mit + D; da(r)-correlates introduce dependent clauses (stolz darauf, dass …).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Sie ist stolz auf ihre Arbeit.',
      'Es gibt keinen Grund für diese Aufregung.',
      'Er ist stolz darauf, die Prüfung bestanden zu haben.',
    ],
    examplesNegative: ['*Sie ist stolz über ihre Arbeit.', '*die Angst über Spinnen'],
    commonErrors: [
      'Transferring the English preposition ("*stolz über", "*abhängig auf").',
      'Wrong case after the fixed preposition ("*stolz auf ihrer Arbeit").',
      'Dropping the da(r)-correlate before a dass-clause where the noun/adjective requires it.',
    ],
    prerequisiteKeys: ['de-a2-verb-preposition-complements'],
  },
  {
    key: 'de-b2-indefinite-pronouns',
    coverageSpec: {
      axes: [
        // The declined stand-alone forms are the claimed traps (einen/
        // keinen/einem/manchem); nominative-collapsed frames never elicit
        // them. Genitive omitted (marginal for these pronouns).
        { name: 'case', floors: { nominative: 8, accusative: 10, dative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Indefinite pronouns II (irgend-, mancher, sämtliche …)',
    description:
      'The extended indefinite system: irgend- compounds (irgendjemand, irgendwo/irgendwohin, irgendein-), the place-adverb series überall / nirgendwo / anderswo, mancher (declined like dieser), mehrere, einige, sämtliche, beide, and einer/keiner/welche as stand-alone pronouns (Hast du Milch? — Ja, es ist noch welche da).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Irgendjemand hat für dich angerufen.',
      'Manche Kollegen arbeiten lieber im Homeoffice.',
      'Brauchst du einen Stift? — Ich habe keinen.',
    ],
    examplesNegative: ['*Ich habe keinen Stift, aber du hast ein.', '*Manche Kollege arbeiten im Homeoffice.'],
    commonErrors: [
      'Using the article form instead of the pronoun form ("*du hast ein" instead of "einen"; neuter antecedents take "eins").',
      'Leaving mancher/sämtliche undeclined.',
      'Missing welche as the partitive pronoun for mass nouns.',
    ],
    prerequisiteKeys: ['de-a2-indefinite-pronouns-basic'],
  },
  {
    key: 'de-b2-word-formation',
    kind: 'grammar',
    name: 'Word formation: suffixes, prefixes, Fugen-s',
    description:
      'Productive derivation: noun suffixes -ung/-heit/-keit/-schaft/-nis, negating prefixes un-/miss-, adjective suffixes -lich/-ig/-isch/-bar/-los/-voll/-frei, adverbial -weise (glücklicherweise), and the linking -s- in compounds (Arbeitszimmer, Liebeslied).',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Die Freundlichkeit der Mitarbeiter ist beeindruckend.',
      'Glücklicherweise war der Fehler vermeidbar.',
      'Das Arbeitszimmer ist im ersten Stock.',
    ],
    examplesNegative: ['*die Freundlichheit', '*das Arbeitzimmer'],
    commonErrors: [
      'Choosing -heit vs -keit wrongly ("*Freundlichheit" — adjectives in -lich/-ig take -keit).',
      'Dropping the Fugen-s ("*Arbeitzimmer" instead of "Arbeitszimmer").',
      'Confusing -lich and -ig pairs with distinct meanings.',
    ],
  },
  {
    key: 'de-b2-mittelfeld-word-order',
    kind: 'grammar',
    name: 'Mittelfeld word order (TeKaMoLo, pronouns, nicht)',
    description:
      'Ordering inside the verb bracket: pronouns come first (acc before dat for two pronouns), then noun phrases; adverbials default to temporal–causal–modal–local (TeKaMoLo); nicht stands before the element it negates, otherwise late; the Vorfeld usually carries the topic — given information first, new information late.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Ich habe ihn gestern wegen des Termins kurz im Büro gesehen.',
      'Sie hat es mir gestern erklärt.',
    ],
    examplesNegative: ['*Ich habe gestern ihn im Büro kurz gesehen.', '*Sie hat mir es gestern erklärt.'],
    commonErrors: [
      'Placing a full adverbial before an unstressed pronoun ("*gestern ihn").',
      'Dative-before-accusative with two pronouns ("*mir es" instead of "es mir").',
      'Rigidly applying TeKaMoLo when focus structure demands another order — the default is a tendency, not law.',
    ],
    prerequisiteKeys: ['de-a2-dative-accusative-objects'],
    // A word-order meta rule: no single blank can test constituent ordering.
    clozeUnsuitable: true,
  },
  {
    key: 'de-b2-text-reference-words',
    kind: 'grammar',
    name: 'Text reference words (Verweiswörter)',
    description:
      'Cohesion devices that point across sentences: da(r)-compounds (dabei, dafür, damit, darauf) picking up a previous clause, dies/das as sentence anaphors, solch-/derartig for kind reference, and deshalb/dadurch as cause links in running text.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Die Firma will Stellen abbauen. Dagegen protestieren die Mitarbeiter.',
      'Er hat sofort zugesagt. Das hat mich überrascht.',
      'Wir mussten umplanen; dabei half uns die neue Software.',
    ],
    examplesNegative: ['*Die Firma will Stellen abbauen. Gegen es protestieren die Mitarbeiter.'],
    commonErrors: [
      'Using preposition + es instead of the da(r)-compound ("*gegen es" instead of "dagegen").',
      'Ambiguous das without a clear antecedent clause.',
      'Repeating the full noun phrase where a reference word makes the text idiomatic.',
    ],
    prerequisiteKeys: ['de-a2-verb-preposition-complements'],
    // Several reference words fit a bare blank; translation carries the point.
    clozeUnsuitable: true,
    targetOverride: 15,
  },
  {
    key: 'de-b2-modal-particles-advanced',
    kind: 'grammar',
    name: 'Modal particles II (halt, eben, wohl, schon, bloß)',
    description:
      'Advanced particle meanings: halt/eben mark resigned acceptance (Das ist halt so), wohl a supposition (Er ist wohl schon weg), schon concessive reassurance (Das wird schon klappen), bloß/nur urgency in warnings and wishes (Sag das bloß nicht!), etwa alarmed questions.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Das ist halt so — da kann man nichts machen.',
      'Er ist wohl schon nach Hause gegangen.',
      'Das wird schon klappen!',
    ],
    examplesNegative: ['*Halt das ist so.'],
    commonErrors: [
      'Fronting the particle ("*Halt das ist so").',
      'Reading wohl as "well" instead of supposition.',
      'Confusing warning bloß with plain nur.',
    ],
    prerequisiteKeys: ['de-b1-modal-particles-basic'],
    clozeUnsuitable: true,
    targetOverride: 12,
  },

  {
    key: 'de-b2-verb-prefixes',
    kind: 'grammar',
    name: 'Verb prefixes: inseparable meanings and variable prefixes',
    description:
      'Inseparable prefixes as a meaning system: be- transitivizes (beantworten + A vs antworten auf), er- = achievement/change of state (erreichen, erröten), ver- = completion, error or change (verschlafen, sich verlaufen), ent- = removal, zer- = "to pieces"; variable prefixes (um-, über-, durch-, unter-) split literal-separable vs figurative-inseparable readings, with distinct participles (umgefahren "knocked down" vs umfahren "driven round").',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Kannst du meine Frage beantworten?',
      'Er hat den Wecker nicht gehört und verschlafen.',
      'Der Bus hat das Verkehrsschild umgefahren.',
      'Wir haben die Baustelle weiträumig umfahren.',
    ],
    examplesNegative: ['*Ich habe die Frage geantwortet.', '*Er hat das Schild umfahren. (meaning "knocked it down" — that reading needs umgefahren)'],
    commonErrors: [
      'Using the plain verb transitively where the be-verb carries the object ("*die Frage antworten" instead of "die Frage beantworten" / "auf die Frage antworten").',
      'Building ge- participles for inseparable readings ("*umgefahren" for "drove around" — the inseparable participle is umfahren, without ge-).',
      'Missing the meaning flip between the separable and inseparable readings (durchschauen: durchgeschaut = looked through it, durchschaut = saw through him).',
    ],
    prerequisiteKeys: ['de-a2-separable-prefix-verbs', 'de-a2-past-participle-formation'],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
  // coverageSpec: intentionally none on the umbrellas below (open noun-dominant
  // identity space; matches the ES/TR vocab-umbrella decision) — except
  // food-drink, floored like tr-a1-vocab-food-drink.
  {
    key: 'de-a1-vocab-family-people',
    kind: 'vocab',
    name: 'Family and people (A1)',
    description:
      'Core A1 vocabulary for family members, people, and basic personal descriptions.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Mutter', 'der ältere Bruder'],
    examplesNegative: ['*der Mutter (as nominative)'],
    commonErrors: [
      'Mismatching article gender on family nouns ("*der Mutter" as subject).',
      'Confusing "die Eltern" (parents) with "die Verwandten" (relatives).',
    ],
  },
  {
    key: 'de-a1-vocab-food-drink',
    kind: 'vocab',
    name: 'Food and drink (A1)',
    description:
      'Core A1 vocabulary for staple foods, fruit, vegetables, and everyday drinks.',
    cefrLevel: A1,
    language: DE,
    coverageSpec: {
      // wordClass diversity: food/drink vocab is noun-dominant, with a few verbs
      // (eat/drink) and adjectives (tastes). Floors sum to the vocab target (10).
      axes: [{ name: 'wordClass', floors: { noun: 6, verb: 2, adjective: 2 } }],
    },
    examplesPositive: ['das Brot', 'der Kaffee'],
    examplesNegative: ['*die Brot (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on food nouns ("*die Brot" instead of "das Brot").',
      'Confusing "der Saft" (juice) with "die Soße" (sauce).',
    ],
  },
  {
    key: 'de-a1-vocab-home-objects',
    kind: 'vocab',
    name: 'Home and objects (A1)',
    description:
      'Core A1 vocabulary for rooms, furniture, and everyday household objects.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['der Tisch', 'das Bett'],
    examplesNegative: ['*der Bett (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on furniture nouns ("*der Bett" instead of "das Bett").',
      'Confusing "der Schrank" (cupboard/wardrobe) with "das Regal" (shelf).',
    ],
  },
  {
    key: 'de-a1-vocab-city-transport',
    kind: 'vocab',
    name: 'City and transport (A1)',
    description:
      'Core A1 vocabulary for places in town, means of transport, and simple directions.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['der Bahnhof', 'die Straße'],
    examplesNegative: ['*das Bahnhof (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on transport nouns ("*das Bahnhof" instead of "der Bahnhof").',
      'Confusing "die Straße" (street) with "der Weg" (way/path).',
    ],
  },
  {
    key: 'de-a1-vocab-weather-clothing',
    kind: 'vocab',
    name: 'Weather and clothing (A1)',
    description:
      'Core A1 vocabulary for weather conditions, seasons, and everyday clothing items.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Jacke', 'der Regen'],
    examplesNegative: ['*das Regen (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on weather nouns ("*das Regen" instead of "der Regen").',
      'Confusing "die Jacke" (jacket) with "der Mantel" (coat).',
    ],
  },
  {
    key: 'de-a2-housing-vocab',
    kind: 'vocab',
    name: 'Housing and home vocabulary (A2)',
    description:
      'Everyday vocabulary for housing, rooms, furniture, and household chores typical of A2 communication.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['die Wohnung', 'der Kühlschrank'],
    examplesNegative: ['*das Wohnung'],
    commonErrors: [
      'Treating compound nouns as separate words ("*Kühl Schrank").',
      'Confusing der Stuhl (chair) with der Sessel (armchair).',
    ],
  },
  {
    key: 'de-a2-vocab-work-school',
    kind: 'vocab',
    name: 'Work and school (A2)',
    description:
      'A2 vocabulary for jobs, workplaces, school subjects, and everyday study activities.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['der Beruf', 'die Prüfung'],
    examplesNegative: ['*das Beruf (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on work/school nouns ("*das Beruf" instead of "der Beruf").',
      'Confusing "die Schule" (school, the institution) with "der Unterricht" (lessons/class time).',
    ],
  },
  {
    key: 'de-a2-vocab-city-shopping',
    kind: 'vocab',
    name: 'City and shopping (A2)',
    description:
      'A2 vocabulary for shops, services, money, and everyday shopping activities.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['das Geschäft', 'die Kasse'],
    examplesNegative: ['*der Geschäft (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on shopping nouns ("*der Geschäft" instead of "das Geschäft").',
      'Confusing "billig" (cheap) with "günstig" (good value) in price contexts.',
    ],
  },
  {
    key: 'de-a2-vocab-health-body',
    kind: 'vocab',
    name: 'Health and body (A2)',
    description:
      'A2 vocabulary for body parts, common symptoms, and everyday health complaints.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['der Kopf', 'die Schmerzen'],
    examplesNegative: ['*das Kopf (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on body nouns ("*das Kopf" instead of "der Kopf").',
      'Confusing "krank sein" (to be ill) with "sich fühlen" (to feel) when describing symptoms.',
    ],
  },
  {
    key: 'de-a2-vocab-travel-nature',
    kind: 'vocab',
    name: 'Travel and nature (A2)',
    description: 'A2 vocabulary for travel, landscapes, and the outdoors.',
    cefrLevel: A2,
    language: DE,
    examplesPositive: ['der Berg', 'die Reise'],
    examplesNegative: ['*das Berg (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on nature nouns ("*das Berg" instead of "der Berg").',
      'Confusing "die Reise" (trip/journey) with "die Fahrt" (ride/drive).',
    ],
  },
  {
    key: 'de-b1-environment-vocab',
    kind: 'vocab',
    name: 'Environment and society vocabulary (B1)',
    description:
      'Vocabulary covering environment, society, work, and current-affairs topics typical of B1 discussions.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['die Umwelt', 'der Klimawandel'],
    examplesNegative: ['*das Umwelt'],
    commonErrors: [
      'Calquing English ("*Klima Wechsel" instead of "Klimawandel").',
      'Confusing "die Umwelt" (the environment) with "die Umgebung" (surroundings).',
    ],
  },
  {
    key: 'de-b1-vocab-media-news',
    kind: 'vocab',
    name: 'Media and news (B1)',
    description:
      'B1 vocabulary for news reporting, media formats, and current-events discussion.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['der Bericht', 'die Zeitschrift'],
    examplesNegative: ['*das Bericht (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on media nouns ("*das Bericht" instead of "der Bericht").',
      'Confusing "die Zeitung" (newspaper) with "die Zeitschrift" (magazine).',
    ],
  },
  {
    key: 'de-b1-vocab-education-career',
    kind: 'vocab',
    name: 'Education and career (B1)',
    description:
      'B1 vocabulary for study paths, qualifications, and career development.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['der Abschluss', 'die Ausbildung'],
    examplesNegative: ['*das Abschluss (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on education nouns ("*das Abschluss" instead of "der Abschluss").',
      'Confusing "die Ausbildung" (vocational training) with "das Studium" (university study).',
    ],
  },
  {
    key: 'de-b1-vocab-emotions-relationships',
    kind: 'vocab',
    name: 'Emotions and relationships (B1)',
    description:
      'B1 vocabulary for feelings, interpersonal relationships, and everyday conflict.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['die Beziehung', 'der Streit'],
    examplesNegative: ['*das Streit (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on relationship nouns ("*das Streit" instead of "der Streit").',
      'Confusing reflexive "sich fühlen" (to feel) with transitive "fühlen" used without the reflexive pronoun.',
    ],
  },
  {
    key: 'de-b1-vocab-opinions-society',
    kind: 'vocab',
    name: 'Opinions and society (B1)',
    description:
      'B1 vocabulary for expressing views, discussing social issues, and public life.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['die Meinung', 'die Gesellschaft'],
    examplesNegative: ['*der Meinung (as nominative)'],
    commonErrors: [
      'Mismatching article gender/case on opinion nouns ("*der Meinung" as a nominative subject instead of "die Meinung").',
      'Calquing English with "*in meiner Meinung" instead of "meiner Meinung nach".',
    ],
  },
  {
    key: 'de-b2-academic-noun-vocab',
    kind: 'vocab',
    name: 'Academic abstract noun vocabulary (B2)',
    description:
      'Abstract and academic-register nouns for argumentation, analysis, and essay writing typical of B2 work.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['die Nachhaltigkeit', 'die Entwicklung'],
    examplesNegative: ['*der Nachhaltigkeit'],
    commonErrors: [
      'Mistakes on -ung / -heit / -keit gender (all feminine).',
      'Calquing English derived nouns instead of using the standard German equivalent.',
    ],
  },
  {
    key: 'de-b2-vocab-work-professional',
    kind: 'vocab',
    name: 'Professional life (B2)',
    description:
      'B2 vocabulary for workplace processes, contracts, and professional communication.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['der Vertrag', 'die Kündigung'],
    examplesNegative: ['*das Vertrag (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on professional-life nouns ("*das Vertrag" instead of "der Vertrag").',
      'Confusing "kündigen" (to terminate a contract / resign) with "entlassen" (to dismiss someone).',
    ],
  },
  {
    key: 'de-b2-vocab-science-technology',
    kind: 'vocab',
    name: 'Science and technology (B2)',
    description:
      'B2 vocabulary for research, technology, innovation, and digitalisation.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['die Forschung', 'der Fortschritt'],
    examplesNegative: ['*das Fortschritt (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on science/tech nouns ("*das Fortschritt" instead of "der Fortschritt").',
      'Confusing "die Erfindung" (invention) with "die Entdeckung" (discovery).',
    ],
  },
  {
    key: 'de-b2-vocab-society-politics',
    kind: 'vocab',
    name: 'Society and politics (B2)',
    description:
      'B2 vocabulary for political institutions, civic life, and social debates.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['die Regierung', 'der Bürger'],
    examplesNegative: ['*das Regierung (wrong gender)'],
    commonErrors: [
      'Mismatching article gender on political nouns ("*das Regierung" instead of "die Regierung").',
      'Confusing "die Politik" (politics/policy) with "der Politiker" (a politician).',
    ],
  },
  {
    key: 'de-b2-vocab-culture-media',
    kind: 'vocab',
    name: 'Culture and media (B2)',
    description:
      'B2 vocabulary for arts, cultural life, and media criticism.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['die Ausstellung', 'die Kritik'],
    examplesNegative: ['*der Ausstellung (as nominative)'],
    commonErrors: [
      'Mismatching article gender/case on culture nouns ("*der Ausstellung" as a nominative subject instead of "die Ausstellung").',
      'Confusing "die Kritik" (criticism/review) with "die Kunst" (art, the general field).',
    ],
  },
];

export { deCurriculum };
export default deCurriculum;
