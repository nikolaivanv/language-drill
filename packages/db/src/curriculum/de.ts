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
  // ---------------------------------------------------------------------------
  // A2 (Menschen A2 + Hammer audit; 29 points)
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
      'Using "sein + past participle" for verbs of motion and change of state (gehen, fahren, kommen, werden, bleiben, sein).',
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
      'Missing the standard contractions ("*in dem Kino" for a plain location where "im Kino" is idiomatic).',
    ],
    prerequisiteKeys: ['de-a1-dative'],
  },
  {
    key: 'de-a2-adjective-declension-indefinite',
    kind: 'grammar',
    name: 'Adjective declension after ein/kein/possessives',
    description:
      'Mixed declension after ein-words: the adjective carries the gender signal where ein has no ending (ein neuer Tisch, ein neues Haus) and -en elsewhere (einen neuen Tisch, mit einem neuen Auto); feminine takes -e (eine neue Lampe).',
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
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
  },
  {
    key: 'de-a2-adjective-declension-definite',
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
    kind: 'grammar',
    name: 'Adjective declension without an article',
    description:
      'Strong declension with no article: the adjective itself carries the article ending (frischer Fisch, frisches Brot, kalte Milch, mit kaltem Wasser, trotz guter Argumente) — common with food, materials and plurals.',
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
    kind: 'grammar',
    name: 'Reflexive verbs',
    description:
      'Verbs with an accusative reflexive pronoun (sich freuen, sich duschen, sich treffen): mich/dich/sich/uns/euch/sich; the pronoun follows the finite verb in main clauses.',
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
    kind: 'grammar',
    name: 'Comparative and superlative',
    description:
      'Comparative in -er and superlative with am -sten, with umlaut in many monosyllables (alt → älter → am ältesten); irregular gut/besser/am besten, gern/lieber/am liebsten, viel/mehr/am meisten; als after comparatives, (genauso) … wie for equality.',
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
      'Skipping the umlaut ("*alter" for "älter", "*am grossten").',
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
    examplesNegative: ['*Man dürfen hier nicht rauchen.', '*Ich habe niemand gesehen. (in careful writing)'],
    commonErrors: [
      'Using a plural verb with man ("*man dürfen").',
      'Replacing man with du/Sie in general statements by English interference.',
      'Combining nichts/niemand with another negation ("*Ich habe nichts nicht gehört").',
    ],
  },
  {
    key: 'de-a2-lassen',
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
      'Situations that began in the past and still hold take the PRESENT tense with seit/schon (Ich wohne seit drei Jahren hier), where English uses the perfect ("I have lived"); the Perfekt with seit implies the situation ended.',
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
    kind: 'grammar',
    name: 'Demonstratives and question articles (dieser, welcher, was für ein)',
    description:
      'dieser/dieses/diese declined like the definite article; stressed der/das/die as demonstrative pronouns (Der ist gut!); welch-? asks about a known set, was für ein? about kind or quality.',
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
    ],
    prerequisiteKeys: ['de-a1-dative'],
    // A bare blank cannot test constituent ORDER: any object fills the slot and
    // several orders are contextually licensed. Translation carries the point.
    clozeUnsuitable: true,
  },
];

export { deCurriculum };
export default deCurriculum;
