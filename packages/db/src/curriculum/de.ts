// TEMPORARILY DISABLED (2026-05-10): all DE curriculum entries are commented
// out so the prod scheduler stops generating German exercises. To restore:
//   1. Uncomment the array body below.
//   2. Restore the destructure / imports below.
//   3. Bump DE back in PER_LANGUAGE_GRAMMAR_MIN (curriculum/index.ts).
//   4. Restore the DE entries in SEED_KEY_TO_GRAMMAR_POINT (seed-exercises.ts).
//   5. Re-enable the per-language counts test for German (curriculum.test.ts).
// import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// const DE = Language.DE;
// const { A1, A2, B1, B2 } = CefrLevel;

const deCurriculum: readonly GrammarPoint[] = [
  /*
  // ---------------------------------------------------------------------------
  // A1
  // ---------------------------------------------------------------------------
  {
    key: 'de-a1-present-indicative',
    kind: 'grammar',
    name: 'Present indicative',
    description:
      'Conjugation of regular and stem-changing verbs in the present tense across all six persons.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['Ich wohne in Berlin.', 'Er fährt jeden Tag mit dem Bus.'],
    examplesNegative: ['*Er fahrt jeden Tag mit dem Bus.'],
    commonErrors: [
      'Forgetting the e→i / a→ä stem change in second and third person singular.',
      'Using English-style auxiliary "do" ("*ich tue wohnen").',
    ],
  },
  {
    key: 'de-a1-articles-nominative',
    kind: 'grammar',
    name: 'Definite and indefinite articles — nominative',
    description:
      'Choosing der/die/das and ein/eine for the subject of a sentence according to noun gender.',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['Der Hund schläft.', 'Eine Frau steht an der Tür.'],
    examplesNegative: ['*Das Hund schläft.'],
    commonErrors: [
      'Defaulting to "der" for unfamiliar nouns.',
      'Treating English-cognate nouns as masculine without checking gender.',
    ],
  },
  {
    key: 'de-a1-noun-gender',
    kind: 'grammar',
    name: 'Noun gender (der/die/das)',
    description:
      'Memorising and applying the three grammatical genders of German nouns alongside common gender-derivation patterns (-ung → die, -chen → das).',
    cefrLevel: A1,
    language: DE,
    examplesPositive: ['die Wohnung', 'das Mädchen'],
    examplesNegative: ['*der Mädchen'],
    commonErrors: [
      'Assigning masculine to people regardless of suffix (e.g. "*der Mädchen").',
      'Ignoring suffix-based gender rules for -ung, -heit, -keit (all feminine).',
    ],
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

  // ---------------------------------------------------------------------------
  // A2
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
    prerequisiteKeys: ['de-a1-present-indicative'],
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

  // ---------------------------------------------------------------------------
  // B1
  // ---------------------------------------------------------------------------
  {
    key: 'de-b1-relative-pronouns',
    kind: 'grammar',
    name: 'Relative pronouns and clauses',
    description:
      'Using der/die/das and dessen/deren as relative pronouns whose case matches the role inside the relative clause; verb goes to the end.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Der Mann, der dort steht, ist mein Vater.',
      'Das Buch, das ich lese, ist spannend.',
    ],
    examplesNegative: ['*Der Mann, der dort steht ist mein Vater.'],
    commonErrors: [
      'Choosing the relative pronoun by the antecedent\'s gender alone, ignoring the case role inside the clause.',
      'Forgetting verb-final word order in relative clauses.',
    ],
    prerequisiteKeys: ['de-a1-articles-nominative'],
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
    key: 'de-b1-modal-verbs-past',
    kind: 'grammar',
    name: 'Modal verbs in the Präteritum',
    description:
      'Forming past-tense modals (konnte, musste, durfte, sollte, wollte, mochte) and pairing them with a final infinitive in main clauses.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: ['Ich konnte gestern nicht kommen.', 'Wir mussten lange warten.'],
    examplesNegative: ['*Ich kann gestern nicht kommen.'],
    commonErrors: [
      'Using the Perfekt with modals where Präteritum is more idiomatic.',
      'Forgetting that the umlaut drops in the simple past (können → konnte, not "*könnte" outside Konjunktiv II).',
    ],
  },
  {
    key: 'de-b1-two-way-prepositions',
    kind: 'grammar',
    name: 'Two-way prepositions (Wechselpräpositionen)',
    description:
      'an, auf, hinter, in, neben, über, unter, vor, zwischen — accusative for direction (wohin?), dative for location (wo?).',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich gehe in die Schule. (direction → Akk.)',
      'Ich bin in der Schule. (location → Dat.)',
    ],
    examplesNegative: ['*Ich gehe in der Schule.'],
    commonErrors: [
      'Defaulting to dative because the noun denotes a place.',
      'Choosing case by the verb stem instead of by direction-vs-location.',
    ],
    prerequisiteKeys: ['de-a2-akkusativ-prepositions', 'de-a2-dativ-prepositions'],
  },
  {
    key: 'de-b1-passive-werden',
    kind: 'grammar',
    name: 'Passive with werden',
    description:
      '"werden + past participle" passive: present, past, and Perfekt forms; agent introduced with "von" and instrument with "durch".',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Das Haus wird gebaut.',
      'Der Brief wurde von ihr geschrieben.',
    ],
    examplesNegative: ['*Das Haus ist gebaut von ihr.'],
    commonErrors: [
      'Confusing the werden-passive with the sein-Zustandspassiv (resultant state).',
      'Using "bei" or "mit" instead of "von" for the agent.',
    ],
  },
  {
    key: 'de-b1-subordinate-conjunctions',
    kind: 'grammar',
    name: 'Subordinating conjunctions and verb-final order',
    description:
      'weil, obwohl, wenn, als, damit, ob, während, bevor, nachdem trigger verb-final order in the subordinate clause.',
    cefrLevel: B1,
    language: DE,
    examplesPositive: [
      'Ich bleibe zu Hause, weil ich krank bin.',
      'Obwohl es regnet, gehen wir spazieren.',
    ],
    examplesNegative: ['*Ich bleibe zu Hause, weil ich bin krank.'],
    commonErrors: [
      'Keeping V2 order after weil and obwohl.',
      'Confusing als (a one-off past event) with wenn (repeated or future).',
    ],
  },

  // ---------------------------------------------------------------------------
  // B2
  // ---------------------------------------------------------------------------
  {
    key: 'de-b2-konjunktiv-ii',
    kind: 'grammar',
    name: 'Konjunktiv II',
    description:
      'Konjunktiv II for hypothetical and counterfactual statements, polite requests, and irrealis conditionals — built with würde + infinitive or umlauted simple-past stems.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Wenn ich Zeit hätte, würde ich kommen.',
      'Ich hätte gerne einen Kaffee.',
    ],
    examplesNegative: ['*Wenn ich Zeit habe, würde ich kommen.'],
    commonErrors: [
      'Pairing a real-conditional present indicative with the Konjunktiv II main clause.',
      'Overusing würde + infinitive where umlauted strong-verb forms (käme, ginge) are more idiomatic.',
    ],
    prerequisiteKeys: ['de-b1-modal-verbs-past'],
  },
  {
    key: 'de-b2-genitive-prepositions',
    kind: 'grammar',
    name: 'Genitiv prepositions',
    description:
      'Formal-register prepositions taking the genitive: während, wegen, trotz, statt, anstatt, innerhalb, außerhalb, aufgrund.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Während des Sommers reisen wir oft.',
      'Trotz des schlechten Wetters gingen wir spazieren.',
    ],
    examplesNegative: ['*Während dem Sommer reisen wir oft.'],
    commonErrors: [
      'Using dative after wegen/trotz/während (acceptable colloquially but flagged in formal writing).',
      'Forgetting the -s/-es genitive ending on masculine and neuter singular nouns.',
    ],
  },
  {
    key: 'de-b2-konjunktiv-i',
    kind: 'grammar',
    name: 'Konjunktiv I (reported speech)',
    description:
      'Konjunktiv I (er sage, er habe, er sei) for indirect speech in journalistic and formal registers; substitution by Konjunktiv II when forms coincide with the indicative.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: [
      'Der Minister sagte, er habe keine Zeit.',
      'Sie behauptet, sie sei krank.',
    ],
    examplesNegative: ['*Der Minister sagte, er hat keine Zeit. (in formal news writing)'],
    commonErrors: [
      'Using the indicative in formal indirect speech.',
      'Failing to switch to Konjunktiv II when Konjunktiv I would coincide with the indicative.',
    ],
    prerequisiteKeys: ['de-b2-konjunktiv-ii'],
  },
  {
    key: 'de-b2-extended-attributes',
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
    prerequisiteKeys: ['de-b1-relative-pronouns'],
  },
  {
    key: 'de-b2-nominalization',
    kind: 'grammar',
    name: 'Nominalisation',
    description:
      'Turning verbs and adjectives into nouns ("das Lesen", "das Gute") — capitalisation, neuter gender, and idiomatic use in formal writing.',
    cefrLevel: B2,
    language: DE,
    examplesPositive: ['Das Lesen macht Spaß.', 'Das Gute an dieser Idee ist die Einfachheit.'],
    examplesNegative: ['*das gute an dieser idee'],
    commonErrors: [
      'Failing to capitalise the nominalised form.',
      'Assigning the wrong gender (nominalised infinitives are always neuter).',
    ],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
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
  */
];

export { deCurriculum };
export default deCurriculum;
