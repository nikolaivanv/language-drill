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
 */
export const CURRICULUM_VERSION_DE = '2026-07-12';

const deCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1 (Menschen A1 + Hammer audit; 18 points)
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
    name: 'Present tense: sein, haben and stem-changing verbs',
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
      'Regularizing wissen ("*ich wisse" instead of "ich weiß").',
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
      'Memorising and applying the three grammatical genders of German nouns alongside common gender-derivation patterns (-ung → die, -chen → das, -er agent nouns → der).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Wohnung', 'das Mädchen'],
    examplesNegative: ['*der Mädchen'],
    commonErrors: [
      'Assigning masculine to people regardless of suffix (e.g. "*der Mädchen").',
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
    kind: 'grammar',
    name: 'Definite, indefinite and negative articles — nominative',
    description:
      'Choosing der/das/die, ein/ein/eine and the negative article kein/kein/keine for the subject of a sentence according to noun gender.',
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
    kind: 'grammar',
    name: 'Dative case: forms and core uses',
    description:
      'Dative forms dem/der/dem/den (+ -n on plural nouns) and einem/einer/einem, used after location prepositions answering wo? (in der Stadt) and with dative verbs like helfen, danken, gefallen, gehören, schmecken.',
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
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-a1-possessive-articles',
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
      'Keeping the full stem of euer before endings ("*euere Kinder" instead of "eure Kinder").',
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
      'Counting "und"-coordinated phrases as occupying position 1.',
    ],
  },
  {
    key: 'de-a1-negation',
    kind: 'grammar',
    name: 'Negation: nicht vs kein and the position of nicht',
    description:
      'kein negates nouns that would carry an indefinite or no article (Ich habe keine Zeit); nicht negates everything else and stands late in the clause — before predicate adjectives, prepositional complements or the specifically negated constituent.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich habe kein Auto.',
      'Der Film ist nicht interessant.',
      'Ich komme heute nicht.',
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
      'No article before professions, nationalities and religions after sein/werden (Ich bin Lehrerin, Er wird Arzt), before indefinite plurals and mass nouns (Wir haben Äpfel — English "some"), and with languages; the article returns with an adjective (Sie ist eine gute Ärztin).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich bin Lehrerin.',
      'Er wird Arzt.',
      'Wir haben Äpfel und Brot gekauft.',
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
      'Present tense of können, wollen, müssen, dürfen, sollen, mögen and the möchte-forms: irregular singular without endings in 1sg/3sg (ich kann, er kann), regular plural, and the verb bracket with the bare infinitive at the end of the clause.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Ich kann heute nicht kommen.',
      'Möchtest du einen Kaffee trinken?',
      'Wir müssen morgen früh aufstehen.',
    ],
    examplesNegative: ['*Er kannt gut schwimmen.', '*Ich will gehen nach Hause.'],
    commonErrors: [
      'Adding -t to the 3sg ("*er kannt", "*sie musst" instead of "er kann", "sie muss").',
      'Placing the infinitive right after the modal instead of clause-finally ("*Ich will gehen nach Hause").',
      'Keeping the umlaut of the infinitive in the singular ("*ich könne" for "ich kann").',
      'Using zu before the infinitive after a modal ("*Ich muss zu arbeiten").',
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
    kind: 'grammar',
    name: 'Imperative (Sie, du, ihr)',
    description:
      'Imperatives: Sie-form with pronoun (Gehen Sie!), du-form without -st and usually without -e (Geh!, Nimm!, Fahr! — e→i(e) change kept, a→ä umlaut dropped), ihr-form = stem + -t (Geht!); sein is irregular (Sei ruhig!, Seien Sie …).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Nehmen Sie bitte Platz!',
      'Geh nach Hause und schlaf gut!',
      'Kommt her, Kinder!',
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
      'Time prepositions: am + days/parts of the day (am Montag, am Abend), um + clock time, im + months/seasons, von … bis and ab for spans, vor/nach/in + dative and für + accusative for relative time (in einer Stunde, für zwei Tage).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: [
      'Der Kurs beginnt am Montag um neun Uhr.',
      'Im Sommer fahren wir ans Meer.',
      'Der Zug kommt in zehn Minuten.',
    ],
    examplesNegative: ['*Ich habe an Montag Zeit.'],
    commonErrors: [
      'Using the uncontracted an/in where am/im is required ("*an Montag", "*in Juli").',
      'Calquing English "at night" ("*an der Nacht" instead of "in der Nacht").',
      'Using um for days or dates ("*um Montag" instead of "am Montag").',
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
      axes: [{ name: 'person', floors: { '1sg': 3, '3sg': 3 } }],
    },
    conjugationSuitable: true,
    conjugationSeedWords: ['sein', 'haben'],
    targetOverride: 15,
  },
];

export { deCurriculum };
export default deCurriculum;
