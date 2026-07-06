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
 *
 * `2026-07-07`: ES B1/B2 expanded to PCIC B1-B2 parity (14 new B1 + 18 new B2
 * grammar points; 5 existing points rescoped — pluperfect moved out of
 * es-b2-compound-tenses to a new B1 point). Bump enumerates the new cells and
 * clears suppression on the rescoped cells so they re-run under the new
 * descriptions. See docs/superpowers/specs/2026-07-06-es-b1-b2-pcic-curriculum-design.md.
 */
export const CURRICULUM_VERSION_ES = '2026-07-07';

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
  {
    key: 'es-a1-negation-tampoco',
    kind: 'grammar',
    name: 'Negation with no, sí/no answers, and también/tampoco',
    description:
      'Sentence negation with no placed immediately before the verb; sí/no as short answers to yes/no questions; and the también/tampoco pair for agreeing with a preceding affirmative (también) or negative (tampoco) statement.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['No tengo hermanos.', 'Me gusta el café, y a Marta también.', 'No bebo alcohol, y mi hermano tampoco.'],
    examplesNegative: ['*Tampoco no tengo coche.'],
    commonErrors: [
      'Using también instead of tampoco to agree with a negative statement, e.g. "*no tengo hermanos, y él también" instead of "y él tampoco".',
      'Producing a double preceding negative by combining tampoco with no, e.g. "*tampoco no tengo coche" instead of "tampoco tengo coche" or "no tengo coche tampoco".',
      'Answering a negative question with just "no" and dropping the second no before the verb, e.g. answering "¿no tienes coche?" with "No, tengo" instead of "No, no tengo".',
    ],
  },
  {
    key: 'es-a1-relative-que-basic',
    kind: 'grammar',
    name: 'Relative clauses with que (restrictive)',
    description:
      'Restrictive relative clauses with the invariable pronoun que, used to identify a noun as the clause subject or direct object, with the relativized verb in the present indicative; que is obligatory and can never be omitted the way English "that/which" often is.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['El chico que vive aquí es mi primo.', 'El libro que leo es muy interesante.'],
    examplesNegative: ['*El libro leo es muy interesante.'],
    commonErrors: [
      'Omitting que when it functions as a direct object, by analogy with English relative-pronoun deletion, e.g. "*el libro leo" instead of "el libro que leo".',
      'Treating que as if it changes form to agree with the antecedent\'s gender or number, when it is actually invariable.',
      'Separating the antecedent from its que-clause, e.g. "*el chico es simpático que vive aquí" instead of keeping them together: "el chico que vive aquí es simpático".',
    ],
  },
  {
    key: 'es-a1-noun-modifiers-de',
    kind: 'grammar',
    name: 'Noun modifiers with de and con',
    description:
      'Noun-modifying de: compound nouns without an article (el libro de español), possessive de contracted with the article (la página del libro), and con describing a permanent feature a noun has (una casa con jardín).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Tengo un libro de español.', 'La página del libro está rota.', 'Vivo en una casa con jardín.'],
    examplesNegative: ['*La página de el libro está rota.'],
    commonErrors: [
      'Failing to contract de + el to del, e.g. "*la página de el libro" instead of "la página del libro".',
      'Using con instead of de to attach a noun modifier describing what something is made of or its type, e.g. "*un libro con español" instead of "un libro de español".',
      'Inserting an article after de in a compound noun, e.g. "*un libro de el español" instead of "un libro de español".',
    ],
  },
  {
    key: 'es-a1-coordination-basic',
    kind: 'grammar',
    name: 'Basic coordinators: y, o, pero, ni, unos...otros',
    description:
      'Basic sentence coordinators: y (and) and o (or) linking two items or clauses, pero (but) contrasting two clauses, ni...ni joining two negated elements, and the correlative unos...otros contrasting two parts of a group.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Estudio español y trabajo en un banco.',
      'No como carne ni pescado.',
      'Unos vecinos son simpáticos, otros no.',
      'Quiero salir, pero llueve mucho.',
    ],
    examplesNegative: ['*Como carne ni pescado.'],
    commonErrors: [
      'Using ni to join two items after an affirmative verb without a preceding negative, e.g. "*como carne ni pescado" instead of "no como carne ni pescado".',
      'Using o instead of the correlative unos...otros when contrasting two parts of a group, e.g. "*unos vecinos son simpáticos o no" instead of "unos vecinos son simpáticos, otros no".',
      'Confusing pero with y when the two ideas contrast rather than simply add on, e.g. "*quiero salir y llueve mucho" instead of "quiero salir, pero llueve mucho".',
    ],
  },
  {
    key: 'es-a1-porque-para',
    kind: 'grammar',
    name: 'Porque, para + infinitive, and por qué',
    description:
      'Porque (because) introducing a cause with an indicative verb, para + infinitive expressing purpose, and the porque/por qué contrast: porque (one word) states a reason while por qué (two words, stressed qué) asks or reports why.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['No voy a la fiesta porque estoy cansado.', 'Estudio español para viajar a México.', '¿Por qué llegas tarde?'],
    examplesNegative: ['*Estudio español para viajo a México.'],
    commonErrors: [
      'Following para with a conjugated verb instead of the infinitive when the subject stays the same, e.g. "*estudio español para viajo a México" instead of "estudio español para viajar a México".',
      'Using para + infinitive to express a cause instead of a purpose, e.g. "*estoy cansado para trabajar mucho" (intending "because I work a lot") instead of "estoy cansado porque trabajo mucho".',
      'Confusing porque and por qué, e.g. "*no sé porque llegas tarde" instead of "no sé por qué llegas tarde" when reporting the reason for something.',
    ],
  },
  {
    key: 'es-a1-prepositions-a-en',
    kind: 'grammar',
    name: 'Prepositions a vs. en',
    description:
      'Static location with en (estoy en casa, el libro está en la mesa) contrasted with motion or direction with a after verbs like ir/llegar (voy a Madrid, llegamos a la escuela); and a fixing a clock time (a las ocho).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Estoy en casa.', 'Voy a Madrid mañana.', 'La clase empieza a las ocho.'],
    examplesNegative: ['*Estoy a casa.', '*Voy en Madrid mañana.'],
    commonErrors: [
      'Using a for a static location instead of en, e.g. "*estoy a casa" instead of "estoy en casa".',
      'Using en for motion or direction instead of a, e.g. "*voy en Madrid" instead of "voy a Madrid".',
      'Omitting a before a clock time, e.g. "*la clase empieza las ocho" instead of "la clase empieza a las ocho".',
    ],
  },

  // ---------------------------------------------------------------------------
  // A2 (PCIC-aligned; Tasks 5–7)
  // ---------------------------------------------------------------------------
  {
    key: 'es-a2-present-irregular-stem-changes',
    kind: 'grammar',
    name: 'Present indicative — irregular stem changes',
    description:
      'Present-tense stem changes e→ie (pensar), o→ue (poder), and e→i (pedir) in all persons except nosotros/vosotros; the irregular yo-forms of saber (sé) and dar (doy); and orthographic yo-form changes before o/a (coger → cojo, seguir → sigo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Pienso que tienes razón.',
      'Ella puede venir mañana, pero yo no puedo.',
      'Pido un café con leche.',
      'Yo sé cocinar, pero no sé bailar.',
      'Te doy mi número de teléfono.',
    ],
    examplesNegative: ['*Ella piensa que nosotros piensamos lo mismo.', '*Yo sabo la respuesta.'],
    commonErrors: [
      'Overapplying the stem change to the nosotros/vosotros forms, producing "*piensamos" instead of "pensamos".',
      'Regularizing an irregular yo-form, producing "*yo sabo" or "*yo do" instead of "sé" and "doy".',
      'Missing the orthographic g→j or gu→g change in the yo-form of -ger/-gir/-guir verbs, producing "*cogo" or "*seguo" instead of "cojo" and "sigo".',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-preterite-regular',
    kind: 'grammar',
    name: 'Preterite — regular verbs',
    description:
      'Regular pretérito indefinido endings for -ar/-er/-ir verbs to narrate completed actions at a specific past time (ayer, el sábado). The stressed final vowel distinguishes it from the present (hablo / habló).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['Ayer hablé con mi madre.', 'Comimos en el parque el sábado.'],
    examplesNegative: ['*Ayer hablo con mi madre.'],
    commonErrors: [
      'Dropping the written accent that distinguishes preterite from present (hablo / habló).',
      'Mixing -er and -ir endings across persons.',
      'Using the preterite for habitual past actions where the imperfect is required.',
    ],
    prerequisiteKeys: ['es-a1-present-indicative-regular'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-preterite-irregular',
    kind: 'grammar',
    name: 'Preterite — irregular verbs',
    description:
      'Irregular preterite stems tener (tuve), hacer (hice/hizo), and estar (estuve), which take unstressed first- and third-person singular endings; the shared fui/fuiste/fue forms of ser and ir; and the accent-free preterites vi/vio (ver) and di/dio (dar).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Ayer hice la tarea y tuve que quedarme en casa.',
      'Ayer fuimos al museo, y la visita fue muy interesante.',
      'Vi la película y luego le di mi opinión.',
    ],
    examplesNegative: ['*Ayer yo hací la tarea.'],
    commonErrors: [
      'Regularizing the irregular preterite stems, producing forms like "*hací" or "*tení" instead of "hice" and "tuve".',
      'Adding an unnecessary written accent to the monosyllabic-looking preterites dio and vio ("*dió", "*vió").',
      'Grafting the regular -ió ending onto an irregular stem, producing "*tuvió" or "*hizió" instead of "tuvo" and "hizo".',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-imperfect',
    kind: 'grammar',
    name: 'Imperfect',
    description:
      'Imperfect tense for descriptions, background states, and habitual past actions (cuando era niño, íbamos a la playa cada verano); the three irregular imperfects ser (era), ir (iba), and ver (veía); and its contrast with the preterite for a single completed event.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Cuando era niño, iba a la playa todos los veranos.',
      'Mientras yo leía, mi hermana veía la televisión.',
      'Llovía mucho cuando llegamos a casa.',
    ],
    examplesNegative: ['*Cuando fui niño, iba a la playa todos los veranos.'],
    commonErrors: [
      'Using the preterite instead of the imperfect for a background description or an ongoing state, e.g. "*cuando fui niño" instead of "cuando era niño".',
      'Regularizing the irregular imperfects, producing "*ia" instead of "iba" or "*veiba" instead of "veía".',
      'Keeping a one-time interrupting event in the imperfect instead of switching to the preterite, e.g. "*mientras leía, mi hermana entraba" when a single entrance is meant.',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-preterito-perfecto',
    kind: 'grammar',
    name: 'Pretérito perfecto',
    description:
      'Present perfect (pretérito perfecto): haber + past participle for actions within a period that includes now; the irregular participles hecho, escrito, and visto; and the time markers ya, todavía no, and hoy that anchor it to the present.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Hoy he hecho mucho ejercicio.',
      'Todavía no he escrito la carta.',
      '¿Ya has visto la nueva película?',
    ],
    examplesNegative: ['*Hoy he escribido la carta.'],
    commonErrors: [
      'Regularizing irregular participles: "*hacido" for "hecho", "*escribido" for "escrito", "*veído" for "visto".',
      'Making the past participle agree in gender/number with the subject when used with haber, e.g. "*he hecha la tarea" instead of "he hecho la tarea".',
      'Using the simple preterite (hice) instead of the perfect when a marker like ya, todavía no, or hoy signals a period that still includes the present.',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
  },
  {
    key: 'es-a2-imperative-affirmative',
    kind: 'grammar',
    name: 'Affirmative imperative',
    description:
      'Affirmative imperative: regular tú (habla, come, vive) and vosotros (hablad, comed, vivid) forms; the eight irregular tú forms di, haz, pon, sal, ten, ven, sé, ve; usted/ustedes forms built on the present subjunctive; and enclitic pronouns (cómpralo, dímelo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Habla más despacio, por favor.',
      'Ven aquí y ponte el abrigo.',
      'Cómprelo usted en la farmacia.',
    ],
    examplesNegative: ['*Comes más despacio, por favor.'],
    commonErrors: [
      'Adding the indicative -s ending to the tú imperative by analogy with the present tense, producing "*comes" or "*hablas" instead of "come" and "habla".',
      'Regularizing the eight irregular tú imperatives, producing "*dice", "*hace", "*pone", or "*sale" instead of "di", "haz", "pon", and "sal".',
      'Placing the enclitic pronoun before the verb instead of attaching it, producing "*lo compra" instead of "cómpralo".',
    ],
  },
  {
    key: 'es-a2-estar-gerundio',
    kind: 'grammar',
    name: 'Estar + gerundio',
    description:
      'Gerund formation (-ando/-iendo, with stem changes like durmiendo/pidiendo and y-insertion like leyendo) combined with estar for the present/past continuous; and enclitic pronouns attached to the gerund (leyéndolo / lo estoy leyendo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Estoy leyendo un libro muy interesante.',
      'Estábamos durmiendo cuando sonó el teléfono.',
      'Estoy escribiéndola ahora mismo.',
    ],
    examplesNegative: ['*Estoy leendo un libro.'],
    commonErrors: [
      'Forgetting the y-insertion in gerunds of -er/-ir verbs whose stem ends in a vowel, producing "*leendo" instead of "leyendo".',
      'Missing the stem change in the gerund of pedir- and dormir-type verbs, producing "*pediendo" or "*dormiendo" instead of "pidiendo" and "durmiendo".',
      'Dropping the written accent when two pronouns are attached to the gerund, producing "*leyendosela" instead of "leyéndosela".',
    ],
  },
  {
    key: 'es-a2-ir-a-future',
    kind: 'grammar',
    name: 'Ir a + infinitive',
    description:
      'The immediate/planned future with ir a + infinitive (voy a estudiar) and the present indicative marked by a future time expression (mañana salgo temprano) — the two everyday ways Spanish expresses future time without the morphological future tense.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Voy a estudiar español este verano.',
      'Mañana salgo temprano para el aeropuerto.',
      '¿Vas a venir a la fiesta?',
    ],
    examplesNegative: ['*Voy estudiar español este verano.'],
    commonErrors: [
      'Omitting the preposition a between ir and the infinitive, producing "*voy estudiar" instead of "voy a estudiar".',
      'Failing to conjugate ir irregularly before a, producing "*yo io a estudiar" instead of "voy a estudiar".',
      'Reaching for the morphological future (estudiaré) instead of the more natural ir a + infinitive or present-plus-marker in everyday speech.',
    ],
  },
  {
    key: 'es-a2-periphrases-obligation-aspect',
    kind: 'grammar',
    name: 'Obligation and aspect periphrases',
    description:
      'Modal and aspectual periphrases tener que (obligation), hay que (impersonal necessity), acabar de (to have just done), empezar a (to begin), volver a (to do again), and soler (habit); and the optional clitic shift (verlo / lo + conjugated verb).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Tengo que devolvértelo mañana.',
      'Suelo desayunar café con tostadas.',
      'Volvió a llamarme por la tarde.',
      'Acabo de terminar la tarea.',
    ],
    examplesNegative: ['*Lo hay que hacer.'],
    commonErrors: [
      'Shifting the clitic before hay que, producing "*lo hay que hacer" instead of the only correct form, "hay que hacerlo".',
      'Confusing volver a + infinitive ("to do again") with volver used literally ("to return"), or acabar de + infinitive ("to have just done") with acabar used literally ("to finish").',
      'Using soler outside the present and imperfect, where it does not occur, instead of rephrasing with normalmente or generalmente.',
    ],
  },
  {
    key: 'es-a2-direct-object-pronouns',
    kind: 'grammar',
    name: 'Direct object pronouns',
    description:
      'Direct object pronouns lo/la/los/las (plus neuter lo for ideas/predicates) agree with the noun replaced; proclisis before a conjugated verb (Lo veo) vs. enclisis on infinitives/gerunds/positive imperatives (verlo, cómpralo), and the periphrastic shift (lo voy a comprar / voy a comprarlo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Compré el libro y lo leí en un día.',
      'Quiero verlo mañana.',
      'Lo quiero ver mañana.',
      'Cómpralo si te gusta.',
    ],
    examplesNegative: ['*Compré la revista pero no lo leí.', '*Veolo cada día.'],
    commonErrors: [
      'Attaching the pronoun to a conjugated (finite) verb form instead of placing it before it, producing "*veolo" instead of "lo veo".',
      'Mismatching the pronoun\'s gender with the noun it replaces, e.g. "*no lo leí" for la revista (feminine) instead of "no la leí".',
      'Confusing the neuter lo (referring to a whole idea or clause) with the masculine lo, e.g. hesitating over "¿Sabes que llegó tarde?" "Sí, lo sé", where lo stands for the entire clause, not a masculine noun.',
    ],
  },
  {
    key: 'es-a2-indirect-object-pronouns-se',
    kind: 'grammar',
    name: 'Indirect object pronouns and se',
    description:
      'Indirect object pronouns le/les, the obligatory le→se before a third-person direct-object clitic (se lo doy, never *le lo doy), clitic doubling with a named indirect object (le di el libro a Juan), and the dative of possession replacing a possessive adjective (Se le rompió el brazo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Le doy el regalo a mi madre.',
      'Se lo doy a ella.',
      'Se le cayó el vaso a Juan.',
    ],
    examplesNegative: ['*Le lo doy a ella.', '*Les lo dije a mis padres.'],
    commonErrors: [
      'Keeping le/les before a third-person direct-object clitic instead of replacing it with se, producing "*le lo doy" or "*les lo dije" instead of "se lo doy" and "se lo dije".',
      'Confusing le/les (indirect object, gaining or losing) with lo/la/los/las (direct object) when the verb clearly involves someone benefiting or losing something, e.g. treating "le robaron la cartera" as if the person should be lo/la instead of le.',
      'Omitting the doubled le/les when the indirect object is a proper name or definite noun following the verb, producing the less natural "di el regalo a Juan" instead of the usual "le di el regalo a Juan".',
    ],
  },
  {
    key: 'es-a2-tonic-pronouns-prepositions',
    kind: 'grammar',
    name: 'Tonic pronouns after prepositions',
    description:
      'Tonic (prepositional) pronoun forms mí and ti after most prepositions (de mí, para ti), the fused forms conmigo/contigo replacing con + mí/ti, and the a mí/a ti reduplication used for emphasis or contrast alongside an unstressed clitic (A mí me gusta el café, pero a ti no).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Este regalo es para ti.',
      '¿Quieres venir conmigo al cine?',
      'A mí me encanta el chocolate, pero a ti no.',
    ],
    examplesNegative: ['*Este regalo es para tú.', '*¿Vienes con mí al cine?'],
    commonErrors: [
      'Using the subject pronoun tú instead of the tonic form ti after a preposition, producing "*para tú" instead of "para ti".',
      'Failing to fuse con with mí/ti, producing "*con mí" and "*con ti" instead of the mandatory conmigo and contigo.',
      'Dropping the accent on mí, confusing it with the possessive mi ("my"), e.g. writing "de mi" when the prepositional pronoun "de mí" is meant.',
    ],
  },
  {
    key: 'es-a2-personal-a',
    kind: 'grammar',
    name: 'Personal a',
    description:
      'Personal a before a direct object naming a specific person or pet (Vi a Juan, Conozco a tu hermana), omitted before unspecified people or non-human objects (Busco un médico, Vi el coche); and emphasizing a pronoun object with a + tonic pronoun still needs the clitic (Lo vi a él, not *Vi a él).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Vi a Juan en el parque.',
      'No conozco a tu hermana.',
      'Necesito un médico esta tarde.',
    ],
    examplesNegative: ['*Vi Juan en el parque.', '*Vi a él ayer.'],
    commonErrors: [
      'Omitting personal a before a specific human direct object, producing "*vi Juan ayer" instead of "vi a Juan ayer".',
      'Adding personal a before an indefinite person not yet identified, producing "*busco a un médico" when no particular doctor is meant.',
      'Treating a + tonic pronoun as a replacement for the clitic rather than an addition to it, producing "*vi a él" instead of "lo vi a él" (or simply "lo vi").',
    ],
  },
  {
    key: 'es-a2-reflexive-verbs',
    kind: 'grammar',
    name: 'Reflexive verbs',
    description:
      'Reflexive pronouns me/te/se/nos/os with daily-routine verbs (levantarse, ducharse, vestirse, acostarse), agreeing in person with the subject; placed before a conjugated verb (Me levanto a las siete) or attached to an infinitive, gerund, or positive imperative (levantarme, levantándome, levántate).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Me levanto a las siete todos los días.',
      'Ella se ducha antes de desayunar.',
      '¿A qué hora te acuestas?',
    ],
    examplesNegative: ['*Levanto a las siete.', '*Nos levanta muy temprano.'],
    commonErrors: [
      'Omitting the reflexive pronoun altogether, producing "*levanto a las siete" instead of "me levanto a las siete".',
      'Mismatching the pronoun and verb person, producing "*nos levanta" instead of "nos levantamos".',
      'Attaching the pronoun to a conjugated verb instead of placing it before it, producing "*duchome" instead of "me ducho".',
    ],
  },
  {
    key: 'es-a2-gustar-type-verbs',
    kind: 'grammar',
    name: 'Gustar-type verbs (extended)',
    description:
      'Extends the A1 me/te gusta pattern to the full series me/te/le/nos/os/les with encantar, doler, interesar; the verb agrees with the thing liked/hurting, not the person (Le duelen los pies); a + tonic reduplication clarifies or contrasts who is affected (A Juan le interesa la historia, a mí no).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Le duelen los pies después de correr.',
      'Nos encanta viajar en verano.',
      'A mí me interesa la política, pero a ella no le interesa nada.',
    ],
    examplesNegative: ['*Me duele los pies.', '*A Juan interesa la historia.'],
    commonErrors: [
      'Forgetting to make the verb agree with a plural subject noun, producing "*me duele los pies" instead of "me duelen los pies".',
      'Dropping the obligatory clitic when the a + tonic phrase is present, producing "*a Juan interesa la historia" instead of "a Juan le interesa la historia".',
      'Treating the person affected as the grammatical subject, e.g. "*yo encanto viajar" instead of "me encanta viajar" — the same reversal warned about for gustar in A1.',
    ],
    prerequisiteKeys: ['es-a1-gustar-basic'],
  },
  {
    key: 'es-a2-articles-use',
    kind: 'grammar',
    name: 'Article use and omission',
    description:
      'Article use/omission: the generic article with abstract/mass nouns; el/un before feminine tonic-a nouns (el aula) despite feminine gender; the definite article for clothing/possessions; and no article with professions (Es profesora) or unspecified mass/plural objects (Bebe agua).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'El aula de física está al final del pasillo.',
      'Mi hermana es profesora, pero es una profesora muy exigente.',
      'Antes de salir, se puso el abrigo y los guantes.',
      'El chocolate es malo para los perros.',
      'Bebe agua con las comidas.',
    ],
    examplesNegative: ['*La aula de física está al final del pasillo.', '*Mi hermana es una profesora.'],
    commonErrors: [
      'Using la instead of el before singular feminine nouns beginning with a stressed a- or ha- sound ("*la aula", "*la águila"), even though the noun stays grammatically feminine (las aulas, las águilas).',
      'Inserting a possessive where Spanish uses the definite article for clothing and personal belongings ("*se puso su abrigo" instead of "se puso el abrigo").',
      'Adding un/una before an unqualified profession noun after ser, on the model of English "she is a teacher" ("*es una profesora" for plain "es profesora"), then forgetting the article reappears once the noun is qualified ("es una profesora excelente").',
      'Adding an unneeded article with unspecified mass or plural objects ("*Bebo el agua con cada comida" when no specific water is meant).',
    ],
  },
  {
    key: 'es-a2-possessives-tonic',
    kind: 'grammar',
    name: 'Stressed possessives (mío, tuyo, suyo)',
    description:
      'Stressed possessive forms mío/tuyo/suyo/nuestro/vuestro agreeing with the thing possessed, used after a noun (un amigo mío), as possessive pronouns with the definite article (el mío, la tuya), and without the article directly after ser to state plain ownership (es mío).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Un amigo mío vive en Barcelona.',
      '—¿De quién es esta mochila? —Es mía.',
      'Tu maleta es azul; la mía es roja.',
    ],
    examplesNegative: ['*Un mi amigo vive en Barcelona.', '*Mía es roja; tu maleta es azul.'],
    commonErrors: [
      'Combining a short-form possessive with the indefinite article ("*un mi amigo" instead of "un amigo mío").',
      'Dropping the definite article when the stressed possessive is the subject or object of a verb ("*mía es roja" instead of "la mía es roja").',
      'Treating suyo/suya as unambiguous when context does not make the possessor clear, instead of clarifying with de él/de ella/de usted ("el coche suyo" can mean his, hers, yours, or theirs).',
    ],
  },
  {
    key: 'es-a2-todo-otro-quantifiers',
    kind: 'grammar',
    name: 'Todo, otro, demasiado, nada/nadie',
    description:
      "Todo/toda requiring a following article, possessive, or demonstrative for 'the whole/all' (todos los estudiantes); otro/otra never preceded by un/una (otro café); demasiado/a agreeing as an adjective (demasiados problemas) but invariable as an adverb; and nada/nadie as negative pronouns.",
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Toda la clase aprobó el examen.',
      'No quiero este café, ponme otro.',
      'Has traído demasiados libros para un solo viaje.',
      'No hay nadie en la oficina y no quiero nada de postre.',
    ],
    examplesNegative: ['*Todo los estudiantes llegaron tarde.', '*Ponme un otro café.'],
    commonErrors: [
      'Dropping or misagreeing the determiner after todo when it means "the whole of/all" ("*todo los estudiantes" instead of "todos los estudiantes").',
      'Inserting un/una before otro on the model of English "another" ("*un otro café" instead of "otro café").',
      'Leaving demasiado invariable before a noun instead of agreeing it in number and gender ("*demasiado problemas" instead of "demasiados problemas").',
    ],
  },
  {
    key: 'es-a2-temporal-clauses',
    kind: 'grammar',
    name: 'Temporal clauses: cuando, antes de, después de, desde, hasta',
    description:
      'Cuando + present indicative for habitual time relations (cuando llueve, cojo el paraguas); antes de / después de + infinitive with a shared subject; desde/desde que/desde hace for duration since a point or over a length of time (desde 2020 / desde hace tres años); and hasta for "until".',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Cuando llueve, cojo el paraguas.',
      'Antes de salir, apago las luces.',
      'Después de cenar, vemos la televisión.',
      'Vivo en Madrid desde 2020, y estudio español desde hace tres años.',
      'La tienda está abierta hasta las nueve de la noche.',
    ],
    examplesNegative: ['*Antes de salgo, apago las luces.', '*Vivo aquí desde tres años.'],
    commonErrors: [
      'Using a conjugated verb after antes de/después de instead of the infinitive when both clauses share the same subject ("*antes de salgo" instead of "antes de salir").',
      'Confusing desde (a starting point) with desde hace (a length of time): "*vivo aquí desde tres años" instead of "vivo aquí desde hace tres años".',
      'Dropping the accent on interrogative cuándo in direct or indirect questions, confusing it with the unaccented conjunction cuando ("*no sé cuando llega" instead of "no sé cuándo llega").',
    ],
  },
  {
    key: 'es-a2-si-present-conditional',
    kind: 'grammar',
    name: 'Open conditions with si + present',
    description:
      'Open conditional sentences: si + present indicative in the protasis, with present, future, or imperative in the apodosis (si llueve, me quedo / iré / quédate); si is never followed by the future tense; and the spelling contrast between si ("if") and sí ("yes"/emphatic).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Si llueve, me quedo en casa.',
      'Si tienes tiempo, llámame esta tarde.',
      'Si terminas pronto, iremos al cine.',
      '—¿Vienes a la fiesta? —Sí, claro que voy.',
    ],
    examplesNegative: ['*Si vendrás mañana, te espero en la estación.', '*¿Vienes a la fiesta? Si, claro que voy.'],
    commonErrors: [
      'Using the future tense after si in the same clause as the condition ("*si vendrás mañana" instead of "si vienes mañana").',
      'Dropping the accent on sí when it means "yes" or adds emphasis, confusing it with the conjunction si ("*Si, claro que voy" instead of "Sí, claro que voy").',
      'Translating English "if X, I would Y" literally with the conditional in the apodosis of a realistic open condition, instead of the present or future ("*si llueve, me quedaría en casa" instead of "si llueve, me quedo/me quedaré en casa").',
    ],
  },
  {
    key: 'es-a2-exclamatives-impersonals',
    kind: 'grammar',
    name: 'Exclamatives with qué and impersonal weather expressions',
    description:
      'Exclamative ¡Qué + adjective/adverb! (¡qué caro!, ¡qué bien!) and ¡Qué + noun! with no article (¡qué vida!); fixed exhortatives introduced by que (¡Que aproveche!); and impersonal weather verbs hace (hace calor/frío/sol) and estar with a temperature (estamos a quince grados).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      '¡Qué caro es este restaurante!',
      '¡Qué bien cocinas!',
      '¡Que tengas un buen viaje!',
      'Hace mucho calor en verano.',
      'Estamos a quince grados esta mañana.',
    ],
    examplesNegative: ['*¡Qué un día tan bonito hace!', '*El tiempo hace mucho calor hoy.'],
    commonErrors: [
      'Inserting un/una after qué in an exclamation ("*¡qué un día tan bonito!" instead of "¡qué día tan bonito!").',
      'Adding an explicit subject to the impersonal weather verb hacer ("*el tiempo hace calor" instead of simply "hace calor").',
      'Omitting a before the number when stating a temperature with estar ("*estamos quince grados" instead of "estamos a quince grados").',
    ],
  },
  {
    key: 'es-a2-connectors',
    kind: 'grammar',
    name: 'Connectors: e/u substitution, por eso, entonces',
    description:
      'Substitution of y with e before a word beginning with an /i/ vowel sound (Fernando e Ignacio) but not before the hie- glide (agua y hielo); substitution of o with u before a word beginning with o- or ho- (diez u once); and por eso / entonces to introduce a result or consequence.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Fernando e Ignacio llegaron tarde.',
      'Necesito diez u once minutos más.',
      'Compramos agua y hielo para la fiesta.',
      'Perdí el autobús; por eso llegué tarde.',
      'No tenía dinero, entonces pedí un préstamo.',
    ],
    examplesNegative: [
      '*Fernando y Ignacio llegaron tarde.',
      '*Necesito diez o once minutos más.',
      '*Compramos agua e hielo para la fiesta.',
    ],
    commonErrors: [
      'Failing to change y to e before a word beginning with an /i/ vowel sound ("*Fernando y Ignacio" instead of "Fernando e Ignacio").',
      'Over-applying the e-substitution to words beginning with the diphthong hie-, which keep y ("*agua e hielo" instead of "agua y hielo").',
      'Failing to change o to u before a word beginning with o- or ho- ("*diez o once" instead of "diez u once").',
    ],
  },
  {
    key: 'es-a2-indefinites-double-negation',
    kind: 'grammar',
    name: 'Indefinite/negative pairs and double negation',
    description:
      'The indefinite/negative pairs algo/nada, alguien/nadie, alguno/ninguno (apocopated algún/ningún), and siempre/nunca; a negative word placed after the verb requires a preceding no (No veo nada), but one placed before the verb drops it (Nunca voy, Nadie vino).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'No veo nada interesante en la tele.',
      'Nunca voy al cine los lunes.',
      '¿Tienes algún problema? No, no tengo ninguno.',
    ],
    examplesNegative: ['*Nadie no vino a la fiesta.'],
    commonErrors: [
      'Adding a redundant preceding no before a negative word that already precedes the verb, e.g. "*nadie no vino" instead of "nadie vino" or "no vino nadie".',
      'Dropping the preceding no when the negative word follows the verb, e.g. "*veo nada" instead of "no veo nada".',
      'Using the affirmative algo/alguien instead of the negative nada/nadie in a plain negated sentence, e.g. "*no tengo algo" instead of "no tengo nada".',
    ],
  },
  {
    key: 'es-a2-por-para',
    kind: 'grammar',
    name: 'Por vs. para',
    description:
      'The por/para contrast: por expresses cause or reason (lo hice por ti), exchange (cambio esto por aquello), duration (por dos años), and movement through a place (paso por el parque); para marks a recipient or a deadline (un regalo para ti, listo para el lunes).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Lo hice por ti, no por mí.',
      'Cambié mi coche por uno nuevo.',
      'Este regalo es para ti; lo necesito para el lunes.',
      'Caminamos por el parque todos los días.',
    ],
    examplesNegative: ['*Cambié mi coche para uno nuevo.'],
    commonErrors: [
      'Using para instead of por to express exchange or substitution, e.g. "*cambié mi coche para uno nuevo" instead of "cambié mi coche por uno nuevo".',
      'Using para instead of por to express the cause or reason behind an action, e.g. "*estoy triste para la noticia" instead of "estoy triste por la noticia".',
      'Using por instead of para to mark who something is intended for, e.g. "*este regalo es por ti" instead of "este regalo es para ti".',
    ],
  },
  {
    key: 'es-a2-mente-adverbs',
    kind: 'grammar',
    name: 'Adverbs in -mente',
    description:
      'Adverb formation: -mente added to the feminine adjective form (rápida → rápidamente) or invariable form (fácil → fácilmente, keeping any written accent); -mente drops from all but the last of coordinated adverbs (lenta y claramente); and the suppletive adverbs bien/mal.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Habla lenta y claramente.',
      'Explicó el problema fácilmente.',
      'Canta muy bien, pero baila mal.',
    ],
    examplesNegative: ['*Canta muy bueno.', '*Habla rápidomente.'],
    commonErrors: [
      'In careful written Spanish, keeping -mente on every coordinated adverb instead of dropping it from all but the last, e.g. writing "lentamente y claramente" instead of the preferred "lenta y claramente".',
      'Adding -mente to the masculine adjective form instead of the feminine, e.g. "*rápidomente" instead of "rápidamente".',
      'Using the adjective bueno/malo instead of the suppletive adverb bien/mal after a verb, e.g. "*canta muy bueno" instead of "canta muy bien".',
    ],
  },
  {
    key: 'es-a2-adjective-apocopation',
    kind: 'grammar',
    name: 'Adjective apocopation (buen, gran, algún...)',
    description:
      'Adjectives losing their final vowel before a masculine singular noun: bueno→buen, malo→mal, alguno→algún, ninguno→ningún (un buen cocinero, algún día); grande→gran before ANY singular noun regardless of gender (una gran ciudad); full forms are used elsewhere (el libro es bueno).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Es un buen cocinero, pero un mal conductor.',
      'Vivimos en una gran ciudad.',
      '¿Tienes algún libro sobre historia? No, no tengo ninguno.',
    ],
    examplesNegative: ['*Es un bueno cocinero.', '*Vivimos en una grande ciudad.'],
    commonErrors: [
      'Failing to shorten grande before a feminine singular noun, unlike bueno/malo which only shorten before masculine nouns, e.g. "*una grande ciudad" instead of "una gran ciudad".',
      'Leaving bueno/malo/alguno/ninguno unshortened before a masculine singular noun, e.g. "*un bueno cocinero" instead of "un buen cocinero".',
      'Shortening ninguno when it is used as a pronoun rather than as an adjective before a noun, e.g. "*no tengo ningún" instead of "no tengo ninguno".',
      'Confusing this pattern with the separately-taught shortening of primero/tercero (see cardinal/ordinal numbers) — a distinct set of words that follows the same apocopation rule.',
    ],
  },
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
      'Present subjunctive: forms (incl. inherited stem changes) after wish, doubt, emotion, and impersonal-judgement triggers (querer que, espero que, dudo que, es importante que), and in independent uses with ojalá (que) and quizá / tal vez.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Espero que estés bien.',
      'Quiero que vengas a la fiesta.',
      'Ojalá que encuentres trabajo pronto.',
    ],
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
      'Conditional simple: regular forms and the irregular stems shared with the future (tendría, haría, podría), used for polite requests (¿Podrías ayudarme?), modest opinions (yo diría que...), and advice (deberías + infinitive).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Yo diría que deberías consultar a un especialista antes de tomar esa decisión.',
      '¿Podrías ayudarme, por favor?',
    ],
    examplesNegative: ['*Deberías que consultes a un médico.'],
    commonErrors: [
      'Using the present or future tense instead of the conditional to soften a request (e.g. "¿Puedes ayudarme?" instead of "¿Podrías ayudarme?").',
      'Forgetting the irregular stems shared with the future (tendría, haría, podría).',
    ],
    sentenceConstructionSuitable: true,
    conjugationSuitable: true,
  },
  {
    key: 'es-b1-llevar-time-expressions',
    kind: 'grammar',
    name: 'Duration and time-span expressions',
    description:
      'Duration and time-span expressions: llevar + period + gerund (Llevo dos años estudiando), hace + period + que + present, tardar + period + en + infinitive (Tardé dos horas en llegar), and dentro de + period for time from now.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Llevo dos años estudiando español.',
      'Hace tres meses que vivo aquí.',
      'Tardamos casi tres horas en montar el armario nuevo.',
      'Dentro de dos semanas empezará el nuevo semestre.',
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
      'Restrictive relative clauses in the indicative: que vs quien (a quien for human objects: el chico a quien saludaste), donde with an expressed antecedent, and the restriction that proper names and tonic pronouns reject restrictive relatives.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'El compañero a quien recomendé para el puesto empieza mañana.',
      'La vecina que me prestó el taladro se mudó la semana pasada.',
      'Volvimos al café donde nos conocimos hace diez años.',
    ],
    examplesNegative: [
      '*Juan que vive aquí es mi vecino.',
      '*Los hombres quienes dijeron eso mintieron.',
    ],
    commonErrors: [
      'Using "quien(es)" in a restrictive clause without a preceding preposition (e.g. "*los hombres quienes dijeron eso" instead of "que dijeron eso").',
      'Choosing "quien" for inanimate antecedents instead of "que".',
      'Attaching a restrictive relative clause directly after a proper name or tonic pronoun (e.g. "*Juan que vive aquí").',
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
  {
    key: 'es-b1-futuro-simple',
    kind: 'grammar',
    name: 'Future simple',
    description:
      'Futuro imperfecto: regular endings on the infinitive (hablaré, comerás) and the irregular stems tendr-, saldr-, sabr-, podr-, har-, dir-; absolute future statements and the future of probability (Serán las once).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Mañana iré al médico a primera hora.', '¿Qué hora es? — Serán las once.'],
    examplesNegative: ['*Mañana teneré una reunión importante.'],
    commonErrors: [
      'Regularising irregular stems ("*teneré", "*saliré" instead of "tendré", "saldré").',
      'Reaching for ir a + infinitive in formal writing where the simple future is expected.',
      'Missing the written accent on the endings ("*hablare" instead of "hablaré").',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
    conjugationSuitable: true,
  },
  {
    key: 'es-b1-pluperfect',
    kind: 'grammar',
    name: 'Pluperfect (past perfect)',
    description:
      'Pluperfect: había + past participle for an event completed before another past reference point (Cuando llegamos ya se había ido), contrasted with the simple preterite for the later event.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Cuando llegamos a la estación, el tren ya había salido.',
      'Nos dimos cuenta de que ya habíamos visto esa película.',
    ],
    examplesNegative: ['*Cuando llegamos a la estación, el tren ya salió antes.'],
    commonErrors: [
      'Using the simple preterite for the earlier of two past events instead of the pluperfect ("*el tren ya salió" instead of "ya había salido").',
      'Forming the pluperfect with "ser" or "estar" instead of "haber".',
      'Inflecting the past participle for gender or number after haber ("*había salida").',
    ],
    prerequisiteKeys: ['es-a2-preterito-perfecto'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
  },
  {
    key: 'es-b1-past-narration',
    kind: 'grammar',
    name: 'Past narration: imperfecto/indefinido interplay',
    description:
      'Narrating in the past: imperfecto for background and indefinido for foregrounded events (Iba por la calle y me encontré con Ana), conato with iba a + infinitive interrupted by a preterite (Iba a salir cuando sonó el teléfono), and al + infinitivo for "on/when doing X" (Al llegar, lo vi).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Iba por la calle cuando de repente me encontré con Ana.',
      'Iba a salir de casa cuando sonó el teléfono.',
      'Al llegar a la oficina, vi que las luces ya estaban encendidas.',
    ],
    examplesNegative: ['*Iba por la calle cuando de repente me encontraba con Ana.'],
    commonErrors: [
      'Using the imperfect for a punctual, plot-advancing event instead of the indefinido ("*me encontraba con Ana" instead of "me encontré con Ana").',
      'Using the preterite of ir a + infinitive instead of the imperfect for an interrupted intention ("*fui a salir cuando sonó" instead of "iba a salir cuando sonó").',
      'Using a finite clause instead of al + infinitivo when the subjects match ("*cuando llegué, lo vi" instead of the more idiomatic "al llegar, lo vi").',
    ],
  },
  {
    key: 'es-b1-imperative-negative-pronouns',
    kind: 'grammar',
    name: 'Negative imperative and clitic pronoun placement',
    description:
      'Negative imperative formed with the present subjunctive plus proclitic pronouns (No te vayas, No me lo digas), contrasted with enclisis on the affirmative imperative, including multi-clitic forms with a written accent (díselo, dámelas).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['No te vayas todavía.', 'Díselo a tu hermana, no se lo ocultes.'],
    examplesNegative: ['*No vete todavía.'],
    commonErrors: [
      'Attaching the pronoun to a negative imperative instead of placing it before the verb ("*no vete" instead of "no te vayas").',
      'Using the plain affirmative imperative form after "no" instead of switching to the subjunctive ("*no ven" instead of "no vengas").',
      'Dropping the written accent when two pronouns are added to an affirmative imperative ("*diselo" instead of "díselo").',
    ],
    prerequisiteKeys: ['es-a2-imperative-affirmative'],
  },
  {
    key: 'es-b1-subjunctive-adverbial',
    kind: 'grammar',
    name: 'Subjunctive in adverbial clauses',
    description:
      'Subjunctive in temporal clauses with future reference (cuando llegues, not *cuando llegarás), antes de que and después de que + subjunctive, and purpose clauses with para que + subjunctive.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Te llamaré cuando llegue a casa.', 'Te lo explico para que lo entiendas.'],
    examplesNegative: ['*Te llamaré cuando llegaré a casa.'],
    commonErrors: [
      'Using the future indicative after "cuando" with future reference instead of the present subjunctive ("*cuando llegaré" instead of "cuando llegue").',
      'Using the indicative after "antes de que", which always requires the subjunctive.',
      'Using "para" + infinitive instead of "para que" + subjunctive when the clauses have different subjects.',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive'],
  },
  {
    key: 'es-b1-reported-speech',
    kind: 'grammar',
    name: 'Reported speech (present-to-past)',
    description:
      'Indirect statements shifting present to imperfect under a past-tense reporting verb (Dijo que tenía sueño; Pensé que estabas cansado), and reported commands with que + present subjunctive (Dice que te sientes).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Dijo que tenía mucho sueño.', 'El profesor dice que hagamos los deberes.'],
    examplesNegative: ['*Dijo que tiene mucho sueño.'],
    commonErrors: [
      'Keeping the present tense in the reported clause after a past-tense reporting verb ("*dijo que tiene sueño" instead of "dijo que tenía sueño").',
      'Reporting a command with the infinitive instead of que + present subjunctive ("*dice hacer los deberes" instead of "dice que hagamos los deberes").',
      'Using the indicative for a reported command instead of switching to the subjunctive ("*dice que vienes" instead of "dice que vengas" when relaying an order).',
    ],
  },
  {
    key: 'es-b1-deber-obligation-probability',
    kind: 'grammar',
    name: 'Deber + infinitivo vs. deber de + infinitivo',
    description:
      'The contrast between deber + infinitive for obligation (Debes terminar el informe) and deber de + infinitive for probability or conjecture (Deben de ser las cinco), plus deberías for softened advice.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Debes terminar el informe antes del viernes.', 'Deben de ser las cinco ya.'],
    examplesNegative: ['*Debes de terminar el informe antes del viernes.'],
    commonErrors: [
      'Using "deber de" for obligation instead of plain "deber" ("*debes de terminar" instead of "debes terminar").',
      'Treating deber and deber de as freely interchangeable, blurring the obligation/probability distinction the two forms are meant to keep separate.',
      'Using the plain present of deber for advice instead of the softened conditional deberías ("*debes hacer ejercicio" as advice instead of "deberías hacer ejercicio").',
    ],
  },
  {
    key: 'es-b1-aspectual-periphrases',
    kind: 'grammar',
    name: 'Aspectual periphrases: dejar de, ponerse a, estar a punto de, seguir + gerundio',
    description:
      'Aspectual periphrases dejar de + infinitivo (to stop doing), ponerse a + infinitivo (to start doing), estar a punto de + infinitivo (to be about to), and seguir + gerundio (to keep on doing).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Dejé de fumar hace dos años.',
      'Se puso a llorar en cuanto se enteró de la noticia.',
      'Estábamos a punto de salir cuando empezó a llover.',
      'Sigue trabajando en la misma empresa desde 2010.',
    ],
    examplesNegative: ['*Dejé fumar hace dos años.'],
    commonErrors: [
      'Dropping the preposition "de" after "dejar" ("*dejé fumar" instead of "dejé de fumar").',
      'Following "seguir" with the bare infinitive instead of the gerund ("*sigue trabajar" instead of "sigue trabajando").',
      'Confusing the inceptive "ponerse a + infinitivo" (to start doing) with "volver a + infinitivo" (to do again), producing the wrong aspectual meaning.',
    ],
  },
  {
    key: 'es-b1-verb-preposition-regime',
    kind: 'grammar',
    name: 'Verb + preposition regime',
    description:
      'Fixed prepositional regime of common verbs: hablar de, pensar en, soñar con, depender de; double complementation with invitar a + infinitivo (Me invitó a cenar).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Siempre habla de sus viajes por Sudamérica.',
      'No dejo de pensar en el examen de mañana.',
      'Anoche soñé con mi antiguo colegio.',
      'Me invitó a cenar el sábado.',
    ],
    examplesNegative: ['*Pienso de ti todo el día.'],
    commonErrors: [
      'Calquing English "think of/about" as "*pensar de" instead of the correct "pensar en".',
      'Using "de" instead of "con" after "soñar" ("*soñé de mi antiguo colegio" instead of "soñé con mi antiguo colegio").',
      'Omitting the "a" before the infinitive after "invitar" ("*me invitó cenar" instead of "me invitó a cenar").',
    ],
  },
  {
    key: 'es-b1-discourse-connectors',
    kind: 'grammar',
    name: 'Discourse connectors: sin embargo, o sea que, causal como, por + infinitivo, aunque + indicative',
    description:
      'Sin embargo (however); resumptive o sea que / así (es) que (so); fronted causal como (Como no venías, empecé…); causal por + infinitivo (Lo hizo por no molestarte); concessive aunque + indicative for a known fact (Aunque llueve, salgo).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Estudió mucho; sin embargo, suspendió el examen.',
      'Como no venías, empecé a cenar sin ti.',
      'Lo hizo por no molestarte.',
      'Aunque llueve, vamos a salir igualmente.',
    ],
    examplesNegative: ['*Empecé a cenar sin ti como no venías.'],
    commonErrors: [
      'Placing causal "como" after the main clause instead of fronting it at the head of the sentence ("*empecé a cenar como no venías" instead of "como no venías, empecé a cenar").',
      'Using the subjunctive after "aunque" for a known, factual concession instead of the indicative ("*aunque llueva, salimos" when it is already raining, instead of "aunque llueve, salimos").',
      'Confusing the resumptive "o sea que" ("so"/"in other words") with the causal "porque" ("because"), reversing cause and consequence.',
    ],
  },
  {
    key: 'es-b1-superlatives-comparisons',
    kind: 'grammar',
    name: 'Superlatives and comparisons: el más/menos…de, -ísimo, igual de…que, más/menos de',
    description:
      'Relative superlative el más/menos + adjective + de (el restaurante más caro de la ciudad); elative suffix -ísimo (buenísimo, riquísimo); equality igual de + adjective + que; and más/menos de before a quantity (más de cien euros).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Es el restaurante más caro de la ciudad.',
      'Esta sopa está riquísima.',
      'Es igual de alto que su hermano.',
      'Tiene más de cien libros en casa.',
    ],
    examplesNegative: ['*Es el restaurante más caro que la ciudad.'],
    commonErrors: [
      'Using "que" instead of "de" after a relative superlative ("*el más caro que la ciudad" instead of "el más caro de la ciudad").',
      'Forgetting the spelling change that adds "qu" before -ísimo on adjectives ending in -co ("*ricísimo" instead of "riquísimo").',
      'Using "más/menos que" before a bare quantity instead of "más/menos de" ("*tiene más que cien libros" instead of "tiene más de cien libros").',
    ],
  },
  {
    key: 'es-b1-que-vs-cual',
    kind: 'grammar',
    name: 'Qué vs. cuál/cuáles',
    description:
      'Qué asks for a definition or category (¿Qué es la democracia?), while cuál/cuáles selects from a set (¿Cuál prefieres?); in standard European Spanish cuál is not used directly before a noun (¿qué libro…?, not *¿cuál libro…?); prepositions precede the interrogative, and adónde asks where to.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      '¿Qué es la democracia?',
      '¿Cuál de estos dos prefieres?',
      '¿Qué libro estás leyendo?',
      '¿Con quién vas al cine?',
      '¿Adónde vamos este verano?',
    ],
    examplesNegative: ['*¿Cuál libro estás leyendo?'],
    commonErrors: [
      'Using "cuál" directly before a noun in standard European Spanish instead of "qué" ("*¿cuál libro quieres?" instead of "¿qué libro quieres?").',
      'Stranding the preposition at the end of the question, as in English, instead of fronting it with the interrogative ("*¿Quién vas al cine con?" instead of "¿Con quién vas al cine?").',
      'Using "cuál" instead of "qué" when asking for the definition of an abstract concept ("*¿Cuál es el amor?" instead of "¿Qué es el amor?").',
    ],
  },
  {
    key: 'es-b1-ser-estar-uses',
    kind: 'grammar',
    name: 'Ser/estar special uses: impersonal time, estar de + occupation, estar a + price/date',
    description:
      'Impersonal ser for time of day (Es tarde, Es de noche); estar de + noun for a temporary occupation (Está de camarero); estar a + a fluctuating price or the date (Estamos a quince, Están a tres euros el kilo); and parecer + adjective vs. impersonal parece que + indicative.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Ya es de noche; deberíamos volver a casa.',
      'Mi hermano está de camarero este verano.',
      'Hoy estamos a quince de mayo.',
      'Parece que va a llover esta tarde.',
    ],
    examplesNegative: ['*Está tarde para llamarla.'],
    commonErrors: [
      'Using "estar" instead of "ser" for the impersonal time-of-day construction ("*está tarde" instead of "es tarde").',
      'Omitting "de" after "estar" when naming a temporary job or role ("*está camarero" instead of "está de camarero").',
      'Using "ser" instead of "estar" to state today\'s date ("*somos a quince" instead of "estamos a quince").',
    ],
  },
  {
    key: 'es-b1-indirect-questions',
    kind: 'grammar',
    name: 'Indirect questions: si, qué, cuándo, dónde + clause or infinitivo',
    description:
      'Reported yes/no questions with si (No sé si voy); indirect wh-questions with qué/cuándo/dónde followed by a finite clause or, with same-subject reference, a bare infinitive (No sé qué hacer, Pregúntale dónde está).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'No sé si ir a la fiesta esta noche.',
      'No sé qué hacer con tanto tiempo libre.',
      'Pregúntale dónde está la parada del autobús.',
      'No sabía cuándo empezaba la película.',
    ],
    examplesNegative: ['*No sé hacer qué con tanto tiempo libre.'],
    commonErrors: [
      'Putting the interrogative word after the infinitive instead of before it in an indirect question ("*no sé hacer qué" instead of "no sé qué hacer").',
      'Dropping the written accent on "qué" in an indirect question, which collapses it into the unrelated "tener que" construction ("no sabía que hacer" read as an obligation, instead of the correctly accented "no sabía qué hacer").',
      'Using "que" instead of "si" to introduce an indirect yes/no question ("*no sé que voy a la fiesta" instead of "no sé si voy a la fiesta").',
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
    name: 'Future perfect',
    description:
      'Future perfect: habré + past participle for actions completed before a future reference point (Cuando lleguemos ya se habrá ido) and for probability about the recent past (Habrá tenido problemas).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: ['Para mañana habré llegado.', 'Ya habrá llegado a casa a estas horas.'],
    examplesNegative: ['*Cuando lleguemos, ya se irá.'],
    commonErrors: [
      'Using the simple future where anteriority to another future event is required (e.g. "*cuando lleguemos, ya se irá" instead of "ya se habrá ido").',
      'Forming the future perfect with "ser" or "estar" instead of "haber".',
      'Inflecting the past participle for gender or number when used with haber (e.g. "*habrá llegada").',
    ],
    prerequisiteKeys: ['es-a2-preterito-perfecto'],
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
  {
    key: 'es-b2-relative-clauses-advanced',
    kind: 'grammar',
    name: 'Advanced relative clauses',
    description:
      'Explicativas set off by commas (mi vecina, que es médica,); el/la/los/las que after a preposition (la casa de la que te hablé); quien(es) with or without an antecedent; donde relatives; lo que; and the indicative/subjunctive contrast (busco un piso que tiene/tenga terraza).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Mi vecina, que es médica, trabaja en el hospital central.',
      'Esa es la casa de la que te hablé el otro día.',
      'No conozco a nadie con quien pueda compartir esto.',
      'No entendí nada de lo que dijeron en la reunión.',
      'Quiero mudarme a una ciudad donde haya menos tráfico.',
      'Busco un piso que tenga terraza y esté bien comunicado.',
    ],
    examplesNegative: ['*La casa que te hablé es muy bonita.'],
    commonErrors: [
      'Stranding the preposition instead of fronting it with the relative pronoun ("*la casa que te hablé" instead of "la casa de la que te hablé"), calquing English relative clauses.',
      'Using the indicative in a relative clause whose antecedent is not yet identified ("*busco un piso que tiene terraza" instead of "que tenga terraza" when no specific flat is in mind).',
      'Omitting the comma that marks an explicativa, collapsing it into a restrictive reading and changing the meaning of the sentence.',
    ],
  },
  {
    key: 'es-b2-subjunctive-compound',
    kind: 'grammar',
    name: 'Compound subjunctive: perfect and pluperfect',
    description:
      'Perfect subjunctive haya + participle for a completed action viewed with doubt, emotion, or future anteriority (No es verdad que haya escrito eso; cuando se haya marchado); pluperfect subjunctive hubiera/hubiese + participle outside counterfactual si-clauses.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'No es verdad que haya escrito esa carta.',
      'Te llamaré en cuanto se haya marchado el jefe.',
      'Ojalá hubiera sabido la verdad antes.',
    ],
    examplesNegative: ['*No es verdad que ha escrito esa carta.'],
    commonErrors: [
      'Using the indicative present perfect ("ha escrito") instead of the perfect subjunctive ("haya escrito") after a trigger that requires the subjunctive.',
      'Confusing haya + participle (perfect, anchored to the present or a future point) with hubiera/hubiese + participle (pluperfect, anchored to the past).',
      'Assuming hubiera/hubiese only occurs in si-clauses and missing its independent uses in wishes, concessions, and negated assertions about the past.',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive', 'es-b2-past-subjunctive'],
  },
  {
    key: 'es-b2-subjunctive-negated-opinion',
    kind: 'grammar',
    name: 'Subjunctive after negated opinion and assertion',
    description:
      'Negation flips the mood of an opinion or assertion clause: no creo que + subjunctive (vs. creo que + indicative); no es cierto/verdad que + subjunctive; and negated verbs of saying (No me dijo que hubiera venido).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Creo que Marta tiene razón.',
      'No creo que Marta tenga razón.',
      'No es verdad que hayan aprobado la ley.',
      'No me dijo que hubiera venido a la fiesta.',
    ],
    examplesNegative: ['*No creo que Marta tiene razón.'],
    commonErrors: [
      'Keeping the indicative after "no creo que" by analogy with the affirmative "creo que + indicative", instead of switching to the subjunctive under negation.',
      'Treating "no es cierto/verdad que" as a plain statement of fact and using the indicative instead of the subjunctive it requires.',
      'Using the indicative instead of the subjunctive when relaying a negated assertion about a past event ("*no me dijo que había venido" as a denial, instead of "no me dijo que hubiera venido").',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive'],
  },
  {
    key: 'es-b2-subjunctive-temporal-concessive',
    kind: 'grammar',
    name: 'Subjunctive in temporal and concessive connectors',
    description:
      'En cuanto, tan pronto como, apenas, una vez que, hasta que, mientras take the subjunctive only for future/posteriority (en cuanto llegues) vs. indicative for past/habitual reference (apenas llegué); aunque/a pesar de que + subjunctive for a non-factual concession; por mucho/más que + subjunctive.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'En cuanto termine el informe, te lo envío.',
      'Apenas llegué a casa, comenzó a llover.',
      'Aunque no lo creas, es la pura verdad.',
      'Por mucho que insistas, no voy a cambiar de opinión.',
    ],
    examplesNegative: ['*En cuanto llegarás, te lo diré.'],
    commonErrors: [
      'Using the future indicative after a temporal connector with future reference instead of the present subjunctive ("*en cuanto llegarás" instead of "en cuanto llegues").',
      'Overgeneralizing the subjunctive to a habitual or completed past temporal clause, where the indicative is required ("*apenas llegara a casa, comenzó a llover" instead of "apenas llegué a casa").',
      'Using the indicative after "aunque" for a hypothetical, not-yet-known concession instead of the subjunctive ("*aunque no lo crees, es la verdad" instead of "aunque no lo creas").',
    ],
    prerequisiteKeys: ['es-b1-subjunctive-adverbial'],
  },
  {
    key: 'es-b2-conditional-connectors',
    kind: 'grammar',
    name: 'Conditional connectors beyond si',
    description:
      'Por si (acaso) + indicative ("in case"); siempre que/siempre y cuando/con tal de que/a condición de que + subjunctive ("provided that"); salvo si/excepto si + indicative; a no ser que/salvo que + subjunctive ("unless").',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Llévate el paraguas por si acaso llueve.',
      'Iré a la fiesta con tal de que tú también vayas.',
      'Aceptaré el trabajo siempre y cuando el sueldo sea justo.',
      'Saldremos a la hora prevista, salvo si hay un imprevisto.',
      'No cambiaré de opinión a no ser que me des una buena razón.',
    ],
    examplesNegative: ['*Llévate el paraguas por si acaso llueva.'],
    commonErrors: [
      'Using the present subjunctive after "por si (acaso)", which is not permitted — only the indicative, or occasionally the imperfect subjunctive, is used ("*por si acaso llueva" instead of "por si acaso llueve").',
      'Using the indicative after "con tal de que" or "siempre y cuando" instead of the subjunctive these connectors require ("*con tal de que vienes" instead of "con tal de que vengas").',
      'Confusing "salvo si" (indicative, like a plain if-clause) with "salvo que" (subjunctive, "unless"), producing the wrong mood for the connector.',
    ],
  },

  {
    key: 'es-b2-passive-voice',
    kind: 'grammar',
    name: 'Passive voice: ser vs estar + participle',
    description:
      'Ser + past participle for the action passive (Las puertas fueron abiertas a las 10), agreeing in gender/number with the subject, vs estar + participle for the resulting state (Las puertas ya estaban abiertas); bare-noun subjects stay postverbal (Han llegado trenes, Se venden pisos).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'La ciudad fue destruida por un terremoto en 1985.',
      'Cuando llegamos, la ciudad ya estaba destruida.',
      'Se venden pisos en esta calle.',
    ],
    examplesNegative: ['*Naranjas son vendidas aquí.'],
    commonErrors: [
      'Forgetting participle agreement with the subject of ser ("*las puertas fueron abierto" instead of "fueron abiertas").',
      'Using ser + participle for a resulting state instead of estar ("*la puerta fue abierta" to mean the door was already open, instead of "la puerta estaba abierta").',
      'Fronting a bare, article-less plural subject before the verb ("*Trenes han llegado" instead of the required postverbal "Han llegado trenes").',
    ],
  },

  {
    key: 'es-b2-verbs-of-change',
    kind: 'grammar',
    name: 'Verbs of becoming: ponerse, quedarse, hacerse, volverse, convertirse en, llegar a ser',
    description:
      'Choosing ponerse (brief mood/appearance change), quedarse (state left by an event), hacerse (voluntary lasting conversion), volverse (involuntary lasting change), convertirse en (total transformation, + noun), or llegar a ser (hard-won outcome of a slow process).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Cuando se enteró de la noticia, se puso muy triste.',
      'Se hizo abogado después de diez años de estudio.',
      'Con la edad, mi padre se ha vuelto muy desconfiado.',
      'La oruga se convirtió en mariposa.',
      'Trabajó muchísimo y con el tiempo llegó a ser director general.',
    ],
    examplesNegative: ['*Se puso budista después de conocer a un monje tibetano.'],
    commonErrors: [
      'Using ponerse for a lasting change of character or belief instead of a temporary mood/state ("*se puso ateo" instead of "se hizo ateo").',
      'Using hacerse for an involuntary or unwanted change instead of volverse ("*se hizo loco" instead of "se volvió loco").',
      'Reaching for convertirse en with an adjective instead of a noun phrase ("*se convirtió en triste" instead of "se puso triste").',
    ],
  },

  {
    key: 'es-b2-se-middle-accidental',
    kind: 'grammar',
    name: 'Middle se and accidental se (dative of interest)',
    description:
      'Middle se for a spontaneous, agentless event (Se abrió la ventana, Se fundió el hielo); accidental se + dative of interest for mishaps (Se me perdió tu dinero, Se le cayeron las llaves), verb agreeing with the thing affected, not the dative; irse (departure) vs ir (destination).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'La ventana se abrió con el viento.',
      'Se me perdió tu dinero y no sé cómo pasó.',
      'Se le cayeron las llaves al entrar en el portal.',
      'Me voy ya, que es tarde.',
    ],
    examplesNegative: ['*Se le cayó las llaves.'],
    commonErrors: [
      'Making the verb agree with the dative pronoun (person) instead of the thing affected ("*se le cayó las llaves" instead of "se le cayeron las llaves").',
      'Dropping the dative pronoun and losing the "unintentional/it happened to me" nuance ("se perdió tu dinero" instead of "se me perdió tu dinero").',
      'Using the ir imperative "ve" to tell someone to leave/go away, instead of the irse imperative "vete" ("*ve ya, es tarde" instead of "vete ya, es tarde").',
    ],
  },

  {
    key: 'es-b2-clitic-advanced',
    kind: 'grammar',
    name: 'Advanced clitics: neuter lo, fronted-object doubling, leísmo de persona',
    description:
      'Neuter lo echoing the predicate of ser/estar (¿Estás cansada? — Lo estoy); obligatory redundant clitic when a direct object is fronted (Los libros los tiene Juan); accepted leísmo de persona for masculine humans (Le vimos a Luis, alongside Lo vimos), not for feminine referents.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      '¿Estás cansada? — Lo estoy.',
      'Los libros los tiene Juan.',
      'A Luis le vimos ayer en la estación.',
    ],
    examplesNegative: ['*A Luisa le vimos ayer en la estación.'],
    commonErrors: [
      'Dropping the resumptive lo after ser/estar with an adjective predicate ("¿Estás cansada? — Estoy" instead of "Lo estoy").',
      'Omitting the redundant clitic when the direct object is fronted ("Los libros tiene Juan" instead of "Los libros los tiene Juan").',
      'Extending leísmo de persona to a feminine direct object ("*le vimos" for Luisa instead of "la vimos").',
    ],
  },

  {
    key: 'es-b2-gerund-participle-constructions',
    kind: 'grammar',
    name: 'Adverbial gerund, nada más + infinitive, and predicative participle clauses',
    description:
      'Adverbial gerund for method/simultaneous action (Aprende leyendo; Me lo confesó yendo por la calle); nada más + infinitive for same-subject sequence (Nada más llegar, nos pusimos a comer); una vez + participle for a prior event; predicative participle agreeing with the object (tienda cerrada).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Aprende idiomas leyendo novelas en el idioma original.',
      'Nada más llegar a casa, nos pusimos a preparar la cena.',
      'Una vez estudiado el problema, propusieron tres soluciones.',
      'Encontré la tienda cerrada cuando llegué.',
    ],
    examplesNegative: ['*Encontré la tienda cerrado.'],
    commonErrors: [
      'Leaving the predicative participle unagreed with the object it describes ("*encontré la tienda cerrado" instead of "cerrada").',
      'Using nada más + infinitive when the following clause has a different subject, instead of switching to nada más que + finite verb ("*nada más llegar yo, tú te fuiste" instead of "nada más llegar yo" or a reformulation with a shared subject).',
      'Using the gerund instead of the participle to describe a resulting state ("*encontré la tienda cerrando" instead of "encontré la tienda cerrada").',
    ],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // Themed A1/A2 umbrellas (2026-07-06), mirroring the TR themed vocab split:
  // narrow topic slices give the generator a fresh semantic surface per cell.
  // ---------------------------------------------------------------------------
  {
    key: 'es-a1-vocab-family-people',
    kind: 'vocab',
    name: 'Family and people (A1)',
    description:
      'Core A1 vocabulary for family members, people, and basic personal descriptions.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['la madre', 'el hermano mayor'],
    examplesNegative: ['*el madre'],
    commonErrors: [
      'Mismatching article gender on family nouns ("*el madre").',
      'Confusing "padres" (parents) with "parientes" (relatives).',
    ],
  },
  {
    key: 'es-a1-vocab-food-drink',
    kind: 'vocab',
    name: 'Food and drink (A1)',
    description: 'Core A1 vocabulary for everyday foods, fruit, vegetables, and drinks.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['el pan', 'la manzana roja'],
    examplesNegative: ['*la agua fría (agua takes "el" before its stressed a-, but stays feminine: el agua fría)'],
    commonErrors: [
      'Missing the special article rule for stressed-a feminine nouns ("el agua", not "*la agua", but still feminine — "el agua fría").',
      'Confusing "fruta" (fruit, generic) with "fruto" (fruit of a plant/tree).',
    ],
  },
  {
    key: 'es-a1-vocab-home-objects',
    kind: 'vocab',
    name: 'Home and objects (A1)',
    description: 'Core A1 vocabulary for rooms, furniture, and everyday household objects.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['la cocina', 'el sofá nuevo'],
    examplesNegative: ['*la sofá'],
    commonErrors: [
      'Mismatching article gender on borrowed nouns ("*la sofá" instead of "el sofá").',
      'Confusing "cuarto" (room) with "cuarta" (fourth, feminine ordinal).',
    ],
  },
  {
    key: 'es-a1-vocab-city-places',
    kind: 'vocab',
    name: 'City and places (A1)',
    description: 'Core A1 vocabulary for everyday places in a city and simple directions.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['la plaza', 'el banco cercano'],
    examplesNegative: ['*el plaza'],
    commonErrors: [
      'Mismatching article gender on place nouns ("*el plaza" instead of "la plaza").',
      'Confusing "banco" (bank/bench) with "banca" (banking, the industry).',
    ],
  },
  {
    key: 'es-a1-vocab-weather-clothing',
    kind: 'vocab',
    name: 'Weather and clothing (A1)',
    description: 'Core A1 vocabulary for weather conditions, seasons, and clothing items.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['el abrigo', 'la lluvia fuerte'],
    examplesNegative: ['*la abrigo'],
    commonErrors: [
      'Mismatching article gender on clothing nouns ("*la abrigo" instead of "el abrigo").',
      'Confusing "tiempo" (weather/time) with "hora" (clock time).',
    ],
  },
  {
    key: 'es-a2-vocab-work-school',
    kind: 'vocab',
    name: 'Work and school (A2)',
    description: 'A2 vocabulary for jobs, workplaces, school subjects, and study activities.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['el trabajo', 'la reunión importante'],
    examplesNegative: ['*el reunión'],
    commonErrors: [
      'Mismatching article gender on -ión nouns ("*el reunión" instead of "la reunión").',
      'Confusing "trabajo" (job/work) with "obra" (a work, e.g. of art or construction).',
    ],
  },
  {
    key: 'es-a2-vocab-city-shopping',
    kind: 'vocab',
    name: 'City and shopping (A2)',
    description: 'A2 vocabulary for shops, services, money, and shopping activities.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['la tienda', 'el precio barato'],
    examplesNegative: ['*la precio'],
    commonErrors: [
      'Mismatching article gender on -o nouns ("*la precio" instead of "el precio").',
      'Confusing "gratis" (free of charge) with "libre" (free/available).',
    ],
  },
  {
    key: 'es-a2-vocab-health-body',
    kind: 'vocab',
    name: 'Health and body (A2)',
    description: 'A2 vocabulary for body parts, symptoms, and common health complaints.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['la cabeza', 'el dolor de estómago'],
    examplesNegative: ['*la estómago'],
    commonErrors: [
      'Assuming body-part nouns are feminine by default ("*la estómago" instead of "el estómago").',
      'Confusing "sentirse mal" (to feel unwell) with "sentir" (to feel/regret, transitive).',
    ],
  },
  {
    key: 'es-a2-vocab-travel-nature',
    kind: 'vocab',
    name: 'Travel and nature (A2)',
    description: 'A2 vocabulary for travel, landscapes, and the outdoors.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['la montaña', 'el viaje largo'],
    examplesNegative: ['*el montaña'],
    commonErrors: [
      'Mismatching article gender on -a nouns ("*el montaña" instead of "la montaña").',
      'Confusing "viaje" (trip/journey) with "viajero" (traveller, the person).',
    ],
  },
  {
    key: 'es-a2-vocab-time-daily-routine',
    kind: 'vocab',
    name: 'Time and daily routine (A2)',
    description: 'A2 vocabulary for parts of the day, the week, and frequency expressions.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: ['la mañana', 'todos los días'],
    examplesNegative: ['*el mañana (in the daily-routine sense)'],
    commonErrors: [
      'Confusing feminine "la mañana" (morning) with masculine "el mañana" (the future/tomorrow, as a noun).',
      'Confusing "hora" (clock time) with "vez" (occasion/instance, as in "una vez").',
    ],
  },
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
    key: 'es-a1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A1)',
    description:
      'Short, slow A1 connected-speech clips (1–2 simple sentences) on everyday topics; tests basic word segmentation, silent h, and b/v spelling traps at beginner pace.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Me llamo Ana y vivo en Madrid.',
      'Hoy es lunes y tengo clase de español.',
    ],
    examplesNegative: ['*Una lista de palabras sueltas sin oración natural.'],
    commonErrors: [
      'Adding or dropping the silent h (hoy / *oy).',
      'Confusing b and v in common words (vivo / *bibo).',
    ],
    targetOverride: 30,
  },
  {
    key: 'es-a2-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A2)',
    description:
      'A2 connected-speech clips (2–3 sentences) that bring in past tenses (pretérito/imperfecto) on familiar topics; tests past-tense verb endings and common spelling traps at a moderate pace.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Ayer fui al mercado y compré fruta fresca.',
      'De niño vivía en un pueblo pequeño cerca de la costa.',
    ],
    examplesNegative: ['*Un texto sin verbos en pasado y sin conexión entre frases.'],
    commonErrors: [
      'Confusing preterite and imperfect endings by ear (compré / *compraba).',
      'Dropping the accent that marks the preterite first person (compré / *compre).',
    ],
    targetOverride: 30,
  },
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
    key: 'es-a1-fw-my-family',
    kind: 'free-writing',
    name: 'Mi familia',
    description:
      'An informal prompt to introduce your family: who they are and one detail about each person.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Asks the learner to name two family members and say one thing about each.',
      'Requires a closing sentence about who they see most often.',
    ],
    examplesNegative: ['*Write about family in general.'],
    commonErrors: ['Unscoped prompt with no concrete checklist.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-a1-fw-my-home',
    kind: 'free-writing',
    name: 'Mi casa',
    description: 'A neutral prompt to describe your home: the rooms and one favourite spot.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Asks the learner to name two rooms and describe what is in each.',
      'Requires a closing sentence about their favourite room and why.',
    ],
    examplesNegative: ['*Describe a house.'],
    commonErrors: ['Listing rooms with no connected description.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-a1-fw-a-day',
    kind: 'free-writing',
    name: 'Un día de mi semana',
    description: 'A neutral prompt to describe one ordinary day of the week from morning to night.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Asks for at least three activities in the order they happen.',
      'Requires a closing sentence about what time the day ends.',
    ],
    examplesNegative: ['*Tell me about your week.'],
    commonErrors: ['Scope too broad (a whole week instead of one day).'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-a2-fw-last-vacation',
    kind: 'free-writing',
    name: 'Mis últimas vacaciones',
    description:
      'A neutral prompt to narrate a past vacation, deliberately eliciting past-tense narration (pretérito/imperfecto).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Asks where the learner went and one thing they did each day.',
      'Requires a closing sentence on whether they would go back.',
    ],
    examplesNegative: ['*Describe vacations in general.'],
    commonErrors: ['Present-tense description instead of a past-tense narration.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-a2-fw-best-friend',
    kind: 'free-writing',
    name: 'Mi mejor amigo/a',
    description: 'An informal prompt to describe your best friend and why the friendship matters.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Asks for two personality traits and an example of each.',
      'Requires a closing sentence on how they met.',
    ],
    examplesNegative: ['*Write about friendship.'],
    commonErrors: ['Abstract essay on friendship with no specific person.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-a2-fw-my-neighborhood',
    kind: 'free-writing',
    name: 'Mi barrio',
    description: 'A neutral prompt to describe your neighborhood and what there is to do nearby.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Asks for two nearby places and what the learner does there.',
      'Requires a recommendation for someone new to the neighborhood.',
    ],
    examplesNegative: ['*Describe a neighborhood (any neighborhood).'],
    commonErrors: ['Conflating "describe" with an unscoped free dump.'],
    freeWriting: { register: 'neutral' },
  },
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
