import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// TR curriculum aligned to full Yedi İklim A1+A2 parity (2026-05-28): 26 A1
// + 14 A2 grammar entries + 1 A2 vocab umbrella. B1 + B2 grammar entries and
// B1/B2 vocab umbrellas remain commented out so the prod scheduler does not
// generate them. To re-enable B1/B2: uncomment the B1/B2 sections below,
// restore B1/B2 in the destructure, raise TR's B1/B2 floors in
// PER_LANGUAGE_GRAMMAR_MIN (curriculum/index.ts), restore TR B1/B2 entries in
// SEED_KEY_TO_GRAMMAR_POINT (seed-exercises.ts), and update the per-language
// counts assertions for Turkish (curriculum.test.ts).
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
export const CURRICULUM_VERSION_TR = '2026-05-28';

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
      'Copular person suffixes on nominal predicates: 1sg -(y)Im, 2sg -sIn, 3sg Ø, 1pl -(y)Iz, 2pl -sInIz, 3pl -lAr (optional, human subjects only). Conversational -DIr is the wrong default.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğretmenim.', // 1sg -(y)Im — I am a teacher
      'Sen öğrencisin.', // 2sg -sIn — you are a student
      'O bir doktor.', // 3sg Ø — s/he is a doctor (no suffix is the correct form)
      'Biz hazırız.', // 1pl -(y)Iz — we are ready
      'Siz yorgunsunuz.', // 2pl -sInIz — you (pl) are tired
      'Kediler küçük.', // 3pl, non-human subject → no -lAr — the cats are small
      'Öğrenciler çalışkanlar.', // 3pl, human subject → optional -lAr — the students are hardworking
    ],
    examplesNegative: [
      '*Ben öğretmen.', // dropped the obligatory 1sg -(y)Im
      '*Kediler küçükler.', // -lAr forced onto a non-human plural subject
      '*Bu masa güzeldir.', // -DIr as a conversational default (should be "Bu masa güzel")
    ],
    commonErrors: [
      'Dropping the obligatory personal suffix (e.g. *Ben öğretmen for Ben öğretmenim).',
      'Using -DIr as a default spoken copula (Bu güzeldir instead of Bu güzel).',
      'Adding 3pl -lAr to non-human subjects (*Kediler küçükler).',
      'Treating 3pl -lAr as mandatory; with human subjects it is optional, with non-human subjects it is omitted.',
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
  {
    key: 'tr-a1-present-continuous',
    kind: 'grammar',
    name: 'Present continuous -(I)yor',
    description:
      'Present continuous -(I)yor: high-vowel buffer harmonises with the stem (geliyor, oturuyor, görüyor). After a vowel-final stem, the stem vowel is raised to high (başla- → başlıyor).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Geliyorum. (I am coming.)',
      'Çay içiyoruz. (We are drinking tea.)',
      'Başlıyor. (It is starting.)',
    ],
    examplesNegative: [
      '*Başlayor. (wrong — stem-final /a/ must raise to /ı/ before -yor: başlıyor)',
    ],
    commonErrors: [
      'Failing to raise the stem-final low vowel to a high vowel before -yor (başlayor instead of başlıyor).',
      'Picking the wrong harmonised buffer vowel after a consonant-final stem (gelıyor instead of geliyor).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-negation',
    kind: 'grammar',
    name: 'Verbal negation -mA',
    description:
      'Verbal negation -ma/-me between stem and tense. Before -(I)yor it fuses as -mIyor with the vowel raised and harmonised: gel- → gelmiyor, oku- → okumuyor.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Gelmiyorum. (I am not coming.)',
      'Dün gelmedim. (I did not come yesterday.)',
    ],
    examplesNegative: [
      '*Gelmeyorum. (wrong — -me + -yor fuses to -miyor: gelmiyorum)',
    ],
    commonErrors: [
      'Failing to raise the negation vowel before -yor (gelmeyor instead of gelmiyor).',
      'Placing the negation suffix after the tense suffix instead of between stem and tense.',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a1-dili-past',
    kind: 'grammar',
    name: 'Definite past -DI ("dili" past)',
    description:
      'The witnessed/definite past suffix -di/-dı/-du/-dü (with -ti/-tı/-tu/-tü after voiceless stems) plus personal endings.',
    cefrLevel: A1,
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
    key: 'tr-a1-future',
    kind: 'grammar',
    name: 'Future -(y)AcAk',
    description:
      'Future tense -acak/-ecek (with -y- buffer); k → ğ before vowel-initial suffixes (gidecek → gideceğim).',
    cefrLevel: A1,
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
    key: 'tr-a1-imperative',
    kind: 'grammar',
    name: 'Imperative (Emir)',
    description:
      '2sg imperative is the bare stem (gel!); 2pl/formal is stem + -(y)In (gelin!, okuyun!), with a -y- buffer after vowel-final stems.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Gel! (Come! — 2sg, bare stem)',
      'Gelin! (Come! — 2pl/formal)',
      'Okuyun! (Read! — vowel stem + -yun)',
    ],
    examplesNegative: [
      '*Gele! (wrong — 2sg imperative is the bare stem "gel", not "gele")',
    ],
    commonErrors: [
      'Adding the -y- buffer to consonant-final stems (*gelyin instead of gelin).',
      'Confusing the 2sg imperative (bare stem) with the optative -sIn (gelsin = "let him come").',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-questions',
    kind: 'grammar',
    name: 'Question formation (mı + WH-words)',
    description:
      'Yes/no questions: particle mı/mi/mu/mü follows the focused word and takes person endings. Content questions use WH-words (ne, kim, nerede, ne zaman, kaç, nasıl, neden) in normal position.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Geliyor musun? (Are you coming?)',
      'Sen öğrenci misin? (Are you a student?)',
      'Bu ne? (What is this?)',
      'Nerede oturuyorsun? (Where do you live?)',
    ],
    examplesNegative: [
      '*Sen öğrencisin mi? (wrong — the person ending attaches to mI, not the predicate: "Sen öğrenci misin?")',
    ],
    commonErrors: [
      'Attaching the personal ending to the predicate instead of to mI ("öğrencisin mi" instead of "öğrenci misin").',
      'Choosing the wrong harmonised form of mI.',
      'Fronting a WH-word English-style instead of leaving it in its normal sentence position.',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a1-degil',
    kind: 'grammar',
    name: 'Nominal negation (değil)',
    description:
      '"değil" negates nominal / copular predicates and takes the personal endings: öğrenci değilim, müsait değilsin. Used with adjectives, nouns, and locative predicates (evde değilim).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğrenci değilim. (I am not a student.)',
      'Bu çay değil. (This is not tea.)',
      'Evde değilim. (I am not at home.)',
    ],
    examplesNegative: [
      '*Ben öğretmen yokum. (wrong — nominal predicates are negated with "değil", not "yok": "öğretmen değilim")',
    ],
    commonErrors: [
      'Using yok (existential negation) instead of değil for nominal predicate negation ("öğretmen yokum" instead of "öğretmen değilim").',
      'Dropping the personal ending on değil ("ben öğrenci değil" instead of "değilim").',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a1-var-yok',
    kind: 'grammar',
    name: 'Existence and possession (var / yok)',
    description:
      'var = "there is / exists", yok = "there is not". Possession: possessive suffix on the possessed noun + var/yok — bir arabam var (I have a car), vaktim yok (I have no time).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Evde kitap var. (There is a book at home.)',
      'Bir arabam var. (I have a car.)',
      'Vaktim yok. (I have no time.)',
    ],
    examplesNegative: [
      '*Ben bir araba var. (wrong — possession requires the possessive suffix on the possessed noun: "Bir arabam var")',
    ],
    commonErrors: [
      'Calquing English "I have X" with a subject pronoun instead of marking the possessed noun ("ben bir araba var" instead of "bir arabam var").',
      'Using değil to negate existence/possession instead of yok ("kitap değil" instead of "kitap yok" for "there is no book").',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-accusative-definite-object',
    kind: 'grammar',
    name: 'Accusative -(y)I for definite objects',
    description:
      'Marking definite or specific direct objects with -i/-ı/-u/-ü (with -y- after vowels). Indefinite objects remain unmarked.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['Kitabı okudum. (the book)', 'Bir kitap okudum. (a book)'],
    examplesNegative: ['*Kitap okudum, çok beğendim. (when "the book" is meant)'],
    commonErrors: [
      'Marking every direct object with -(y)I regardless of definiteness.',
      'Failing to use -y- as a buffer consonant after a vowel-final stem.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-ablative-dative',
    kind: 'grammar',
    name: 'Ablative -DAn and dative -(y)A',
    description:
      'Ablative -dan/-den/-tan/-ten ("from") and dative -a/-e ("to/for"); both harmonise and the dative buffers with -y- after vowels.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['Okuldan geliyorum.', 'Ankara\'ya gidiyorum.'],
    examplesNegative: ['*Ankara gidiyorum.'],
    commonErrors: [
      'Dropping the dative case on the goal of motion.',
      'Confusing ablative -DAn with locative -DA.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-locative'],
  },
  {
    key: 'tr-a1-genitive-possessive',
    kind: 'grammar',
    name: 'Genitive-possessive construction',
    description:
      '"X-(n)In Y-(s)I" pattern: genitive on the possessor and 3sg possessive on the possessed (öğretmenin kitabı = the teacher\'s book).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['öğretmenin kitabı', 'Türkiye\'nin başkenti'],
    examplesNegative: ['*öğretmen kitabı (when "the teacher\'s book" is meant)'],
    commonErrors: [
      'Omitting the genitive on the possessor.',
      'Omitting the 3sg possessive on the possessed.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-demonstratives',
    kind: 'grammar',
    name: 'Demonstratives (bu / şu / o, burası / şurası / orası)',
    description:
      'Demonstratives bu/şu/o (this / that — proximal, medial, distal) work as pronouns and adjectives. Locational burası/şurası/orası ("this/that place") take case suffixes like nouns.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bu kitap çok güzel. (This book is very nice.)',
      'Şu çantayı al. (Take that bag.)',
      'Orası çok uzak. (That place is very far.)',
      'Burada bekleyelim. (Let us wait here.)',
    ],
    examplesNegative: [
      '*Bu uzak. (when meaning "this place is far" — "bu" modifies a noun; the noun for "this place" is "burası": "Burası uzak.")',
    ],
    commonErrors: [
      'Confusing bu (pronoun/adjective "this") with bura/burası (the noun "this place / here"): *Bu uzak instead of Burası uzak.',
      'Not distinguishing the three distance levels: bu = proximal, şu = medial / just introduced, o = distal / already known.',
    ],
  },
  {
    key: 'tr-a1-personal-pronouns',
    kind: 'grammar',
    name: 'Personal pronouns and their case forms',
    description:
      'Subject pronouns ben/sen/o/biz/siz/onlar and their case-marked forms (bana, beni, bende, benden, benim). Note the irregular -n- buffer in 3rd-person forms (onu, onun, ona).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğrenciyim. (I am a student — subject.)',
      'Bana ver. (Give to me — dative.)',
      'Senin kitabın. (Your book — genitive.)',
      'Onu gördüm. (I saw him/her/it — accusative.)',
    ],
    examplesNegative: [
      '*Beni geldim. (wrong — subject is "ben", not the accusative "beni": "Ben geldim.")',
    ],
    commonErrors: [
      'Using oblique forms (beni, bana) where the subject is needed — the subject pronoun is always the bare form ben.',
      'Forgetting the irregular -n- buffer before case suffixes in 3rd person: onu, ona, onun, onda, ondan (not *ou, *oa).',
    ],
  },
  {
    key: 'tr-a1-numbers-ordinals',
    kind: 'grammar',
    name: 'Numbers and ordinals (-(I)ncI)',
    description:
      'Cardinal numbers form compounds by juxtaposition (yüz yirmi üç = 123). Ordinals attach -(I)ncI to the cardinal stem, harmonising: birinci, ikinci, üçüncü, dördüncü.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'üç kitap (three books)',
      'yüz yirmi üç (123 — compound, no connector)',
      'birinci sınıf (first class / grade)',
      'üçüncü kat (third floor)',
    ],
    examplesNegative: [
      '*yüz ve yirmi üç. (wrong — compound numbers juxtapose without "ve": "yüz yirmi üç")',
    ],
    commonErrors: [
      'Inserting "ve" between parts of a compound number ("yüz ve yirmi üç" instead of "yüz yirmi üç").',
      'Picking the wrong harmonised form of the ordinal -(I)ncI suffix (*üçinci instead of üçüncü).',
      'Pluralising the noun after a numeral ("üç kitaplar" — see tr-a1-plural-suffix).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-possessive-suffixes',
    kind: 'grammar',
    name: 'Possessive suffixes (İyelik ekleri)',
    description:
      'Personal possessive suffixes attach to the possessed noun: -(I)m, -(I)n, -(s)I, -(I)mIz, -(I)nIz, -lArI. After a vowel-final stem the 3sg uses an -s- buffer (kapısı, not *kapıı).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evim (my house)',
      'kitabın (your book)',
      'arabası (his/her car) — vowel-final stem + -sı',
      'evimiz (our house)',
    ],
    examplesNegative: [
      '*evi (when meaning "my house" — "evi" is 3sg "his/her house"; "my house" is "evim")',
    ],
    commonErrors: [
      'Confusing 1sg -(I)m with 3sg -(s)I: "evim" (my house) vs "evi" (his/her house).',
      'Dropping the -s- buffer in 3sg after a vowel-final stem (*arabaı instead of arabası).',
      'Marking the possessor instead of the possessed (possessive suffix goes on the possessed noun; the possessor takes the genitive).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-instrumental-ile',
    kind: 'grammar',
    name: 'Instrumental ile / -(y)lA',
    description:
      'Instrumental "with / by" — standalone postposition ile or suffix -la/-le harmonised, with -y- buffer after vowel-final stems: arkadaşımla, kalemle, arabayla.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Arkadaşımla geldim. (I came with my friend.)',
      'Kalemle yazıyorum. (I am writing with a pen.)',
      'Otobüsle gidiyoruz. (We go by bus.)',
      'Arabayla geldim. (I came by car — -y- buffer after vowel.)',
    ],
    examplesNegative: [
      '*Arabala geldim. (wrong — vowel-final stem needs -y- buffer: "arabayla")',
    ],
    commonErrors: [
      'Forgetting the -y- buffer on vowel-final stems (*arabala instead of arabayla).',
      'Picking the wrong harmonised form of -lA (*arkadaşle instead of arkadaşla on a back-vowel stem).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-postpositions-once-sonra',
    kind: 'grammar',
    name: '-DAn önce / -DAn sonra (before / after)',
    description:
      '"Before" and "after" a noun take ablative -DAn on the noun + önce/sonra: yemekten sonra (after the meal), dersten önce (before class), akşamdan sonra.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Yemekten sonra çay içeriz. (After the meal we drink tea.)',
      'Dersten önce kahve aldım. (I had coffee before class.)',
      'Akşamdan sonra yağmur yağdı. (After evening it rained.)',
    ],
    examplesNegative: [
      '*Yemek sonra çay içeriz. (wrong — önce / sonra need the noun in the ablative: "yemekten sonra")',
    ],
    commonErrors: [
      'Omitting the ablative -DAn on the noun before önce/sonra (*yemek sonra instead of yemekten sonra).',
      'Confusing this nominal -DAn önce / sonra with the A2 converbal -mAdAn önce / -DIktAn sonra, which attach to verb stems.',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-dan-a-kadar',
    kind: 'grammar',
    name: '-DAn … -A kadar (from … to / until)',
    description:
      '"From X to Y" uses ablative -DAn on the source and dative -A + kadar on the goal: sabahtan akşama kadar (morning to evening), evden okula kadar (home to school).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Sabahtan akşama kadar çalıştım. (I worked from morning till evening.)',
      'Evden okula kadar yürüyorum. (I walk from home to school.)',
      'Pazartesi\'den cuma\'ya kadar (from Monday to Friday)',
    ],
    examplesNegative: [
      '*Sabah akşama kadar. (wrong — the source must take ablative: "sabahtan akşama kadar")',
    ],
    commonErrors: [
      'Omitting the ablative on the source ("sabah akşama kadar" instead of "sabahtan akşama kadar").',
      'Omitting "kadar" on the goal ("sabahtan akşama" without "kadar" — the construction needs both halves).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-ki-relativizer',
    kind: 'grammar',
    name: 'Relativiser -ki / -DAki',
    description:
      'Relativiser -ki (invariant, no vowel harmony) turns a case-marked phrase into an attributive relative: masadaki kitap (the book on the table), benimki (mine), evdekiler (the ones at home).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Masadaki kitap çok kalın. (The book on the table is very thick.)',
      'Benimki yeşil. (Mine is green.)',
      'Evdekiler uyuyor. (The ones at home are sleeping.)',
    ],
    examplesNegative: [
      '*Masada kitap kalın. (intending "the book on the table is thick" — needs -ki: "Masadaki kitap kalın.")',
    ],
    commonErrors: [
      'Omitting -ki when a case-marked phrase modifies a noun ("masada kitap" instead of "masadaki kitap").',
      'Applying vowel harmony to -ki — it is invariant: "evdeki", "masadaki", never *evdekı / *masadekı.',
    ],
    prerequisiteKeys: ['tr-a1-locative'],
  },
  {
    key: 'tr-a1-gore-bence',
    kind: 'grammar',
    name: '-A göre, bence ("according to / in my opinion")',
    description:
      'Opinion / "according to": dative + göre — bana göre, sana göre, öğretmene göre. The frozen forms bence / sence / onca mean "in my / your / his opinion".',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bana göre bu doğru. (According to me, this is right.)',
      'Öğretmene göre sınav kolay. (According to the teacher, the exam is easy.)',
      'Bence çok güzel. (In my opinion it is very nice.)',
    ],
    examplesNegative: [
      '*Ben göre bu doğru. (wrong — göre requires the dative: "Bana göre bu doğru.")',
    ],
    commonErrors: [
      'Using a bare pronoun before göre instead of the dative ("ben göre" instead of "bana göre").',
      'Conjugating bence with a personal ending ("bencem") — it is a frozen form taking no person marking.',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-beri-dir',
    kind: 'grammar',
    name: '-DEn beri / -DIr (since / for)',
    description:
      'Duration: -DEn beri ("since" a point — sabahtan beri = since morning) and -DIr ("for" a duration — iki saattir = for two hours, attached and harmonised).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Sabahtan beri çalışıyorum. (I have been working since morning.)',
      'İki saattir bekliyorum. (I have been waiting for two hours.)',
      '2020\'den beri Türkiye\'de yaşıyor. (He has lived in Turkey since 2020.)',
    ],
    examplesNegative: [
      '*İki saatten bekliyorum. (wrong — for-a-duration uses -DIr on the duration noun: "İki saattir bekliyorum.")',
    ],
    commonErrors: [
      'Confusing -DEn beri (since a point) with -DIr (for a duration): sabahtan beri vs iki saattir.',
      'Using "için" (purpose) to express a duration ("iki saat için bekliyorum") — duration takes -DIr.',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-comparative-superlative',
    kind: 'grammar',
    name: 'Comparative (daha) and superlative (en)',
    description:
      'Comparative: ablative -DEn + daha + adjective (Ali Ayşe\'den daha uzun = Ali is taller than Ayşe). Superlative: en + adjective (en güzel film = the most beautiful film).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ali Ayşe\'den daha uzun. (Ali is taller than Ayşe.)',
      'Bu kitap o kitaptan daha ilginç. (This book is more interesting than that one.)',
      'En güzel film. (The most beautiful film.)',
      'O sınıfın en zeki öğrencisi. (The smartest student in that class.)',
    ],
    examplesNegative: [
      '*Ali Ayşe daha uzun. (wrong — the standard of comparison takes ablative: "Ayşe\'den daha uzun")',
    ],
    commonErrors: [
      'Omitting the ablative on the standard of comparison ("Ali Ayşe daha uzun" instead of "Ali Ayşe\'den daha uzun").',
      'Placing "daha" after the adjective instead of before it ("Ali uzun daha" instead of "Ali daha uzun").',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },

  // ---------------------------------------------------------------------------
  // A2
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a2-mis-evidential',
    kind: 'grammar',
    name: 'Evidential past -mIş',
    description:
      'Reported, inferred, or surprise past with -mış/-miş/-muş/-müş — used when the speaker did not witness the event directly.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Hava soğukmuş.', 'Ahmet evlenmiş.'],
    examplesNegative: ['*Dün hava soğukmuş. (when the speaker felt the cold)'],
    commonErrors: [
      'Using -mIş for events the speaker actually witnessed.',
      'Confusing the -mIş evidential with the -mIş perfect participle.',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
  {
    key: 'tr-a2-aorist',
    kind: 'grammar',
    name: 'Aorist -(I/A)r',
    description:
      'Aorist tense for habitual actions, general truths, and polite offers; irregular stems (geliyor → gelir).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['Her sabah kahve içerim.', 'Çay ister misiniz?'],
    examplesNegative: ['*Her sabah kahve içiyorum. (in a generic-truth context)'],
    commonErrors: [
      'Substituting the present continuous -(I)yor for habitual statements.',
      'Picking the wrong aorist suffix for monosyllabic stems.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-ability-necessity',
    kind: 'grammar',
    name: 'Ability -(y)Abil and necessity -mAlI',
    description:
      'Ability: -(y)Abil + tense suffix (yapabilirim = I can do); negative ability -(y)AmA (yapamam). Necessity: -mAlI + person endings (gitmeliyim = I must go), harmonised.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yüzebilirim. (I can swim.)',
      'Türkçe konuşabiliyor musun? (Can you speak Turkish?)',
      'Yapamam. (I cannot do it — negative ability.)',
      'Erken kalkmalıyım. (I must get up early.)',
    ],
    examplesNegative: [
      '*Yüzmek yapabilirim. (wrong — ability is a suffix on the verb stem, not a separate auxiliary: "yüzebilirim")',
    ],
    commonErrors: [
      'Treating -(y)Abil as a separate auxiliary ("yüzmek yapabilirim") instead of suffixing it ("yüzebilirim").',
      'Confusing negative ability "yapamam" (I cannot) with simple verbal negation "yapmam" (I do not).',
      'Forgetting vowel harmony on -mAlI (*gitmalıyım instead of gitmeliyim on a front-vowel stem).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a2-converbs',
    kind: 'grammar',
    name: 'Converbs (-(y)Ip, -(y)ArAk, -mAdAn, -(y)A…-(y)A)',
    description:
      'Adverbial converbs link clauses without a finite verb: -(y)Ip (sequence), -(y)ArAk (manner), -mAdAn (without doing), -(y)A…-(y)A (repeated action).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Eve gelip yemek yedim. (I came home and ate — sequence.)',
      'Gülerek konuştu. (She spoke smiling — manner.)',
      'Yemeden gitme. (Don\'t leave without eating — without.)',
      'Bağıra bağıra koştu. (He ran shouting and shouting — repeated.)',
    ],
    examplesNegative: [
      '*Eve geldim ve yemek yedim. (overuses finite "ve" coordination where a converb is more idiomatic: "Eve gelip yemek yedim.")',
    ],
    commonErrors: [
      'Defaulting to "ve" coordination instead of using converbs to link clauses.',
      'Confusing -(y)Ip (sequence: did X, then Y) with -(y)ArAk (manner: did Y by/while doing X).',
      'Treating -mAdAn ("without doing") as ordinary verbal negation rather than an adverbial converb.',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a2-converb-temporal',
    kind: 'grammar',
    name: 'Temporal converbs -mAdAn önce / -DIktAn sonra',
    description:
      'Temporal converbs on the verb stem: -mAdAn önce ("before doing": gitmeden önce = before going) and -DIktAn sonra ("after doing": yedikten sonra = after eating).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gitmeden önce ara beni. (Call me before you go.)',
      'Yedikten sonra dişlerimi fırçalarım. (I brush my teeth after eating.)',
      'Okuldan döndükten sonra dinlendim. (I rested after coming back from school.)',
    ],
    examplesNegative: [
      '*Gitmek önce ara beni. (wrong — "before going" needs -mAdAn on the verb stem: "Gitmeden önce ara beni"; the nominal -DAn önce takes a noun, not an infinitive.)',
    ],
    commonErrors: [
      'Using the nominal -DAn önce / sonra (with a noun) where the verbal temporal converb is needed: "gitmek önce" → "gitmeden önce".',
      'Confusing -mAdAn ("without doing") with -mAdAn önce ("before doing"): yemeden gitme vs yemeden önce ellerini yıka.',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
  {
    key: 'tr-a2-nominalization',
    kind: 'grammar',
    name: 'Verbal nouns -mA / -mAk / -Iş',
    description:
      'Verbal nouns: -mAk (infinitive — okumak güzel), -mA (action noun, often with possessive — onun gelmesi zor), -Iş (act / manner — yürüyüş = walk, gidiş = departure).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Okumak çok eğlenceli. (Reading is very fun — -mAk.)',
      'Yüzmek istiyorum. (I want to swim — -mAk as object.)',
      'Onun gelmesi zor. (His coming is difficult — -mA with possessive.)',
      'Bu yürüyüş güzeldi. (This walk was nice — -Iş lexicalised.)',
    ],
    examplesNegative: [
      '*Onun gelme zor. (wrong — -mA action nouns take a possessive suffix when used as an embedded subject: "Onun gelmesi zor".)',
    ],
    commonErrors: [
      'Forgetting the possessive suffix on -mA in embedded clauses ("onun gelme zor" instead of "onun gelmesi zor").',
      'Substituting -mAk for -mA when the embedded subject differs from the main subject (Turkish uses -mA + possessive: "gelmesini istiyorum", not "*gelmek istiyorum" when subjects differ).',
      'Picking the wrong harmonised form (*okumek instead of okumak).',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a2-relative-an',
    kind: 'grammar',
    name: 'Subject relative -(y)An / -(y)En',
    description:
      'Subject relative -(y)An / -(y)En turns a verb into a pre-nominal modifier for subject relatives: gelen adam (the man who came), oynayan çocuk (the playing child).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gelen adam babam. (The man who came is my father.)',
      'Oynayan çocuklar mutlu. (The playing children are happy.)',
      'Türkçe konuşan biri. (Someone who speaks Turkish.)',
      'Burada oturan kadın öğretmen. (The woman sitting here is a teacher.)',
    ],
    examplesNegative: [
      '*Ben okuyan kitap. (wrong — -(y)An only marks SUBJECT relatives; non-subject "the book I read" needs the B2 -DIK form: "benim okuduğum kitap".)',
    ],
    commonErrors: [
      'Using -(y)An for non-subject relatives where -DIK / -(y)AcAK with possessive is required (B2).',
      'Placing -(y)An after the noun English-style ("adam gelen") instead of before it ("gelen adam").',
      'Forgetting the -y- buffer on vowel-final stems (*okuan instead of okuyan).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a2-gibi-kadar',
    kind: 'grammar',
    name: 'Similarity and equality (gibi, kadar)',
    description:
      'gibi ("like") follows the compared noun (aslan gibi); on pronouns it takes the genitive (benim gibi). kadar ("as … as / about") marks equality or approximate quantity.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Bir aslan gibi güçlü. (Strong like a lion.)',
      'Benim gibi düşünüyor. (He thinks like me.)',
      'Senin kadar uzun. (As tall as you.)',
      'Bir saat kadar bekledim. (I waited about an hour.)',
    ],
    examplesNegative: [
      '*Ben gibi düşünüyor. (wrong — with a pronoun, gibi requires the genitive: "benim gibi", not "ben gibi".)',
    ],
    commonErrors: [
      'Using a bare pronoun before gibi instead of the genitive ("ben gibi" instead of "benim gibi").',
      'Confusing gibi (similarity) with kadar (equality / quantity): "aslan gibi güçlü" (strong like a lion) vs "aslan kadar güçlü" (as strong as a lion).',
    ],
  },
  {
    key: 'tr-a2-correlative-conjunctions',
    kind: 'grammar',
    name: 'Correlative conjunctions (hem…hem, ne…ne, ya…ya, ister…ister)',
    description:
      'Correlative pairs: hem … hem ("both … and"), ne … ne ("neither … nor" — verb stays positive), ya … ya ("either … or"), ister … ister ("whether … or").',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hem Türkçe hem İngilizce konuşuyor. (She speaks both Turkish and English.)',
      'Ne çay ne kahve içerim. (I drink neither tea nor coffee — verb stays positive.)',
      'Ya bugün ya yarın gelirim. (I will come either today or tomorrow.)',
      'İster sen gel ister o. (Let either you come or him.)',
    ],
    examplesNegative: [
      '*Ne çay ne kahve içmem. (wrong — with ne … ne the verb stays POSITIVE in Turkish: "Ne çay ne kahve içerim".)',
    ],
    commonErrors: [
      'Negating the verb after ne … ne ("Ne çay ne kahve içmem" instead of "Ne çay ne kahve içerim"); the correlative itself supplies the negation.',
      'Using only one half of the correlative pair (a single "hem"); Turkish requires both halves.',
    ],
  },
  {
    key: 'tr-a2-causal-connectors',
    kind: 'grammar',
    name: 'Causal connectors (çünkü, bu yüzden, bu sebeple)',
    description:
      'Sentence-level causal connectors: çünkü ("because" — explanation in the next clause), bu yüzden / bu sebeple ("for that reason / therefore" — consequence in the next clause).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Geç kaldım çünkü trafik vardı. (I was late because there was traffic.)',
      'Yağmur yağıyordu, bu yüzden dışarı çıkmadık. (It was raining, so we didn\'t go out.)',
      'Sınavım var, bu sebeple gelemem. (I have an exam, so I can\'t come.)',
    ],
    examplesNegative: [
      '*Geç kaldım için trafik vardı. (wrong — between two finite clauses use çünkü; bare "için" requires a nominalised clause — that is the B1 -DIğI için form.)',
    ],
    commonErrors: [
      'Confusing çünkü (explanation follows the connector) with bu yüzden / bu sebeple (consequence follows the connector).',
      'Using bare için between two finite clauses ("trafik vardı için geç kaldım") — at A2 use çünkü or bu yüzden; the nominalised -DIğI için form is B1.',
    ],
  },
  {
    key: 'tr-a2-ca-suffix',
    kind: 'grammar',
    name: 'Derivational -CA (manner adverbs, language names)',
    description:
      'Derivational -CA (-ca/-ce/-ça/-çe, harmonised): forms manner adverbs (yavaşça, sessizce), equative adjectives (kardeşçe), and language names (Türkçe).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yavaşça konuş. (Speak slowly.)',
      'Sessizce oturdu. (He sat silently.)',
      'Kardeşçe paylaştık. (We shared like brothers.)',
      'Türkçe öğreniyorum. (I am learning Turkish.)',
    ],
    examplesNegative: [
      '*Yavaşce konuş. (wrong — back-vowel stem "yavaş" needs back-vowel -ca: "yavaşça"; -CA harmonises.)',
    ],
    commonErrors: [
      'Picking the wrong harmonised form (-ca/-ce/-ça/-çe): *yavaşce instead of yavaşça.',
      'Voicing the -c- after a voiceless stem instead of devoicing to -ç- ("yavaşca" instead of "yavaşça").',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-pekistirme',
    kind: 'grammar',
    name: 'Reduplication intensifier (Pekiştirme)',
    description:
      'Intensifier reduplication: take the adjective\'s first vowel + a fixed m/p/r/s consonant and prefix it: bembeyaz, kıpkırmızı, yepyeni, masmavi. The chosen consonant is lexical.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Kar gibi bembeyaz. (Snow-white.)',
      'Yüzü kıpkırmızı oldu. (His face turned bright red.)',
      'Yepyeni bir araba. (A brand-new car.)',
      'Masmavi bir gökyüzü. (A deep-blue sky.)',
    ],
    examplesNegative: [
      '*beyaz beyaz bir gömlek. (wrong — adjective intensification uses the pekiştirme prefix, not simple repetition: "bembeyaz bir gömlek")',
    ],
    commonErrors: [
      'Trying to predict the m/p/r/s consonant phonetically — it is lexicalised per word (bembeyaz, kıpkırmızı, simsiyah, yemyeşil).',
      'Substituting simple repetition (*beyaz beyaz) for the reduplication intensifier (bembeyaz).',
    ],
  },
  {
    key: 'tr-a2-purpose-icin-uzere',
    kind: 'grammar',
    name: 'Purpose / imminence (-mAk için, -mAk üzere)',
    description:
      'Purpose / imminence: -mAk için ("in order to" — çalışmak için geldim), -mAk üzere ("about to / on the verge of" — gitmek üzereyim; also a formal "in order to").',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Çalışmak için Almanya\'ya gitti. (He went to Germany in order to work.)',
      'Türkçe öğrenmek için kursa gidiyorum. (I am going to a course in order to learn Turkish.)',
      'Tam çıkmak üzereydim. (I was just about to leave.)',
    ],
    examplesNegative: [
      '*Çalışırım için Almanya\'ya gitti. (wrong — purpose uses the infinitive: "çalışmak için", not a finite verb form.)',
    ],
    commonErrors: [
      'Using a finite verb form before için instead of the -mAk infinitive ("çalışırım için" → "çalışmak için").',
      'Confusing the two senses of -mAk üzere: "about to" (imminence) vs the formal "in order to" — context disambiguates.',
    ],
    prerequisiteKeys: ['tr-a1-future'],
  },
  {
    key: 'tr-a2-reported-speech',
    kind: 'grammar',
    name: 'Reported speech (diye + dolaylı anlatım)',
    description:
      'Reported speech: reported clause + diye + reporting verb (söylemek, sormak, cevap vermek). Reported imperatives can also use -mAsInI iste-: "Gelmemi istedi" = he asked me to come.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      '"Yarın gelir misin?" diye sordu. (He asked, "Will you come tomorrow?")',
      '"Hayır" diye cevap verdim. (I answered, "No".)',
      'Geleceğini söyledi. (He said he would come — integrated form.)',
      'Gelmemi istedi. (He told me to come — reported imperative.)',
    ],
    examplesNegative: [
      '*"Yarın gelir misin?" sordu. (wrong — diye is required to mark the reported clause: "\\"Yarın gelir misin?\\" diye sordu.")',
    ],
    commonErrors: [
      'Omitting diye between a directly-quoted clause and the reporting verb ("\\"Yarın gelir misin\\" sordu" instead of "\\"Yarın gelir misin\\" diye sordu").',
      'Failing to shift person/tense in integrated reported speech — use -DIğInI / -(y)AcAğInI: "Geleceğini söyledi" = he said he would come.',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },

  /*
  // ---------------------------------------------------------------------------
  // B1
  // ---------------------------------------------------------------------------
  // Note: tr-b1-mis-evidential, tr-b1-aorist, and tr-b1-future have been
  // relocated to A2 / A1; do not restore them here.
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
    prerequisiteKeys: ['tr-a1-dili-past', 'tr-b1-conditionals-sa'],
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
    name: 'Non-subject relative participles -DIK / -(y)AcAK',
    description:
      'Non-subject pre-nominal relative clauses with -DIK and -(y)AcAK + possessive suffix, for past/non-past and future. The subject relative -(y)An is at A2.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Okuduğum kitap (the book I am reading)',
      'Yarın okuyacağım kitap (the book I will read tomorrow)',
    ],
    examplesNegative: ['*Benim okuyan kitap (wrong — subject-relative -(y)An cannot encode "the book I read"; needs -DIK: "benim okuduğum kitap")'],
    commonErrors: [
      'Using the A2 subject relative -(y)An for non-subject relatives.',
      'Forgetting the possessive suffix on -DIK / -(y)AcAK forms.',
    ],
    prerequisiteKeys: ['tr-a1-genitive-possessive'],
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
  // Note: tr-b2-converbs has been relocated to A2; do not restore it here.
  // The participle-based "when" forms -DIğIndA / -DIğI zaman remain B1+ work
  // and can be added later as a separate entry if needed.
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
    key: 'tr-b2-noun-clauses-dik',
    kind: 'grammar',
    name: 'Noun clauses with -DIK / -(y)AcAK',
    description:
      'Embedded noun clauses with -DIK (past/general) or -(y)AcAK (future) + possessive suffix + case. The simpler -mA / -mAk / -Iş verbal-noun forms are at A2.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Yarın yağmur yağacağını söyledi.',
      'Onun geldiğini bilmiyordum. (I didn\'t know he had come.)',
    ],
    examplesNegative: ['*Onun geldi söyledi. (wrong — a finite past requires a -DIğI noun clause: "Onun geldiğini söyledi.")'],
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
