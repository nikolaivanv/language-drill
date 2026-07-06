import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// ES A1/A2 restored at full PCIC parity (2026-07-06): level placement follows
// the Plan Curricular del Instituto Cervantes Gramática A1-A2 inventory;
// content is grounded in Butt & Benjamin, A New Reference Grammar of Modern
// Spanish. See docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md.
const ES = Language.ES;
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
 * Current value `2026-06-13` was bumped to clear `low-yield` suppression on the
 * two `personRotation`-flagged ES cloze cells that the 2026-06-12 person-rotation
 * change (#272) cannot otherwise reach: `es-b1-present-subjunctive` cloze (last
 * job approved 1 < 3) and `es-b2-compound-tenses` cloze (last job approved 2),
 * both recorded `2026-06-06` — matching the prior on-disk value, so suppression
 * never cleared and the rotation + 1.5× target raise never took effect on them.
 * `decideEnqueue` keys suppression-clearing on the curriculum version, NOT on
 * `GENERATION_PROMPT_VERSION`, so this off-label bump is the only routine way to
 * force a fresh attempt. Prior `2026-06-06` reflected the earlier ES B1/B2 audit.
 * Mirrors the TR bump in #275.
 *
 * `2026-06-15` adds the two `kind: 'dictation'` umbrellas (`es-b1-dictation`,
 * `es-b2-dictation`); the bump ensures the scheduler's low-yield / saturated-dedup
 * suppression cannot pre-empt the brand-new dictation cells.
 *
 * `2026-06-15b` adds the twelve `kind: 'free-writing'` topic umbrellas (six each
 * for B1/B2); the bump clears any low-yield / saturated-dedup suppression so the
 * brand-new free-writing cells run on the next scheduler tick.
 *
 * `2026-06-16` flags two verb-conjugation points (`es-b1-present-subjunctive`,
 * `es-b1-conditional`) with `conjugationSuitable: true`; the bump clears any
 * low-yield / saturated-dedup suppression so the new CONJUGATION cells run.
 *
 * `2026-06-17` clears saturated-dedup suppression on the stuck free-writing
 * cells so they re-evaluate under the lowered target.
 *
 * `2026-07-06`: ES A1/A2 restored and expanded to PCIC parity (21 A1 + 23 A2
 * grammar points, 10 vocab + 2 dictation + 6 free-writing umbrellas);
 * `es-b1-comparatives-superlatives` re-leveled to `es-a2-comparatives-superlatives`
 * per PCIC 2.5/6.1/15.3.8. Bump enumerates all new cells and clears any
 * suppression left from the 2026-05-10 reduction.
 */
export const CURRICULUM_VERSION_ES = '2026-07-06';

const esCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1 (PCIC-aligned; Tasks 2–4)
  // ---------------------------------------------------------------------------
  {
    key: 'es-a1-noun-gender',
    kind: 'grammar',
    name: 'Noun gender',
    description:
      'Noun gender: masculine -o / feminine -a, nouns in other vowels or consonants learned with their article, common exceptions (el problema, el día, la mano, la foto), and heteronym pairs (el padre / la madre).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['El problema es difícil.', 'Me duele la mano derecha.'],
    examplesNegative: ['*La problema es difícil.'],
    commonErrors: [
      'Treating every noun in -a as feminine ("*la problema", "*la día").',
      'Treating every noun in -o as masculine ("*el mano").',
      'Guessing the gender of nouns in -e or a consonant instead of learning it with the article.',
    ],
  },
  {
    key: 'es-a1-noun-plural',
    kind: 'grammar',
    name: 'Noun plural',
    description:
      'Plural formation: -s after a vowel (mesa → mesas, café → cafés), -es after a consonant (árbol → árboles) — including final -s in stressed syllables (país → países); nouns in stressed -í/-ú usually take -es (jabalí → jabalíes).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Conozco tres países interesantes.', 'Hay muchas ciudades grandes en España.'],
    examplesNegative: ['*Hay muchas ciudads grandes en España.'],
    commonErrors: [
      'Adding only -s to nouns ending in a consonant instead of -es ("*ciudads" for "ciudades").',
      'Leaving país unchanged in the plural instead of adding -es ("*los país" instead of "los países").',
      'Forgetting to change z to c before adding -es ("*lapizes" instead of "lápices").',
    ],
  },
  {
    key: 'es-a1-gender-agreement',
    kind: 'grammar',
    name: 'Noun-adjective agreement',
    description:
      'Agreement of descriptive adjectives with the noun in gender and number, including gentilicios like español/española that add -a versus invariable ones like marroquí, and the normal postnominal position of these adjectives.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Tengo un amigo español y una amiga española.', 'El chico marroquí y la chica marroquí viven aquí.'],
    examplesNegative: ['*Tengo una amiga español.'],
    commonErrors: [
      'Forgetting to add -a to gentilicios like español, inglés, or alemán in the feminine ("*una amiga español").',
      'Wrongly adding -a to invariable gentilicios ending in -í, such as marroquí ("*una amiga marroquía").',
      'Placing the adjective before the noun by analogy with English word order ("*una española amiga").',
    ],
  },
  {
    key: 'es-a1-articles',
    kind: 'grammar',
    name: 'Definite and indefinite articles',
    description:
      'Definite articles el/la/los/las and indefinite un/una/unos/unas; the contractions al and del; the article required before the subject of gustar; and its omission after impersonal hay.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Vamos al cine y volvemos del trabajo a las ocho.', 'Me gusta la música clásica.'],
    examplesNegative: ['*Hay la leche en la nevera.'],
    commonErrors: [
      'Failing to contract de + el and a + el into del and al ("*de el libro" instead of "del libro").',
      'Omitting the article before the subject of gustar ("*Me gusta chocolate" instead of "me gusta el chocolate").',
      'Inserting an article after impersonal hay ("*hay la leche" instead of "hay leche").',
    ],
  },
  {
    key: 'es-a1-demonstratives',
    kind: 'grammar',
    name: 'Demonstratives',
    description:
      'Demonstrative adjectives/pronouns este/ese/aquel (and neuter esto/eso/aquello) marking near-speaker, near-listener, and distant deixis; demonstratives replace rather than combine with the definite article.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Este libro es mío.', '¿Qué es eso que tienes en la mano?'],
    examplesNegative: ['*El este libro es mío.'],
    commonErrors: [
      'Combining a demonstrative with the definite article ("*el este libro" instead of "este libro").',
      'Using the neuter esto/eso/aquello to refer to a specific person or noun instead of the gendered form ("*esto es mi profesor" instead of "este es mi profesor").',
      'Treating ese and aquel as fully interchangeable regardless of distance from speaker and listener.',
    ],
  },
  {
    key: 'es-a1-possessives-atonic',
    kind: 'grammar',
    name: 'Possessive adjectives (short forms)',
    description:
      'Short-form possessives mi/tu/su/nuestro/vuestro, agreeing in number and, for nuestro/vuestro, gender with the thing possessed; placed before the noun with no article; and the several possible meanings of su/sus.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Nuestra casa es grande.', '¿Dónde está tu coche?'],
    examplesNegative: ['*La mi casa es grande.'],
    commonErrors: [
      'Using a possessive where Spanish prefers the definite article, especially with body parts ("*me duele mi cabeza" instead of "me duele la cabeza").',
      'Wrongly making mi/tu/su agree in gender the way nuestro/vuestro do ("*mia hermana" instead of "mi hermana").',
      'Assuming su can only mean "his," missing that it also covers "her," "your" (usted/ustedes), and "their."',
    ],
  },
  {
    key: 'es-a1-subject-pronouns',
    kind: 'grammar',
    name: 'Subject pronouns',
    description:
      'Subject pronouns yo, tú, él/ella, usted, nosotros/as, vosotros/as, ellos/ellas, ustedes; normally omitted because the verb ending marks the subject, and used only for emphasis, contrast, or after ser.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Hablo español y un poco de inglés.', 'Yo estudio biología, pero él estudia física.'],
    examplesNegative: ['*Yo hablo español y yo vivo en Madrid y yo trabajo mucho.'],
    commonErrors: [
      'Inserting a subject pronoun before every verb by analogy with English ("*yo hablo, yo vivo, yo trabajo" instead of just conjugating the verb).',
      'Omitting the pronoun in a context that needs it for contrast between two different subjects.',
      'Confusing tú and usted register, using tú with strangers or authority figures where usted is expected.',
    ],
  },
  {
    key: 'es-a1-interrogatives',
    kind: 'grammar',
    name: 'Question words',
    description:
      'Interrogative words qué, quién(es), cuánto/a/os/as, dónde, cómo, and por qué, all written with an accent; verb-subject word order after them; and yes/no questions formed by intonation or inversion, with no helper verb.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['¿Dónde vives?', '¿Cuántas manzanas quieres?'],
    examplesNegative: ['*¿Donde tú vives?'],
    commonErrors: [
      'Forgetting the written accent on question words ("donde" instead of "dónde").',
      'Keeping subject-verb order instead of inverting after a question word ("*¿Dónde tú vives?" instead of "¿Dónde vives?").',
      'Trying to form yes/no questions with a helper verb as in English instead of inversion or rising intonation ("¿Vives aquí?").',
    ],
  },
  {
    key: 'es-a1-present-indicative-regular',
    kind: 'grammar',
    name: 'Present indicative (regular verbs)',
    description:
      'Present indicative of regular -ar, -er, and -ir verbs (hablar, comer, vivir) across all six persons; used for habitual actions, general truths, and near-future scheduled events.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Todos los días como fruta y bebo agua.', 'Mis amigos viven en Madrid y trabajan en un banco.'],
    examplesNegative: ['*Nosotros vivemos en Madrid.'],
    commonErrors: [
      'Using the -ar ending -as on -er verbs, producing "*tú comas" instead of "tú comes".',
      'Confusing the nosotros endings of -er and -ir verbs, producing "*vivemos" instead of "vivimos".',
      'Dropping the second-person -s ending by analogy with the minimal English conjugation, producing "*tú vive" instead of "tú vives".',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-a1-present-irregular-core',
    kind: 'grammar',
    name: 'Present indicative of ser, estar, haber, and ir',
    description:
      "Present indicative of the four irregular verbs ser (soy, eres, es...), estar (estoy, estás, está...), haber (only as hay 'there is/are'), and ir (voy, vas, va...); focuses on each verb's irregular yo-form and estar's accented endings.",
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Yo soy de Perú, pero ahora estoy en Chile.', '¿Adónde vas? Voy al mercado los sábados.'],
    examplesNegative: ['*Nosotros es de España.'],
    commonErrors: [
      'Conjugating ir as if it were regular, producing "*yo io" instead of the irregular "voy".',
      'Mismatching subject and verb ending in ser, writing "*nosotros es" instead of "nosotros somos".',
      "Treating hay as a normal verb that must agree in number with its following noun, instead of using the invariable form for both singular and plural (\"hay un libro\" / \"hay dos libros\").",
    ],
  },
  {
    key: 'es-a1-ser-estar-basic',
    kind: 'grammar',
    name: 'Ser and estar (basic contrast)',
    description:
      'Basic ser/estar contrast: ser for identity, profession, nationality or origin, and clock time; estar for location and for physical or emotional condition, including bien/mal; ser + adjectives of inherent nature vs. estar + adjectives of temporary state.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Soy profesora y soy de Colombia.', 'Mi hermano está en el hospital porque está enfermo.'],
    examplesNegative: ['*Mi hermano es en el hospital.'],
    commonErrors: [
      'Using ser for location instead of estar, e.g. "*el banco es cerca de mi casa" instead of "el banco está cerca de mi casa".',
      'Using estar for identity or profession, e.g. "*yo estoy profesor" instead of "yo soy profesor".',
      'Answering "¿Cómo estás?" with the wrong copula, saying "*soy bien" instead of "estoy bien".',
    ],
  },
  {
    key: 'es-a1-hay-estar',
    kind: 'grammar',
    name: 'Hay vs. estar',
    description:
      'Existential hay (invariable, only third person, no article) for indefinite or unspecified things vs. estar for a definite item already identified by an article, possessive, or demonstrative: hay un libro en la mesa vs. el libro está en la mesa.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Hay un banco en esta calle.', 'El banco está al lado de la farmacia.'],
    examplesNegative: ['*Hay el banco en esta calle.'],
    commonErrors: [
      'Using hay with a definite article, demonstrative, or possessive, e.g. "*hay el banco" instead of "está el banco" or simply "hay un banco".',
      'Using estar for an indefinite noun that has not been mentioned before, e.g. "*está una farmacia cerca" instead of "hay una farmacia cerca".',
      'Trying to pluralize hay to agree with a plural noun, e.g. "*han dos bancos" instead of the invariable "hay dos bancos".',
    ],
  },
  {
    key: 'es-a1-gustar-basic',
    kind: 'grammar',
    name: 'Gustar-type verbs',
    description:
      'Basic likes and dislikes with gustar: me/te gusta + singular noun or infinitive, me/te gustan + plural noun. The thing liked is the grammatical subject and takes the definite article (Me gusta la paella).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Me gusta el café por la mañana.', 'Te gusta el café por la mañana.'],
    examplesNegative: ['*Me gustan bailar.'],
    commonErrors: [
      'Treating gustar like a regular subject-verb construction, e.g. "*yo gusto el café" instead of "me gusta el café", forgetting that the person who likes something is the indirect object, not the subject.',
      'Failing to make gustar agree with a plural subject noun, saying "*me gusta los libros" instead of "me gustan los libros".',
      'Wrongly pluralizing gustar before an infinitive subject, saying "*me gustan bailar" instead of the invariable singular "me gusta bailar".',
    ],
  },
  {
    key: 'es-a1-querer-poder-infinitive',
    kind: 'grammar',
    name: 'Querer and poder with the infinitive',
    description:
      'Querer and poder followed directly by an infinitive with no linking preposition (quiero viajar, puedo ayudarte); the infinitive used as a singular masculine subject (viajar es caro); and creer que + indicative to state a belief.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Quiero aprender español este año.', 'Creo que puedes hacerlo sin problema.'],
    examplesNegative: ['*Quiero a viajar a México.'],
    commonErrors: [
      'Inserting an unnecessary preposition between querer/poder and the infinitive, e.g. "*quiero a viajar" instead of "quiero viajar", by analogy with verbs like ir a or aprender a.',
      'Using the gerund instead of the infinitive as a subject, e.g. "*viajando es caro" instead of "viajar es caro".',
      'Following creer que with the subjunctive by analogy with expressions of doubt, e.g. "*creo que sea verdad" instead of the indicative "creo que es verdad".',
    ],
  },
  {
    key: 'es-a1-numbers-ordinals',
    kind: 'grammar',
    name: 'Cardinal and ordinal numbers',
    description:
      'Cardinal numbers, including gender agreement of uno and -cientos with the counted noun (doscientas mujeres, veintiún libros); and ordinal numbers primero to décimo, which agree in gender/number and shorten before a masculine singular noun.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Necesito doscientas sillas para la fiesta.', 'Vivo en el tercer piso.'],
    examplesNegative: ['*Necesito doscientos sillas para la fiesta.'],
    commonErrors: [
      'Leaving -cientos in the masculine regardless of the noun\'s gender, e.g. "*doscientos mujeres" instead of "doscientas mujeres".',
      'Forgetting to drop the final -o of primero/tercero before a masculine singular noun, e.g. "*el primero piso" instead of "el primer piso".',
      'Using uno instead of the shortened un before a masculine noun in compound numbers, e.g. "*veintiuno libros" instead of "veintiún libros".',
    ],
  },
  {
    key: 'es-a1-quantifiers-muy-mucho',
    kind: 'grammar',
    name: 'Quantifiers and muy vs. mucho',
    description:
      'Quantifiers mucho, poco, and bastante used as adjectives agreeing with the noun they quantify (mucha gente, pocos días); muy as the invariable adverb before adjectives and adverbs, contrasted with mucho used after a verb.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Tengo mucha hambre y poco tiempo.', 'Este libro es muy interesante y me gusta mucho.'],
    examplesNegative: ['*Este libro es mucho interesante.'],
    commonErrors: [
      'Using mucho instead of muy before an adjective or adverb, e.g. "*mucho interesante" instead of "muy interesante".',
      'Leaving mucho/poco unagreed with a feminine or plural noun, e.g. "*mucho gente" instead of "mucha gente".',
      'Using muy before a verb instead of mucho, e.g. "*me gusta muy" instead of "me gusta mucho".',
    ],
  },

  // ---------------------------------------------------------------------------
  // A2 (PCIC-aligned; Tasks 5–7)
  // ---------------------------------------------------------------------------
  {
    key: 'es-a2-comparatives-superlatives',
    kind: 'grammar',
    name: 'Comparatives',
    description:
      'Comparisons of superiority, inferiority, and equality: más/menos ... que, tan ... como, tanto/a/os/as ... como, and the irregular comparatives mejor, peor, mayor, menor.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Madrid es más grande que Sevilla.', 'Juan es tan alto como yo.'],
    examplesNegative: ['*Madrid es más grande de Sevilla.'],
    commonErrors: [
      'Using "de" instead of "que" in comparisons ("*más alto de mí").',
      'Saying "más bueno" instead of the suppletive form "mejor".',
      'Using "tan" before a noun where "tanto/a/os/as" is required ("*tan problemas como").',
    ],
  },

  // ---------------------------------------------------------------------------
  // B1
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-present-subjunctive',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    prerequisiteKeys: ['es-a1-present-indicative-regular'],
    sentenceConstructionSuitable: true,
    conjugationSuitable: true,
  },
  {
    key: 'es-b1-conditional',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    sentenceConstructionSuitable: true,
    conjugationSuitable: true,
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
    sentenceConstructionSuitable: true,
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

  // ---------------------------------------------------------------------------
  // B2
  // ---------------------------------------------------------------------------
  {
    key: 'es-b2-past-subjunctive',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    sentenceConstructionSuitable: true,
  },
  {
    key: 'es-b2-compound-tenses',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
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
    prerequisiteKeys: ['es-a1-ser-estar-basic'],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Dictation umbrellas — kind: 'dictation' (Phase 2 generation pipeline)
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B1)',
    description:
      'Natural B1 connected-speech clips (2–4 short sentences) on everyday domains; tests sinalefa, weak-syllable reduction, and common spelling traps.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'No te preocupes, el tiempo lo cura todo y mañana lo verás de otra manera.',
      'Quedamos a las ocho en la plaza y de ahí vamos andando al cine.',
    ],
    examplesNegative: ['*Clip de una sola palabra o lista inconexa sin oraciones naturales.'],
    commonErrors: [
      'Mis-segmenting word boundaries under sinalefa (hearing "lo cura" as "locura").',
      'Dropping the silent h or confusing b/v in spelling.',
    ],
  },
  {
    key: 'es-b2-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B2)',
    description:
      'Natural B2 connected-speech clips (3–5 sentences) with subordinate clauses and richer vocabulary; tests connected-speech tracking and spelling under faster delivery.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Aunque había estudiado mucho, en cuanto vio el examen se quedó en blanco y tuvo que respirar hondo.',
      'Me dijeron que, si llegábamos antes de las nueve, todavía habría sitio para aparcar cerca.',
    ],
    examplesNegative: ['*Texto demasiado largo o con vocabulario muy por encima de B2.'],
    commonErrors: [
      'Losing track of clause boundaries in longer sentences.',
      'Confusing similar-sounding connectors (aunque / a un que).',
    ],
  },

  // ---------------------------------------------------------------------------
  // Free-writing topic umbrellas — kind: 'free-writing' (Phase 2 generation)
  // One cell per (language, level, topic); register is author-declared, the word
  // band is CEFR-derived (FREE_WRITING_LENGTH_BY_CEFR in packages/ai).
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-fw-ideal-weekend',
    kind: 'free-writing',
    name: 'Mi fin de semana ideal',
    description: 'A friendly, informal prompt to describe an ideal weekend and why it appeals.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks the learner to describe plans and give one reason for each.',
      'Requires a closing sentence about how they would feel.',
    ],
    examplesNegative: ['*Write whatever you want about weekends.'],
    commonErrors: ['Prompt too open to score; no concrete checklist.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b1-fw-my-town',
    kind: 'free-writing',
    name: 'Mi ciudad',
    description: 'A neutral prompt to describe your town and what there is to do there.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for two places and what you can do in each.',
      'Requires a recommendation for a visitor.',
    ],
    examplesNegative: ['*Describe a city (any city, anything).'],
    commonErrors: ['Conflating "describe" with an unscoped free dump.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-daily-routine',
    kind: 'free-writing',
    name: 'Un día normal',
    description: 'A neutral prompt to narrate a typical day from morning to night.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for at least three moments of the day in order.',
      'Requires one thing they would like to change.',
    ],
    examplesNegative: ['*Tell me about your life.'],
    commonErrors: ['Scope too broad (whole life instead of one day).'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-favorite-meal',
    kind: 'free-writing',
    name: 'Mi comida favorita',
    description: 'An informal prompt to describe a favourite dish and when the learner eats it.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks what the dish is and why they like it.',
      'Requires naming who they usually eat it with.',
    ],
    examplesNegative: ['*Write about food.'],
    commonErrors: ['Listing ingredients instead of a connected paragraph.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b1-fw-a-trip',
    kind: 'free-writing',
    name: 'Un viaje que recuerdo',
    description: 'A neutral prompt to narrate a memorable trip and one thing that happened.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks where and when, plus one memorable event.',
      'Requires a closing sentence on whether they would return.',
    ],
    examplesNegative: ['*Describe travelling in general.'],
    commonErrors: ['Generic travel essay with no specific trip.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-free-time',
    kind: 'free-writing',
    name: 'Mi tiempo libre',
    description: 'An informal prompt to describe what the learner does for fun and why.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for two activities and how often they do them.',
      'Requires one activity they would like to try.',
    ],
    examplesNegative: ['*Hobbies.'],
    commonErrors: ['One-word answers instead of a paragraph.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b2-fw-remote-work',
    kind: 'free-writing',
    name: 'El teletrabajo: ¿avance o aislamiento?',
    description: 'A formal opinion prompt weighing the benefits and drawbacks of remote work.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a clear thesis plus one supporting and one opposing argument.',
      'Requires a concluding sentence that restates the position.',
    ],
    examplesNegative: ['*Write your opinion about work.'],
    commonErrors: ['Prompt too open to score; no required structure.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-environment',
    kind: 'free-writing',
    name: 'El medio ambiente y las decisiones individuales',
    description: 'A formal prompt arguing whether individual choices can affect the environment.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a position plus two concrete examples.',
      'Requires one counter-argument and a response to it.',
    ],
    examplesNegative: ['*Talk about the environment.'],
    commonErrors: ['Listing facts with no argued position.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-technology-relationships',
    kind: 'free-writing',
    name: 'La tecnología y las relaciones humanas',
    description: 'A formal prompt on whether technology brings people closer or pushes them apart.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a thesis plus two reasons with examples.',
      'Requires a concessive paragraph acknowledging the other view.',
    ],
    examplesNegative: ['*Is technology good or bad?'],
    commonErrors: ['Yes/no framing with no developed argument.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-study-abroad',
    kind: 'free-writing',
    name: '¿Estudiar en casa o en el extranjero?',
    description: 'A neutral prompt comparing studying at home versus abroad and recommending one.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for two advantages of each option.',
      'Requires a justified recommendation at the end.',
    ],
    examplesNegative: ['*Studying abroad.'],
    commonErrors: ['Describing only one side; no comparison.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b2-fw-social-media',
    kind: 'free-writing',
    name: 'Las redes sociales en la vida diaria',
    description: 'A formal prompt arguing how social media shapes everyday life, for better or worse.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a position plus two effects with examples.',
      'Requires a suggestion for healthier use.',
    ],
    examplesNegative: ['*Social media is bad. Discuss.'],
    commonErrors: ['One-sided rant with no nuance or examples.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-work-life-balance',
    kind: 'free-writing',
    name: 'Trabajo y vida personal',
    description: 'A neutral prompt on how to balance work and personal life and why it matters.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for two strategies and why each helps.',
      'Requires one obstacle and how to handle it.',
    ],
    examplesNegative: ['*Work-life balance.'],
    commonErrors: ['Abstract platitudes with no concrete strategies.'],
    freeWriting: { register: 'neutral' },
  },
];

export { esCurriculum };
export default esCurriculum;
