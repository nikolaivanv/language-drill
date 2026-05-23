import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// TEMPORARILY REDUCED (2026-05-10): TR B1 + B2 grammar entries and the B1/B2
// vocab umbrellas are commented out so the prod scheduler stops generating
// them. To restore: uncomment the B1/B2 sections below, restore B1/B2 in the
// destructure, bump TR back in PER_LANGUAGE_GRAMMAR_MIN (curriculum/index.ts),
// restore TR B1/B2 entries in SEED_KEY_TO_GRAMMAR_POINT (seed-exercises.ts),
// and re-enable the per-language counts assertions for Turkish (curriculum.test.ts).
const TR = Language.TR;
const { A1, A2 } = CefrLevel;

/**
 * Per-language curriculum version. Bump in the same commit as any edit to
 * this file's grammar entries (analogous to `*_PROMPT_VERSION` in
 * `packages/ai/src/`). The scheduler in `infra/lambda/src/generation/`
 * compares this to the value recorded on the most recent succeeded
 * generation_jobs row for each cell — when they differ, any
 * "saturated-dedup" or "low-yield" suppression on that cell clears, on the
 * assumption that the curriculum edit may have unblocked the search space.
 */
export const CURRICULUM_VERSION_TR = '2026-05-23';

const trCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a1-vowel-harmony',
    kind: 'grammar',
    name: 'Vowel harmony',
    description:
      "Suffix vowels harmonise with the stem's last vowel. 2-way (e/a): plural -lAr, locative -DA, ablative -DAn. 4-way (i/ı/u/ü): accusative -(y)I, possessive -(s)I, dative, past -DI. Drill both patterns.",
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evler (houses) — front vowel /e/ → -ler',
      'okullar (schools) — back vowel /u/ → -lar',
      'evi (the house, accusative) — front unrounded /e/ stem → -i',
      'kapıyı (the door, accusative) — back unrounded /a/ stem → -ı',
      'okulu (the school, accusative) — back rounded /u/ stem → -u',
      'gülü (the rose, accusative) — front rounded /ü/ stem → -ü',
      'işte (at work, locative) — front unrounded /i/ stem → -te',
      'köprüye (to the bridge, dative) — front rounded /ü/ stem → -ye',
    ],
    examplesNegative: [
      '*okuller (wrong — back-vowel stem requires -lar)',
      '*evyi (wrong — accusative on /e/ stem is -(y)i with /y/ buffer → "evi", not "evyi")',
      '*okulı (wrong — back rounded /u/ stem requires -u, not -ı)',
    ],
    commonErrors: [
      'Defaulting to one vowel form (-ler) regardless of the stem vowel.',
      'Treating loanwords as if they followed front-vowel harmony when they take back-vowel suffixes.',
      'Picking the wrong member of the 4-way high-vowel set — e.g. using -ı on a rounded stem where -u is required (okulı vs. okulu), or using -i on a back-vowel stem where -ı is required.',
      'Conflating the 2-way (low-vowel) and 4-way (high-vowel) harmony patterns — applying -lAr/-lEr logic to suffixes that take the 4-way pattern, such as the accusative -(y)I.',
    ],
  },
  {
    key: 'tr-a1-personal-suffixes',
    kind: 'grammar',
    name: 'Personal (copular) suffixes',
    description:
      'Predicate suffixes -(y)Im, -sIn, Ø, -(y)Iz, -sInIz, -lAr that mark person on nominal predicates ("I am a teacher" → öğretmenim).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['Ben öğretmenim.', 'Sen öğrencisin.'],
    examplesNegative: ['*Ben öğretmen.'],
    commonErrors: [
      'Dropping the personal suffix and relying on the pronoun alone.',
      'Using -dir as a default predicate marker in conversational contexts.',
    ],
  },
  {
    key: 'tr-a1-plural-suffix',
    kind: 'grammar',
    name: 'Plural suffix -lAr',
    description:
      'The plural marker -lar/-ler attaches per vowel harmony. It is dropped after numerals and most quantifiers.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['kitaplar (books)', 'üç kitap (three books)'],
    examplesNegative: ['*üç kitaplar'],
    commonErrors: [
      'Adding -lAr after a numeral or a quantifier.',
      'Choosing the wrong harmonised form (-lar after a front vowel).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-locative',
    kind: 'grammar',
    name: 'Locative case -DA',
    description:
      'The locative -da/-de/-ta/-te marks "in/at/on" and harmonises with the stem; the consonant softens to -ta/-te after voiceless stems.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['evde (at home)', 'sokakta (on the street)'],
    examplesNegative: ['*sokakda'],
    commonErrors: [
      'Forgetting the consonant assimilation after voiceless final consonants.',
      'Confusing locative -DA with ablative -DAn.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },

  // ---------------------------------------------------------------------------
  // A2
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a2-dili-past',
    kind: 'grammar',
    name: 'Definite past -DI ("dili" past)',
    description:
      'The witnessed/definite past suffix -di/-dı/-du/-dü (with -ti/-tı/-tu/-tü after voiceless stems) plus personal endings.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Dün eve gittim.', 'Geçen yaz İstanbul\'a gittik.'],
    examplesNegative: ['*Dün eve gitdim.'],
    commonErrors: [
      'Forgetting consonant assimilation (-d → -t after voiceless stems).',
      'Confusing -DI (witnessed) with the -mIş evidential past.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-question-formation',
    kind: 'grammar',
    name: 'Yes/no question particle "mI"',
    description:
      'The interrogative particle mı/mi/mu/mü follows the focused element and takes person endings; harmonises with the preceding word.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Geliyor musun?', 'Sen öğrenci misin?'],
    examplesNegative: ['*Sen öğrencisin mi?'],
    commonErrors: [
      'Attaching the personal ending to the verb instead of to "mI".',
      'Choosing the wrong harmonised form of mI.',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a2-accusative-definite-object',
    kind: 'grammar',
    name: 'Accusative -(y)I for definite objects',
    description:
      'Marking definite or specific direct objects with -i/-ı/-u/-ü (with -y- after vowels). Indefinite objects remain unmarked.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Kitabı okudum. (the book)', 'Bir kitap okudum. (a book)'],
    examplesNegative: ['*Kitap okudum, çok beğendim. (when "the book" is meant)'],
    commonErrors: [
      'Marking every direct object with -(y)I regardless of definiteness.',
      'Failing to use -y- as a buffer consonant after a vowel-final stem.',
    ],
  },
  {
    key: 'tr-a2-genitive-possessive',
    kind: 'grammar',
    name: 'Genitive-possessive construction',
    description:
      '"X-(n)In Y-(s)I" pattern: genitive on the possessor and 3sg possessive on the possessed (öğretmenin kitabı = the teacher\'s book).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['öğretmenin kitabı', 'Türkiye\'nin başkenti'],
    examplesNegative: ['*öğretmen kitabı (when "the teacher\'s book" is meant)'],
    commonErrors: [
      'Omitting the genitive on the possessor.',
      'Omitting the 3sg possessive on the possessed.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-ablative-dative',
    kind: 'grammar',
    name: 'Ablative -DAn and dative -(y)A',
    description:
      'Ablative -dan/-den/-tan/-ten ("from") and dative -a/-e ("to/for"); both harmonise and the dative buffers with -y- after vowels.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Okuldan geliyorum.', 'Ankara\'ya gidiyorum.'],
    examplesNegative: ['*Ankara gidiyorum.'],
    commonErrors: [
      'Dropping the dative case on the goal of motion.',
      'Confusing ablative -DAn with locative -DA.',
    ],
    prerequisiteKeys: ['tr-a1-locative'],
  },

  /*
  // ---------------------------------------------------------------------------
  // B1
  // ---------------------------------------------------------------------------
  {
    key: 'tr-b1-mis-evidential',
    kind: 'grammar',
    name: 'Evidential past -mIş',
    description:
      'Reported, inferred, or surprise past with -mış/-miş/-muş/-müş — used when the speaker did not witness the event directly.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['Hava soğukmuş.', 'Ahmet evlenmiş.'],
    examplesNegative: ['*Dün hava soğukmuş. (when speaker felt the cold)'],
    commonErrors: [
      'Using -mIş for events the speaker actually witnessed.',
      'Confusing the -mIş evidential with the -mIş perfect participle.',
    ],
    prerequisiteKeys: ['tr-a2-dili-past'],
  },
  {
    key: 'tr-b1-aorist',
    kind: 'grammar',
    name: 'Aorist -(I/A)r',
    description:
      'Aorist tense for habitual actions, general truths, and polite offers; irregular stems (geliyor → gelir).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['Her sabah kahve içerim.', 'Çay ister misiniz?'],
    examplesNegative: ['*Her sabah kahve içiyorum. (in a generic-truth context)'],
    commonErrors: [
      'Substituting the present continuous -(I)yor for habitual statements.',
      'Picking the wrong aorist suffix for monosyllabic stems.',
    ],
  },
  {
    key: 'tr-b1-future',
    kind: 'grammar',
    name: 'Future -(y)AcAk',
    description:
      'Future tense -acak/-ecek (with -y- buffer); k → ğ before vowel-initial suffixes (gidecek → gideceğim).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['Yarın geleceğim.', 'Onlar tatile gidecekler.'],
    examplesNegative: ['*Yarın gelecekım.'],
    commonErrors: [
      'Failing to soften final -k to -ğ before vowel-initial suffixes.',
      'Substituting the present -(I)yor for planned future events when -(y)AcAk is more idiomatic.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-b1-conditionals-sa',
    kind: 'grammar',
    name: 'Conditional -sA',
    description:
      'Conditional/irrealis -sa/-se attaches to verbal stems for "if" clauses, polite requests, and counterfactuals when combined with past tenses.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['Vaktim olsa, gelirim.', 'Yağmur yağarsa, evde kalırız.'],
    examplesNegative: ['*Vaktim olur, gelirim.'],
    commonErrors: [
      'Omitting -sA in irrealis conditions.',
      'Mixing -sA with the wrong main-clause tense for the intended modality.',
    ],
  },
  {
    key: 'tr-b1-keske-optative',
    kind: 'grammar',
    name: '"Keşke" + past for regret and wish',
    description:
      '"Keşke" with -DI past for past regrets ("if only I had…") and with -sA for present-time wishes.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Keşke daha çok çalışsaydım.',
      'Keşke burada olsa.',
    ],
    examplesNegative: ['*Keşke daha çok çalışırım.'],
    commonErrors: [
      'Using the simple aorist or present after "keşke".',
      'Mixing -sA and -DI tenses incorrectly between regret and wish meanings.',
    ],
    prerequisiteKeys: ['tr-a2-dili-past', 'tr-b1-conditionals-sa'],
  },
  {
    key: 'tr-b1-causal-conjunctions',
    kind: 'grammar',
    name: 'Causal conjunctions and converbs',
    description:
      'Expressing cause: "çünkü" (paratactic), "için" / "-dığı için" (because), "yüzünden" / "sayesinde" (negative / positive cause).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Geç kaldım çünkü trafik vardı.',
      'Trafik olduğu için geç kaldım.',
    ],
    examplesNegative: ['*Geç kaldım için trafik vardı.'],
    commonErrors: [
      'Treating "çünkü" and "için" as interchangeable.',
      'Forgetting to nominalise with -DIğI before "için" in subordinate clauses.',
    ],
  },

  // ---------------------------------------------------------------------------
  // B2
  // ---------------------------------------------------------------------------
  {
    key: 'tr-b2-relative-clause-participles',
    kind: 'grammar',
    name: 'Relative-clause participles -(y)An / -DIK / -(y)AcAK',
    description:
      'Pre-nominal relative clauses: -(y)An for subject relatives, -DIK and -(y)AcAK with possessive suffixes for non-subject relatives in past/non-past and future.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Dün gelen adam (the man who came yesterday)',
      'Okuduğum kitap (the book I am reading)',
    ],
    examplesNegative: ['*Ben okuyan kitap'],
    commonErrors: [
      'Using -(y)An for non-subject relatives.',
      'Forgetting the possessive suffix on -DIK / -(y)AcAK forms.',
    ],
    prerequisiteKeys: ['tr-a2-genitive-possessive'],
  },
  {
    key: 'tr-b2-passive-with-nominalization',
    kind: 'grammar',
    name: 'Passive plus -DIK nominalisation',
    description:
      'Passive -Il/-In/-n forms combined with -DIğI nominal clauses, often the academic-register subject of impersonal claims ("It is known that…").',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Bu kitabın 1980\'de yazıldığı bilinmektedir.',
      'Sorunun çözüldüğü açıklandı.',
    ],
    examplesNegative: ['*Bu kitap 1980\'de yazdı bilinmektedir.'],
    commonErrors: [
      'Using the active form inside a -DIğI clause that requires the passive.',
      'Forgetting the genitive marker on the embedded subject.',
    ],
    prerequisiteKeys: ['tr-b2-relative-clause-participles'],
  },
  {
    key: 'tr-b2-converbs',
    kind: 'grammar',
    name: 'Converbs (-(y)Ip, -ArAk, -DIğIndA, -DIğI zaman)',
    description:
      'Adverbial subordinators that link clauses by manner, sequence, or time without a finite verb in the dependent clause.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Eve gelip yemek yedim.',
      'Onu gördüğümde çok şaşırdım.',
    ],
    examplesNegative: ['*Eve geldim ve yemek yedim. (overusing finite "ve")'],
    commonErrors: [
      'Defaulting to "ve" coordination instead of using converbs.',
      'Mixing -(y)Ip and -ArAk where each is idiomatic.',
    ],
  },
  {
    key: 'tr-b2-causative-reciprocal',
    kind: 'grammar',
    name: 'Causative and reciprocal voices',
    description:
      'Causative -DIr/-Ir/-t and reciprocal/cooperative -(I/A)ş; case shifts on participants when the valency changes.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Annem bana mektubu yazdırdı.',
      'Çocuklar parkta birbirleriyle konuşuştular.',
    ],
    examplesNegative: ['*Annem ben mektubu yazdırdı.'],
    commonErrors: [
      'Failing to mark the causee with the dative or accusative as required.',
      'Doubling causative suffixes unnecessarily.',
    ],
  },
  {
    key: 'tr-b2-noun-clauses-ma-dik',
    kind: 'grammar',
    name: 'Noun clauses with -mA / -DIK / -(y)AcAK',
    description:
      'Embedded clauses functioning as noun arguments: -mA(K) for non-finite, -DIK for past/general, -(y)AcAK for future, all taking possessive plus case.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Onun gelmesini istiyorum.',
      'Yarın yağmur yağacağını söyledi.',
    ],
    examplesNegative: ['*Onun geldi istiyorum.'],
    commonErrors: [
      'Using a finite tensed clause where a -DIK / -(y)AcAK noun clause is required.',
      'Forgetting the genitive on the embedded subject.',
    ],
    prerequisiteKeys: ['tr-b2-relative-clause-participles'],
  },
  */

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a2-everyday-vocab',
    kind: 'vocab',
    name: 'Everyday vocabulary (A2)',
    description:
      'High-frequency Turkish vocabulary covering family, food, daily routines, weather, transport, and basic shopping.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['kahvaltı (breakfast)', 'durak (stop)'],
    examplesNegative: ['*kahve altı'],
    commonErrors: [
      'Splitting compound nouns into separate words.',
      'Confusing aile (family) with akraba (relatives).',
    ],
  },
  /*
  {
    key: 'tr-b1-abstract-noun-vocab',
    kind: 'vocab',
    name: 'Abstract noun vocabulary (B1)',
    description:
      'Vocabulary for opinions, society, environment, and current affairs typical of B1-level discussion.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['çevre (environment)', 'iletişim (communication)'],
    examplesNegative: ['*çevreler dünya geneli'],
    commonErrors: [
      'Confusing "çevre" (environment) with "etraf" (surroundings).',
      'Calquing English compound expressions instead of using a single Turkish nominalisation.',
    ],
  },
  {
    key: 'tr-b2-academic-noun-vocab',
    kind: 'vocab',
    name: 'Academic abstract noun vocabulary (B2)',
    description:
      'Academic-register abstract nouns and Ottoman-derived vocabulary common in essays, reports, and formal news writing.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['sürdürülebilirlik (sustainability)', 'gelişme (development)'],
    examplesNegative: ['*sürdürebilirlik'],
    commonErrors: [
      'Mistakes on -lIk derivational suffix (vowel harmony).',
      'Mixing Ottoman-derived and Turkic-derived synonyms with mismatched register.',
    ],
  },
  */
];

export { trCurriculum };
export default trCurriculum;
