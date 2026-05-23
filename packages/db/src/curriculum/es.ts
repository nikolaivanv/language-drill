import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// TEMPORARILY REDUCED (2026-05-10): ES A1 + A2 grammar entries and the A2
// vocab umbrella are commented out so the prod scheduler stops generating
// them. To restore: uncomment the A1/A2 sections below, restore A1/A2 in the
// destructure, bump ES back in PER_LANGUAGE_GRAMMAR_MIN (curriculum/index.ts),
// restore ES A2 entries in SEED_KEY_TO_GRAMMAR_POINT (seed-exercises.ts), and
// re-enable the per-language counts assertions for Spanish (curriculum.test.ts).
const ES = Language.ES;
const { B1, B2 } = CefrLevel;

/**
 * Per-language curriculum version. Bump in the same commit as any edit to
 * this file's grammar entries (analogous to `*_PROMPT_VERSION` in
 * `packages/ai/src/`). The scheduler in `infra/lambda/src/generation/`
 * compares this to the value recorded on the most recent succeeded
 * generation_jobs row for each cell — when they differ, any
 * "saturated-dedup" or "low-yield" suppression on that cell clears, on the
 * assumption that the curriculum edit may have unblocked the search space.
 */
export const CURRICULUM_VERSION_ES = '2026-05-23';

const esCurriculum: readonly GrammarPoint[] = [
  /*
  // ---------------------------------------------------------------------------
  // A1
  // ---------------------------------------------------------------------------
  {
    key: 'es-a1-present-indicative-regular',
    kind: 'grammar',
    name: 'Present indicative — regular verbs',
    description:
      'Conjugation of regular -ar, -er, -ir verbs in the present indicative across all six persons.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Yo hablo español todos los días.', 'Nosotros comemos a las dos.'],
    examplesNegative: ['*Yo habla español todos los días.'],
    commonErrors: [
      'Using the third-person form for first person (e.g. "yo habla" instead of "yo hablo").',
      'Confusing -er and -ir endings in the nosotros form.',
    ],
  },
  {
    key: 'es-a1-ser-estar-basic',
    kind: 'grammar',
    name: 'ser vs. estar — basic uses',
    description:
      'Choosing ser for identity, origin, and inherent traits vs. estar for location and temporary states.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Soy de México.', 'Estoy cansado hoy.'],
    examplesNegative: ['*Estoy de México.'],
    commonErrors: [
      'Using estar for nationality or profession ("*estoy mexicano").',
      'Using ser for temporary location or mood ("*soy en casa").',
    ],
  },
  {
    key: 'es-a1-articles',
    kind: 'grammar',
    name: 'Definite and indefinite articles',
    description:
      'Selecting el/la/los/las and un/una/unos/unas to match noun gender and number.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['El libro está en la mesa.', 'Compré unas manzanas.'],
    examplesNegative: ['*El mesa está limpia.'],
    commonErrors: [
      'Assigning English-style invariant "the" instead of matching gender.',
      'Forgetting that "agua" takes "el" in the singular despite being feminine.',
    ],
  },
  {
    key: 'es-a1-gender-agreement',
    kind: 'grammar',
    name: 'Noun–adjective gender and number agreement',
    description:
      'Inflecting adjectives to match the gender and number of the noun they modify.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Una casa pequeña.', 'Los coches rojos son rápidos.'],
    examplesNegative: ['*Una casa pequeño.'],
    commonErrors: [
      'Leaving adjectives in masculine singular by default.',
      'Failing to pluralise adjectives that follow plural nouns.',
    ],
  },

  // ---------------------------------------------------------------------------
  // A2
  // ---------------------------------------------------------------------------
  {
    key: 'es-a2-preterite-regular',
    kind: 'grammar',
    name: 'Preterite — regular verbs',
    description:
      'Regular preterite (simple past) endings for -ar, -er, -ir verbs to narrate completed actions.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Ayer hablé con mi madre.', 'Comimos en el parque el sábado.'],
    examplesNegative: ['*Ayer hablo con mi madre.'],
    commonErrors: [
      'Confusing preterite endings with present tense (no accent on stressed final vowel).',
      'Mixing -er and -ir endings in the third person plural.',
    ],
    prerequisiteKeys: ['es-a1-present-indicative-regular'],
  },
  {
    key: 'es-a2-preterite-irregular',
    kind: 'grammar',
    name: 'Preterite — irregular verbs',
    description:
      'Irregular preterite stems and endings: ser/ir (fui), hacer (hice), tener (tuve), poder (pude), decir (dije), etc.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Ayer fui al cine.', 'No pudimos terminar a tiempo.'],
    examplesNegative: ['*Ayer fuí al cine.'],
    commonErrors: [
      'Adding regular endings to irregular stems ("*tení" instead of "tuve").',
      'Adding accent marks to irregular preterite forms that do not take them.',
      'Confusing the shared form of ser and ir in the preterite.',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
  },
  {
    key: 'es-a2-imperfect',
    kind: 'grammar',
    name: 'Imperfect tense',
    description:
      'Using the imperfect for habitual past actions, ongoing past states, and background description.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Cuando era niño, jugaba al fútbol.', 'Llovía mucho aquel día.'],
    examplesNegative: ['*Cuando era niño, jugué al fútbol todos los días.'],
    commonErrors: [
      'Using preterite for habitual or ongoing past actions where imperfect is required.',
      'Forgetting that ser, ir, and ver are the only fully irregular imperfects.',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
  },
  {
    key: 'es-a2-gustar-type-verbs',
    kind: 'grammar',
    name: 'gustar-type verbs',
    description:
      'Reverse-construction verbs (gustar, encantar, doler, faltar, importar) that agree with the thing liked, not the experiencer.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Me gustan las películas españolas.', 'A ella le encanta el chocolate.'],
    examplesNegative: ['*Yo gusto las películas españolas.'],
    commonErrors: [
      'Conjugating gustar as if the speaker were the subject ("*yo gusto").',
      'Forgetting plural agreement when the liked thing is plural ("*me gusta los libros").',
      'Omitting the indirect-object pronoun (me/te/le/nos/os/les).',
    ],
  },
  {
    key: 'es-a2-reflexive-verbs',
    kind: 'grammar',
    name: 'Reflexive verbs',
    description:
      'Pairing reflexive pronouns (me, te, se, nos, os, se) with verbs whose action returns to the subject.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Me levanto a las siete.', 'Se llama Carlos.'],
    examplesNegative: ['*Levanto a las siete.'],
    commonErrors: [
      'Dropping the reflexive pronoun for daily-routine verbs.',
      'Misplacing the pronoun after the verb in finite tenses ("*levantome").',
    ],
  },
  */

  // ---------------------------------------------------------------------------
  // B1
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-present-subjunctive',
    kind: 'grammar',
    name: 'Present subjunctive',
    description:
      'Present subjunctive after expressions of wish, doubt, emotion, and impersonal opinion (querer que, espero que, dudar que, es importante que).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Espero que estés bien.', 'Quiero que vengas a la fiesta.'],
    examplesNegative: ['*Espero que estás bien.'],
    commonErrors: [
      'Using the indicative after expressions that require subjunctive (querer que, esperar que).',
      'Forgetting the stem changes that carry over from the present indicative.',
      'Failing to switch the e/o stem vowels in the yo form.',
    ],
    // Restore when es-a1-present-indicative-regular is uncommented:
    // prerequisiteKeys: ['es-a1-present-indicative-regular'],
  },
  {
    key: 'es-b1-conditional',
    kind: 'grammar',
    name: 'Conditional simple',
    description:
      'Conditional tense for hypothetical situations, polite requests, and reported speech ("dijo que vendría").',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Yo iría contigo si pudiera.', '¿Podrías ayudarme, por favor?'],
    examplesNegative: ['*Yo iré contigo si pudiera.'],
    commonErrors: [
      'Substituting the future tense for the conditional in hypothetical statements.',
      'Forgetting the irregular stems shared with the future (tendría, haría, podría).',
    ],
  },
  {
    key: 'es-b1-llevar-time-expressions',
    kind: 'grammar',
    name: 'Time expressions with llevar and hace ... que',
    description:
      '"Llevo + period + gerund" and "hace + period + que + present" to express how long an action has been ongoing.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Llevo dos años estudiando español.',
      'Hace tres meses que vivo aquí.',
    ],
    examplesNegative: ['*He estudiado español por dos años.'],
    commonErrors: [
      'Calquing the English present perfect with "por" instead of using llevar or hace ... que.',
      'Mixing the gerund (llevo estudiando) with the infinitive ("*llevo estudiar").',
      'Conjugating the verb after "hace ... que" in the past instead of the present.',
    ],
  },
  {
    key: 'es-b1-relative-clauses',
    kind: 'grammar',
    name: 'Relative clauses',
    description:
      'Linking clauses with que, quien(es), donde, and lo que; restrictive vs. non-restrictive uses.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'El libro que leí ayer es interesante.',
      'La mujer con quien hablé es mi vecina.',
    ],
    examplesNegative: ['*El libro cual leí ayer es interesante.'],
    commonErrors: [
      'Using "cual" without an article in restrictive relative clauses.',
      'Choosing "quien" for inanimate antecedents.',
    ],
  },
  {
    key: 'es-b1-passive-se',
    kind: 'grammar',
    name: 'Passive and impersonal "se"',
    description:
      'The "se" construction for passive ("se venden libros") and impersonal generalisations ("se vive bien aquí").',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Se venden coches usados.', 'En España se cena tarde.'],
    examplesNegative: ['*Coches usados son vendidos aquí.'],
    commonErrors: [
      'Using the English-style "ser + past participle" passive where "se" is more idiomatic.',
      'Failing to make the verb agree with the plural noun in passive-se ("*se vende coches").',
    ],
  },
  {
    key: 'es-b1-comparatives-superlatives',
    kind: 'grammar',
    name: 'Comparatives and superlatives',
    description:
      'más/menos ... que, tan ... como, the absolute superlative -ísimo, and irregular forms (mejor, peor, mayor, menor).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Madrid es más grande que Sevilla.', 'Esta tarta está buenísima.'],
    examplesNegative: ['*Madrid es más grande de Sevilla.'],
    commonErrors: [
      'Using "de" instead of "que" in comparisons ("*más alto de mí").',
      'Saying "más bueno" instead of the suppletive form "mejor".',
    ],
  },

  // ---------------------------------------------------------------------------
  // B2
  // ---------------------------------------------------------------------------
  {
    key: 'es-b2-past-subjunctive',
    kind: 'grammar',
    name: 'Past (imperfect) subjunctive',
    description:
      'Imperfect subjunctive (-ara/-iera) after past-tense triggers, polite requests, and counterfactual "si" clauses.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['Si tuviera tiempo, viajaría más.', 'Esperaba que vinieras.'],
    examplesNegative: ['*Si tengo tiempo, viajaría más.'],
    commonErrors: [
      'Using present subjunctive after a past-tense main verb.',
      'Mixing the -ara and -iera stems incorrectly across conjugations.',
      'Pairing a counterfactual conditional with the indicative in the if-clause.',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive'],
  },
  {
    key: 'es-b2-compound-tenses',
    kind: 'grammar',
    name: 'Compound tenses with haber',
    description:
      'Perfect tenses formed with haber + past participle: present perfect, pluperfect, future perfect, conditional perfect.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['Habíamos terminado antes de las ocho.', 'Para mañana habré llegado.'],
    examplesNegative: ['*Yo soy terminado el trabajo.'],
    commonErrors: [
      'Forming the perfect with "ser" or "estar" instead of "haber".',
      'Inflecting the past participle for gender or number when used with haber.',
    ],
  },
  {
    key: 'es-b2-conditional-perfect',
    kind: 'grammar',
    name: 'Conditional perfect',
    description:
      '"Habría + participle" for hypothetical past actions and reported future-in-the-past, often paired with si + pluperfect subjunctive.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Yo habría actuado de otra manera.',
      'Si me lo hubieras dicho, te habría ayudado.',
    ],
    examplesNegative: ['*Yo habré actuado de otra manera.'],
    commonErrors: [
      'Using future perfect (habré) where conditional perfect (habría) is required.',
      'Pairing conditional perfect with the indicative pluperfect in counterfactuals.',
    ],
    prerequisiteKeys: ['es-b1-conditional', 'es-b2-compound-tenses'],
  },
  {
    key: 'es-b2-complex-conditionals',
    kind: 'grammar',
    name: 'Complex conditional sentences',
    description:
      'Counterfactual past conditionals: "si + pluperfect subjunctive, conditional perfect" (Si hubiera sabido, habría venido).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Si hubiera estudiado, habría aprobado.',
      'Si hubieras venido, te habrías divertido.',
    ],
    examplesNegative: ['*Si había estudiado, había aprobado.'],
    commonErrors: [
      'Using indicative pluperfect ("había") in the if-clause of counterfactual past conditionals.',
      'Mixing tenses across the two clauses (e.g. simple conditional in the result clause).',
    ],
    prerequisiteKeys: ['es-b2-past-subjunctive', 'es-b2-conditional-perfect'],
  },
  {
    key: 'es-b2-nuanced-ser-estar',
    kind: 'grammar',
    name: 'Nuanced ser vs. estar',
    description:
      'Adjectives that change meaning with ser vs. estar (ser listo / estar listo, ser aburrido / estar aburrido) and resultant-state estar with past participles.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'María es muy lista. (clever)',
      'María está lista. (ready)',
      'La puerta está cerrada.',
    ],
    examplesNegative: ['*María es lista para salir.'],
    commonErrors: [
      'Treating ser/estar as interchangeable for adjectives that flip meaning.',
      'Using ser with resultant-state past participles ("*la puerta es cerrada").',
    ],
    // Restore when es-a1-ser-estar-basic is uncommented:
    // prerequisiteKeys: ['es-a1-ser-estar-basic'],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
  /*
  {
    key: 'es-a2-everyday-vocab',
    kind: 'vocab',
    name: 'Everyday vocabulary (A2)',
    description:
      'High-frequency Spanish vocabulary for daily routines, food, family, weather, and basic shopping.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['desayunar', 'la panadería'],
    examplesNegative: ['*el panadería'],
    commonErrors: [
      'Confusing false friends like "embarazada" (pregnant) with "embarrassed".',
      'Mismatching gender on common nouns such as "el problema" (masculine despite -a).',
    ],
  },
  */
  {
    key: 'es-b1-environment-vocab',
    kind: 'vocab',
    name: 'Environment and society vocabulary (B1)',
    description:
      'Vocabulary for current affairs, environment, work, and social topics typical of B1 discussions.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['el medio ambiente', 'la contaminación'],
    examplesNegative: ['*la medio ambiente'],
    commonErrors: [
      'Calquing English compounds ("*el cambio del clima" instead of "el cambio climático").',
      'Confusing "asistir a" (to attend) with "atender" (to assist).',
    ],
  },
  {
    key: 'es-b2-abstract-noun-vocab',
    kind: 'vocab',
    name: 'Abstract noun vocabulary (B2)',
    description:
      'Abstract and academic-register nouns covering values, emotions, and reasoning typical of B2 essays and discussions.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['la sostenibilidad', 'el desarrollo'],
    examplesNegative: ['*la sustentabilidad social del mundo (overuse)'],
    commonErrors: [
      'Confusing "actualmente" (currently) with "actually" — use "en realidad" or "de hecho" for the latter.',
      'Overusing nominalisations from English ("*la realización" for "the fact that").',
    ],
  },
];

export { esCurriculum };
export default esCurriculum;
