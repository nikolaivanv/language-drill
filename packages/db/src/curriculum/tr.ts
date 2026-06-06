import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// TR curriculum aligned to full Yedi İklim A1+A2 parity (2026-05-28): 26 A1
// + 14 A2 grammar entries + 2 vocab umbrellas (A1 + A2). B1 + B2 grammar
// entries and B1/B2 vocab umbrellas remain commented out so the prod scheduler does not
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
 *
 * Current value `2026-05-30` reflects the #220 book-grounded audit of all 40
 * grammar points; the Yedi İklim A1+A2 *parity* (the 26 A1 + 14 A2 count noted
 * in the header above) was aligned earlier, on 2026-05-28.
 */
export const CURRICULUM_VERSION_TR = '2026-06-06';

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
      "Forgetting harmony follows the stem's last vowel even in loanwords (otobüs → otobüsler, kitap → kitaplar); and conversely that a few loanwords take front-vowel suffixes despite a back last vowel (saat → saati, gol → golü).",
      'Picking the wrong member of the 4-way high-vowel set — e.g. using -ı on a rounded stem where -u is required (okulı vs. okulu), or using -i on a back-vowel stem where -ı is required.',
      'Conflating the 2-way (low-vowel) and 4-way (high-vowel) harmony patterns — applying -lAr/-lEr logic to suffixes that take the 4-way pattern, such as the accusative -(y)I.',
    ],
  },
  {
    key: 'tr-a1-personal-suffixes',
    kind: 'grammar',
    name: 'Personal (copular) suffixes',
    description:
      'Copular person suffixes on nominal predicates: 1sg -(y)Im, 2sg -sIn, 3sg Ø, 1pl -(y)Iz, 2pl -sInIz, 3pl -lAr (optional, human only). After a vowel-final stem insert -y- (hastayım).',
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
      'Ben hastayım.', // 1sg after a vowel-final stem → buffer -y-: hasta + -yım (I am ill)
      'Çok iyiyiz.', // 1pl after a vowel-final stem → buffer -y-: iyi + -yiz (we are very well)
    ],
    examplesNegative: [
      '*Ben öğretmen.', // dropped the obligatory 1sg -(y)Im
      '*Kediler küçükler.', // -lAr forced onto a non-human plural subject
      '*Bu masa güzeldir.', // -DIr as a conversational default (should be "Bu masa güzel")
      '*Ben hastaım.', // vowel-final stem needs the -y- buffer before -(y)Im → hastayım
    ],
    commonErrors: [
      'Dropping the obligatory personal suffix (e.g. *Ben öğretmen for Ben öğretmenim).',
      'Using -DIr as a default spoken copula (Bu güzeldir instead of Bu güzel).',
      'Adding 3pl -lAr to non-human subjects (*Kediler küçükler).',
      'Treating 3pl -lAr as mandatory; with human subjects it is optional, with non-human subjects it is omitted.',
      'Dropping the -y- buffer after a vowel-final stem (*iyiim, *hastaım instead of iyiyim, hastayım).',
    ],
  },
  {
    key: 'tr-a1-plural-suffix',
    kind: 'grammar',
    name: 'Plural suffix -lAr',
    description:
      'Plural -lar/-ler attaches by vowel harmony (kitaplar, evler). It is not added after a numeral or quantifiers like çok/her/birkaç, which already imply number (üç kitap, çok ev).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'kitaplar (books)',
      'üç kitap (three books)',
      'evler (houses — front-vowel -ler after e)',
      'çok kitap (a lot of books — singular head after çok)',
    ],
    examplesNegative: [
      '*üç kitaplar',
      '*çok evler (çok and similar quantifiers keep the noun singular → çok ev)',
    ],
    commonErrors: [
      'Adding -lAr after a numeral (üç kitap, not üç kitaplar) — plurality is already marked by the numeral.',
      'Adding -lAr after quantifiers that require the singular (her/çok/birkaç + noun).',
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
    examplesPositive: [
      'evde (at home)',
      'sokakta (on the street)',
      'Ali işte. (Ali is at work — voiceless ş, so -te.)',
    ],
    examplesNegative: [
      '*sokakda',
      '*işde (wrong — final ş is voiceless, so -te not -de: işte)',
    ],
    commonErrors: [
      'Forgetting the consonant assimilation after voiceless final consonants.',
      'Confusing locative -DA with ablative -DAn.',
      'Applying -ta/-te only to back-vowel stems and forgetting that front-vowel voiceless stems also soften (işte, sepette).',
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
      'Okula otobüsle gidiyorum. (I go to school by bus — note git- voices to gid-.)',
      'Çocuklar bahçede oynuyor. (The children are playing — high-vowel-final oyna- → oynuyor.)',
    ],
    examplesNegative: [
      '*Başlayor. (wrong — stem-final /a/ must raise to /ı/ before -yor: başlıyor)',
      '*Gitiyorum. (wrong — git- voices its final t before -yor: gidiyorum)',
    ],
    commonErrors: [
      'Failing to raise the stem-final low vowel to a high vowel before -yor (başlayor instead of başlıyor).',
      'Picking the wrong harmonised buffer vowel after a consonant-final stem (gelıyor instead of geliyor).',
      'Forgetting that git-, et-, tat-, güt- voice stem-final t→d before -(I)yor (*gitiyor / *etiyor instead of gidiyor / ediyor).',
      'Assuming -(I)yor is only "be …ing": it also covers habitual actions (her sabah koşuyorum = I run every morning).',
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
    examplesPositive: [
      'Dün eve gittim.',
      'Geçen yaz İstanbul\'a gittik.',
      'Onu dün görmedim. (I didn\'t see him yesterday — negation -me- before -di.)',
      'Sınavı geçtin mi? (Did you pass the exam? — question particle mi after the verb.)',
    ],
    examplesNegative: [
      '*Dün eve gitdim.',
      '*Filmi izledisin. (wrong person ending — -DI uses the group-1 endings: izledin, not izledisin.)',
    ],
    commonErrors: [
      'Forgetting consonant assimilation (-d → -t after voiceless stems).',
      'Confusing -DI (witnessed) with the -mIş evidential past.',
      'Using the present/aorist (group-2) personal endings on -DI: *gittisin instead of gittin — -DI takes the group-1 set (-m, -n, -k, -nIz).',
      'Confusing the verbal past -DI (geldim) with the past copula -(y)DI on nominal / adjectival predicates (hastaydım, evdeydik).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-future',
    kind: 'grammar',
    name: 'Future -(y)AcAk',
    description:
      'Future -(y)AcAk: -acak/-ecek by harmony. After a vowel-final stem insert -y- (oku → okuyacak); k → ğ before vowel suffixes (gidecek → gideceğim). Negative raises -mA: gelmeyecek.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Yarın geleceğim.',
      'Onlar tatile gidecekler.',
      'Kitabı bekleyeceğiz. (vowel stem bekle- takes the -y- buffer)',
      'Annem yarın çorba yapacak. (3sg, no buffer after a consonant stem)',
    ],
    examplesNegative: [
      '*Yarın gelecekım.',
      '*Onlar okuacaklar. (vowel stem oku- needs the -y- buffer → okuyacaklar)',
      '*Ben gelmayacağım. (negative -mA harmonises and raises before the suffix → gelmeyeceğim)',
    ],
    commonErrors: [
      'Failing to soften final -k to -ğ before vowel-initial suffixes.',
      'Substituting the present -(I)yor for planned future events when -(y)AcAk is more idiomatic.',
      'Dropping the -y- buffer after a vowel-final stem (*okuacak instead of okuyacak).',
      'Forming the negative without raising/harmonising -mA (*gelmayacak instead of gelmeyecek).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-imperative',
    kind: 'grammar',
    name: 'Imperative (Emir)',
    description:
      '2sg imperative is the bare stem (gel!); 2pl/formal is stem + -(y)In with 4-way harmony and -y- after vowels (gelin!, okuyun!). Negative is stem + -mA (gelme!, okumayın!).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Gel! (Come! — 2sg, bare stem)',
      'Gelin! (Come! — 2pl/formal)',
      'Okuyun! (Read! — vowel stem + -yun)',
      'Gelme! (Don\'t come! — 2sg negative, stem + -mA)',
      'Burada bekleyin. (Wait here. — 2pl/formal, vowel stem + -y- + -in)',
    ],
    examplesNegative: [
      '*Gele! (wrong — 2sg imperative is the bare stem "gel", not "gele")',
      '*Gel yok. (wrong — "don\'t come" is not formed with yok; the negative imperative is stem + -mA: "Gelme!")',
      '*Gelün! (wrong — -In harmonises to the stem vowel; after "gel" it is -in: "Gelin!")',
    ],
    commonErrors: [
      'Adding the -y- buffer to consonant-final stems (*gelyin instead of gelin).',
      'Confusing the 2sg imperative (bare stem) with the optative -sIn (gelsin = "let him come").',
      'Forming the negative imperative with the bare stem or yok/değil instead of stem + -mA (Gelme!, not *Gel yok).',
      'Using one fixed form of -In instead of harmonising it four ways (-in/-ın/-un/-ün): *gelün, *okuyin.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-questions',
    kind: 'grammar',
    name: 'Question formation (mı + WH-words)',
    description:
      'Yes/no: clitic mI follows the focused word. In nominal/present predicates it carries the person ending; in the -DI past the ending stays on the verb (geldin mi). WH-words sit before the verb.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Geliyor musun? (Are you coming?)',
      'Sen öğrenci misin? (Are you a student?)',
      'Bu ne? (What is this?)',
      'Nerede oturuyorsun? (Where do you live?)',
      'Dün sinemaya gittin mi? (Did you go to the cinema yesterday? — past: the -n ending is on the verb, mı is bare.)',
      'Evde süt var mı? (Is there milk at home? — yes/no question on var.)',
    ],
    examplesNegative: [
      '*Sen öğrencisin mi? (wrong — the person ending attaches to mI, not the predicate: "Sen öğrenci misin?")',
      '*Dün geldi misin? (wrong — in the -di past the person ending stays on the verb, not on mI → "Dün geldin mi?")',
    ],
    commonErrors: [
      'Attaching the personal ending to the predicate instead of to mI ("öğrencisin mi" instead of "öğrenci misin").',
      'Choosing the wrong harmonised form of mI.',
      'Fronting a WH-word English-style instead of leaving it in its normal sentence position.',
      'Over-applying the present-tense pattern to the past ("geldi misin" instead of "geldin mi") — in the -di past the ending attaches to the verb, leaving mı bare.',
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
      'Bu senin telefonun, değil mi? (This is your phone, isn\'t it? — değil mi = tag question.)',
    ],
    examplesNegative: [
      '*Ben öğretmen yokum. (wrong — nominal predicates are negated with "değil", not "yok": "öğretmen değilim")',
      '*Ben değil öğretmen. (wrong — değil follows the complement, it does not precede it → "öğretmen değilim")',
    ],
    commonErrors: [
      'Using yok (existential negation) instead of değil for nominal predicate negation ("öğretmen yokum" instead of "öğretmen değilim").',
      'Dropping the personal ending on değil ("ben öğrenci değil" instead of "değilim").',
      'Placing değil before the predicate complement instead of after it ("ben değil öğretmen" instead of "öğretmen değilim").',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a1-var-yok',
    kind: 'grammar',
    name: 'Existence and possession (var / yok)',
    description:
      'var = "there is/exists", yok = "there isn\'t". Possession: possessive suffix on the thing owned + var/yok — arabam var (I have a car). Past tense uses the copula: vardı / yoktu.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Evde kitap var. (There is a book at home.)',
      'Bir arabam var. (I have a car.)',
      'Vaktim yok. (I have no time.)',
      'Eskiden burada bir lokanta vardı. (There used to be a restaurant here — past = var + -dı.)',
      'Dün hiç vaktim yoktu. (I had no time at all yesterday — yok + -tu.)',
    ],
    examplesNegative: [
      '*Ben bir araba var. (wrong — possession requires the possessive suffix on the possessed noun: "Bir arabam var")',
      '*Bir arabam oldu. (for "I had a car" — past possession is the copula on var: "Bir arabam vardı"; oldu = "came to have")',
    ],
    commonErrors: [
      'Calquing English "I have X" with a subject pronoun instead of marking the possessed noun ("ben bir araba var" instead of "bir arabam var").',
      'Using değil to negate existence/possession instead of yok ("kitap değil" instead of "kitap yok" for "there is no book").',
      'Conjugating olmak for the past instead of adding the copula to var/yok ("araba oldu" instead of "arabam vardı" for "I had a car").',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-accusative-definite-object',
    kind: 'grammar',
    name: 'Accusative -(y)I for definite objects',
    description:
      'Definite direct objects take accusative -(y)I. Indefinite ones (bir kitap, or a bare noun right before the verb) stay unmarked; proper names and pronouns are inherently definite and take it.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Kitabı okudum. (the book)',
      'Bir kitap okudum. (a book)',
      "Osman'ı dün gördüm. (proper name — inherently definite → -ı)",
      'Seni seviyorum. (pronoun object → accusative -i)',
      'Bu evi çok beğendim. (demonstrative → definite → -i)',
    ],
    examplesNegative: [
      '*Kitap okudum, çok beğendim. (when "the book" is meant)',
      "*Ali gördüm. (proper-name object is inherently definite → \"Ali'yi gördüm\")",
    ],
    commonErrors: [
      'Marking every direct object with -(y)I regardless of definiteness.',
      'Failing to use -y- as a buffer consonant after a vowel-final stem.',
      "Omitting accusative on inherently-definite objects — proper names and pronouns (*Ali gördüm / *sen seviyorum → Ali'yi gördüm / seni seviyorum).",
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
    examplesPositive: [
      'Okuldan geliyorum.',
      'Ankara\'ya gidiyorum.',
      'Anneme çiçek aldım. (I bought flowers for my mother — dative -e marks the recipient.)',
      'Uçaktan indik. (We got off the plane — ablative -tan, voiceless k forces -t-.)',
    ],
    examplesNegative: [
      '*Ankara gidiyorum.',
      '*Kitapdan bir sayfa okudum. (wrong — after voiceless p the ablative is -tan/-ten: "Kitaptan bir sayfa okudum".)',
    ],
    commonErrors: [
      'Dropping the dative case on the goal of motion.',
      'Confusing ablative -DAn with locative -DA.',
      'Writing the ablative as -dan/-den after a voiceless consonant (p, ç, t, k, s, ş, h, f) instead of assimilating to -tan/-ten: *kitapdan → kitaptan.',
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
    examplesPositive: [
      'öğretmenin kitabı',
      'Türkiye\'nin başkenti',
      'Evin kapısı açık. (The door of the house is open — buffer -n- in the genitive, -s- in the 3sg possessive.)',
      'Onun bir kedisi var. (He/She has a cat — the possessive on the head is obligatory in var sentences.)',
    ],
    examplesNegative: [
      '*öğretmen kitabı (when "the teacher\'s book" is meant)',
      '*Onun araba var. (for "he has a car" — the head keeps its possessive even with var: "Onun arabası var")',
    ],
    commonErrors: [
      'Omitting the genitive on the possessor.',
      'Omitting the 3sg possessive on the possessed.',
      'Dropping the buffer consonants: genitive -(n)In takes -n- after a vowel (odanın, Türkiye\'nin) and 3sg possessive -(s)I takes -s- after a vowel (kapısı, arabası), not *odaın / *kapıı.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-demonstratives',
    kind: 'grammar',
    name: 'Demonstratives (bu / şu / o, burası / şurası / orası)',
    description:
      'bu/şu/o ("this/that") are pronouns and invariant determiners (bu kitap, bu kitaplar). As pronouns they take an -n- buffer before case (bunu, buna). Locational burası/orası inflect like nouns.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bu kitap çok güzel. (This book is very nice.)',
      'Şu çantayı al. (Take that bag.)',
      'Orası çok uzak. (That place is very far.)',
      'Burada bekleyelim. (Let us wait here.)',
      'Bu kitaplar çok pahalı. (These books are very expensive — the determiner stays "bu"; plural is on the noun.)',
      'Bunu sevdim. (I liked this one — pronoun "bu" + accusative with the -n- buffer.)',
    ],
    examplesNegative: [
      '*Bu uzak. (when meaning "this place is far" — "bu" modifies a noun; the noun for "this place" is "burası": "Burası uzak.")',
      '*Bunlar kitaplar pahalı. (wrong — the determiner does not pluralise → "Bu kitaplar pahalı"; "bunlar" is a pronoun.)',
    ],
    commonErrors: [
      'Confusing bu (pronoun/adjective "this") with bura/burası (the noun "this place / here"): *Bu uzak instead of Burası uzak.',
      'Misreading şu as merely "medial": bu = near/already-known, o = far/already-known, but şu chiefly flags something pointed at or introduced for the first time.',
      'Pluralising the demonstrative determiner instead of the noun: *bunlar kitaplar instead of bu kitaplar (bu/şu/o never inflect as adjectives).',
      'Dropping the -n- buffer when adding case to a demonstrative pronoun: *buyu / *bua instead of bunu / buna.',
    ],
  },
  {
    key: 'tr-a1-personal-pronouns',
    kind: 'grammar',
    name: 'Personal pronouns and their case forms',
    description:
      'Subject pronouns ben/sen/o/biz/siz/onlar and case forms. Irregular: dative bana/sana (not *bene), 1st-person genitive benim/bizim, and 3rd-person -n- buffer (onu, ona, onun, onda, ondan).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğrenciyim. (I am a student — subject.)',
      'Bana ver. (Give to me — dative.)',
      'Senin kitabın. (Your book — genitive.)',
      'Onu gördüm. (I saw him/her/it — accusative.)',
      'Bu benim. (This is mine — 1st-person genitive benim, not *benin.)',
      'Sana bir şey söyleyeceğim. (I\'ll tell you something — dative sana, not *sene.)',
    ],
    examplesNegative: [
      '*Beni geldim. (wrong — subject is "ben", not the accusative "beni": "Ben geldim.")',
      '*Bene ver. (wrong — the 1sg dative is irregular: the stem vowel becomes a → "Bana ver".)',
    ],
    commonErrors: [
      'Using oblique forms (beni, bana) where the subject is needed — the subject pronoun is always the bare form ben.',
      'Forgetting the irregular -n- buffer before case suffixes in 3rd person: onu, ona, onun, onda, ondan (not *ou, *oa).',
      'Regularising the irregular dative of ben/sen: writing *bene / *sene instead of bana / sana.',
      'Using the regular genitive -in on 1st-person pronouns (*benin, *bizin) instead of the irregular -Im forms benim, bizim.',
    ],
  },
  {
    key: 'tr-a1-numbers-ordinals',
    kind: 'grammar',
    name: 'Numbers and ordinals (-(I)ncI)',
    description:
      'Cardinals juxtapose (yüz yirmi üç = 123). Ordinals add -(I)ncI: birinci, ikinci, üçüncü; the I drops after a vowel (ikinci) but appears after a consonant (beşinci). "ilk" = first.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'üç kitap (three books)',
      'yüz yirmi üç (123 — compound, no connector)',
      'birinci sınıf (first class / grade)',
      'üçüncü kat (third floor)',
      'dördüncü kat (fourth floor — stem softens dört → dörd-)',
      'ilk gün (the first day — "ilk" = birinci)',
    ],
    examplesNegative: [
      '*yüz ve yirmi üç. (wrong — compound numbers juxtapose without "ve": "yüz yirmi üç")',
      '*ikiinci (wrong — the suffix\'s initial vowel drops after a vowel-final stem → ikinci)',
      '*dörtüncü (wrong — final t softens to d before the vowel suffix → dördüncü)',
    ],
    commonErrors: [
      'Inserting "ve" between parts of a compound number ("yüz ve yirmi üç" instead of "yüz yirmi üç").',
      'Picking the wrong harmonised form of the ordinal -(I)ncI suffix (*üçinci instead of üçüncü).',
      'Pluralising the noun after a numeral ("üç kitaplar" — see tr-a1-plural-suffix).',
      'Doubling the vowel after a vowel-final stem (*ikiinci, *altııncı) — the suffix\'s initial (I) drops here: ikinci, altıncı.',
      'Failing to soften final t→d in dört before the ordinal suffix (*dörtüncü instead of dördüncü).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-possessive-suffixes',
    kind: 'grammar',
    name: 'Possessive suffixes (İyelik ekleri)',
    description:
      'Possessive suffixes mark the possessed noun: -(I)m, -(I)n, -(s)I, -(I)mIz, -(I)nIz, -lArI (harmonised). The buffer vowel (I) drops after a vowel (araba-m); 3sg adds -s- after a vowel (kapı-sı).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evim (my house)',
      'kitabın (your book)',
      'arabası (his/her car) — vowel-final stem + -sı',
      'evimiz (our house)',
      'arabam (my car — vowel-final stem, no buffer vowel: araba + m)',
      'gözüm (my eye — round-vowel stem, suffix harmonises to -üm)',
    ],
    examplesNegative: [
      '*evi (when meaning "my house" — "evi" is 3sg "his/her house"; "my house" is "evim")',
      '*arabaım (wrong — after a vowel the 1sg buffer vowel drops: "arabam")',
    ],
    commonErrors: [
      'Confusing 1sg -(I)m with 3sg -(s)I: "evim" (my house) vs "evi" (his/her house).',
      'Dropping the -s- buffer in 3sg after a vowel-final stem (*arabaı instead of arabası).',
      'Marking the possessor instead of the possessed (possessive suffix goes on the possessed noun; the possessor takes the genitive).',
      'Inserting a buffer vowel after a vowel-final stem (*arabaım, *kapıım instead of arabam, kapım — the buffer (I) only appears after consonants).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-instrumental-ile',
    kind: 'grammar',
    name: 'Instrumental ile / -(y)lA',
    description:
      'Instrumental/comitative "with/by" — postposition ile or harmonised suffix -la/-le (-y- buffer after vowels: arabayla). Pronouns take the genitive: benimle, seninle, onunla, kiminle.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Arkadaşımla geldim. (I came with my friend.)',
      'Kalemle yazıyorum. (I am writing with a pen.)',
      'Otobüsle gidiyoruz. (We go by bus.)',
      'Arabayla geldim. (I came by car — -y- buffer after vowel.)',
      'Benimle gelir misin? (Will you come with me? — pronoun takes genitive: ben+im+le.)',
      'Onunla konuştum. (I talked with him/her — o becomes onunla, not *onla.)',
    ],
    examplesNegative: [
      '*Arabala geldim. (wrong — vowel-final stem needs -y- buffer: "arabayla")',
      '*Benle gel. (wrong — the pronoun ben takes the genitive before -le: "benimle gel".)',
    ],
    commonErrors: [
      'Forgetting the -y- buffer on vowel-final stems (*arabala instead of arabayla).',
      'Picking the wrong harmonised form of -lA (*arkadaşle instead of arkadaşla on a back-vowel stem).',
      'Attaching ile/-lA to a bare pronoun (*benle, *senle, *onla) instead of the genitive form (benimle, seninle, onunla, kiminle).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-postpositions-once-sonra',
    kind: 'grammar',
    name: '-DAn önce / -DAn sonra (before / after)',
    description:
      '"Before/after" a noun: ablative -DAn + önce/sonra — yemekten sonra, dersten önce. Pronouns too: benden önce. A time span before önce/sonra means "ago/later": beş dakika önce, bir saat sonra.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Yemekten sonra çay içeriz. (After the meal we drink tea.)',
      'Dersten önce kahve aldım. (I had coffee before class.)',
      'Akşamdan sonra yağmur yağdı. (After evening it rained.)',
      'Benden önce geldi. (He arrived before me — pronoun + ablative: ben → benden.)',
      'Beş dakika önce çıktı. (She left five minutes ago — "X önce" = "X ago".)',
    ],
    examplesNegative: [
      '*Yemek sonra çay içeriz. (wrong — önce / sonra need the noun in the ablative: "yemekten sonra")',
      '*Ben önce geldi. (wrong — a pronoun complement also needs the ablative: "benden önce".)',
    ],
    commonErrors: [
      'Omitting the ablative -DAn on the noun before önce/sonra (*yemek sonra instead of yemekten sonra).',
      'Confusing this nominal -DAn önce / sonra with the A2 converbal -mAdAn önce / -DIktAn sonra, which attach to verb stems.',
      'Forgetting the ablative on a pronoun complement (*ben sonra instead of benden sonra; ben → benden).',
      'Adding -DAn to a time span used as "ago/later": it is bare before önce/sonra ("beş dakika önce", not *beş dakikadan önce).',
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
      'Saat dokuzdan beşe kadar çalışıyorum. (I work from nine to five.)',
    ],
    examplesNegative: [
      '*Sabah akşama kadar. (wrong — the source must take ablative: "sabahtan akşama kadar")',
      '*Sabahtan akşam kadar. (wrong — kadar needs the dative on the goal → "sabahtan akşama kadar")',
      '*Evden okulakadar. (wrong — kadar is a separate word, never suffixed → "evden okula kadar")',
    ],
    commonErrors: [
      'Omitting the ablative on the source ("sabah akşama kadar" instead of "sabahtan akşama kadar").',
      'Omitting "kadar" on the goal ("sabahtan akşama" without "kadar" — the construction needs both halves).',
      'Dropping the dative -(y)A on the goal: kadar governs the dative, so it is "akşama kadar", never "akşam kadar".',
      'Writing kadar joined to the goal noun ("okulakadar") — kadar is always a separate word.',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-ki-relativizer',
    kind: 'grammar',
    name: 'Relativiser -ki / -DAki',
    description:
      'Relativiser -ki turns a locative/genitive/time phrase into a modifier: masadaki kitap, benimki (mine). No vowel harmony — except dün/gün → dünkü, bugünkü.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Masadaki kitap çok kalın. (The book on the table is very thick.)',
      'Benimki yeşil. (Mine is green.)',
      'Evdekiler uyuyor. (The ones at home are sleeping.)',
      'Bugünkü gazete masada. (Today\'s newspaper is on the table — -ki on a time word, surfaces as -kü after gün.)',
      'Dünkü film çok güzeldi. (Yesterday\'s film was very nice — dün + -kü.)',
    ],
    examplesNegative: [
      '*Masada kitap kalın. (intending "the book on the table is thick" — needs -ki: "Masadaki kitap kalın.")',
      '*Dünki film. (wrong — after dün/gün -ki is spelt -kü → "dünkü film".)',
    ],
    commonErrors: [
      'Omitting -ki when a case-marked phrase modifies a noun ("masada kitap" instead of "masadaki kitap").',
      '-ki does not take normal vowel harmony ("evdeki", "masadaki", never *evdekı / *masadekı). The only exception is after dün/gün, where it becomes -kü (dünkü, bugünkü).',
    ],
    prerequisiteKeys: ['tr-a1-locative'],
  },
  {
    key: 'tr-a1-gore-bence',
    kind: 'grammar',
    name: '-A göre, bence ("according to / in my opinion")',
    description:
      'Opinion / "according to": dative + göre (bana göre, öğretmene göre). -CE forms bence/sence/bizce/sizce = "in my/your/our opinion". göre also means "suited to": Bu iş bana göre değil.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bana göre bu doğru. (According to me, this is right.)',
      'Öğretmene göre sınav kolay. (According to the teacher, the exam is easy.)',
      'Bence çok güzel. (In my opinion it is very nice.)',
      'Sizce bu doğru mu? (In your (pl/formal) opinion, is this right?)',
      'Bu iş bana göre değil. (This job isn\'t right for me — göre = "suited to".)',
    ],
    examplesNegative: [
      '*Ben göre bu doğru. (wrong — göre requires the dative: "Bana göre bu doğru.")',
      '*Bençe çok güzel. (wrong spelling — ben ends in voiced -n, so the suffix stays -ce: "Bence çok güzel.")',
    ],
    commonErrors: [
      'Using a bare pronoun before göre instead of the dative ("ben göre" instead of "bana göre").',
      'Conjugating bence with a personal ending ("bencem") — it is a frozen form taking no person marking.',
      'Forgetting that the opinion adverbs are pronoun + -CE (bence/sence/bizce/sizce); the 3rd-person opinion is "ona göre", not a *-CE form.',
      'Confusing göre\'s senses: besides "according to", göre means "suited to / right for" (Bu bana göre = this suits me).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-beri-dir',
    kind: 'grammar',
    name: '-DEn beri / -DIr (since / for)',
    description:
      'Duration up to now/then. -DEn beri = "since" a point AND "for" a span (sabahtan beri; üç günden beri). -DIr = "for" a span, on the period noun (iki saattir). Predicate stays ongoing (-iyor).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Sabahtan beri çalışıyorum. (I have been working since morning.)',
      'İki saattir bekliyorum. (I have been waiting for two hours.)',
      '2020\'den beri Türkiye\'de yaşıyor. (He has lived in Turkey since 2020.)',
      'Üç gündür buradayım. (I have been here for three days — -DIr on the period noun.)',
      'İki günden beri hastayım. (I have been ill for two days — beri also expresses "for".)',
    ],
    examplesNegative: [
      '*İki saatten bekliyorum. (wrong — for-a-duration uses -DIr on the duration noun: "İki saattir bekliyorum.")',
      '*Sabah beri çalışıyorum. (wrong — beri needs the ablative on its complement → "Sabahtan beri çalışıyorum".)',
    ],
    commonErrors: [
      'Confusing -DEn beri (since a point) with -DIr (for a duration): sabahtan beri vs iki saattir.',
      'Assuming beri only means "since": -DEn beri also expresses "for" a span (üç günden beri = iki saattir = "for three days / two hours").',
      'Using "için" for an elapsed duration ("iki saat için bekliyorum") — an elapsed duration takes -DIr or -DEn beri (iki saattir / iki saatten beri bekliyorum).',
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
      'Bu araba ondan ucuz. (This car is cheaper than that one — daha can be dropped once the ablative standard is present.)',
      'Bu kitap o kitaptan daha az ilginç. (This book is less interesting than that one — "less" = daha az.)',
    ],
    examplesNegative: [
      '*Ali Ayşe daha uzun. (wrong — the standard of comparison takes ablative: "Ayşe\'den daha uzun")',
    ],
    commonErrors: [
      'Omitting the ablative on the standard of comparison ("Ali Ayşe daha uzun" instead of "Ali Ayşe\'den daha uzun").',
      'Placing "daha" after the adjective instead of before it ("Ali uzun daha" instead of "Ali daha uzun").',
      'Expressing "less" by negating the adjective instead of using daha az ("daha az ilginç" = less interesting).',
      'Assuming daha is obligatory: when an ablative standard is present, daha is often dropped ("ondan ucuz" = cheaper than that).',
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
      'Indirect past -mIş (verbal) and copular -(y)mIş: hearsay, inference from a result, or surprise. Obligatory when the event was not witnessed — -DI instead would claim first-hand knowledge.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hava soğukmuş.',
      'Ahmet evlenmiş.',
      'Yollar ıslak, yağmur yağmış. (inference from a result — unwitnessed)',
      'Yeni komşumuz çok kibarmış. (hearsay / newly learned — copular -mış)',
    ],
    examplesNegative: ['*Dün hava soğukmuş. (when the speaker felt the cold)'],
    commonErrors: [
      'Using -mIş for events the speaker actually witnessed.',
      'Confusing the -mIş evidential with the -mIş perfect participle.',
      'Defaulting to witnessed -DI for hearsay or inference, where evidential -mIş is obligatory.',
      'Dropping copular -(y)mIş on nominal / adjectival predicates when reporting (hastaymış, not hastaydı).',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
  {
    key: 'tr-a2-aorist',
    kind: 'grammar',
    name: 'Aorist -(I/A)r',
    description:
      'Aorist -(A/I)r marks general truths, characteristic behaviour, and offers (Çay içer misin?). Negative is -mAz (içmez), irregular in 1sg -mAm / 1pl -mAyIz. Contrast with observed -(I)yor.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Her sabah kahve içerim.',
      'Çay ister misiniz?',
      'Kaplumbağa yavaş yürür. (characteristic / general truth → aorist)',
      'Ali sigara içmez. (negative aorist -mez = "is a non-smoker")',
      'İçmem, teşekkürler. (1sg negative — irregular -mem, not *içmezim)',
    ],
    examplesNegative: [
      '*Her sabah kahve içiyorum. (in a generic-truth context)',
      '*Ali sigara içmer. (negative aorist is -mez: "içmez", never *içmer)',
    ],
    commonErrors: [
      'Substituting the present continuous -(I)yor for habitual statements.',
      'Picking the wrong aorist suffix for monosyllabic stems.',
      'Forming the negative with *-mAr instead of -mAz (içmer → içmez).',
      'Using regular endings in the 1sg/1pl negative instead of the irregular -mAm / -mAyIz (*içmezim → içmem).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-ability-necessity',
    kind: 'grammar',
    name: 'Ability -(y)Abil and necessity -mAlI',
    description:
      "Ability: -(y)Abil+tense (yapabilirim; vowel stems take -y-: okuyabilirim). Negative is irregular -(y)AmA, not -Abilme (yapamam). Necessity -mAlI ('must', speaker-felt) vs lazım/gerek ('have to').",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yüzebilirim. (I can swim.)',
      'Türkçe konuşabiliyor musun? (Can you speak Turkish?)',
      'Yapamam. (I cannot do it — negative ability.)',
      'Erken kalkmalıyım. (I must get up early.)',
      'Okuyabilirim. (I can read — vowel stem oku- takes the buffer -y-.)',
      'Eve gitmem lazım. (I have to go home — objective necessity with lazım, vs. speaker-felt gitmeliyim.)',
    ],
    examplesNegative: [
      '*Yüzmek yapabilirim. (wrong — ability is a suffix on the verb stem, not a separate auxiliary: "yüzebilirim")',
      '*Okuabilirim. (wrong — a vowel-final stem needs the buffer -y- before -(y)Abil → "okuyabilirim".)',
    ],
    commonErrors: [
      'Treating -(y)Abil as a separate auxiliary ("yüzmek yapabilirim") instead of suffixing it ("yüzebilirim").',
      'Confusing negative ability "yapamam" (I cannot) with simple verbal negation "yapmam" (I do not).',
      'Forgetting vowel harmony on -mAlI (*gitmalıyım instead of gitmeliyim on a front-vowel stem).',
      'Dropping the buffer -y- after a vowel-final stem (*okuabilirim instead of "okuyabilirim").',
      'Using -mAlI for an external/objective obligation where Turkish prefers lazım/gerek ("have to"); -mAlI is the speaker\'s own felt obligation ("must").',
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
      'Koşup düştü. (He ran and fell — the converb verb has no tense; only "düştü" carries the past.)',
      'Müziği açarak ders çalıştı. (She studied with the music on — manner; "çalıştı" supplies the tense.)',
    ],
    examplesNegative: [
      '*Eve geldim ve yemek yedim. (overuses finite "ve" coordination where a converb is more idiomatic: "Eve gelip yemek yedim.")',
      '*Eve geldip yemek yedim. (wrong — the converb verb takes no tense and stays bare: "Eve gelip yemek yedim".)',
      '*Annem yapıp ben kurdum. (wrong — -(y)Ip needs the same subject for both verbs → use finite coordination: "Annem yaptı ve ben kurdum".)',
    ],
    commonErrors: [
      'Defaulting to "ve" coordination instead of using converbs to link clauses.',
      'Confusing -(y)Ip (sequence: did X, then Y) with -(y)ArAk (manner: did Y by/while doing X).',
      'Treating -mAdAn ("without doing") as ordinary verbal negation rather than an adverbial converb.',
      'Putting tense/person on the converb verb (*geldip) — the converb stays bare; only the final main verb is inflected for the whole chain.',
      'Using -(y)Ip / -(y)ArAk when the two clauses have different subjects — these converbs normally require the same subject; use finite coordination instead.',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-converb-temporal',
    kind: 'grammar',
    name: 'Temporal converbs -mAdAn önce / -DIktAn sonra',
    description:
      'Temporal converbs on a verb stem: -mAdAn (önce) ("before doing"; önce optional — gitmeden = before going) and -DIktAn sonra ("after doing"; yedikten sonra). Subject stays a bare noun.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gitmeden önce ara beni. (Call me before you go.)',
      'Yedikten sonra dişlerimi fırçalarım. (I brush my teeth after eating.)',
      'Okuldan döndükten sonra dinlendim. (I rested after coming back from school.)',
      'Uyumadan dişlerini fırçala. (Brush your teeth before sleeping — -mAdAn alone, önce dropped.)',
      'Sen gittikten sonra herkes üzüldü. (Everyone was sad after you left — converb subject is the bare noun "sen".)',
    ],
    examplesNegative: [
      '*Gitmek önce ara beni. (wrong — "before going" needs -mAdAn on the verb stem: "Gitmeden önce ara beni"; the nominal -DAn önce takes a noun, not an infinitive.)',
      '*Sen gittiğinden sonra herkes üzüldü. (wrong — -DIktAn sonra takes no person marking; use the bare form: "Sen gittikten sonra herkes üzüldü".)',
    ],
    commonErrors: [
      'Using the nominal -DAn önce / sonra (with a noun) where the verbal temporal converb is needed: "gitmek önce" → "gitmeden önce".',
      'Confusing -mAdAn ("without doing") with -mAdAn önce ("before doing"): yemeden gitme vs yemeden önce ellerini yıka.',
      'Adding person / possessive marking to -DIktAn sonra (it never agrees): "gittiğinden sonra" → "gittikten sonra".',
      'Thinking önce is obligatory after -mAdAn: -mAdAn on its own can already mean "before" (uyumadan = before sleeping).',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
  {
    key: 'tr-a2-nominalization',
    kind: 'grammar',
    name: 'Verbal nouns -mA / -mAk / -Iş',
    description:
      'Verbal nouns: -mAk (infinitive, same subject as the main verb: okumak güzel), -mA + possessive (different subject: onun gelmesi zor), -Iş (manner / single act, often lexicalised: yürüyüş, gidiş).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Okumak çok eğlenceli. (Reading is very fun — -mAk.)',
      'Yüzmek istiyorum. (I want to swim — -mAk as object.)',
      'Onun gelmesi zor. (His coming is difficult — -mA with possessive.)',
      'Bu yürüyüş güzeldi. (This walk was nice — -Iş lexicalised.)',
      'Gelmek istiyorum. (I want to come — same subject, so plain -mAk.)',
      'Onun gelmesini istiyorum. (I want him to come — different subject, so -mA + possessive + accusative.)',
    ],
    examplesNegative: [
      '*Onun gelme zor. (wrong — -mA action nouns take a possessive suffix when used as an embedded subject: "Onun gelmesi zor".)',
      '*Onun gelmek istiyorum. (wrong — when the embedded subject differs, use -mA + possessive: "Onun gelmesini istiyorum".)',
    ],
    commonErrors: [
      'Forgetting the possessive suffix on -mA in embedded clauses ("onun gelme zor" instead of "onun gelmesi zor").',
      'Using -mAk when the embedded subject differs from the main subject: "Onun gelmesini istiyorum" (different subject), not "*Onun gelmek istiyorum" — bare -mAk works only when both subjects are the same.',
      'Picking the wrong harmonised form (*okumek instead of okumak).',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-relative-an',
    kind: 'grammar',
    name: 'Subject relative -(y)An / -(y)En',
    description:
      'Subject relative -(y)An/-(y)En: a tenseless pre-nominal modifier for subject relatives (gelen adam = the man who came/comes). Negative -mAyAn; for "X that is …" use olan (kırmızı olan araba).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gelen adam babam. (The man who came is my father.)',
      'Oynayan çocuklar mutlu. (The playing children are happy.)',
      'Türkçe konuşan biri. (Someone who speaks Turkish.)',
      'Burada oturan kadın öğretmen. (The woman sitting here is a teacher.)',
      'Kırmızı olan araba bizim. (The car that is red is ours — olan = ol- + -(y)An relativizes a nominal predicate.)',
      'Hiç çalışmayan öğrenci sınıfta kaldı. (The student who doesn\'t study at all failed — negative -mAyAn.)',
    ],
    examplesNegative: [
      '*Ben okuyan kitap. (wrong — -(y)An only marks SUBJECT relatives; non-subject "the book I read" needs the B2 -DIK form: "benim okuduğum kitap".)',
    ],
    commonErrors: [
      'Using -(y)An for non-subject relatives where -DIK / -(y)AcAK with possessive is required (B2).',
      'Placing -(y)An after the noun English-style ("adam gelen") instead of before it ("gelen adam").',
      'Forgetting the -y- buffer on vowel-final stems (*okuan instead of okuyan).',
      'Forgetting the suppletive olan for relativizing a noun / adjective predicate ("the one that is a teacher" = öğretmen olan).',
      'Dropping the -y- buffer on the negative -mA stem (*gelmeen / *çalışmaan instead of gelmeyen / çalışmayan).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-gibi-kadar',
    kind: 'grammar',
    name: 'Similarity and equality (gibi, kadar)',
    description:
      'gibi ("like") and kadar ("as…as") follow the compared noun (aslan gibi); pronouns take the genitive before both (benim gibi, senin kadar). kadar also marks approximate quantity.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Bir aslan gibi güçlü. (Strong like a lion.)',
      'Benim gibi düşünüyor. (He thinks like me.)',
      'Senin kadar uzun. (As tall as you.)',
      'Bir saat kadar bekledim. (I waited about an hour.)',
      'Benim kadar çalışmıyor. (He doesn\'t work as much as I do — kadar attracts the genitive on ben, like gibi.)',
    ],
    examplesNegative: [
      '*Ben gibi düşünüyor. (wrong — with a pronoun, gibi requires the genitive: "benim gibi", not "ben gibi".)',
      '*Ben kadar uzun. (wrong — kadar attracts the genitive on this pronoun just like gibi: "benim kadar uzun".)',
    ],
    commonErrors: [
      'Using a bare pronoun before gibi instead of the genitive ("ben gibi" instead of "benim gibi").',
      'Confusing gibi (similarity) with kadar (equality / quantity): "aslan gibi güçlü" (strong like a lion) vs "aslan kadar güçlü" (as strong as a lion).',
      'Forgetting that kadar — not only gibi — takes the genitive on ben/sen/biz/siz/bu/şu/o/kim ("ben kadar" instead of "benim kadar").',
      'Adding the genitive to PLURAL pronouns before gibi/kadar: "bizler gibi", "onlar kadar" stay bare (no -in).',
    ],
  },
  {
    key: 'tr-a2-correlative-conjunctions',
    kind: 'grammar',
    name: 'Correlative conjunctions (hem…hem, ne…ne, ya…ya, ister…ister)',
    description:
      'Correlative pairs: hem … hem (de) "both … and", ne … ne "neither … nor" (predicate normally positive), ya … ya (da) "either … or", ister … ister "whether … or"; both halves obligatory.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hem Türkçe hem İngilizce konuşuyor. (She speaks both Turkish and English.)',
      'Ne çay ne kahve içerim. (I drink neither tea nor coffee — verb stays positive.)',
      'Ya bugün ya yarın gelirim. (I will come either today or tomorrow.)',
      'İster sen gel ister o. (Let either you come or him.)',
      'Hem ben hem de kardeşim geldik. (Both I and my brother came — the last half often takes de.)',
      'Ne param ne de zamanım var. (I have neither money nor time — predicate stays positive: var.)',
    ],
    examplesNegative: [
      '*Ne çay ne kahve içmem. (wrong — with ne … ne the verb stays POSITIVE in Turkish: "Ne çay ne kahve içerim".)',
      '*Ya bugün, yarın gelirim. (wrong — both halves of the pair are obligatory: "Ya bugün ya yarın gelirim".)',
    ],
    commonErrors: [
      'Negating the verb after ne … ne ("Ne çay ne kahve içmem"); at A2 keep the predicate POSITIVE ("Ne çay ne kahve içerim") since the correlative already supplies the negation.',
      'Using only one half of the correlative pair (a single "hem"); Turkish requires both halves.',
      'Forgetting that the last conjunct of hem…hem and ya…ya commonly takes de/da ("hem … hem de", "ya … ya da").',
    ],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-causal-connectors',
    kind: 'grammar',
    name: 'Causal connectors (çünkü, bu yüzden, bu sebeple)',
    description:
      'Causal connectors: çünkü "because" (cause follows; informal — can also sit at the END of the clause), bu yüzden / bu sebeple "for that reason, so" (consequence follows the connector).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Geç kaldım çünkü trafik vardı. (I was late because there was traffic.)',
      'Yağmur yağıyordu, bu yüzden dışarı çıkmadık. (It was raining, so we didn\'t go out.)',
      'Sınavım var, bu sebeple gelemem. (I have an exam, so I can\'t come.)',
      'Gelemedim. Çok yorgundum çünkü. (I couldn\'t come. Because I was very tired — informal clause-final çünkü.)',
    ],
    examplesNegative: [
      '*Geç kaldım için trafik vardı. (wrong — between two finite clauses use çünkü; bare "için" requires a nominalised clause — that is the B1 -DIğI için form.)',
    ],
    commonErrors: [
      'Confusing çünkü (explanation follows the connector) with bu yüzden / bu sebeple (consequence follows the connector).',
      'Using bare için between two finite clauses ("trafik vardı için geç kaldım") — at A2 use çünkü or bu yüzden; the nominalised -DIğI için form is B1.',
      'Forgetting that çünkü can also come at the very end of the clause in speech (Yorgundum çünkü.) — only çünkü, not bu yüzden, allows this.',
    ],
  },
  {
    key: 'tr-a2-ca-suffix',
    kind: 'grammar',
    name: 'Derivational -CA (manner adverbs, language names)',
    description:
      "Derivational -CA (-ca/-ce/-ça/-çe, harmonised; -ç- after voiceless stems): manner adverbs (yavaşça), '-ish' forms (çocukça), and language names used adverbially (Türkçe = Turkish / in Turkish).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yavaşça konuş. (Speak slowly.)',
      'Sessizce oturdu. (He sat silently.)',
      'Kardeşçe paylaştık. (We shared like brothers.)',
      'Türkçe öğreniyorum. (I am learning Turkish.)',
      'Bu kitabı Türkçe okudum. (I read this book in Turkish — the same -CA form, used as an adverb.)',
      'Çok çocukça davrandın. (You behaved very childishly — -CA on çocuk.)',
    ],
    examplesNegative: [
      '*Yavaşce konuş. (wrong — back-vowel stem "yavaş" needs back-vowel -ca: "yavaşça"; -CA harmonises.)',
      '*İngilizde konuşuyorum. (wrong — "in English" is the -CA form İngilizce, not a locative: "İngilizce konuşuyorum".)',
    ],
    commonErrors: [
      'Picking the wrong harmonised form (-ca/-ce/-ça/-çe): *yavaşce instead of yavaşça.',
      'Voicing the -c- after a voiceless stem instead of devoicing to -ç- ("yavaşca" instead of "yavaşça").',
      "Treating 'in [a language]' as needing an extra word or case — the bare -CA form is both the language name and the adverb (Türkçe konuş = speak in Turkish).",
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-pekistirme',
    kind: 'grammar',
    name: 'Reduplication intensifier (Pekiştirme)',
    description:
      "Intensifier reduplication: prefix = stem's first consonant+vowel + fixed p/s/r/m (vowel-initial stems take p: apaçık), then stem: bembeyaz, kıpkırmızı, yepyeni. Consonant is lexical; no çok/en.",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Kar gibi bembeyaz. (Snow-white.)',
      'Yüzü kıpkırmızı oldu. (His face turned bright red.)',
      'Yepyeni bir araba. (A brand-new car.)',
      'Masmavi bir gökyüzü. (A deep-blue sky.)',
      'Bardak bomboş kalmış. (The glass was left completely empty — boş → bomboş.)',
      'Kapı apaçık duruyordu. (The door was standing wide open — açık → apaçık, vowel-initial takes p.)',
    ],
    examplesNegative: [
      '*beyaz beyaz bir gömlek. (wrong — adjective intensification uses the pekiştirme prefix, not simple repetition: "bembeyaz bir gömlek")',
      '*çok bembeyaz bir gömlek. (wrong — a reduplicated intensifier already means "very", so it rejects çok/en → "bembeyaz bir gömlek")',
    ],
    commonErrors: [
      'Trying to predict the m/p/r/s consonant phonetically — it is lexicalised per word (bembeyaz, kıpkırmızı, simsiyah, yemyeşil).',
      'Substituting simple repetition (*beyaz beyaz) for the reduplication intensifier (bembeyaz).',
      'Adding çok or en to a reduplicated form (*çok bembeyaz, *en yepyeni) — the prefix already carries the "very/most" meaning.',
      'Assuming the consonant is freely chosen for every stem — vowel-initial stems always take p (apaçık, ipince); only consonant-initial stems vary.',
    ],
  },
  {
    key: 'tr-a2-purpose-icin-uzere',
    kind: 'grammar',
    name: 'Purpose / imminence (-mAk için, -mAk üzere)',
    description:
      "Purpose/imminence: -mAk için 'in order to' (same subject); a different subject needs -mAsI için 'so that' (anlaması için). -mAk üzere = 'about to' or formal 'in order to' (gitmek üzereyim).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Çalışmak için Almanya\'ya gitti. (He went to Germany in order to work.)',
      'Türkçe öğrenmek için kursa gidiyorum. (I am going to a course in order to learn Turkish.)',
      'Tam çıkmak üzereydim. (I was just about to leave.)',
      'Geç kalmamak için erken çıktım. (I left early in order not to be late — negative purpose -mAmAk için.)',
      'Çocuğun anlaması için yavaş konuştum. (I spoke slowly so that the child would understand — different subject → -mAsI için.)',
    ],
    examplesNegative: [
      '*Çalışırım için Almanya\'ya gitti. (wrong — purpose uses the infinitive: "çalışmak için", not a finite verb form.)',
      '*Çocuk anlamak için yavaş konuştum. (wrong — the purpose clause has its own subject, so use -mAsI için: "Çocuğun anlaması için yavaş konuştum".)',
    ],
    commonErrors: [
      'Using a finite verb form before için instead of the -mAk infinitive ("çalışırım için" → "çalışmak için").',
      'Confusing the two senses of -mAk üzere: "about to" (imminence) vs the formal "in order to" — context disambiguates.',
      'Using -mAk için when the purpose clause has a different subject — a separate subject requires -mAsI için ("çocuk anlamak için" → "çocuğun anlaması için").',
      'Forgetting that purpose is negated on the infinitive with -mA- ("in order not to be late" = "geç kalmamak için").',
    ],
    prerequisiteKeys: ['tr-a1-future'],
  },
  {
    key: 'tr-a2-reported-speech',
    kind: 'grammar',
    name: 'Reported speech (diye + dolaylı anlatım)',
    description:
      'Reported speech: direct quote + de- (dedi) or diye + reporting verb (sormak, söylemek). söyle- takes only integrated clauses: -DIğInI söyledi; reported command -mAsInI iste-/söyle-.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      '"Yarın gelir misin?" diye sordu. (He asked, "Will you come tomorrow?")',
      '"Hayır" diye cevap verdim. (I answered, "No".)',
      'Geleceğini söyledi. (He said he would come — integrated form.)',
      'Gelmemi istedi. (He told me to come — reported imperative.)',
      '"Çok yorgunum" dedi. (She said, "I\'m very tired." — dedi / de- is the everyday verb for quoting; no diye needed.)',
      'Annem gelmemi söyledi. (My mother told me to come — söyle- + -mA + possessive + accusative.)',
    ],
    examplesNegative: [
      '*"Yarın gelir misin?" sordu. (wrong — diye is required to mark the reported clause: "\\"Yarın gelir misin?\\" diye sordu.")',
    ],
    commonErrors: [
      'Omitting diye between a directly-quoted clause and the reporting verb ("\\"Yarın gelir misin\\" sordu" instead of "\\"Yarın gelir misin\\" diye sordu").',
      'Failing to shift person/tense in integrated reported speech — use -DIğInI / -(y)AcAğInI: "Geleceğini söyledi" = he said he would come.',
      'Using söylemek with a direct quotation — söyle- only takes integrated clauses (-DIğInI / -mAsInI); direct quotes need de- ("…" dedi) or diye.',
      'Forgetting the accusative on the reported command: *gelmem istedi instead of gelmemi istedi (gel-me-m-i).',
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
    key: 'tr-a1-everyday-vocab',
    kind: 'vocab',
    name: 'Everyday vocabulary (A1)',
    description:
      'Core high-frequency Turkish vocabulary for A1: numbers, days, family, food and drink, greetings, and basic everyday objects.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['su (water)', 'ev (house)', 'anne (mother)'],
    examplesNegative: ['*ev de', '*su lar'],
    commonErrors: [
      'Detaching case or plural suffixes from the noun (evde, not *ev de).',
      'Vowel-harmony slips on common suffixes (evde, not *evda).',
    ],
  },
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
