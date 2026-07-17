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
 *
 * 2026-07-08: digit-form elicitation for es-a1-numbers-ordinals
 * (selfRevealingElicitation + curated value pool). Bump re-enqueues every
 * below-target ES cell and clears low-yield suppression on the cells starved
 * by the 2026-07-07 run: es-a1-numbers-ordinals cloze (pool 1), es-a1-fw-a-day
 * (2), es-a1-vocab-family-people (2), plus the thin A1 vocab/cloze cells.
 *
 * `2026-07-09`: Butt & Benjamin gap audit — 22 new grammar points (2 A1, 6 A2,
 * 6 B1, 8 B2: irregular yo-forms, locatives, strong/spelling preterites,
 * saber/poder, hace-ago, cada/mismo, diacritics, nominalizers, impersonal
 * plural, reciprocal se, meaning-shift past tenses, influence verbs, ser for
 * events, conjecture conditional, full backshift, cuyo, nosotros imperative,
 * gradual gerund, perception verbs, correlative comparison, adjective
 * position) and 9 rescoped descriptions (noun-plural, personal-a, tonic
 * pronouns, articles-use, preterito-perfecto, llevar-time, present
 * subjunctive, subjunctive-adverbial, exclamatives). Bump enumerates the new
 * cells and clears suppression on the rescoped ones so they re-run under the
 * widened descriptions.
 *
 * `2026-07-11`: ES conjugation verb-selection fix. Curated `conjugationSeedWords`
 * pin four preterite/present points (es-a1-present-yo-go, es-a2-preterite-irregular,
 * es-a2-preterite-strong-stems, es-a2-preterite-stem-spelling) to their target verb
 * sets — the 2026-07-09 run wandered onto off-target verbs (5–40% approval). Split
 * es-a2-preterite-stem-spelling: yo-form -qué/-gué/-cé changes moved to the new
 * es-a2-preterite-yo-spelling (disjoint diagnostic person from the 3rd-person
 * changes). Bump also clears low-yield suppression on the starved conjugation cells.
 *
 * `2026-07-10`: base-word-cue elicitation for es-b2-appreciative-suffixes
 * (selfRevealingElicitation + curated B&B ch. 43 pool) — the 2026-07-08 run
 * approved 4/41 with 23 context-spoils-answer rejects because the model had
 * no sanctioned cue for derived forms. Bump also clears low-yield suppression
 * on the cells starved by that run: es-a2-temporal-clauses cloze (2/26),
 * es-a1-demonstratives cloze (2/9), es-a2-articles-use cloze (1/7),
 * es-a1-fw-a-day (0/3).
 *
 * `2026-07-10a`: adds the two `kind: 'paraphrase'` umbrellas
 * (`es-b1-paraphrase`, `es-b2-paraphrase`) that own the new contextual-paraphrase
 * generation cells; the bump enumerates them on the next scheduler tick.
 *
 * `2026-07-11a`: marks three paradigm-contrast grammar points `clozeUnsuitable`
 * (es-a1-possessives-atonic, es-a1-locative-prepositions, es-a2-temporal-clauses).
 * Each targets a closed set whose members all fit a bare blank, so the cloze cell
 * is a flag-factory: the 2026-07-10 run approved 0/16, ~1/8, and 2/20 respectively
 * (127 flagged cloze rows across the three, ~$1.3 of nightly waste) while their
 * translation cells stay healthy (15/18/28 approved). Dropping the cloze cell
 * routes the points to translation only; the bump also clears the low-yield
 * suppression these cloze cells keep tripping (which prior bumps only re-ran into
 * the same failure — dropping the cell is the actual fix, not re-running it).
 *
 * `2026-07-11b`: fixes the two worst cells of the 2026-07-11 run.
 * (1) es-a2-present-irregular-stem-changes approved 0/15 conjugation, 0/5 cloze,
 * 1/6 translation because the coverageSpec floored 1pl — the "boot" person where
 * the diphthong disappears (pensamos/podemos are regular) — and the conjugation
 * cell drew non-stem-changing verbs from the band (echar, saber, tener). Fix drops
 * the 1pl floor and pins a curated e→ie/o→ue/e→i/u→ue verb pool. (2) es-a1-
 * demonstratives approved 0/7 cloze with 6/7 flagged ambiguous (este/ese/aquel all
 * fit a bare blank) — marked clozeUnsuitable, routing it to translation only. The
 * bump clears low-yield suppression on both starved cells so they re-run.
 *
 * `2026-07-12a`: clears low-yield suppression after the generation-prompt fix in
 * PR #565 (`generate@2026-07-12`). Two ES cloze cells sat at 0 approved all-time —
 * es-a1-quantifiers-muy-mucho (4/4 rejected context-spoils-answer) and
 * es-a2-present-irregular-stem-changes (0/5 cloze; the 07-11b fix repaired only its
 * conjugation/translation cells). Root cause was the cloze `context` field spoiling
 * the answer plus register-inappropriate frequency-band seeds — both now fixed
 * generator-side (context field removed + hard schema guard; seed self-filters
 * register/level). This bump re-runs both starved cloze cells on the fixed prompt.
 *
 * `2026-07-15a`: adds `es-b2-remote-conditionals` (B&B ch. 29.3 "remote
 * conditions": si + imperfect subjunctive → conditional simple). The 2026-07-09
 * gap audit covered open (A2) and unfulfilled (B2 complex-conditionals) types
 * but left the type-2 pattern split across es-b1-conditional (apodosis only,
 * framed as politeness) and es-b2-past-subjunctive (protasis only, framed as
 * triggers) — no topic taught the two-clause construction itself. Bump
 * enumerates the new cells on the next scheduler tick.
 *
 * `2026-07-16`: the B&B book-coverage ledger retrofit (all 44 chapters,
 * 448 triaged gaps — see docs/analysis/es-bb-book-coverage-audit-2026-07-16.md)
 * adds four points the ledger found unclaimed: es-a1-telling-time (B&B 36.10.1;
 * PCIC A1 "la hora"), es-b1-collective-agreement (B&B 2.3.1: la gente dice),
 * es-b1-adjective-de-infinitive (B&B 38.8.12: fácil de leer vs es fácil leer),
 * and es-b2-aspectual-se (B&B 30.9: me comí toda la pizza), plus fold
 * widenings on existing points encoding the triage's fold verdicts. Bump
 * enumerates the new cells on the next scheduler tick.
 *
 * `2026-07-16a`: clears low-yield suppression on es-b2-perception-verbs cloze
 * (approved 2/9 on 2026-07-16; chronic — 19/50 → 10/31 → 8/21 → 2/13 → 2/11 →
 * 2/9) after the form-contrast cloze rule in `generate@2026-07-16` /
 * `validate@2026-07-16`: drafts kept listing BOTH the infinitive and the
 * gerund in `acceptableAnswers` (the taught contrast), which the validator
 * flags as ambiguous; context must now force exactly one form. If yield does
 * not recover on the new prompt, the fallback is `clozeUnsuitable: true`.
 *
 * `2026-07-17`: Tier-1 of the full-curriculum coverageSpec audit
 * (docs/analysis/coverage-spec-audit-2026-07-17.md) — adds specs to eight
 * spec-less points whose paradigm halves were collapse-prone:
 * present-irregular-core (the only conjugation-paradigm point without one),
 * possessives-atonic, imperative-affirmative (tú vs usted/ustedes — the
 * direct analogue of the collapsed TR imperative), reflexive-verbs,
 * gustar-type-verbs (person + number), imperative-negative-pronouns and
 * nosotros-imperative (polarity), reciprocal-se (1pl/3pl partial). Bump
 * clears target-reached suppression so the touched cells re-run under the
 * floors; at-target cells additionally need demote:pool (see
 * docs/curriculum-authoring.md retrofit section).
 */
export const CURRICULUM_VERSION_ES = '2026-07-17';

const esCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1 (PCIC-aligned; Tasks 2–4)
  // ---------------------------------------------------------------------------
  {
    key: 'es-a1-noun-gender',
    kind: 'grammar',
    name: 'Noun gender',
    description:
      'Noun gender: masculine -o / feminine -a, nouns in other vowels or consonants learned with their article, common exceptions (el problema, el día, la mano, la foto), and heteronym pairs (el padre / la madre). Profession nouns in -o form the feminine in -a (la arquitecta); some stay invariable, with the article marking sex (el/la juez). Countries in unstressed -a are feminine (la España de hoy); others are masculine (todo México).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'El problema es difícil.',
      'Me duele la mano derecha.',
      'El capital de la empresa está en la capital del país.',
      'Dejé el paraguas junto al sacacorchos.',
      'Saqué un siete en el examen.',
    ],
    examplesNegative: ['*La problema es difícil.'],
    commonErrors: [
      'Treating every noun in -a as feminine ("*la problema", "*la día").',
      'Treating every noun in -o as masculine ("*el mano").',
      'Guessing the gender of nouns in -e or a consonant instead of learning it with the article.',
      'Matching an invariable-gender noun to the referent\'s sex ("*un persona simpático" for a man instead of "una persona simpática"; la víctima can be a man).',
      'Using the feminine plural for a mixed-sex group, missing that "mis hermanos" covers brothers and sisters and "los padres" means parents.',
    ],
  },
  {
    key: 'es-a1-noun-plural',
    kind: 'grammar',
    name: 'Noun plural',
    description:
      'Plural formation: -s after a vowel (mesa → mesas), -es after a consonant (árbol → árboles) including stressed final -s (país → países); stressed -í/-ú usually take -es (jabalí → jabalíes); nouns in unstressed vowel + s are invariable (el lunes / los lunes, la crisis / las crisis). Foreign loanwords usually add just -s (los anoraks); family surnames are invariable (los Pérez); in noun+noun compounds only the first noun pluralizes (los años luz).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Conozco tres países interesantes.', 'Hay muchas ciudades grandes en España.'],
    examplesNegative: ['*Hay muchas ciudads grandes en España.'],
    commonErrors: [
      'Adding only -s to nouns ending in a consonant instead of -es ("*ciudads" for "ciudades").',
      'Leaving país unchanged in the plural instead of adding -es ("*los país" instead of "los países").',
      'Forgetting to change z to c before adding -es ("*lapizes" instead of "lápices").',
      'Adding -es to nouns already ending in an unstressed vowel + s ("*los luneses", "*las crisises" instead of "los lunes", "las crisis").',
      'Keeping the singular stress in the three stress-shifting plurals ("*los carácteres" instead of "los caracteres"; el régimen → los regímenes, el espécimen → los especímenes).',
    ],
  },
  {
    key: 'es-a1-gender-agreement',
    kind: 'grammar',
    name: 'Noun-adjective agreement',
    description:
      'Agreement of descriptive adjectives with the noun in gender and number, including gentilicios like español/española that add -a versus invariable ones like marroquí, and the normal postnominal position of these adjectives. A few adjectives are invariable for both gender and number (estándar, gratis: los coches estándar, las entradas gratis).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Tengo un amigo español y una amiga española.',
      'El chico marroquí y la chica marroquí viven aquí.',
      'Llevo calcetines rojo claro y una camisa verde oscuro.',
    ],
    examplesNegative: ['*Tengo una amiga español.'],
    commonErrors: [
      'Forgetting to add -a to gentilicios like español, inglés, or alemán in the feminine ("*una amiga español").',
      'Wrongly adding -a to invariable gentilicios ending in -í, such as marroquí ("*una amiga marroquía").',
      'Placing the adjective before the noun by analogy with English word order ("*una española amiga").',
      'Pluralizing noun-derived or compound colour adjectives ("*tres botones naranjas", "*hojas verdes oscuras" instead of "tres botones naranja", "hojas verde oscuro").',
      'Giving a collective noun plural agreement ("*la gente son amables" instead of "la gente es amable").',
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
      'Demonstrative adjectives/pronouns este/ese/aquel (and neuter esto/eso/aquello) marking near-speaker, near-listener, and distant deixis; demonstratives replace rather than combine with the definite article. The place adverbs aquí/ahí/allí mirror the same three distances.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Este libro es mío.',
      '¿Qué es eso que tienes en la mano?',
      'Aquí construiremos la casa, ahí el garaje y allí la piscina.',
    ],
    examplesNegative: ['*El este libro es mío.'],
    commonErrors: [
      'Combining a demonstrative with the definite article ("*el este libro" instead of "este libro").',
      'Using the neuter esto/eso/aquello to refer to a specific person or noun instead of the gendered form ("*esto es mi profesor" instead of "este es mi profesor").',
      'Treating ese and aquel as fully interchangeable regardless of distance from speaker and listener.',
    ],
    // clozeUnsuitable (2026-07-11b): a paradigm-contrast point — este/ese/aquel all
    // fit a bare blank ("___ hombre es mi jefe"), so the deixis distance the point
    // teaches is exactly the information a single blank cannot pin down without a
    // spatial cue the generator doesn't reliably supply. The 2026-07-10 bump re-ran
    // the cloze cell and it failed again: the 2026-07-11 run approved 0/7 with 6/7
    // flagged ambiguous. Translation gives the deixis for free via this/that/those,
    // so it carries the point (sibling of es-a1-possessives-atonic).
    clozeUnsuitable: true,
  },
  {
    key: 'es-a1-possessives-atonic',
    coverageSpec: {
      axes: [
        // Possessor-person paradigm mi/tu/su/nuestro; su-ambiguity needs 3sg
        // drilled apart from the mi default, nuestro is the only
        // gender-agreeing form. Partial floors (no 3pl: su covers it).
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Possessive adjectives (short forms)',
    description:
      'Short-form possessives mi/tu/su/nuestro/vuestro, agreeing in number and, for nuestro/vuestro, gender with the thing possessed; placed before the noun with no article; and the several possible meanings of su/sus, which de + pronoun can clarify or replace (la camisa de él vs. su camisa).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Nuestra casa es grande.', '¿Dónde está tu coche?'],
    examplesNegative: ['*La mi casa es grande.'],
    commonErrors: [
      'Using a possessive where Spanish prefers the definite article, especially with body parts ("*me duele mi cabeza" instead of "me duele la cabeza").',
      'Wrongly making mi/tu/su agree in gender the way nuestro/vuestro do ("*mia hermana" instead of "mi hermana").',
      'Assuming su can only mean "his," missing that it also covers "her," "your" (usted/ustedes), and "their."',
      'Letting one possessive cover two different things as in English ("*mi chaqueta y corbata" instead of "mi chaqueta y mi corbata"; one suffices only for a single referent: mi amigo y compañero).',
    ],
    // clozeUnsuitable (2026-07-11a): a paradigm-contrast point — mi/tu/su/nuestro
    // all fit a bare blank, so a cloze cannot force a single answer without a
    // disambiguating cue the generator does not reliably supply. The 2026-07-10
    // run flagged 10/12 cloze drafts as ambiguous; pool stands at 10 approved /
    // 32 flagged cloze vs 18 approved / 9 flagged translation. Translation gives
    // the possessor for free, so it carries the point.
    clozeUnsuitable: true,
  },
  {
    key: 'es-a1-subject-pronouns',
    kind: 'grammar',
    name: 'Subject pronouns',
    description:
      'Subject pronouns yo, tú, él/ella, usted, nosotros/as, vosotros/as, ellos/ellas, ustedes; normally omitted because the verb ending marks the subject, and used only for emphasis, contrast, or after ser. Vosotros/as is the informal plural in Spain only; Latin America uses ustedes for all plural address.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Hablo español y un poco de inglés.',
      'Yo estudio biología, pero él estudia física.',
      'Nosotros los estudiantes trabajamos mucho.',
      '¿Quién es? — Soy yo.',
      'Tú y yo vamos juntos al cine.',
    ],
    examplesNegative: ['*Yo hablo español y yo vivo en Madrid y yo trabajo mucho.'],
    commonErrors: [
      'Inserting a subject pronoun before every verb by analogy with English ("*yo hablo, yo vivo, yo trabajo" instead of just conjugating the verb).',
      'Omitting the pronoun in a context that needs it for contrast between two different subjects.',
      'Confusing tú and usted register, using tú with strangers or authority figures where usted is expected.',
      'Using él/ella as a subject pronoun for a thing by analogy with English "it" ("*él sopla" for the wind instead of just "sopla"); after a preposition él/ella for things is fine (sin él).',
      'Using nosotros/vosotros for an all-female group instead of the required nosotras/vosotras ("*nosotros tres" said by three women instead of "nosotras tres").',
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
      'Present indicative of regular -ar, -er, and -ir verbs (hablar, comer, vivir) across all six persons; used for habitual actions, general truths, near-future scheduled events, imminent or just-arranged ones (¡Ya voy!, Me caso), and offers or permission questions (¿Nos vamos?, ¿Escribo yo a los abuelos?).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: ['Todos los días como fruta y bebo agua.', 'Mis amigos viven en Madrid y trabajan en un banco.'],
    examplesNegative: ['*Nosotros vivemos en Madrid.'],
    commonErrors: [
      'Using the -ar ending -as on -er verbs, producing "*tú comas" instead of "tú comes".',
      'Confusing the nosotros endings of -er and -ir verbs, producing "*vivemos" instead of "vivimos".',
      'Dropping the second-person -s ending by analogy with the minimal English conjugation, producing "*tú vive" instead of "tú vives".',
      'Using the continuous for an imminent arranged event by English transfer ("*me estoy casando" to announce a wedding plan instead of "me caso").',
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
    coverageSpec: {
      axes: [
        // Full suppletive paradigms (soy/eres/es…, voy/vas/va…) are the
        // content — the only conjugation-paradigm point that shipped
        // spec-less (2026-07-17 audit). Sum 25 grows the A1 cell to 25,
        // matching es-a1-present-indicative-regular.
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
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
    key: 'es-a1-present-yo-go',
    kind: 'grammar',
    name: 'Present irregular yo-forms (-go, -zco)',
    description:
      'Verbs with an irregular first-person singular in the present: -go forms hago, pongo, salgo, tengo, vengo, digo, oigo, traigo, and -zco forms of -cer/-cir verbs (conozco, conduzco); the other persons follow the regular or stem-changing pattern (hago / haces, tengo / tienes).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Hago los deberes por la tarde.',
      'Salgo de casa a las ocho y vengo en autobús.',
      'Conozco muy bien esta ciudad.',
    ],
    examplesNegative: ['*Yo haco los deberes por la tarde.', '*No conozo esta ciudad.'],
    commonErrors: [
      'Regularizing the yo-form, producing "*haco", "*pono", or "*salo" instead of "hago", "pongo", and "salgo".',
      'Missing the -zco of -cer/-cir verbs, producing "*conoco" or "*conozo" instead of "conozco".',
      'Spreading the irregular yo-form into other persons, producing "*tú digas" or "*él pongue" instead of "tú dices" and "él pone".',
    ],
    prerequisiteKeys: ['es-a1-present-indicative-regular'],
    coverageSpec: {
      // 1sg ONLY: for pure -go/-zco verbs the irregularity lives entirely in the
      // yo-form; 3sg/3pl are regular (hace, conoce) and don't exercise the point,
      // so the 2026-07-09 run approved 0/13 non-1sg conjugation drafts. Contrast
      // with the other persons is carried by this point's cloze/translation cells.
      axes: [{ name: 'person', floors: { '1sg': 12 } }],
    },
    // Closed target-verb set: the conjugation generator drew random verbs from the
    // frequency band and picked off-target ones (e.g. valer, or regular 3sg forms),
    // so 18/20 drafts were rejected on 2026-07-09. This curated list replaces the
    // band (see buildSeedWords). targetOverride sizes the point to the list so no
    // conjugation ordinal is left unseeded (point-wide: also caps cloze/translation).
    conjugationSeedWords: [
      'tener', 'hacer', 'poner', 'salir', 'venir', 'decir',
      'traer', 'oír', 'conocer', 'caer', 'parecer', 'conducir',
    ],
    targetOverride: 12,
    conjugationSuitable: true,
  },
  {
    key: 'es-a1-ser-estar-basic',
    kind: 'grammar',
    name: 'Ser and estar (basic contrast)',
    description:
      'Basic ser/estar contrast: ser for identity, profession, nationality or origin (soy de Colombia), material with de (la mesa es de madera), and clock time; estar for location and for physical or emotional condition, including bien/mal; ser + adjectives of inherent nature vs. estar + adjectives of temporary state.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Soy profesora y soy de Colombia.',
      'Mi hermano está en el hospital porque está enfermo.',
      'La mesa es de madera.',
    ],
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
      'Existential hay (invariable, only third person, no article) for indefinite or unspecified things vs. estar for a definite item already identified by an article, possessive, or demonstrative: hay un libro en la mesa vs. el libro está en la mesa. Abstract nouns like problema or accidente take only hay, while locatable people and things can take estar even when indefinite.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Hay un banco en esta calle.',
      'El banco está al lado de la farmacia.',
      'Hay un problema con la reserva.',
    ],
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
      'Querer and poder followed directly by an infinitive with no linking preposition (quiero viajar, puedo ayudarte); masculine singular agreement for adjectives referring to an infinitive, a clause, or no specific noun (viajar es caro, es absurdo hacerlo); and creer que + indicative to state a belief.',
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
      'Cardinal numbers, including gender agreement of uno and -cientos with the counted noun (doscientas mujeres, veintiún libros); and ordinal numbers primero to décimo, which agree in gender/number and shorten before a masculine singular noun. Above décimo, everyday usage prefers cardinals (el siglo veinte). Nouns identified by a number take the article (el piso 38, la página 5).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Necesito doscientas sillas para la fiesta.',
      'Vivo en el tercer piso.',
      'Salimos el veinticinco de febrero.',
      'Mi hermano tiene quince años.',
      'El cuarenta por ciento de los alumnos estudia inglés.',
      'Compré una docena de huevos.',
    ],
    examplesNegative: ['*Necesito doscientos sillas para la fiesta.'],
    commonErrors: [
      'Leaving -cientos in the masculine regardless of the noun\'s gender, e.g. "*doscientos mujeres" instead of "doscientas mujeres".',
      'Forgetting to drop the final -o of primero/tercero before a masculine singular noun, e.g. "*el primero piso" instead of "el primer piso".',
      'Using uno instead of the shortened un before a masculine noun in compound numbers, e.g. "*veintiuno libros" instead of "veintiún libros".',
      'Dropping de after millón/millones, e.g. "*dos millones turistas" instead of "dos millones de turistas" (but "un millón doscientos mil euros" with no de).',
      'Copying the English cardinal-ordinal order, e.g. "*los primeros tres párrafos" instead of "los tres primeros párrafos".',
    ],
    selfRevealingElicitation: 'digit-form',
    elicitationSeedValues: [
      'primer', 'primera', 'segundo', 'segunda', 'tercer', 'tercera',
      'cuarto', 'cuarta', 'quinto', 'sexta', 'séptimo', 'octava',
      'noveno', 'décima',
      'veintiún', 'veintiuna', 'treinta y un', 'cuarenta y una',
      'doscientos', 'doscientas', 'trescientas', 'cuatrocientos',
      'quinientas', 'seiscientos', 'setecientas', 'ochocientos',
      'novecientas', 'ciento un',
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
      'Sentence negation with no placed immediately before the verb; sí/no as short answers to yes/no questions; and the también/tampoco pair for agreeing with a preceding affirmative (también) or negative (tampoco) statement. The tag ¿no? seeks confirmation (Usted habla inglés, ¿no?), and ya no expresses "no longer" (Ya no vivo aquí).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'No tengo hermanos.',
      'Me gusta el café, y a Marta también.',
      'No bebo alcohol, y mi hermano tampoco.',
      'Usted habla inglés, ¿no?',
      'Ya no vivimos aquí.',
    ],
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
      'Noun-modifying de: compound nouns without an article (el libro de español), possessive de contracted with the article (la página del libro), and con describing a permanent feature or contents (una casa con jardín, una cesta con pan). Attribute de also gives price, age, and measurement (un coche de diez mil dólares, un hombre de cuarenta años, tres metros de largo).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'Tengo un libro de español.',
      'La página del libro está rota.',
      'Vivo en una casa con jardín.',
      'Trae una cesta con pan y un vaso con agua.',
    ],
    examplesNegative: ['*La página de el libro está rota.'],
    commonErrors: [
      'Failing to contract de + el to del, e.g. "*la página de el libro" instead of "la página del libro".',
      'Using con instead of de to attach a noun modifier describing what something is made of or its type, e.g. "*un libro con español" instead of "un libro de español".',
      'Inserting an article after de in a compound noun, e.g. "*un libro de el español" instead of "un libro de español".',
      'Joining two nouns with a locative preposition on the English model ("*el libro en la mesa" instead of "el libro que está en la mesa" or "la casa de la colina").',
      'Breaking up a de-compound with an adjective ("*un lápiz barato de memoria" instead of "un lápiz de memoria barato").',
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

  {
    key: 'es-a1-locative-prepositions',
    kind: 'grammar',
    name: 'Locative prepositional phrases',
    description:
      'Static location with compound prepositions debajo de, encima de, delante de, detrás de, dentro de, fuera de, cerca de, lejos de, and al lado de (contracting de + el to del), plus entre ... y (between); normally with estar or hay (El gato está debajo de la mesa). Bare adverbs like fuera, dentro, arriba, abajo need no de (cenamos fuera; te espero abajo); motion uses adentro/afuera, adelante, atrás; entre also means "among" (entre mis amigos).',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      'El gato duerme debajo de la mesa.',
      'La farmacia está al lado del supermercado.',
      'Vivo cerca de la estación, entre el parque y el río.',
      'Vamos a cenar fuera esta noche.',
      'Sigue adelante y no mires hacia atrás.',
      'Entre mis amigos, nadie fuma.',
    ],
    examplesNegative: ['*El gato duerme debajo la mesa.', '*La farmacia está al lado de el supermercado.'],
    commonErrors: [
      'Dropping the linking de, producing "*debajo la mesa" or "*cerca la estación" instead of "debajo de la mesa" and "cerca de la estación".',
      'Failing to contract de + el after a compound locative, producing "*al lado de el supermercado" instead of "al lado del supermercado".',
      'Adding de after entre, producing "*entre de las dos calles" instead of "entre las dos calles".',
      'Using static detrás/delante where motion needs atrás/adelante ("*dar un paso detrás" instead of "dar un paso atrás").',
    ],
    prerequisiteKeys: ['es-a1-hay-estar'],
    // clozeUnsuitable (2026-07-11a): a paradigm-contrast point — encima/debajo/
    // delante/detrás all fit a bare blank, and blanking only the first word
    // strands the linking "de". The 2026-07-10 run approved 0/16 cloze drafts;
    // pool stands at 4 approved / 28 flagged cloze vs 15 approved / 4 flagged
    // translation. Translation supplies the position for free, so it carries it.
    clozeUnsuitable: true,
  },
  {
    key: 'es-a1-telling-time',
    kind: 'grammar',
    name: 'Telling the time',
    description:
      'Clock time with ser: singular for one o\'clock (Es la una) vs. plural for all other hours (Son las tres), fractions y cuarto / y media / menos veinte, asking ¿Qué hora es?, and scheduling with a + article (La clase es a las ocho). Includes approximations like a eso de las dos.',
    cefrLevel: A1,
    language: ES,
    examplesPositive: [
      '¿Qué hora es? — Son las tres y media.',
      'Es la una menos cuarto.',
      'La clase empieza a las ocho.',
      'Llegaré a eso de las dos.',
    ],
    examplesNegative: ['*Son la una.', '*Es las tres y media.'],
    commonErrors: [
      'Using the plural with one o\'clock ("*son la una" instead of "es la una").',
      'Using the singular for hours after one ("*es las tres" instead of "son las tres").',
      'Using en instead of a to schedule an event ("*la reunión es en las ocho" instead of "la reunión es a las ocho").',
    ],
    prerequisiteKeys: ['es-a1-numbers-ordinals'],
  },

  // ---------------------------------------------------------------------------
  // A2 (PCIC-aligned; Tasks 5–7)
  // ---------------------------------------------------------------------------
  {
    key: 'es-a2-present-irregular-stem-changes',
    kind: 'grammar',
    name: 'Present indicative — irregular stem changes',
    description:
      'Present-tense stem changes e→ie (pensar), o→ue (poder), and e→i (pedir) in all persons except nosotros/vosotros; the irregular yo-forms of saber (sé) and dar (doy); orthographic yo-form changes before o/a (coger → cojo, seguir → sigo); and the same boot pattern in -iar/-uar verbs that stress the í/ú (envío, actúo — but cambio) and -uir verbs that insert y (construyo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Pienso que tienes razón.',
      'Ella puede venir mañana, pero yo no puedo.',
      'Pido un café con leche.',
      'Yo sé cocinar, pero no sé bailar.',
      'Te doy mi número de teléfono.',
      'Te envío las fotos y ellos construyen la casa.',
    ],
    examplesNegative: ['*Ella piensa que nosotros piensamos lo mismo.', '*Yo sabo la respuesta.', '*Te envio las fotos.'],
    commonErrors: [
      'Overapplying the stem change to the nosotros/vosotros forms, producing "*piensamos" instead of "pensamos".',
      'Regularizing an irregular yo-form, producing "*yo sabo" or "*yo do" instead of "sé" and "doy".',
      'Missing the orthographic g→j or gu→g change in the yo-form of -ger/-gir/-guir verbs, producing "*cogo" or "*seguo" instead of "cojo" and "sigo".',
      'Missing the stressed accent or y-insertion inside the boot of -iar/-uar/-uir verbs, producing "*envio", "*actuo", or "*construo" instead of "envío", "actúo", and "construyo".',
    ],
    coverageSpec: {
      // 1pl DROPPED (2026-07-11b): the stem change vanishes in nosotros/vosotros
      // (the "boot" exception — pensamos/podemos/pedimos are regular), so every
      // 1pl draft is definitionally off-target for a point whose whole content is
      // the diphthong. The 2026-07-11 run floored 1pl and approved 0/all of them
      // across cloze/translation/conjugation (grammar-point-mismatch flags).
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '3pl': 5 } },
      ],
    },
    // Curated stem-changing verb pool (2026-07-11b): the conjugation generator drew
    // verbs from the frequency band and picked non-stem-changers — the 2026-07-11
    // run seeded "echar" (fully regular) and "saber"/"tener" (whose only present
    // irregularity is the yo-form / 1pl is regular), so 0/15 conjugation drafts were
    // approved. This closed list REPLACES the band (buildSeedWords, verb path) with
    // genuine e→ie / o→ue / e→i / u→ue verbs that diphthongize in every floored
    // person. yo-only irregulars (saber/dar) and -go verbs (tener/venir/decir) are
    // deliberately excluded — they belong to es-a1-present-yo-go, not here.
    conjugationSeedWords: [
      // e→ie
      'pensar', 'querer', 'entender', 'empezar', 'cerrar', 'preferir', 'perder',
      // o→ue
      'poder', 'volver', 'dormir', 'contar', 'encontrar', 'recordar',
      // e→i
      'pedir', 'seguir',
      // u→ue
      'jugar',
    ],
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
    // Closed target set matching the description: the 2026-07-09 run wandered onto
    // out-of-scope verbs (salir — fully regular; poder/castigar — belong to
    // strong-stems / orthographic points), so 14/40 drafts were rejected for
    // grammar-point mismatch. Curated verbs pin the generator to this point's
    // paradigm; 7 verbs × 5 persons comfortably exceeds the level target (no
    // targetOverride needed). ser/ir both listed (shared fui/fue forms).
    conjugationSeedWords: ['tener', 'hacer', 'estar', 'ser', 'ir', 'ver', 'dar'],
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-preterite-strong-stems',
    kind: 'grammar',
    name: 'Preterite — strong stems (pude, puse, dije...)',
    description:
      'The remaining strong preterites: u-stems poder (pude), poner (puse), saber (supe), caber (cupe), i-stems querer (quise) and venir (vine), and j-stems decir (dije), traer (traje), conducir (conduje); all take unstressed -e/-o endings, and j-stems take -eron, not -ieron (dijeron, trajeron).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'No pude dormir anoche.',
      'Mis abuelos vinieron a vernos y trajeron un pastel.',
      'Me lo dijeron ayer por la tarde.',
      'No cupimos todos en el coche.',
    ],
    examplesNegative: ['*No podí dormir anoche.', '*Me lo dijieron ayer.'],
    commonErrors: [
      'Regularizing the strong stem, producing "*podí", "*ponió", or "*vení" instead of "pude", "puso", and "vine".',
      'Using -ieron after a j-stem, producing "*dijieron" or "*trajieron" instead of "dijeron" and "trajeron".',
      'Stressing and accenting the 1sg/3sg endings by analogy with regular preterites, producing "*pudé" or "*vinó" instead of "pude" and "vino".',
    ],
    prerequisiteKeys: ['es-a2-preterite-irregular'],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    // Same wandering bug as es-a2-preterite-irregular (40% conjugation approval on
    // 2026-07-09): pin to the strong-stem verbs named in the description so the
    // generator stops drilling regular verbs. 9 verbs × 5 persons exceeds target.
    conjugationSeedWords: [
      'poder', 'poner', 'saber', 'querer', 'venir',
      'decir', 'traer', 'conducir', 'producir',
    ],
    conjugationSuitable: true,
  },
  {
    // Narrowed 2026-07-11: this point formerly bundled 3rd-person vowel/y changes
    // (3sg/3pl) with yo-form -qué/-gué/-cé spelling changes (1sg). The two have
    // DISJOINT diagnostic persons, but the seed picker assigns person independently
    // of the verb — so a 1sg -car verb kept landing on a 3sg target (buscó, regular)
    // and vice-versa, giving 19% approval. Split: the -qué/-gué/-cé family moved to
    // the new es-a2-preterite-yo-spelling; this point now covers 3rd-person only.
    key: 'es-a2-preterite-stem-spelling',
    kind: 'grammar',
    name: 'Preterite — third-person vowel and y changes',
    description:
      'Third-person preterite changes: e→i / o→u stem-vowel shift in -ir verbs (pidió/pidieron, durmió/durmieron, sintió, siguió) and y between vowels in vowel-stem -er/-ir verbs (leyó/leyeron, oyó, cayó, construyó). Only 3sg/3pl are affected; the other persons are regular.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Pidió un café y se durmió en el sofá.',
      'Leyó la noticia y siguió trabajando.',
      'Prefirieron quedarse y no me creyeron.',
    ],
    examplesNegative: ['*Pedió un café.', '*Se dormió en el sofá.', '*Leió la noticia.'],
    commonErrors: [
      'Keeping the infinitive vowel in the third person, producing "*pedió" or "*dormió" instead of "pidió" and "durmió".',
      'Writing i instead of y between vowels, producing "*leió" or "*oió" instead of "leyó" and "oyó".',
      'Applying the third-person change to other persons, producing "*pidí" or "*durmí" instead of the regular "pedí" and "dormí".',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
    coverageSpec: {
      // 3sg/3pl ONLY — the change surfaces nowhere else; curated verbs are all
      // diagnostic in both, so verb↔person always aligns. targetOverride sizes the
      // point (2 persons) to a bounded pool.
      axes: [{ name: 'person', floors: { '3sg': 8, '3pl': 8 } }],
    },
    conjugationSeedWords: [
      'pedir', 'servir', 'seguir', 'repetir', 'sentir', 'preferir', 'dormir',
      'morir', 'leer', 'creer', 'oír', 'caer', 'construir', 'huir',
    ],
    targetOverride: 16,
    conjugationSuitable: true,
  },
  {
    // Added 2026-07-11 (split from es-a2-preterite-stem-spelling): the yo-form
    // orthographic changes, whose only diagnostic person is 1sg.
    key: 'es-a2-preterite-yo-spelling',
    kind: 'grammar',
    name: 'Preterite — yo-form spelling changes (-qué/-gué/-cé)',
    description:
      'First-person singular preterite spelling changes that keep the stem sound: -car→-qué (buscar→busqué, tocar→toqué), -gar→-gué (llegar→llegué, pagar→pagué), -zar→-cé (empezar→empecé, cruzar→crucé). Only the yo-form changes; the other persons are regular (buscó, llegó, empezó). Rare -guar verbs also take a dieresis: averiguar → averigüé.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Ayer llegué tarde y busqué otra ruta.',
      'Empecé el trabajo y toqué el piano.',
      'Pagué la cuenta y crucé la calle.',
      'Averigüé su dirección anoche.',
    ],
    examplesNegative: ['*Ayer llegé tarde.', '*Empezé el trabajo.', '*Buscé la llave.'],
    commonErrors: [
      'Dropping the spelling change and writing the plain stem: "*llegé", "*buscé", or "*empezé" instead of "llegué", "busqué", and "empecé".',
      'Spreading the yo-form change to other persons, producing "*buscó" with qu ("*busqó") or "*empezó" as "*empecó".',
      'Confusing -zar: writing "*empezé" or "*cruzé" instead of "empecé" and "crucé".',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
    coverageSpec: {
      // 1sg ONLY — the orthographic change surfaces only in the yo-form.
      axes: [{ name: 'person', floors: { '1sg': 15 } }],
    },
    conjugationSeedWords: [
      'buscar', 'sacar', 'tocar', 'explicar', 'practicar', 'llegar', 'pagar',
      'jugar', 'entregar', 'apagar', 'empezar', 'cruzar', 'almorzar',
      'organizar', 'realizar',
    ],
    targetOverride: 15,
    conjugationSuitable: true,
  },
  {
    key: 'es-a2-imperfect',
    kind: 'grammar',
    name: 'Imperfect',
    description:
      'Imperfect tense for descriptions, background states, and habitual past actions (cuando era niño, íbamos a la playa cada verano); the three irregular imperfects ser (era), ir (iba), and ver (veía); its contrast with the preterite for a single completed event; and the courtesy imperfect for polite requests (Quería hablar con el director).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Cuando era niño, iba a la playa todos los veranos.',
      'Mientras yo leía, mi hermana veía la televisión.',
      'Llovía mucho cuando llegamos a casa.',
      'Buenos días, quería un kilo de tomates.',
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
      'Present perfect (pretérito perfecto): haber + past participle for actions within a period that includes now; the irregular participles hecho, escrito, visto, dicho, puesto, vuelto, abierto, roto, and muerto; and the time markers ya, todavía no, and hoy that anchor it to the present. In European Spanish any just-now or same-day event takes the perfect (Esta mañana me he levantado a las seis).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Hoy he hecho mucho ejercicio.',
      'Todavía no he escrito la carta.',
      '¿Ya has visto la nueva película?',
      'La he visto hace un momento.',
    ],
    examplesNegative: ['*Hoy he escribido la carta.'],
    commonErrors: [
      'Regularizing irregular participles: "*hacido" for "hecho", "*escribido" for "escrito", "*rompido" for "roto", "*ponido" for "puesto", "*volvido" for "vuelto".',
      'Making the past participle agree in gender/number with the subject when used with haber, e.g. "*he hecha la tarea" instead of "he hecho la tarea".',
      'Using the simple preterite (hice) instead of the perfect when a marker like ya, todavía no, or hoy signals a period that still includes the present.',
      'Inserting an adverb between haber and the participle on the English or French model, producing "*he siempre dicho" instead of "siempre he dicho" or "he dicho siempre" — nothing intervenes, and clitics attach to haber (habértelo dicho).',
      'Deleting the participle in a short answer on the English model, producing "—¿Has probado las fresas? —*Sí, he" instead of "Sí, las he probado" or simply "Sí".',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
  },
  {
    key: 'es-a2-imperative-affirmative',
    coverageSpec: {
      axes: [
        // Direct analogue of the collapsed TR imperative (PR #588): tú
        // (incl. the eight irregulars di/haz/pon…) vs subjunctive-based
        // usted/ustedes are different morphologies. No polarity axis — the
        // negative imperative is es-b1-imperative-negative-pronouns.
        { name: 'person', floors: { '2sg': 10, '3sg': 8, '3pl': 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Affirmative imperative',
    description:
      'Affirmative imperative: regular tú (habla, come, vive) and vosotros (hablad, comed, vivid) forms; the eight irregular tú forms di, haz, pon, sal, ten, ven, sé, ve; usted/ustedes forms built on the present subjunctive; enclitic pronouns (cómpralo, dímelo); and the pronominal imperative of estar (estate quieto, estense tranquilos).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Habla más despacio, por favor.',
      'Ven aquí y ponte el abrigo.',
      'Cómprelo usted en la farmacia.',
      'Estate quieto un momento, por favor.',
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
      'Gerund formation (-ando/-iendo, with stem changes like durmiendo/pidiendo and y-insertion like leyendo) combined with estar for the present/past continuous; and enclitic pronouns attached to the gerund (leyéndolo / lo estoy leyendo). Estar in other tenses frames a bounded stretch (Estuve hablando dos horas) or progress at a future moment (Mañana a estas horas estaremos volando).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Estoy leyendo un libro muy interesante.',
      'Estábamos durmiendo cuando sonó el teléfono.',
      'Estoy escribiéndola ahora mismo.',
      'Lo estuve buscando un buen rato.',
      'Estás siendo muy amable hoy.',
    ],
    examplesNegative: ['*Estoy leendo un libro.', '*Estoy yendo al trabajo en metro.'],
    commonErrors: [
      'Forgetting the y-insertion in gerunds of -er/-ir verbs whose stem ends in a vowel, producing "*leendo" instead of "leyendo".',
      'Missing the stem change in the gerund of pedir- and dormir-type verbs, producing "*pediendo" or "*dormiendo" instead of "pidiendo" and "durmiendo".',
      'Dropping the written accent when two pronouns are attached to the gerund, producing "*leyendosela" instead of "leyéndosela".',
      'Using the continuous where Spanish rejects it — with ir/venir/poder, for states, or for posture — producing "*estoy yendo", "*está llevando corbata", or "*está sentándose" instead of "voy", "lleva corbata", and "está sentado".',
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
      'Modal and aspectual periphrases tener que (obligation), hay que (impersonal necessity), acabar de (to have just done), empezar a (to begin), volver a (to do again), and soler (habit); the optional clitic shift (verlo / lo + conjugated verb); and recién + participle for "newly/just done" (recién pintado, recién casados).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Tengo que devolvértelo mañana.',
      'Suelo desayunar café con tostadas.',
      'Volvió a llamarme por la tarde.',
      'Acabo de terminar la tarea.',
      'Cuidado: el banco está recién pintado.',
    ],
    examplesNegative: ['*Lo hay que hacer.'],
    commonErrors: [
      'Shifting the clitic before hay que, producing "*lo hay que hacer" instead of the only correct form, "hay que hacerlo".',
      'Confusing volver a + infinitive ("to do again") with volver used literally ("to return"), or acabar de + infinitive ("to have just done") with acabar used literally ("to finish").',
      'Using soler outside the present and imperfect, where it does not occur, instead of rephrasing with normalmente or generalmente.',
    ],
  },
  {
    key: 'es-a2-saber-poder-ability',
    kind: 'grammar',
    name: 'Saber vs. poder for ability',
    description:
      'Saber + infinitive for a learned skill (Sé nadar, ¿Sabes conducir?) versus poder + infinitive for circumstantial possibility, capacity, or permission (Hoy no puedo nadar, ¿Puedo entrar?); English "can" covers both, so the verb is chosen by meaning, not translation.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Sé nadar, pero hoy no puedo porque la piscina está cerrada.',
      '¿Sabes tocar la guitarra?',
      '¿Puedo abrir la ventana?',
    ],
    examplesNegative: ['*Puedo tocar el piano desde los cinco años.', '*Sé a nadar.'],
    commonErrors: [
      'Using poder for a learned skill, producing "*puedo tocar el piano" for "sé tocar el piano" when general ability rather than a concrete occasion is meant.',
      'Using saber for a one-off possibility or permission, producing "*¿sabes venir mañana?" instead of "¿puedes venir mañana?".',
      'Inserting a preposition or que after saber, producing "*sé a nadar" or "*sé que nadar" instead of "sé nadar".',
    ],
    prerequisiteKeys: ['es-a1-querer-poder-infinitive'],
  },
  {
    key: 'es-a2-direct-object-pronouns',
    kind: 'grammar',
    name: 'Direct object pronouns',
    description:
      'Direct object pronouns lo/la/los/las (plus neuter lo for ideas/predicates) agree with the noun replaced; proclisis before a conjugated verb (Lo veo) vs. enclisis on infinitives/gerunds/positive imperatives (verlo, cómpralo), and the periphrastic shift (lo voy a comprar / voy a comprarlo). Usted/ustedes take these third-person forms (Doctora, la llamé ayer = I called you).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Compré el libro y lo leí en un día.',
      'Quiero verlo mañana.',
      'Lo quiero ver mañana.',
      'Cómpralo si te gusta.',
      'Doctora, la llamé ayer pero no contestó.',
    ],
    examplesNegative: ['*Compré la revista pero no lo leí.', '*Veolo cada día.'],
    commonErrors: [
      'Attaching the pronoun to a conjugated (finite) verb form instead of placing it before it, producing "*veolo" instead of "lo veo".',
      'Mismatching the pronoun\'s gender with the noun it replaces, e.g. "*no lo leí" for la revista (feminine) instead of "no la leí".',
      'Confusing the neuter lo (referring to a whole idea or clause) with the masculine lo, e.g. hesitating over "¿Sabes que llegó tarde?" "Sí, lo sé", where lo stands for the entire clause, not a masculine noun.',
      'Shifting the clitic where climbing is barred — with hay que, parecer, or verbs of saying/believing — producing "*lo hay que hacer" or "*lo creen saber" instead of "hay que hacerlo" and "creen saberlo".',
    ],
  },
  {
    key: 'es-a2-indirect-object-pronouns-se',
    kind: 'grammar',
    name: 'Indirect object pronouns and se',
    description:
      'Indirect object pronouns le/les, the obligatory le→se before a third-person direct-object clitic (se lo doy, never *le lo doy), clitic doubling with a named indirect object (le di el libro a Juan), and the dative of possession replacing a possessive adjective (Se le rompió el brazo); clitics follow the fixed order se > te/os > me/nos > lo/la/los/las (Se te ha caído la tinta).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Le doy el regalo a mi madre.',
      'Se lo doy a ella.',
      'Se le cayó el vaso a Juan.',
      'Se te ha caído la tinta.',
    ],
    examplesNegative: ['*Le lo doy a ella.', '*Les lo dije a mis padres.'],
    commonErrors: [
      'Keeping le/les before a third-person direct-object clitic instead of replacing it with se, producing "*le lo doy" or "*les lo dije" instead of "se lo doy" and "se lo dije".',
      'Confusing le/les (indirect object, gaining or losing) with lo/la/los/las (direct object) when the verb clearly involves someone benefiting or losing something, e.g. treating "le robaron la cartera" as if the person should be lo/la instead of le.',
      'Omitting the doubled le/les when the indirect object is a proper name or definite noun following the verb, producing the less natural "di el regalo a Juan" instead of the usual "le di el regalo a Juan".',
      'Putting me/te before se, producing "*me se cayó el vaso" instead of "se me cayó el vaso" — se always comes first in a clitic cluster.',
    ],
  },
  {
    key: 'es-a2-tonic-pronouns-prepositions',
    kind: 'grammar',
    name: 'Tonic pronouns after prepositions',
    description:
      'Tonic pronoun forms mí and ti after prepositions (de mí, para ti), the fused conmigo/contigo, and a mí/a ti reduplication for contrast (A mí me gusta el café, pero a ti no); the exceptions entre, según, hasta, and incluso take subject forms instead (entre tú y yo, según tú); reflexive third person uses sí (mismo) and consigo (hablan entre sí, disgustado consigo mismo), though speech often prefers él/ella.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Este regalo es para ti.',
      '¿Quieres venir conmigo al cine?',
      'A mí me encanta el chocolate, pero a ti no.',
      'Entre tú y yo, esto es un secreto.',
      'Está disgustado consigo mismo.',
    ],
    examplesNegative: ['*Este regalo es para tú.', '*¿Vienes con mí al cine?', '*Entre ti y mí, esto es un secreto.'],
    commonErrors: [
      'Using the subject pronoun tú instead of the tonic form ti after a preposition, producing "*para tú" instead of "para ti".',
      'Failing to fuse con with mí/ti, producing "*con mí" and "*con ti" instead of the mandatory conmigo and contigo.',
      'Dropping the accent on mí, confusing it with the possessive mi ("my"), e.g. writing "de mi" when the prepositional pronoun "de mí" is meant.',
      'Using the tonic forms after the exception prepositions, producing "*entre ti y mí" or "*según ti" instead of "entre tú y yo" and "según tú".',
      'Using a clitic with verbs of motion instead of preposition + tonic pronoun, producing "*se le acercó" instead of "se acercó a ella".',
    ],
  },
  {
    key: 'es-a2-personal-a',
    kind: 'grammar',
    name: 'Personal a',
    description:
      'Personal a before a direct object naming a specific person or pet (Vi a Juan), omitted before unspecified people or things (Busco un médico, Vi el coche) — but obligatory before alguien, nadie, and quién (No veo a nadie); a + tonic pronoun still needs the clitic (Lo vi a él, not *Vi a él). With querer/tener, a shifts the sense: querer a un hijo = love him, querer un hijo = want one.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Vi a Juan en el parque.',
      'No conozco a tu hermana.',
      'Necesito un médico esta tarde.',
      'No veo a nadie en la oficina.',
      'Me trataba como a una reina.',
      'Admiro al pueblo cubano.',
    ],
    examplesNegative: ['*Vi Juan en el parque.', '*Vi a él ayer.', '*No veo nadie en la oficina.'],
    commonErrors: [
      'Omitting personal a before a specific human direct object, producing "*vi Juan ayer" instead of "vi a Juan ayer".',
      'Dropping a before alguien/nadie/quién, producing "*no veo nadie" instead of "no veo a nadie" — the a is obligatory even though the referent is non-specific.',
      'Adding personal a before an indefinite person not yet identified, producing "*busco a un médico" when no particular doctor is meant.',
      'Treating a + tonic pronoun as a replacement for the clitic rather than an addition to it, producing "*vi a él" instead of "lo vi a él" (or simply "lo vi").',
      'Adding a before place names after verbs like visitar or abandonar ("*visité a Madrid" instead of "visité Madrid"), even though collective nouns read as people do take it (Admiro al pueblo cubano).',
    ],
  },
  {
    key: 'es-a2-reflexive-verbs',
    coverageSpec: {
      axes: [
        // The pronoun must agree in person with the subject (me levanto /
        // nos levantamos — commonError '*nos levanta'); collapse to 3sg se
        // or 1sg me guts the paradigm.
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Reflexive verbs',
    description:
      'Reflexive pronouns me/te/se/nos/os with daily-routine verbs (levantarse, ducharse, vestirse, acostarse), agreeing in person with the subject; placed before a conjugated verb (Me levanto a las siete) or attached to an infinitive, gerund, or positive imperative (levantarme, levantándome, levántate). Also marks intransitives (casarse, dormirse), always-pronominal quejarse/atreverse a, and "get done for oneself" (me voy a cortar el pelo).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Me levanto a las siete todos los días.',
      'Ella se ducha antes de desayunar.',
      '¿A qué hora te acuestas?',
      'Mi hermana se casó el año pasado.',
      'Mañana me voy a cortar el pelo.',
    ],
    examplesNegative: ['*Levanto a las siete.', '*Nos levanta muy temprano.'],
    commonErrors: [
      'Omitting the reflexive pronoun altogether, producing "*levanto a las siete" instead of "me levanto a las siete".',
      'Mismatching the pronoun and verb person, producing "*nos levanta" instead of "nos levantamos".',
      'Attaching the pronoun to a conjugated verb instead of placing it before it, producing "*duchome" instead of "me ducho".',
      'Dropping se from an inherently pronominal verb, producing "*quejo de todo" or "*atrevo a hacerlo" instead of "me quejo de todo" and "me atrevo a hacerlo".',
    ],
  },
  {
    key: 'es-a2-gustar-type-verbs',
    coverageSpec: {
      axes: [
        // The full experiencer series me/te/le/nos/les IS the A2 delta over
        // es-a1-gustar-basic; person here pins the dative experiencer.
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
        // The verb agrees with the thing liked, not the person (le duelen
        // los pies — commonError '*me duele los pies').
        { name: 'number', floors: { singular: 8, plural: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Gustar-type verbs (extended)',
    description:
      'Extends the A1 me/te gusta pattern to the full series me/te/le/nos/os/les with encantar, doler, interesar; the verb agrees with the thing liked/hurting, not the person (Le duelen los pies); a + tonic reduplication clarifies or contrasts who is affected (A Juan le interesa la historia, a mí no). Resultar and ser + adjective follow the same pattern (me resulta difícil, le es útil).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Le duelen los pies después de correr.',
      'Nos encanta viajar en verano.',
      'A mí me interesa la política, pero a ella no le interesa nada.',
      'Me resulta difícil madrugar.',
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
      'Article use/omission: generic article with abstract/mass nouns; el/un before feminine tonic-a nouns (el aula); definite article for clothing/possessions, days of the week (el lunes = on Monday, los lunes habitually), titles outside direct address (la señora Ruiz), and places like en el hospital; none with professions (Es profesora), unspecified mass nouns (Bebe agua), or languages after hablar/en (hablo español — but el español de Chile).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'El aula de física está al final del pasillo.',
      'Mi hermana es profesora, pero es una profesora muy exigente.',
      'Antes de salir, se puso el abrigo y los guantes.',
      'El chocolate es malo para los perros.',
      'Bebe agua con las comidas.',
      'Vuelvo al trabajo el lunes.',
    ],
    examplesNegative: ['*La aula de física está al final del pasillo.', '*Mi hermana es una profesora.', '*Vuelvo al trabajo en lunes.'],
    commonErrors: [
      'Using la instead of el before singular feminine nouns beginning with a stressed a- or ha- sound ("*la aula", "*la águila"), even though the noun stays grammatically feminine (las aulas, las águilas).',
      'Inserting a possessive where Spanish uses the definite article for clothing and personal belongings ("*se puso su abrigo" instead of "se puso el abrigo").',
      'Adding un/una before an unqualified profession noun after ser, on the model of English "she is a teacher" ("*es una profesora" for plain "es profesora"), then forgetting the article reappears once the noun is qualified ("es una profesora excelente").',
      'Adding an unneeded article with unspecified mass or plural objects ("*Bebo el agua con cada comida" when no specific water is meant).',
      'Inserting en with days of the week on the English model ("*en lunes" instead of "el lunes"), or dropping the article altogether ("*voy lunes", "*dos veces a semana" instead of "dos veces a la semana").',
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
      "Todo/toda requiring a following article, possessive, or demonstrative for 'the whole/all' (todos los estudiantes); otro/otra never preceded by un/una (otro café); demasiado/a agreeing as an adjective (demasiados problemas) but invariable as an adverb; nada/nadie as negative pronouns; and varios/varias 'several', agreeing and article-free before the noun (en varias partes del país).",
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Toda la clase aprobó el examen.',
      'No quiero este café, ponme otro.',
      'Has traído demasiados libros para un solo viaje.',
      'No hay nadie en la oficina y no quiero nada de postre.',
      'Compré varios libros y varias revistas.',
    ],
    examplesNegative: ['*Todo los estudiantes llegaron tarde.', '*Ponme un otro café.'],
    commonErrors: [
      'Dropping or misagreeing the determiner after todo when it means "the whole of/all" ("*todo los estudiantes" instead of "todos los estudiantes").',
      'Inserting un/una before otro on the model of English "another" ("*un otro café" instead of "otro café").',
      'Leaving demasiado invariable before a noun instead of agreeing it in number and gender ("*demasiado problemas" instead of "demasiados problemas").',
    ],
  },
  {
    key: 'es-a2-cada-mismo',
    kind: 'grammar',
    name: 'Cada and mismo',
    description:
      'Invariable distributive cada (cada día, cada dos semanas, cada uno de mis amigos — never *cadas or gender-marked) versus agreeing el mismo / la misma (... que) for sameness (llevamos la misma camiseta que ayer), plus emphatic yo mismo / ella misma; agreeing propio for own/self-same (mi propio coche, el propio autor); and distributive de dos en dos (entraban de dos en dos).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Voy al gimnasio cada dos días.',
      'Trabajamos en la misma oficina que el año pasado.',
      'Lo preparé yo misma.',
      'Lo vi con mis propios ojos.',
      'Los niños entraban de dos en dos.',
    ],
    examplesNegative: ['*Cadas mañanas corro por el parque.', '*Tenemos el mismo profesor como el año pasado.'],
    commonErrors: [
      'Pluralizing or gender-marking cada ("*cadas mañanas", "*cada casas") — it is invariable and takes a singular noun unless a numeral intervenes (cada dos días).',
      'Using como instead of que after mismo ("*el mismo profesor como antes" instead of "el mismo profesor que antes").',
      'Dropping the article before mismo ("*tenemos mismo horario" instead of "tenemos el mismo horario").',
    ],
  },
  {
    key: 'es-a2-temporal-clauses',
    kind: 'grammar',
    name: 'Temporal clauses: cuando, antes de, después de, desde, hasta',
    description:
      'Cuando + present indicative for habitual time relations (cuando llueve, cojo el paraguas); antes de / después de + infinitive with a shared subject; desde/desde que/desde hace for duration since a point or over a length of time (desde 2020 / desde hace tres años); hasta for "until"; and bare antes "before(hand)" with antes que + pronoun (Lola se levantó antes que nadie), distinct from the formal preposition ante.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Cuando llueve, cojo el paraguas.',
      'Antes de salir, apago las luces.',
      'Después de cenar, vemos la televisión.',
      'Vivo en Madrid desde 2020, y estudio español desde hace tres años.',
      'La tienda está abierta hasta las nueve de la noche.',
      'Lola se levantó antes que nadie.',
    ],
    examplesNegative: ['*Antes de salgo, apago las luces.', '*Vivo aquí desde tres años.'],
    commonErrors: [
      'Using a conjugated verb after antes de/después de instead of the infinitive when both clauses share the same subject ("*antes de salgo" instead of "antes de salir").',
      'Confusing desde (a starting point) with desde hace (a length of time): "*vivo aquí desde tres años" instead of "vivo aquí desde hace tres años".',
      'Dropping the accent on interrogative cuándo in direct or indirect questions, confusing it with the unaccented conjunction cuando ("*no sé cuando llega" instead of "no sé cuándo llega").',
    ],
    // clozeUnsuitable (2026-07-11a): a paradigm-contrast point — antes de /
    // después de (and cuando/desde/hasta) both fit a bare blank, so real-world
    // inference, not grammar, decides the answer. The 2026-07-10 run flagged
    // 16/20 cloze drafts as ambiguous; pool stands at 12 approved / 67 flagged
    // cloze vs 28 approved / 9 flagged translation. Translation fixes the
    // connector via the source sentence, so it carries the point.
    clozeUnsuitable: true,
  },
  {
    key: 'es-a2-hace-ago',
    kind: 'grammar',
    name: 'Hace + time period = "ago"',
    description:
      'Hace + period with a past tense to place an event a period back from now (Llegué hace dos años; Hace una semana vimos esa película), contrasted with desde hace + period for a still-ongoing duration (Vivo aquí desde hace un año); hace never changes form in this use.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Llegué a España hace dos años.',
      'Hace una semana vimos esa película.',
      'Trabajo aquí desde hace seis meses.',
    ],
    examplesNegative: ['*Llegué a España dos años hace.', '*Hacen dos años que llegué.'],
    commonErrors: [
      'Placing hace after the period on the model of English "two years ago", producing "*dos años hace" instead of "hace dos años".',
      'Pluralizing hace to agree with the period, producing "*hacen dos años" instead of "hace dos años".',
      'Confusing the "ago" pattern with the duration pattern, producing "*la vi desde hace dos días" when "la vi hace dos días" (ago) is meant.',
    ],
    prerequisiteKeys: ['es-a2-preterite-regular'],
  },
  {
    key: 'es-a2-si-present-conditional',
    kind: 'grammar',
    name: 'Open conditions with si + present',
    description:
      'Open conditional sentences: si + present indicative in the protasis, with present, future, or imperative in the apodosis (si llueve, me quedo / iré / quédate); si is never followed by the future tense; and the spelling contrast between si ("if") and sí ("yes"/emphatic). Si also takes the perfect for by-then completion (Si no ha cambiado para el viernes, avísame) and past indicatives for fulfilled or habitual conditions.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Si llueve, me quedo en casa.',
      'Si tienes tiempo, llámame esta tarde.',
      'Si terminas pronto, iremos al cine.',
      '—¿Vienes a la fiesta? —Sí, claro que voy.',
      'Si no ha cambiado para el viernes, avísame.',
      'Si teníamos dinero, íbamos al teatro.',
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
      'Exclamative ¡Qué + adjective/adverb! (¡qué caro!, ¡qué bien!), ¡Qué + noun! with no article (¡qué vida!), and ¡Qué + noun + tan/más + adjective! (¡Qué día tan bonito!); fixed exhortatives with que (¡Que aproveche!); and impersonal weather hace calor/frío/sol, estamos a quince grados.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      '¡Qué caro es este restaurante!',
      '¡Qué bien cocinas!',
      '¡Qué película tan aburrida!',
      '¡Que tengas un buen viaje!',
      'Hace mucho calor en verano.',
      'Estamos a quince grados esta mañana.',
    ],
    examplesNegative: ['*¡Qué un día tan bonito hace!', '*El tiempo hace mucho calor hoy.'],
    commonErrors: [
      'Inserting un/una after qué in an exclamation ("*¡qué un día tan bonito!" instead of "¡qué día tan bonito!").',
      'Dropping tan/más between the noun and its adjective ("*¡qué día bonito!" instead of "¡qué día tan bonito!" or "¡qué día más bonito!").',
      'Adding an explicit subject to the impersonal weather verb hacer ("*el tiempo hace calor" instead of simply "hace calor").',
      'Omitting a before the number when stating a temperature with estar ("*estamos quince grados" instead of "estamos a quince grados").',
    ],
  },
  {
    key: 'es-a2-connectors',
    kind: 'grammar',
    name: 'Connectors: e/u substitution, por eso, entonces',
    description:
      'Substitution of y with e before a word beginning with an /i/ vowel sound (Fernando e Ignacio) but not before the hie- glide (agua y hielo); substitution of o with u before a word beginning with o- or ho- (diez u once); por eso / entonces to introduce a result or consequence; and luego "afterwards/later on" vs. entonces "then/at that moment" (both can mean "in that case").',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Fernando e Ignacio llegaron tarde.',
      'Necesito diez u once minutos más.',
      'Compramos agua y hielo para la fiesta.',
      'Perdí el autobús; por eso llegué tarde.',
      'No tenía dinero, entonces pedí un préstamo.',
      'Primero cenamos y luego vimos una película.',
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
      'The indefinite/negative pairs algo/nada, alguien/nadie, alguno/ninguno (apocopated algún/ningún), and siempre/nunca; a negative word placed after the verb requires a preceding no (No veo nada), but one placed before the verb drops it (Nunca voy, Nadie vino), as does en mi vida (En mi vida lo he visto); adverbial nada = "not at all" (No me gusta nada) and ni siquiera = "not even" (Ni siquiera me llamó) extend the set.',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'No veo nada interesante en la tele.',
      'Nunca voy al cine los lunes.',
      '¿Tienes algún problema? No, no tengo ninguno.',
      'Ni siquiera me llamó para avisarme.',
      'En mi vida he visto algo así.',
    ],
    examplesNegative: ['*Nadie no vino a la fiesta.'],
    commonErrors: [
      'Adding a redundant preceding no before a negative word that already precedes the verb, e.g. "*nadie no vino" instead of "nadie vino" or "no vino nadie".',
      'Dropping the preceding no when the negative word follows the verb, e.g. "*veo nada" instead of "no veo nada".',
      'Using the affirmative algo/alguien instead of the negative nada/nadie in a plain negated sentence, e.g. "*no tengo algo" instead of "no tengo nada".',
      'Using unos before de, producing "*unos de los alumnos" instead of "algunos de los alumnos" — only algunos quantifies a de-phrase.',
    ],
  },
  {
    key: 'es-a2-por-para',
    kind: 'grammar',
    name: 'Por vs. para',
    description:
      'The por/para contrast: por expresses cause or reason (lo hice por ti), exchange (cambio esto por aquello), duration (por dos años), means or channel (por correo, me enteré por un amigo), fetching after ir/venir (voy por pan; Spain a por pan), and movement through or vague location (paso por el parque, estará por aquí); para marks a recipient or a deadline (un regalo para ti, listo para el lunes).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Lo hice por ti, no por mí.',
      'Cambié mi coche por uno nuevo.',
      'Este regalo es para ti; lo necesito para el lunes.',
      'Caminamos por el parque todos los días.',
      'Me enteré de la noticia por un amigo.',
      'Mi padre ha salido a por pan.',
    ],
    examplesNegative: ['*Cambié mi coche para uno nuevo.'],
    commonErrors: [
      'Using para instead of por to express exchange or substitution, e.g. "*cambié mi coche para uno nuevo" instead of "cambié mi coche por uno nuevo".',
      'Using para instead of por to express the cause or reason behind an action, e.g. "*estoy triste para la noticia" instead of "estoy triste por la noticia".',
      'Using por instead of para to mark who something is intended for, e.g. "*este regalo es por ti" instead of "este regalo es para ti".',
      'Rendering English "for + time period" with para (or overusing por) when Spanish uses durante, desde hace, or nothing, producing "*estuve en Roma para dos semanas" instead of "estuve en Roma dos semanas".',
    ],
  },
  {
    key: 'es-a2-mente-adverbs',
    kind: 'grammar',
    name: 'Adverbs in -mente',
    description:
      'Adverb formation: -mente added to the feminine adjective form (rápida → rápidamente) or invariable form (fácil → fácilmente, keeping any written accent); -mente drops from all but the last of coordinated adverbs (lenta y claramente); the suppletive adverbs bien/mal; invariable adjective-adverbs with set verbs (hablar claro, comprar barato, respirar hondo); and viewpoint -mente (Económicamente, el país va mal).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Habla lenta y claramente.',
      'Explicó el problema fácilmente.',
      'Canta muy bien, pero baila mal.',
      'Personalmente, lo dudo.',
      'Habla más alto, por favor.',
    ],
    examplesNegative: ['*Canta muy bueno.', '*Habla rápidomente.'],
    commonErrors: [
      'In careful written Spanish, keeping -mente on every coordinated adverb instead of dropping it from all but the last, e.g. writing "lentamente y claramente" instead of the preferred "lenta y claramente".',
      'Adding -mente to the masculine adjective form instead of the feminine, e.g. "*rápidomente" instead of "rápidamente".',
      'Using the adjective bueno/malo instead of the suppletive adverb bien/mal after a verb, e.g. "*canta muy bueno" instead of "canta muy bien".',
      'Attaching -mente to adjectives that reject it (ordinals, nationalities, physical appearance), producing "*segundamente" or "*argentinamente" instead of "en segundo lugar" or "a la argentina".',
      'Modifying one -mente adverb with another ("*increíblemente rápidamente") instead of recasting with con + noun ("con una rapidez increíble").',
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
  {
    key: 'es-a2-diacritic-pairs',
    kind: 'grammar',
    name: 'Diacritic accent pairs (tú/tu, sé/se...)',
    description:
      'The written accent that separates otherwise identical words: tú/tu, él/el, mí/mi, sé/se, dé/de, té/te, sí/si, más/mas, and aún (= todavía) / aun (= incluso); the accented member is the stressed pronoun, verb, or adverb, the bare one the unstressed function word; also solo "alone" agreeing (volvió sola) vs. adverb solo/sólo "only" (accent optional), and assertive sí que (¡Sí que vendrá!) vs. rejoinder pero si (¡Pero si te oí!).',
    cefrLevel: A2,
    language: ES,
    examplesPositive: [
      'Tú siempre olvidas tu paraguas.',
      'Sé que se acuesta tarde.',
      'A mí me encanta mi barrio.',
      'Aún no he probado el té.',
      'Octavia volvió sola y solo quería descansar.',
      '—No vendrá. —¡Sí que vendrá!',
    ],
    examplesNegative: ['*Tu siempre olvidas tú paraguas.', '*Se que se acuesta tarde.'],
    commonErrors: [
      'Dropping the accent on the stressed member, writing "tu" for the pronoun tú or "se" for the verb sé.',
      'Hypercorrecting by accenting the unstressed member, producing "*tú paraguas" or "*mí casa".',
      'Writing aun for aún (= todavía) and vice versa, blurring "even" and "still".',
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
      'Present subjunctive: forms (incl. inherited stem changes) after wish, doubt, emotion, and impersonal-judgement triggers (querer que, espero que, dudo que, es importante que), and in independent uses with ojalá (que) and quizá / tal vez — but a lo mejor takes the indicative (A lo mejor llueve). Also temer que, nouns + de que (la esperanza de que llueva), fronted el (hecho de) que, and que-wishes/commands (¡Que te vaya bien!; Que entre).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Espero que estés bien.',
      'Quiero que vengas a la fiesta.',
      'Ojalá que encuentres trabajo pronto.',
      'El hecho de que no haya venido me molesta.',
      'Que entren de uno en uno.',
      'Temo que sea demasiado tarde.',
    ],
    examplesNegative: ['*Espero que estás bien.'],
    commonErrors: [
      'Using the indicative after expressions that require subjunctive (querer que, esperar que).',
      'Forgetting the stem changes that carry over from the present indicative.',
      'Failing to switch the e/o stem vowels in the yo form.',
      'Extending the subjunctive to a lo mejor ("*a lo mejor llueva" instead of "a lo mejor llueve"), which — unlike quizá / tal vez — takes the indicative.',
      'Using the subjunctive after quejarse de que or after me temo que meaning "I\'m afraid (= regret to say)", which take the indicative ("*me temo que sea tarde" instead of "me temo que es tarde").',
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
      'Duration and time-span expressions: llevar + period + gerund (Llevo dos años estudiando), hace + period + que + present, its past-shifted form hacía + period + que + imperfect (Hacía años que no la veía), tardar + en + infinitive, and dentro de + period for time from now. Completed durations take a past tense + (durante) period (Trabajé (durante) varios años en Madrid) — llevar / hace…que only cover still-ongoing events.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Llevo dos años estudiando español.',
      'Hace tres meses que vivo aquí.',
      'Tardamos casi tres horas en montar el armario nuevo.',
      'Dentro de dos semanas empezará el nuevo semestre.',
      'Hacía años que no veía a mi primo.',
      'Fue presidenta durante tres años.',
    ],
    examplesNegative: ['*He estudiado español por dos años.'],
    commonErrors: [
      'Calquing the English present perfect with "por" instead of using llevar or hace ... que.',
      'Mixing the gerund (llevo estudiando) with the infinitive ("*llevo estudiar").',
      'Mixing the tense pairs: hace ... que takes the present (hace tres meses que vivo aquí) and hacía ... que the imperfect (hacía años que no la veía).',
    ],
  },
  {
    key: 'es-b1-relative-clauses',
    kind: 'grammar',
    name: 'Relative clauses',
    description:
      'Restrictive relative clauses in the indicative: que vs quien (a quien for human objects: el chico a quien saludaste), donde with an expressed antecedent, and the restriction that proper names and tonic pronouns reject restrictive relatives. Also noun + que + infinitive (tengo cosas que hacer; but necesito algo para comer), and Verb–Subject order keeping que next to its antecedent (es el perro que compró mi amigo).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'El compañero a quien recomendé para el puesto empieza mañana.',
      'La vecina que me prestó el taladro se mudó la semana pasada.',
      'Volvimos al café donde nos conocimos hace diez años.',
      'Tengo muchas cosas que hacer antes del viaje.',
      'Así dice la carta que nos envió tu padre.',
    ],
    examplesNegative: [
      '*Juan que vive aquí es mi vecino.',
      '*Los hombres quienes dijeron eso mintieron.',
      '*Una chica hablando francés preguntó por ti.',
    ],
    commonErrors: [
      'Using "quien(es)" in a restrictive clause without a preceding preposition (e.g. "*los hombres quienes dijeron eso" instead of "que dijeron eso").',
      'Choosing "quien" for inanimate antecedents instead of "que".',
      'Attaching a restrictive relative clause directly after a proper name or tonic pronoun (e.g. "*Juan que vive aquí").',
      'Using a gerund to modify a noun, English-style ("*una chica hablando francés" instead of "una chica que habla francés").',
      'Keeping Subject-Verb order so the relative clause strands far from its antecedent ("*un señor compró la casa que había vivido en Florida" instead of "compró la casa un señor que había vivido en Florida").',
    ],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'es-b1-nominalizers',
    kind: 'grammar',
    name: 'Nominalizers el de / el que ("the one...")',
    description:
      'Article + de standing for an omitted noun (mi coche y el de Juan, los de ayer) and article + que for "the one(s) that" (prefiero el que compramos, la que está fuera), agreeing in gender and number with the omitted noun; blocks the English calque *el uno de / *uno que. Adjectives also nominalize with a determiner (los viejos, una rota) — masculine un becomes uno (uno parecido).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Mi móvil es más viejo que el de mi madre.',
      'Estas galletas son las que compramos ayer.',
      'Los de la primera fila no ven bien.',
      'No quiero este bolso; prefiero uno parecido pero más barato.',
    ],
    examplesNegative: ['*Mi móvil es más viejo que el uno de mi madre.'],
    commonErrors: [
      'Calquing English "the one of", producing "*el uno de Juan" instead of "el de Juan".',
      'Failing to make the article agree with the omitted noun, producing "*el que compramos" for a feminine noun like camisa instead of "la que compramos".',
      'Using neuter lo de / lo que when a specific gendered noun is omitted, producing "*lo que está fuera" for "la que está fuera" when referring to la silla.',
    ],
    prerequisiteKeys: ['es-b1-relative-clauses'],
  },
  {
    key: 'es-b1-passive-se',
    kind: 'grammar',
    name: 'Passive and impersonal "se"',
    description:
      'The "se" construction for passive ("se venden libros") and impersonal generalisations ("se vive bien aquí"). With a human object impersonal se takes le/les (Se le nota cansada), and pronominal verbs use uno instead, since two se cannot co-occur (Uno se levanta temprano).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Se venden coches usados.',
      'En España se cena tarde.',
      'Se les ve contentos.',
      'Se tienen que resolver varios problemas.',
    ],
    examplesNegative: ['*Coches usados son vendidos aquí.'],
    commonErrors: [
      'Using the English-style "ser + past participle" passive where "se" is more idiomatic.',
      'Failing to make the verb agree with the plural noun in passive-se ("*se vende coches").',
      'Doubling se to make a pronominal verb impersonal ("*se se levanta temprano" instead of "uno se levanta temprano").',
    ],
  },
  {
    key: 'es-b1-impersonal-plural',
    kind: 'grammar',
    name: 'Impersonal third-person plural (dicen que...)',
    description:
      'Agentless third-person plural for unspecified people: dicen que... (people say), llaman a la puerta (someone is at the door), me robaron la cartera (my wallet was stolen) — the everyday alternative to a passive, used even when only one unknown person acted. Related generics: uno/una + 3sg verb (Uno nunca sabe; una for female speakers) and informal impersonal tú (Si lo piensas, es increíble); uno/se preferred in formal register.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Dicen que va a llover mañana.',
      'Me robaron la cartera en el metro.',
      'Te llaman por teléfono.',
      'Uno nunca sabe qué puede pasar.',
    ],
    examplesNegative: ['*Mi cartera fue robada en el metro.'],
    commonErrors: [
      'Forcing a ser-passive where Spanish prefers the impersonal plural, producing "*mi cartera fue robada" instead of "me robaron la cartera".',
      'Inserting ellos, which cancels the impersonal reading — "ellos dicen que..." points at specific people; the impersonal is bare "dicen que...".',
      'Using the singular for an unknown agent, producing "*llama a la puerta" instead of "llaman a la puerta" when the caller is unidentified.',
    ],
    prerequisiteKeys: ['es-b1-passive-se'],
  },
  {
    key: 'es-b1-reciprocal-se',
    coverageSpec: {
      axes: [
        // nos vs se reciprocals (commonError '*mi hermano y yo me ayudamos'
        // → nos ayudamos); reciprocals need plural subjects, so partial
        // floors — 1pl/3pl only.
        { name: 'person', floors: { '1pl': 8, '3pl': 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Reciprocal se (each other)',
    description:
      'Plural reflexive pronouns nos/os/se with a reciprocal "each other" reading (nos escribimos, se quieren, ¿os conocéis?), disambiguated from the plain reflexive reading with el uno al otro / la una a la otra or entre sí when needed (se miraron el uno al otro).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Nos escribimos todas las semanas.',
      'Mis padres se conocieron en la universidad.',
      'Las hermanas se ayudan la una a la otra.',
    ],
    examplesNegative: ['*Mis padres conocieron en la universidad.', '*Mi hermano y yo me ayudamos.'],
    commonErrors: [
      'Dropping the pronoun, producing "*mis padres conocieron en 1990" instead of "mis padres se conocieron en 1990".',
      'Calquing English "each other" as an object phrase without se, producing "*ellos quieren el uno al otro" instead of "se quieren (el uno al otro)".',
      'Using a singular pronoun with a plural reciprocal subject, producing "*mi hermano y yo me ayudamos" instead of "nos ayudamos".',
    ],
    prerequisiteKeys: ['es-a2-reflexive-verbs'],
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
    key: 'es-b1-preterite-imperfect-meaning',
    kind: 'grammar',
    name: 'Meaning-changing preterite vs. imperfect',
    description:
      'State verbs whose English translation shifts with the past-tense choice: conocí (met) / conocía (knew), supe (found out) / sabía (knew), pude (managed) / podía (was able to), no quise (refused) / no quería (did not want to), tuve (got, received) / tenía (had), estuvo (a state finally reached, after hasta que / una vez que) / estaba (was).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Conocí a mi mejor amiga en 2015.',
      'No sabía que vivías aquí; lo supe ayer.',
      'Quise ayudarla, pero no pude.',
      'No descansó hasta que estuvo delante de mí.',
    ],
    examplesNegative: ['*Conocía a mi mejor amiga en una fiesta en 2015.'],
    commonErrors: [
      'Using the imperfect for the first encounter or the moment of finding out, producing "*conocía a Juan en la fiesta" instead of "conocí a Juan en la fiesta".',
      'Using the preterite for an ongoing state, producing "*supe la respuesta durante años" instead of "sabía la respuesta".',
      'Missing that no quise means refusal, rendering every "did not want to" as "no quise" even where "no quería" (an unacted desire) is meant.',
    ],
    prerequisiteKeys: ['es-b1-past-narration'],
  },
  {
    key: 'es-b1-imperative-negative-pronouns',
    coverageSpec: {
      axes: [
        // The point is built on the polarity contrast: proclisis + subjunctive
        // switch (no se lo digas) vs enclisis + written accent (díselo).
        // Unpinned generation collapses to affirmative (TR-imperative failure
        // mode, PR #588). Negative-weighted: it is the headline half.
        { name: 'polarity', floors: { affirmative: 8, negative: 10 } },
      ],
    },
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
      'Subjunctive in temporal clauses with future reference (cuando llegues, not *cuando llegarás), antes de que and después de que + subjunctive, purpose clauses with para que + subjunctive, and sin que + subjunctive for "without (someone) doing" (Salió sin que nadie lo viera).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: ['Te llamaré cuando llegue a casa.', 'Te lo explico para que lo entiendas.', 'Salió sin que nadie lo viera.'],
    examplesNegative: ['*Te llamaré cuando llegaré a casa.', '*Salió sin que nadie lo vio.'],
    commonErrors: [
      'Using the future indicative after "cuando" with future reference instead of the present subjunctive ("*cuando llegaré" instead of "cuando llegue").',
      'Using the indicative after "antes de que", which always requires the subjunctive.',
      'Using "para" + infinitive instead of "para que" + subjunctive when the clauses have different subjects.',
      'Using the indicative after "sin que" ("*sin que nadie lo vio"), or using "sin que" at all when the subjects match, where "sin" + infinitive is required (salí sin despedirme).',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive'],
  },
  {
    key: 'es-b1-influence-verbs-infinitive',
    kind: 'grammar',
    name: 'Dejar, permitir, hacer + infinitive',
    description:
      'Influence and causation with a dative clitic + infinitive: dejar (no me dejan salir), permitir (le permitieron entrar), prohibir (le prohibieron fumar), and causative hacer (me hizo llorar); interchangeable with que + subjunctive (le permitieron que entrara), never que + indicative.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Mis padres no me dejan salir entre semana.',
      'El médico le prohibió fumar.',
      'Esa película siempre me hace llorar.',
    ],
    examplesNegative: ['*Mis padres no dejan que salgo.', '*Me hace a llorar.'],
    commonErrors: [
      'Using que + indicative after an influence verb, producing "*no dejan que salgo" instead of "no dejan que salga" or "no me dejan salir".',
      'Inserting a before the infinitive after hacer, producing "*me hace a llorar" instead of "me hace llorar".',
      'Dropping the dative clitic that marks the affected person, producing "*mis padres no dejan salir" instead of "mis padres no me dejan salir".',
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
      'The contrast between deber + infinitive for obligation (Debes terminar el informe) and deber de + infinitive for probability or conjecture (Deben de ser las cinco), plus deberías for softened advice. Epistemic poder also speculates (Podría ser tu tía), and modal + haber + participle covers past reference (Debería haberlo hecho / Lo debería haber hecho).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Debes terminar el informe antes del viernes.',
      'Deben de ser las cinco ya.',
      'No contesta; podría estar durmiendo todavía.',
      'Debería haberlo hecho la semana pasada.',
    ],
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
      'Aspectual periphrases dejar de + infinitivo (to stop doing), ponerse a + infinitivo (to start doing), estar a punto de + infinitivo (to be about to; also estar para + infinitivo), and seguir + gerundio (to keep on doing). Also quedarse/acabar + gerundio (Me quedé ayudándolos; Acabó cediendo) and resultative tener + agreeing participle (Ya tengo compradas las entradas).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Dejé de fumar hace dos años.',
      'Se puso a llorar en cuanto se enteró de la noticia.',
      'Estábamos a punto de salir cuando empezó a llover.',
      'Sigue trabajando en la misma empresa desde 2010.',
      'Acabarás haciendo lo que ella diga.',
      'Ya tengo compradas las entradas para el concierto.',
    ],
    examplesNegative: ['*Dejé fumar hace dos años.'],
    commonErrors: [
      'Dropping the preposition "de" after "dejar" ("*dejé fumar" instead of "dejé de fumar").',
      'Following "seguir" with the bare infinitive instead of the gerund ("*sigue trabajar" instead of "sigue trabajando").',
      'Confusing the inceptive "ponerse a + infinitivo" (to start doing) with "volver a + infinitivo" (to do again), producing the wrong aspectual meaning.',
      'Leaving the participle invariable in resultative tener + participle ("*tengo comprado las entradas" instead of "tengo compradas las entradas").',
    ],
  },
  {
    key: 'es-b1-verb-preposition-regime',
    kind: 'grammar',
    name: 'Verb + preposition regime',
    description:
      'Fixed prepositional regime of verbs (hablar de, pensar en, soñar con, depender de, jugar a + article, casarse con, saber/oler a, negarse a, ayudar a), adjectives (amable con, harto de), and nouns (miedo a, amor por/hacia); after any preposition the infinitive, never the gerund; the regime preposition is kept before que-clauses (darse cuenta de que); double complementation with invitar a + infinitivo.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Siempre habla de sus viajes por Sudamérica.',
      'No dejo de pensar en el examen de mañana.',
      'Anoche soñé con mi antiguo colegio.',
      'Me invitó a cenar el sábado.',
      'De pequeños jugábamos al ajedrez después de clase.',
      'Esta sopa sabe a ajo.',
    ],
    examplesNegative: [
      '*Pienso de ti todo el día.',
      '*Me di cuenta que era tarde.',
      '*Los niños juegan fútbol en el patio.',
    ],
    commonErrors: [
      'Calquing English "think of/about" as "*pensar de" instead of the correct "pensar en".',
      'Using "de" instead of "con" after "soñar" ("*soñé de mi antiguo colegio" instead of "soñé con mi antiguo colegio").',
      'Omitting the "a" before the infinitive after "invitar" ("*me invitó cenar" instead of "me invitó a cenar").',
      'Dropping the governed preposition before a que-clause — queísmo ("*me di cuenta que llovía" instead of "me di cuenta de que llovía") — or adding a spurious de after verbs of saying — dequeísmo ("*dice de que no viene" instead of "dice que no viene").',
      'Using the gerund after a preposition instead of the infinitive ("*estoy harto de diciéndotelo" instead of "estoy harto de decírtelo").',
    ],
  },
  {
    key: 'es-b1-discourse-connectors',
    kind: 'grammar',
    name: 'Discourse connectors: sin embargo, o sea que, causal como, por + infinitivo, aunque + indicative',
    description:
      'Sin embargo (however); resumptive o sea que / así (es) que (so); fronted causal como (Como no venías, empecé…); causal por + infinitivo (Lo hizo por no molestarte); concessive aunque + indicative for a known fact (Aunque llueve, salgo). Also additive además / es más, dismissive de todas formas / de todos modos, emphatic en realidad / de hecho with explanatory es que + clause, and contrastive en cambio / por otra parte.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Estudió mucho; sin embargo, suspendió el examen.',
      'Como no venías, empecé a cenar sin ti.',
      'Lo hizo por no molestarte.',
      'Aunque llueve, vamos a salir igualmente.',
      'De todas formas, llámame mañana.',
      '¿Por qué no viniste? — Es que no dormí en casa.',
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
      'Relative superlative el más/menos + adjective + de (el restaurante más caro de la ciudad); elative suffix -ísimo (buenísimo, riquísimo), which also intensifies adverbs — -mente adverbs infix -ísima- (clarísimamente) and lejos/cerca give lejísimos/cerquísima; equality igual de + adjective + que; and más/menos de before a quantity (más de cien euros).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Es el restaurante más caro de la ciudad.',
      'Esta sopa está riquísima.',
      'Es igual de alto que su hermano.',
      'Tiene más de cien libros en casa.',
      'Vive lejísimos del centro.',
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
      'Impersonal ser for time of day (Es tarde, Es de noche); estar de + noun for a temporary occupation (Está de camarero); estar a + a fluctuating price or the date (Estamos a quince, Están a tres euros el kilo); estar con + noun for a current ailment or accompaniment (Está con tos); and parecer + adjective vs. impersonal parece que + indicative.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Ya es de noche; deberíamos volver a casa.',
      'Mi hermano está de camarero este verano.',
      'Hoy estamos a quince de mayo.',
      'Parece que va a llover esta tarde.',
      'No viene hoy; está en cama con gripe.',
    ],
    examplesNegative: ['*Está tarde para llamarla.'],
    commonErrors: [
      'Using "estar" instead of "ser" for the impersonal time-of-day construction ("*está tarde" instead of "es tarde").',
      'Omitting "de" after "estar" when naming a temporary job or role ("*está camarero" instead of "está de camarero").',
      'Using "ser" instead of "estar" to state today\'s date ("*somos a quince" instead of "estamos a quince").',
    ],
  },
  {
    key: 'es-b1-ser-location-events',
    kind: 'grammar',
    name: 'Ser for the location of events',
    description:
      'Events (parties, meetings, classes, concerts) take ser — not estar — for where and when they happen (La reunión es en la sala 2; El examen es a las diez), while people and things keep estar for location (La sala 2 está en la primera planta): "to take place" versus "to be located".',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'La fiesta es en casa de Marta.',
      '¿Dónde es el concierto? — Es en el teatro, que está en el centro.',
    ],
    examplesNegative: ['*La fiesta está en casa de Marta.', '*El examen está a las diez.'],
    commonErrors: [
      'Extending the "estar for location" rule to events, producing "*la reunión está en la sala 2" instead of "la reunión es en la sala 2".',
      'Using estar for the time of an event, producing "*el examen está a las diez" instead of "el examen es a las diez".',
      'Overcorrecting and using ser for the location of physical things or people, producing "*el teatro es en el centro" instead of "el teatro está en el centro".',
    ],
    prerequisiteKeys: ['es-a1-ser-estar-basic'],
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
  {
    key: 'es-b1-collective-agreement',
    kind: 'grammar',
    name: 'Number agreement with collective nouns',
    description:
      'Singular verb after collective nouns where English uses a plural: la gente dice, todo el mundo sabe, la policía busca, el equipo juega. After collective + de + plural noun (la mayoría de los vecinos), plural agreement is usual (creen).',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'La gente dice que el barrio ha cambiado mucho.',
      'Todo el mundo sabe la respuesta.',
      'La policía busca a los ladrones del banco.',
      'La mayoría de los vecinos creen que es buena idea.',
    ],
    examplesNegative: ['*La gente dicen que es verdad.'],
    commonErrors: [
      'Using a plural verb with gente ("*la gente dicen" instead of "la gente dice").',
      'Using a plural verb with todo el mundo ("*todo el mundo saben" instead of "todo el mundo sabe").',
      'Making the predicate adjective plural with a singular collective ("*la gente están cansados" instead of "la gente está cansada").',
    ],
  },
  {
    key: 'es-b1-adjective-de-infinitive',
    kind: 'grammar',
    name: 'Fácil/difícil de + infinitive',
    description:
      'Adjective + de + infinitive when the sentence subject is the understood object of the infinitive (Este libro es fácil de leer; Su conducta es difícil de comprender), vs. the impersonal pattern es + adjective + infinitive with the object expressed after the verb and no de (Es difícil comprender su conducta). Works with fácil, difícil, imposible, duro, complicado.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Este libro es fácil de leer.',
      'Su conducta es difícil de comprender.',
      'Es difícil comprender su conducta.',
      'Esa mancha es imposible de quitar.',
    ],
    examplesNegative: ['*Es difícil de encontrar trabajo aquí.'],
    commonErrors: [
      'Inserting de in the impersonal pattern ("*es difícil de encontrar trabajo" instead of "es difícil encontrar trabajo").',
      'Omitting de when the subject is the understood object ("*este libro es fácil leer" instead of "este libro es fácil de leer").',
      'Adding a redundant object pronoun after the infinitive ("*su conducta es difícil de comprenderla" instead of "su conducta es difícil de comprender").',
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
    key: 'es-b2-conditional-conjecture',
    kind: 'grammar',
    name: 'Conditional for conjecture about the past',
    description:
      'The conditional simple to guess about a past situation (Serían las seis cuando llegó; Tendría unos treinta años), completing the probability system: future for present guesses (Serán las once), future perfect for the recent past (Habrá salido), conditional for a remote past.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Serían las seis cuando llegó.',
      'No sé cuántos años tenía entonces; tendría unos treinta.',
    ],
    examplesNegative: ['*Serán las seis cuando llegó.'],
    commonErrors: [
      'Using the future of probability with a past reference point, producing "*serán las seis cuando llegó" instead of "serían las seis cuando llegó".',
      'Never producing the conjectural conditional, falling back on "probablemente eran las seis" where "serían las seis" is the idiomatic guess.',
      'Reading conjectural serían/tendría as a literal conditional ("would be") and mistranslating the guess.',
    ],
    prerequisiteKeys: ['es-b1-conditional', 'es-b1-futuro-simple'],
  },
  {
    key: 'es-b2-reported-speech-backshift',
    kind: 'grammar',
    name: 'Reported speech — full backshift',
    description:
      'Completes B1 reporting: future shifts to conditional (Dijo que vendría), preterite/perfect to pluperfect (Dijo que había llegado), commands to the imperfect subjunctive (Me pidió que la ayudara); plus deictic shifts (hoy → aquel día) and reported questions (Me preguntó si...).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Dijo que vendría a la fiesta.',
      'Aseguró que ya había terminado el informe.',
      'Me pidió que la ayudara con la mudanza.',
      'Dijo que me llamaría al día siguiente.',
    ],
    examplesNegative: ['*Dijo que vendrá a la fiesta.', '*Me pidió que la ayude con la mudanza.'],
    commonErrors: [
      'Keeping the future in the reported clause, producing "*dijo que vendrá" instead of "dijo que vendría".',
      'Failing to backshift a preterite or perfect to the pluperfect, producing "dijo que llegó" where careful style wants "dijo que había llegado".',
      'Reporting a past command with the present subjunctive, producing "*me pidió que la ayude" instead of "me pidió que la ayudara".',
      'Using próximo for narrative "next" ("*el próximo día" in a past narrative instead of "al día siguiente") — próximo / que viene count from now, siguiente from the narrative anchor.',
    ],
    prerequisiteKeys: ['es-b1-reported-speech', 'es-b2-past-subjunctive'],
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
      'Counterfactual past conditionals: "si + pluperfect subjunctive, conditional perfect" (Si hubiera sabido, habría venido). In the result clause hubiera + participle can replace habría (Si lo hubiera sabido, hubiera venido) — only the -ra form, never -se.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Si hubiera estudiado, habría aprobado.',
      'Si hubieras venido, te habrías divertido.',
      'Si lo hubiera sabido, hubiera venido antes.',
    ],
    examplesNegative: ['*Si había estudiado, había aprobado.'],
    commonErrors: [
      'Using indicative pluperfect ("había") in the if-clause of counterfactual past conditionals.',
      'Mixing tenses across the two clauses (e.g. simple conditional in the result clause).',
      'Using the -se form in the result clause ("*si lo hubiera sabido, hubiese venido") — only hubiera can replace habría there, never hubiese.',
    ],
    prerequisiteKeys: ['es-b2-past-subjunctive', 'es-b2-conditional-perfect'],
  },
  {
    key: 'es-b2-remote-conditionals',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } },
      ],
    },
    kind: 'grammar',
    name: 'Remote conditional sentences',
    description:
      'Hypothetical conditionals: "si + imperfect subjunctive, conditional simple" (Si tuviera dinero, lo compraría) for unlikely or contrary-to-fact conditions; -ra and -se forms are interchangeable after si; includes "if I were you" (Si yo fuera tú / Yo que tú, + conditional).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Yo iría contigo si pudiera.',
      'Si fuera millonario, te compraría un yate.',
      'Si pagaras ahora, costaría menos.',
      'Si yo fuera tú, me callaría.',
    ],
    examplesNegative: ['*Si tendría dinero, lo compraría.', '*Si tenía dinero, lo compraría.'],
    commonErrors: [
      'Using the imperfect indicative in the if-clause by transfer from English/French ("*si tenía dinero, lo compraría" instead of "si tuviera dinero") — that pattern is only correct as a reported open condition in the past (Dijo que me pagaría si había terminado).',
      'Using the conditional in the if-clause ("*si estaría" instead of "si estuviera") — a regional/sub-standard pattern learners should not imitate.',
      'Using the present subjunctive after si ("*si tenga tiempo, viajaría" instead of "si tuviera tiempo").',
    ],
    prerequisiteKeys: ['es-b1-conditional', 'es-b2-past-subjunctive'],
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
      'Cuando llegué, María estaba sentada en el sofá.',
      'El acusado insistió en que era inocente.',
    ],
    examplesNegative: ['*María es lista para salir.'],
    commonErrors: [
      'Treating ser/estar as interchangeable for adjectives that flip meaning.',
      'Using ser with resultant-state past participles ("*la puerta es cerrada").',
      'Rendering English "-ing" posture verbs with the gerund ("*estaba sentándose en el sofá" for "she was sitting") — the state takes estar + participle: estaba sentada, está acostada, estaba apoyado.',
      'Defaulting to estar with state-like adjectives that prefer ser (feliz, pobre, inocente, culpable, consciente): "El acusado dijo que era inocente", despite the state-like feel.',
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
      'Using cuando in a restrictive time relative by analogy with English "when" ("*en un año cuando todo cambió" instead of "en un año (en) que todo cambió") — relative cuando appears only in non-restrictive clauses (en agosto, cuando les den las vacaciones).',
    ],
  },
  {
    key: 'es-b2-cuyo',
    kind: 'grammar',
    name: 'Relative possessive cuyo',
    description:
      'Cuyo/cuya/cuyos/cuyas ("whose") agreeing in gender and number with the thing possessed, not the possessor (un autor cuyas novelas conozco); typical of written Spanish, with de quien / del que as spoken alternatives; never *que su, and never used as a question word.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Es un autor cuyas novelas se leen en todo el mundo.',
      'La empresa, cuyo director dimitió ayer, cotiza en bolsa.',
    ],
    examplesNegative: ['*Es un autor que sus novelas se leen en todo el mundo.', '*Un autor cuyo novelas conozco.'],
    commonErrors: [
      'Calquing English with que + possessive, producing "*el autor que sus novelas..." instead of "el autor cuyas novelas...".',
      'Agreeing cuyo with the possessor instead of the possessed noun, producing "*un autor cuyo novelas" instead of "un autor cuyas novelas".',
      'Using cuyo as an interrogative, producing "*¿Cuyo libro es este?" instead of "¿De quién es este libro?".',
    ],
    prerequisiteKeys: ['es-b1-relative-clauses'],
  },
  {
    key: 'es-b2-nosotros-imperative',
    coverageSpec: {
      axes: [
        // Both poles have distinct surface behavior: -s drop before the
        // enclitic (sentémonos) vs proclitic negative (no nos sentemos) —
        // commonError 3 is exactly the negative-clitic trap. Person axis
        // pointless (1pl by definition).
        { name: 'polarity', floors: { affirmative: 8, negative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Nosotros imperative (¡Empecemos!)',
    description:
      'First-person-plural commands with the present subjunctive (Empecemos; No lo toquemos); the final -s drops before the enclitic nos (Sentémonos, not *sentémosnos); vamos a + infinitive as the colloquial alternative, and irregular vámonos versus negative no nos vayamos.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Empecemos la reunión, que es tarde.',
      'Sentémonos aquí, cerca de la ventana.',
      'Vámonos ya.',
    ],
    examplesNegative: ['*Sentémosnos aquí.', '*No sentémonos tan lejos.'],
    commonErrors: [
      'Keeping the -s before nos, producing "*sentémosnos" or "*levantémosnos" instead of "sentémonos" and "levantémonos".',
      'Relying on vamos a + infinitive everywhere and never producing the one-word subjunctive command (empecemos, salgamos).',
      'Attaching the pronoun in a negative command instead of placing it before the verb, producing "*no sentémonos" instead of "no nos sentemos".',
    ],
    prerequisiteKeys: ['es-a2-imperative-affirmative', 'es-b1-present-subjunctive'],
  },
  {
    key: 'es-b2-subjunctive-compound',
    kind: 'grammar',
    name: 'Compound subjunctive: perfect and pluperfect',
    description:
      'Perfect subjunctive haya + participle for a completed action viewed with doubt, emotion, or future anteriority (No es verdad que haya escrito eso; cuando se haya marchado); pluperfect subjunctive hubiera/hubiese + participle outside counterfactual si-clauses. With past reference the perfect and imperfect subjunctive are often interchangeable (Es imposible que lo haya hecho / lo hiciera) — accept both.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'No es verdad que haya escrito esa carta.',
      'Te llamaré en cuanto se haya marchado el jefe.',
      'Ojalá hubiera sabido la verdad antes.',
      'Es imposible que lo haya hecho él solo.',
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
      'No dudo que es verdad.',
    ],
    examplesNegative: ['*No creo que Marta tiene razón.'],
    commonErrors: [
      'Keeping the indicative after "no creo que" by analogy with the affirmative "creo que + indicative", instead of switching to the subjunctive under negation.',
      'Treating "no es cierto/verdad que" as a plain statement of fact and using the indicative instead of the subjunctive it requires.',
      'Using the indicative instead of the subjunctive when relaying a negated assertion about a past event ("*no me dijo que había venido" as a denial, instead of "no me dijo que hubiera venido").',
      'Extending the subjunctive to "no dudo que" — dudar que takes the subjunctive, but no dudar que meaning "I\'m sure that" takes the indicative ("No dudo que es verdad").',
    ],
    prerequisiteKeys: ['es-b1-present-subjunctive'],
  },
  {
    key: 'es-b2-subjunctive-temporal-concessive',
    kind: 'grammar',
    name: 'Subjunctive in temporal and concessive connectors',
    description:
      'En cuanto, tan pronto como, apenas, una vez que, hasta que, después (de) que, mientras take the subjunctive only for future/posteriority (en cuanto llegues) vs. indicative for past/habitual reference (apenas llegué); aunque/a pesar de que + subjunctive for a non-factual concession; por mucho/más que + subjunctive; reduplicative subjunctive for "whether/whatever/wherever" (le guste o no, pase lo que pase, vaya donde vaya).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'En cuanto termine el informe, te lo envío.',
      'Apenas llegué a casa, comenzó a llover.',
      'Aunque no lo creas, es la pura verdad.',
      'Por mucho que insistas, no voy a cambiar de opinión.',
      'Comeremos después de que lleguen todos.',
      'Digan lo que digan, pienso hacerlo.',
    ],
    examplesNegative: ['*En cuanto llegarás, te lo diré.'],
    commonErrors: [
      'Using the future indicative after a temporal connector with future reference instead of the present subjunctive ("*en cuanto llegarás" instead of "en cuanto llegues").',
      'Overgeneralizing the subjunctive to a habitual or completed past temporal clause, where the indicative is required ("*apenas llegara a casa, comenzó a llover" instead of "apenas llegué a casa").',
      'Using the indicative after "aunque" for a hypothetical, not-yet-known concession instead of the subjunctive ("*aunque no lo crees, es la verdad" instead of "aunque no lo creas").',
      'Extending the subjunctive to the factual concessives "y eso que" and "si bien", which take only the indicative ("no la reconocí, y eso que la había visto") — and y eso que can only follow the main clause.',
    ],
    prerequisiteKeys: ['es-b1-subjunctive-adverbial'],
  },
  {
    key: 'es-b2-conditional-connectors',
    kind: 'grammar',
    name: 'Conditional connectors beyond si',
    description:
      'Por si (acaso) + indicative ("in case"); siempre que/siempre y cuando/con tal de que/a condición de que + subjunctive ("provided that"); salvo si/excepto si + indicative; a no ser que/salvo que + subjunctive ("unless"); conditional como + subjunctive for threats/warnings (¡Como vuelvas a llegar tarde…!) vs causal como + indicative; same-subject de + infinitive as an if-clause (De haberlo sabido, no habría venido).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Llévate el paraguas por si acaso llueve.',
      'Iré a la fiesta con tal de que tú también vayas.',
      'Aceptaré el trabajo siempre y cuando el sueldo sea justo.',
      'Saldremos a la hora prevista, salvo si hay un imprevisto.',
      'No cambiaré de opinión a no ser que me des una buena razón.',
      '¡Como vuelvas a llegar tarde, te quedas sin salir!',
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
      'Ser + past participle for the action passive (Las puertas fueron abiertas a las 10), agreeing in gender/number with the subject, vs estar + participle for the resulting state (Las puertas ya estaban abiertas); bare-noun subjects stay postverbal (Han llegado trenes, Se venden pisos); sin/por/a medio + infinitive has passive force for un-done states (una botella sin abrir, esto está por ver, maletas a medio hacer).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'La ciudad fue destruida por un terremoto en 1985.',
      'Cuando llegamos, la ciudad ya estaba destruida.',
      'Se venden pisos en esta calle.',
      'La botella sigue sin abrir en la nevera.',
    ],
    examplesNegative: ['*Naranjas son vendidas aquí.'],
    commonErrors: [
      'Forgetting participle agreement with the subject of ser ("*las puertas fueron abierto" instead of "fueron abiertas").',
      'Using ser + participle for a resulting state instead of estar ("*la puerta fue abierta" to mean the door was already open, instead of "la puerta estaba abierta").',
      'Fronting a bare, article-less plural subject before the verb ("*Trenes han llegado" instead of the required postverbal "Han llegado trenes").',
      'Calquing the English indirect-object passive ("*ella fue enviada una carta" for "she was sent a letter" instead of "le enviaron / se le envió una carta") — only the direct object can become the subject of ser.',
      'Calquing the English prepositional passive ("*esta cama ha sido dormido en") — the object of a preposition can never become the passive subject.',
    ],
  },

  {
    key: 'es-b2-verbs-of-change',
    kind: 'grammar',
    name: 'Verbs of becoming: ponerse, quedarse, hacerse, volverse, convertirse en, llegar a ser',
    description:
      'Choosing ponerse (brief mood/appearance change), quedarse (state left by an event), hacerse (voluntary lasting conversion), volverse (involuntary lasting change), convertirse en (total transformation, + noun), or llegar a ser (hard-won outcome of a slow process); also resultar for an unexpected outcome or impression (El plan resultó un desastre), and plain quedar beside quedarse for lasting states (quedó ciego), slightly more formal.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Cuando se enteró de la noticia, se puso muy triste.',
      'Se hizo abogado después de diez años de estudio.',
      'Con la edad, mi padre se ha vuelto muy desconfiado.',
      'La oruga se convirtió en mariposa.',
      'Trabajó muchísimo y con el tiempo llegó a ser director general.',
      'Sus amigos me resultaron muy simpáticos.',
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
      'A transitive verb turns pronominal for a spontaneous or subjectless event, with things or people (Se abrió la ventana; preocupar/preocuparse, enamorarse de); accidental se + dative of interest for mishaps (Se me perdió tu dinero; se me olvidó, se me ocurrió, se me acabó), verb agreeing with the thing, not the dative; nuance-adding se on motion verbs — irse/venirse stress departure, caerse/salirse untimely or accidental action.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'La ventana se abrió con el viento.',
      'Se me perdió tu dinero y no sé cómo pasó.',
      'Se le cayeron las llaves al entrar en el portal.',
      'Me voy ya, que es tarde.',
      'Se me olvidaron las llaves en casa.',
      '¿Por qué no te vienes conmigo al cine?',
    ],
    examplesNegative: ['*Se le cayó las llaves.'],
    commonErrors: [
      'Making the verb agree with the dative pronoun (person) instead of the thing affected ("*se le cayó las llaves" instead of "se le cayeron las llaves").',
      'Dropping the dative pronoun and losing the "unintentional/it happened to me" nuance ("se perdió tu dinero" instead of "se me perdió tu dinero").',
      'Using the ir imperative "ve" to tell someone to leave/go away, instead of the irse imperative "vete" ("*ve ya, es tarde" instead of "vete ya, es tarde").',
      'Over-pronominalizing verbs that are already intransitive ("*se empezó la película" instead of "empezó la película") — empezar, terminar, mejorar, hervir, subir/bajar (prices) take no se.',
    ],
  },

  {
    key: 'es-b2-clitic-advanced',
    kind: 'grammar',
    name: 'Advanced clitics: neuter lo, fronted-object doubling, leísmo de persona',
    description:
      'Neuter lo echoing the predicate of ser/estar (¿Estás cansada? — Lo estoy); obligatory redundant clitic when a direct object is fronted (Los libros los tiene Juan); accepted leísmo de persona for masculine humans (Le vimos a Luis, alongside Lo vimos), not for feminine referents; ello after prepositions (no hablemos de ello); le for a human object with creer, pegar, obedecer or an inanimate subject (le espera una catástrofe).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      '¿Estás cansada? — Lo estoy.',
      'Los libros los tiene Juan.',
      'A Luis le vimos ayer en la estación.',
      'Prefiero no hablar de ello.',
      'La vi a ella, pero no a él.',
      'Le espera una catástrofe.',
    ],
    examplesNegative: ['*A Luisa le vimos ayer en la estación.'],
    commonErrors: [
      'Dropping the resumptive lo after ser/estar with an adjective predicate ("¿Estás cansada? — Estoy" instead of "Lo estoy").',
      'Omitting the redundant clitic when the direct object is fronted ("Los libros tiene Juan" instead of "Los libros los tiene Juan").',
      'Extending leísmo de persona to a feminine direct object ("*le vimos" for Luisa instead of "la vimos").',
      'Adding a resumptive clitic to a fronted bare object with no determiner ("*dinero no lo tengo" instead of "dinero no tengo") — doubling applies only to determined objects (Los libros los tiene Juan).',
      'Dropping the doubling clitic when todo is the direct object ("*sé todo" instead of "lo sé todo"; "*me tienes que contar todo" instead of "me lo tienes que contar todo").',
    ],
  },

  {
    key: 'es-b2-gerund-participle-constructions',
    kind: 'grammar',
    name: 'Adverbial gerund, nada más + infinitive, and predicative participle clauses',
    description:
      'Adverbial gerund for method, purpose, cause, or concession (Aprende leyendo; Nos llamó pidiendo ayuda; Siendo estudiante, tendrá beca; aun sabiéndolo); como + gerund = como si (como calculando); nada más + infinitive for same-subject sequence (Nada más llegar, nos pusimos a comer); una vez + participle for a prior event; predicative participle agreeing with the object (tienda cerrada).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Aprende idiomas leyendo novelas en el idioma original.',
      'Nada más llegar a casa, nos pusimos a preparar la cena.',
      'Una vez estudiado el problema, propusieron tres soluciones.',
      'Encontré la tienda cerrada cuando llegué.',
      'Me miró como calculando mi edad.',
      'Sonrió tranquila y siguió andando.',
    ],
    examplesNegative: ['*Encontré la tienda cerrado.'],
    commonErrors: [
      'Leaving the predicative participle unagreed with the object it describes ("*encontré la tienda cerrado" instead of "cerrada").',
      'Leaving a subject-oriented predicative adjective unagreed, or replacing it with an adverb everywhere ("*ellas viven feliz" instead of "viven felices") — the adjective agrees with the subject where English uses an adverb.',
      'Using nada más + infinitive when the following clause has a different subject, instead of switching to nada más que + finite verb ("*nada más llegar yo, tú te fuiste" instead of "nada más llegar yo" or a reformulation with a shared subject).',
      'Using the gerund instead of the participle to describe a resulting state ("*encontré la tienda cerrando" instead of "encontré la tienda cerrada").',
    ],
  },

  {
    key: 'es-b2-gradual-gerund',
    kind: 'grammar',
    name: 'Ir/venir + gerundio (gradual action)',
    description:
      'Gradual or accumulating aspect with a motion verb + gerund: ir + gerundio for progressive development (Voy entendiendo la gramática; La situación fue empeorando) and venir + gerundio for a process running up to now (Lo vengo diciendo desde enero); andar + gerundio for intermittent "going around doing" (Siempre anda buscando camorra); extends the B1 periphrasis set.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Poco a poco voy entendiendo la gramática.',
      'Los precios fueron subiendo durante todo el año.',
      'Lo vengo diciendo desde enero.',
      'Anda escribiendo una novela desde hace meses.',
    ],
    examplesNegative: ['*La situación fue empeorar.'],
    commonErrors: [
      'Following ir/venir with the infinitive instead of the gerund, producing "*fue empeorar" instead of "fue empeorando".',
      'Confusing ir a + infinitive (future plan) with ir + gerundio (gradual progress): "voy a entender" is not "voy entendiendo".',
      'Rendering "more and more" with an adverb pile, producing "entiendo más y más" where "voy entendiendo" is idiomatic.',
    ],
    prerequisiteKeys: ['es-b1-aspectual-periphrases'],
  },
  {
    key: 'es-b2-perception-verbs',
    kind: 'grammar',
    name: 'Ver/oír + infinitive or gerund',
    description:
      'Perception verbs ver/oír + object + infinitive for a completed action (La vi entrar; Los oí llegar) versus + gerund for action caught in progress (La vi fumando); the object clitic attaches to the perception verb, and ver/oír que + clause is the neutral alternative; the gerund pattern extends to pillar, dejar, encontrar and hay (Lo pillé robando; hay gente esperando); le is usual when the infinitive has its own object (le oí cantar un aria).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'La vi entrar en el banco.',
      'Oí a los vecinos discutiendo anoche.',
      'Vi que entraba en el banco.',
      'Dejamos a Andrés durmiendo y salimos.',
      'Juan le oyó cantar un aria.',
    ],
    examplesNegative: ['*Vi a ella entrar en el banco.'],
    commonErrors: [
      'Using a tonic pronoun instead of the clitic, producing "*vi a ella entrar" instead of "la vi entrar".',
      'Forcing que + clause everywhere and never producing the compact infinitive/gerund pattern.',
      'Using the infinitive for an ongoing activity where the gerund is meant: "la vi fumar" reports the completed event, "la vi fumando" catches her mid-action.',
    ],
    prerequisiteKeys: ['es-a2-direct-object-pronouns'],
  },
  {
    key: 'es-b2-consecutives-intensity',
    kind: 'grammar',
    name: 'Consecutive clauses of intensity: tan/tanto…que, de manera que, por lo tanto',
    description:
      'tan + adjective/adverb + que and tanto/a/os/as + noun + que (agreeing with the noun, e.g. tantas personas) for consequence; invariable tanto que with verbs (corrió tanto que…); de manera/modo que + indicative for result; formal por lo tanto, por consiguiente (distinct from por eso/entonces); suficiente(s)/bastante/demasiado… (como) para + infinitive for "enough/too… to".',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Hablaba tan rápido que no entendíamos nada.',
      'Vinieron tantas personas a la boda que no cupimos en la sala.',
      'Corrió tanto que se quedó sin aliento.',
      'No teníamos billetes; por lo tanto, decidimos volver a casa.',
      'Ha vendido suficientes coches como para ganarse el viaje.',
    ],
    examplesNegative: ['*Está tanto cansada que no puede seguir.'],
    commonErrors: [
      'Using "tanto" before an adjective instead of "tan" ("*está tanto cansada" instead of "está tan cansada").',
      'Leaving "tanto" invariable before a noun instead of agreeing in gender and number ("*tanto personas vinieron" instead of "tantas personas vinieron").',
      'Confusing this consequence construction with the A2 equality comparison tan/tanto…como, blending the two into ungrammatical hybrids.',
    ],
  },

  {
    key: 'es-b2-sino-adversatives',
    kind: 'grammar',
    name: 'Pero vs. sino: correction versus contrast',
    description:
      'Sino corrects a negated statement (No es antipático sino tímido) and requires sino que before a finite verb (sino que estoy dispuesto a ayudar); pero contrasts without correcting, even after a negation (No tiene dinero, pero es feliz); no obstante is a literary "nevertheless".',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'No es antipático sino tímido.',
      'No solo le creo, sino que estoy dispuesto a ayudarlo.',
      'No tiene dinero, pero es feliz.',
      'No obstante, decidieron seguir adelante con el proyecto.',
    ],
    examplesNegative: ['*No es antipático, pero tímido.'],
    commonErrors: [
      'Using pero instead of sino when the first clause is being corrected, not merely qualified ("*no es antipático, pero tímido" instead of "sino tímido").',
      'Omitting "que" before a finite verb after sino ("*sino estoy dispuesto a ayudarlo" instead of "sino que estoy dispuesto a ayudarlo").',
      'Using sino outside a negative context, where only pero is possible ("*habla francés, sino mal" instead of "pero mal").',
    ],
  },

  {
    key: 'es-b2-causal-connectors',
    kind: 'grammar',
    name: 'Formal causal connectors: ya que, puesto que, debido a que, enunciative porque',
    description:
      'Ya que and puesto que mean "since/given that", fronted or after the main clause; debido a que is a formal causal alternative; porque can also justify the speaker\'s assertion about a state rather than explain its cause (Están en casa, porque veo luz encendida); colloquial que links an imperative or warning to its reason (¡Rápido, que se va el tren!).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Puesto que quieres que me quede, me quedo.',
      'No pudimos salir, ya que llovía sin parar.',
      'El vuelo se retrasó debido a que había niebla en el aeropuerto.',
      'Están en casa, porque veo luz encendida en la ventana.',
      '¡Date prisa, que se va el tren!',
    ],
    examplesNegative: ['*El vuelo se retrasó debido que había niebla en el aeropuerto.'],
    commonErrors: [
      'Dropping the "a" in "debido a que" ("*debido que" instead of "debido a que").',
      'Confusing "porque" (because) with "por qué" (why) in writing.',
      'Missing the enunciative use of porque to justify the speaker\'s inference rather than the fact itself, and reaching for ya que instead in that context.',
    ],
  },

  {
    key: 'es-b2-lo-nominalizer',
    kind: 'grammar',
    name: 'Lo as nominalizer: lo + adjective, lo de, lo que, lo + adj + que',
    description:
      'Lo + masculine singular adjective as an abstract noun (lo interesante, lo mejor); lo de + noun phrase for "the business of" (lo de ayer); lo que relative clauses; lo + adjective + que as an intensifier where the adjective agrees with its noun (lo cansada que estaba); el porqué "the reason"; superlative time expressions with neuter lo (lo antes posible).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Lo importante es que digan la verdad.',
      '¿Le cuento lo de los otros tres novios?',
      'No sabes lo cansada que estaba después del viaje.',
      'Nadie conoce el porqué de su decisión.',
      'Envíamelo lo antes posible, por favor.',
    ],
    examplesNegative: ['*María estaba agotada; no sabes lo cansado que estaba.'],
    commonErrors: [
      'Treating "lo + adjective + que" as invariable instead of agreeing the adjective with the noun it describes ("*no sabes lo cansado que estaba" for a female subject, instead of "lo cansada que estaba").',
      'Using "lo de" even when a specific gendered referent is meant, instead of "el/la/los/las de".',
      'Writing "por qué" instead of "el porqué" for the noun meaning "the reason".',
    ],
  },

  {
    key: 'es-b2-comparatives-advanced',
    kind: 'grammar',
    name: 'Advanced comparatives: de lo que, superior/inferior a, el doble de, igual que',
    description:
      'Más/menos + de lo que (or gendered del/de la que) for clausal comparison (más caro de lo que pensaba); superior/inferior a; el doble de and tres veces más for multiplicative comparison; igual que for equality; bare más N que N pitting two nouns (más libros que revistas).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Es más caro de lo que pensaba.',
      'Su rendimiento fue superior al de la competencia.',
      'Esta ciudad tiene el doble de habitantes que la nuestra.',
      'Aquí llueve tres veces más que en el sur.',
      'En esta biblioteca hay más revistas que libros.',
      'Ahora hay muchas más oportunidades que antes.',
    ],
    examplesNegative: ['*Es más caro que pensaba.'],
    commonErrors: [
      'Using bare "que" before a clause instead of "de lo que" (or gendered del/de la que) when comparing across two different verbs ("*es más caro que pensaba" instead of "es más caro de lo que pensaba").',
      'Leaving mucho/poco invariable before más/menos/mayor/menor + noun ("*mucho más casas" instead of "muchas más casas") — they agree in gender and number (muchos menos hijos, mucha mayor velocidad).',
      'Treating "superior/inferior a" like "más/menos que" and inserting "que" instead of "a" ("*superior que la competencia" instead of "superior a la competencia").',
      'Using "que" instead of "de" before a quantified noun phrase after multiplicatives ("*el doble que habitantes" instead of "el doble de habitantes") — "que" is correct only before a comparison target ("gana el doble que yo").',
    ],
  },

  {
    key: 'es-b2-correlative-comparison',
    kind: 'grammar',
    name: 'Correlative and progressive comparison',
    description:
      'Cuanto más/menos..., más/menos... for "the more..., the more..." (Cuanto más practiques, más aprenderás), with cuanto agreeing before a noun (cuantas más fotos) and the subjunctive for future reference; and cada vez más/menos for "more and more" — never *más y más.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Cuanto más practiques, más aprenderás.',
      'Cuantas más fotos veo, menos me decido.',
      'El tráfico está cada vez peor.',
    ],
    examplesNegative: ['*Más practicas, más aprendes.', '*La ciudad está más y más cara.'],
    commonErrors: [
      'Calquing English "the more..., the more...", producing "*más practicas, más aprendes" or "*lo más... lo más..." instead of "cuanto más practiques, más aprenderás".',
      'Calquing "more and more" as "*más y más" instead of "cada vez más".',
      'Leaving cuanto invariable before a noun, producing "*cuanto más fotos" instead of "cuantas más fotos".',
    ],
    prerequisiteKeys: ['es-a2-comparatives-superlatives'],
    clozeUnsuitable: true,
  },
  {
    key: 'es-b2-quantifiers-advanced',
    kind: 'grammar',
    name: 'Advanced quantifiers: cualquier(a), partitives, multiplicatives, algo + adjective',
    description:
      'Cualquier + noun drops the final -a (cualquier libro), while the standalone pronoun cualquiera keeps it; partitives la mitad de / un tercio de; multiplicative el doble de and the ratio tres de cada cinco; attenuating algo + adjective for "rather/somewhat" (Es algo pesado).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Cualquier libro de esa estantería te servirá.',
      'Cualquiera podría hacerlo mejor que él.',
      'La mitad de los invitados llegó tarde.',
      'Casi un tercio de la población vive en la capital.',
      'Tres de cada cinco personas prefieren el tren.',
      'Es algo pesado, pero se puede llevar.',
    ],
    examplesNegative: ['*Cualquiera libro de esa estantería te servirá.'],
    commonErrors: [
      'Using "cualquiera" before a noun instead of dropping the final -a to "cualquier" ("*cualquiera libro" instead of "cualquier libro").',
      'Missing the adverbial "rather/somewhat" use of algo before an adjective, reading "es algo pesado" as if algo were the A2 pronoun "something".',
      'Using "que" instead of "de" before a quantified noun phrase after multiplicatives or fractions ("*el doble que habitantes" instead of "el doble de habitantes") — "que" is correct only before a comparison target ("gana el doble que yo").',
      'Adding an article after ambos ("*ambas las chicas" instead of "ambas chicas") — ambos = los dos and takes no article; los dos is the usual spoken alternative.',
      'Making adverbial medio agree before an adjective ("*están medias dormidas" instead of "están medio dormidas") — medio agrees only as an adjective (media hora, media tonelada).',
    ],
  },

  {
    key: 'es-b2-cleft-sentences',
    kind: 'grammar',
    name: 'Cleft sentences: ser-focus with relator agreement',
    description:
      'Ser-focus cleft sentences where the relator matches the focus type: quien/el que for people (Fue Juan quien llamó), donde for place, cuando for time, lo que for a neuter idea (Lo que necesito es dormir); plain que alone in this slot is the classic anglophone error.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Fue Juan quien llamó anoche.',
      'Es aquí donde nos conocimos.',
      'Fue entonces cuando lo supe.',
      'Lo que necesito es dormir.',
      'El que manda aquí soy yo.',
    ],
    examplesNegative: ['*Fue Juan que llamó anoche.'],
    commonErrors: [
      'Using plain "que" instead of the relator matching the focus type ("*fue Juan que llamó" instead of "fue Juan quien/el que llamó").',
      'Using "donde" for a temporal focus or "cuando" for a place focus, instead of matching the relator to the focus type ("*fue entonces donde lo supe" instead of "fue entonces cuando lo supe").',
      'Dropping the preposition from the second half of a prepositional cleft in careful register ("*es con ella que tienes que hablar" instead of "es con ella con la que/con quien tienes que hablar").',
      'Making ser agree with the singular or neuter subject instead of a plural or personal predicate ("*todo es problemas" instead of "todo son problemas"; "*el jefe es tú" instead of "el jefe eres tú").',
      'Using third-person agreement in the relative clause when the focus is a plural first or second person ("*vosotros fuisteis los que lo vieron" instead of "los que lo visteis") — third person is only accepted in the singular (tú fuiste el que lo vio).',
    ],
  },

  {
    key: 'es-b2-adjective-position',
    kind: 'grammar',
    name: 'Adjective position and meaning',
    description:
      'Pre- versus postnominal adjective position changing meaning: un gran escritor (great) / un escritor grande (big), un pobre hombre (unfortunate) / un hombre pobre (poor), mi antiguo colegio (former) / un edificio antiguo (old), un viejo amigo / un amigo viejo; also único, nuevo, cierto.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Es un gran escritor, aunque no es un hombre grande.',
      'Visité mi antiguo colegio, un edificio antiguo del siglo XIX.',
      'Fue un mero malentendido, sin mayor importancia.',
      'El gobierno presentó su nueva política energética.',
    ],
    examplesNegative: ['*Es un escritor grande de fama mundial.'],
    commonErrors: [
      'Defaulting every adjective to postnominal position and losing the "former / great / unfortunate" readings that only the prenominal slot carries.',
      'Reading un pobre hombre as "a penniless man" — prenominal pobre means unfortunate; postnominal un hombre pobre is the money sense.',
      'Forgetting the apocopated form in prenominal position, producing "*un grande escritor" instead of "un gran escritor".',
      'Postposing the prenominal-only adjectives mero, pleno, supuesto, llamado, tamaño, sendos ("*un trámite mero" instead of "un mero trámite").',
      'Treating relational adjectives (virus informático, política energética, la vida familiar) like ordinary ones — they are always postnominal, not gradable with más/menos, and rarely predicative.',
    ],
    prerequisiteKeys: ['es-a2-adjective-apocopation'],
    clozeUnsuitable: true,
  },
  {
    key: 'es-b2-appreciative-suffixes',
    kind: 'grammar',
    name: 'Appreciative suffixes: diminutive -ito, augmentative -ón/-azo, pejorative -ucho',
    description:
      'Diminutive -ito, with the -c-/-e- allomorph after words ending in -n/-r (mujercita) or -e/ie-ue (cochecito); affective and lexicalized senses (bolsillo, via -illo); augmentative -ón/-azo (portazo); pejorative -ucho (casucha). Recognition-only: production stays capped at the core -ito/-ón.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Espera un momentito, por favor.',
      'Compró un cochecito para el bebé.',
      'Le dio un portazo tremendo al salir.',
      'Vivían en una casucha en las afueras del pueblo.',
    ],
    examplesNegative: ['*Tiene un dormitorito muy grande.'],
    commonErrors: [
      'Coining novel diminutives outside the safe -ito/-ón pattern, producing non-words a native speaker would not recognize ("*dormitorito" from dormitorio is not Spanish).',
      'Overapplying the -c-/-ec- allomorph to words that take a plain -ito/-ita ("*sillacita" instead of "sillita"), instead of reserving it for words ending in -n/-r or in -e/ie-ue.',
      'Assuming augmentatives like -ón are freely productive and inventing new coinages, rather than sticking to established, recognized forms.',
    ],
    // The derived form cannot be elicited without identifying the base word
    // (2026-07-08 run: 4/41 approved, 23 context-spoils-answer). The cue is
    // the parenthetical BASE word; the pool holds only transparent, B&B ch. 43
    // attested derivations (no lexicalized portazo/bolsillo/cajón class, no
    // forms already saturated in the approved pool: sillita, cajita, besito,
    // casucha, palmita, pulgarcito, barcucho, segundito).
    selfRevealingElicitation: 'base-word-cue',
    elicitationSeedValues: [
      // -ito/-ita, plain (B&B 43.2.1(3), 43.2.2)
      'casita', 'perrito', 'pajarito', 'botellita', 'bolsita', 'cosita',
      'momentito', 'paquetito', 'abuelita', 'hermanita', 'armarito',
      'gordito', 'tontito', 'igualito', 'cerquita', 'despacito', 'poquito',
      // -cito/-ecito allomorph after -n/-r, -e, or ie/ue (B&B 43.2.1(1)–(2))
      'mujercita', 'cochecito', 'madrecita', 'padrecito', 'puentecito',
      'piedrecita', 'siestecita', 'viejecito', 'cafecito', 'florecita',
      'solecito', 'vocecita', 'pececito', 'mayorcito', 'pobrecito',
      'parquecito', 'barecito',
      // -ón augmentative (B&B 43.3a)
      'solterón', 'cabezón', 'notición', 'chuletón', 'fortunón',
      // -azo augmentative / blow-with-object (B&B 43.3a)
      'cochazo', 'exitazo', 'golazo', 'profesorazo', 'catarrazo', 'codazo',
      // -ucho pejorative (B&B 43.4)
      'hotelucho',
    ],
  },
  {
    key: 'es-b2-aspectual-se',
    kind: 'grammar',
    name: 'Aspectual se (comerse, beberse, saberse)',
    description:
      'Reflexive pronoun on transitive verbs of consumption, perception, and knowledge to stress complete or remarkable consumption of a specific, quantified object: Me comí toda la pizza, Se bebió el café de un trago, Me sé todos los verbos, Se fuma tres paquetes al día. Requires a specific direct object (contrast bare Como pizza); distinct from agentless accidental se (Se me cayó).',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Me comí toda la pizza yo solo.',
      'Se bebió el café de un trago.',
      'Me sé todos los verbos irregulares.',
      'Se leyó la novela entera en una tarde.',
    ],
    examplesNegative: ['*Me comí pizza.'],
    commonErrors: [
      'Using aspectual se with a bare, unquantified object ("*me comí pizza" instead of "comí pizza" or "me comí una pizza entera").',
      'Mismatching the pronoun and the subject person ("*se comí toda la pizza" instead of "me comí toda la pizza").',
      'Confusing deliberate aspectual se (se bebió el vino) with the accidental se + dative construction for mishaps (se le cayó el vino).',
    ],
    prerequisiteKeys: ['es-a2-reflexive-verbs'],
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

  // ---------------------------------------------------------------------------
  // Paraphrase umbrellas — kind: 'paraphrase' (Phase 2 contextual-paraphrase generation)
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-paraphrase',
    kind: 'paraphrase',
    name: 'Paraphrase — say it another way (B1)',
    description:
      'Rewrite a B1 sentence under one constraint: avoid a given word, shift register, or simplify for an audience — preserving meaning while reaching for synonyms and alternative structures.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Source "Me encanta el cine" → without «encantar»: "Disfruto muchísimo del cine."',
      'Source "¿Me pasas la sal?" → formal register: "¿Sería tan amable de pasarme la sal?"',
    ],
    examplesNegative: ['*A rewrite that changes the meaning of the source.'],
    commonErrors: [
      'Using a banned word in a different inflected form.',
      'Changing register but also changing what is said.',
    ],
    paraphrase: {
      seeds: [
        'a complaint to a landlord',
        'describing a childhood memory',
        'asking a colleague for a deadline extension',
        'giving directions to a tourist',
        'declining an invitation politely',
        'explaining why you are late',
        'recommending a restaurant',
        'apologising for a mistake at work',
        'describing your morning routine',
        'asking for a refund in a shop',
        'inviting a friend to an event',
        'summarising a film you saw',
      ],
    },
  },
  {
    key: 'es-b2-paraphrase',
    kind: 'paraphrase',
    name: 'Paraphrase — say it another way (B2)',
    description:
      'Rewrite a B2 sentence under one constraint: avoid a given word, shift register up or down, or simplify a nuanced point for a lay audience — preserving the full propositional content.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Source "El desempleo ha aumentado considerablemente" → without «aumentar»: "El desempleo ha crecido de forma notable."',
      'Source "Necesitamos abordar este problema cuanto antes" → simplify for a child: "Tenemos que solucionar esto pronto."',
    ],
    examplesNegative: ['*A rewrite that drops part of the original claim.'],
    commonErrors: [
      'Simplifying so much that a key nuance is lost.',
      'Swapping in a near-synonym that shifts the meaning slightly.',
    ],
    paraphrase: {
      seeds: [
        'summarising a news article for a friend',
        'explaining a company policy change to staff',
        'writing a formal complaint to a public office',
        'giving constructive feedback to a colleague',
        'defending an unpopular opinion in a debate',
        'explaining a legal clause in plain language',
        'pitching a project idea to a manager',
        'describing a health issue to a doctor',
        'negotiating a salary raise',
        'explaining why a plan failed to a client',
        'writing a reference letter for a former employee',
        'proposing a compromise in a disagreement',
      ],
    },
  },
];

export { esCurriculum };
export default esCurriculum;
