// Read — sample data
// Three passages, each in a different target language to showcase the card variants.

const READ_PASSAGES = {
  tr: {
    code: 'tr', lang: 'Turkish', flag: 'TR',
    title: 'Daily routine',
    source: 'Yeni Hitit · A2 reader',
    text: 'Her sabah ailesiyle birlikte kahvaltı eder, sonra çocuklar okula gitmek için evlerinden erkenden çıkarlar. Hava güzel olduğunda yürüyerek giderler.',
    // surface-form → intensity
    highlights: {
      'kahvaltı': 'subtle',
      'erkenden': 'subtle',
      'evlerinden': 'assertive',
    },
    saved: ['yürüyerek'],
    // featured words for the demo flow
    demo: {
      assertiveTap: 'evlerinden',   // instant deep card
      coldTap: 'ailesiyle',          // triggers loading skeleton
    },
  },

  de: {
    code: 'de', lang: 'German', flag: 'DE',
    title: 'Auf Reisen',
    source: 'Aspekte neu · B1+',
    text: 'Wir fuhren mit dem Zug von einem Dorf zum nächsten und übernachteten in alten Häusern am Rand der Berge.',
    highlights: {
      'übernachteten': 'subtle',
      'Häusern': 'assertive',
      'Rand': 'subtle',
    },
    saved: ['Dorf'],
    demo: {
      assertiveTap: 'Häusern',
      coldTap: 'fuhren',
    },
  },

  es: {
    code: 'es', lang: 'Spanish', flag: 'ES',
    title: 'Aunque cansado',
    source: 'Lectura B2 · short story',
    text: 'Aunque estaba cansado, siguió trabajando hasta el amanecer. Echo de menos a mi familia, pero el deber me llama.',
    highlights: {
      'amanecer': 'subtle',
      'deber': 'subtle',
    },
    saved: [],
    demo: {
      // phrase span (start..end indices in token stream computed at render time, but we match by text)
      phraseSpan: 'echo de menos',
      sentenceSpan: 'Aunque estaba cansado, siguió trabajando hasta el amanecer.',
    },
  },
};

// ────────────────────────────────────────────────────────────────
// Word dictionary — keyed by surface form (lowercased), per passage.
// Each entry holds CORE + EXTRAS fields per the new spec.

const READ_WORDS = {
  // ── Turkish ────────────────────────────────────────────────
  'evlerinden': {
    headword: 'evlerinden', pos: 'noun', cefr: 'B1', freq: 420, lang: 'tr',
    inflection: 'root “ev” · pl. “evler”',
    contextualSense: 'from their houses',
    definitionLabel: 'Türkçe',
    definition: 'Bir ailenin yaşadığı, içinde oturulan yapı.',
    morphology: [
      { part: 'ev', role: 'house' },
      { part: '-ler', role: 'plural' },
      { part: '-i', role: '3rd-person possessive ("their")' },
      { part: '-n', role: 'buffer consonant' },
      { part: '-den', role: 'ablative ("from")' },
    ],
    morphWhy: 'Ablative case (-den) marks motion away from something — here, the children leaving their houses.',
    synonyms: [
      { word: 'konut', note: 'more formal / official' },
      { word: 'mesken', note: 'formal, legal / administrative' },
    ],
    collocations: [
      { phrase: 'evden çıkmak', gloss: 'to leave the house' },
      { phrase: 'ev sahibi', gloss: 'host / landlord' },
    ],
    register: 'neutral',
    extraExample: { tl: 'Akşam geç saatte evlerinden ayrıldılar.', en: 'They left their house late in the evening.' },
  },
  'kahvaltı': {
    headword: 'kahvaltı', pos: 'noun', cefr: 'A2', freq: 980, lang: 'tr',
    inflection: 'noun · uncountable',
    contextualSense: 'breakfast',
    definitionLabel: 'Türkçe',
    definition: 'Sabah yenen ilk öğün.',
    morphology: [
      { part: 'kahve', role: 'coffee' },
      { part: 'altı', role: 'under / before' },
    ],
    morphWhy: 'Literally "before coffee" — the meal taken before the morning coffee.',
    synonyms: [{ word: 'sabah yemeği', note: 'descriptive, less idiomatic' }],
    collocations: [
      { phrase: 'kahvaltı etmek', gloss: 'to have breakfast' },
      { phrase: 'kahvaltı sofrası', gloss: 'breakfast spread' },
    ],
    register: 'neutral, everyday',
    extraExample: { tl: 'Hafta sonu uzun bir kahvaltı yaparız.', en: 'We have a long breakfast on weekends.' },
  },
  'erkenden': {
    headword: 'erkenden', pos: 'adverb', cefr: 'A2', freq: 1840, lang: 'tr',
    inflection: 'adverb',
    contextualSense: 'early (in the morning)',
    definitionLabel: 'Türkçe',
    definition: 'Beklenenden veya alışılandan önce, sabahın erken saatlerinde.',
    morphology: [
      { part: 'erken', role: 'early' },
      { part: '-den', role: 'adverbial suffix' },
    ],
    morphWhy: 'The ablative-derived adverbial form intensifies "erken" — "good and early".',
    synonyms: [{ word: 'sabah sabah', note: 'colloquial, repetitive form' }],
    collocations: [{ phrase: 'erkenden kalkmak', gloss: 'to get up early' }],
    register: 'neutral',
    extraExample: { tl: 'Toplantıya erkenden geldim.', en: 'I came to the meeting early.' },
  },
  'yürüyerek': {
    headword: 'yürüyerek', pos: 'adverb', cefr: 'A2', freq: 2210, lang: 'tr',
    inflection: 'gerund of yürümek',
    contextualSense: 'on foot, by walking',
    definitionLabel: 'Türkçe',
    definition: 'Ayakla, taşıt kullanmadan.',
    morphology: [
      { part: 'yürü-', role: 'walk (verb root)' },
      { part: '-(y)erek', role: 'gerund — "by ___ing"' },
    ],
    morphWhy: 'The -(y)erek suffix turns a verb into a manner adverb.',
    register: 'neutral',
  },
  'ailesiyle': {
    headword: 'ailesiyle', pos: 'noun', cefr: 'A2', freq: 1240, lang: 'tr',
    inflection: 'root “aile” · 3sg poss + instrumental',
    contextualSense: 'with his/her family',
    definitionLabel: 'Türkçe',
    definition: 'Aynı evde yaşayan, kan bağıyla bağlı insanlar topluluğu.',
    morphology: [
      { part: 'aile', role: 'family' },
      { part: '-si', role: '3rd-person possessive ("his/her")' },
      { part: '-(y)le', role: 'instrumental ("with")' },
    ],
    morphWhy: 'Possessive + instrumental — "with his/her family".',
    register: 'neutral',
  },

  // ── German ─────────────────────────────────────────────────
  'häusern': {
    headword: 'Häusern', pos: 'noun', cefr: 'A2', freq: 1100, lang: 'de',
    inflection: 'das Haus · pl. Häuser · (here: dative plural)',
    contextualSense: '(in / at) the houses',
    definitionLabel: 'Deutsch',
    definition: 'Ein Gebäude, in dem Menschen wohnen.',
    morphology: [
      { part: 'Haus', role: 'house (sg.)' },
      { part: '+ umlaut', role: 'plural marker' },
      { part: '-ern', role: 'dative plural ending' },
    ],
    morphWhy: 'Dative plural after the preposition "in" indicating location.',
    synonyms: [
      { word: 'Gebäude', note: 'more general' },
      { word: 'Heim', note: 'emotional, "home"' },
    ],
    collocations: [
      { phrase: 'zu Hause sein', gloss: 'to be at home' },
      { phrase: 'aus dem Haus gehen', gloss: 'to leave the house' },
    ],
    register: 'neutral',
    extraExample: { tl: 'Wir wohnten in alten Häusern am See.', en: 'We stayed in old houses by the lake.' },
  },
  'übernachteten': {
    headword: 'übernachteten', pos: 'verb', cefr: 'B1', freq: 3120, lang: 'de',
    inflection: 'übernachten · 1./3. pl. Präteritum',
    contextualSense: 'spent the night, stayed overnight',
    definitionLabel: 'Deutsch',
    definition: 'Die Nacht an einem Ort verbringen.',
    morphology: [
      { part: 'über-', role: 'over / across' },
      { part: 'nacht-', role: 'night' },
      { part: '-eten', role: 'preterite 1/3 pl.' },
    ],
    morphWhy: 'Separable-prefix verb in simple past — narrative tense.',
    register: 'neutral',
  },
  'rand': {
    headword: 'Rand', pos: 'noun', cefr: 'B1', freq: 2480, lang: 'de',
    inflection: 'der Rand · pl. Ränder',
    contextualSense: 'edge, fringe',
    definitionLabel: 'Deutsch',
    definition: 'Der äußere Teil oder Begrenzung eines Gebiets.',
    register: 'neutral',
  },
  'dorf': {
    headword: 'Dorf', pos: 'noun', cefr: 'A2', freq: 1620, lang: 'de',
    inflection: 'das Dorf · pl. Dörfer',
    contextualSense: 'village',
    definitionLabel: 'Deutsch',
    definition: 'Kleine ländliche Siedlung.',
    register: 'neutral',
  },
  'fuhren': {
    headword: 'fuhren', pos: 'verb', cefr: 'A2', freq: 720, lang: 'de',
    inflection: 'fahren · 1./3. pl. Präteritum',
    contextualSense: 'travelled, drove',
    definitionLabel: 'Deutsch',
    definition: 'Sich mit einem Fahrzeug fortbewegen.',
    morphology: [
      { part: 'fahr-', role: 'travel / drive' },
      { part: 'vowel change a→u', role: 'strong-verb preterite' },
      { part: '-en', role: '1/3 pl. ending' },
    ],
    morphWhy: 'Strong verb — vowel ablaut signals the past tense.',
    register: 'neutral',
  },

  // ── Spanish ────────────────────────────────────────────────
  'amanecer': {
    headword: 'amanecer', pos: 'noun', cefr: 'B1', freq: 3640, lang: 'es',
    inflection: 'el amanecer · sg.',
    contextualSense: 'dawn, daybreak',
    definitionLabel: 'Español',
    definition: 'Momento en que aparece la luz del día.',
    morphology: [
      { part: 'a-', role: 'directional prefix' },
      { part: 'manecer', role: 'from "manec-" (light)' },
    ],
    register: 'literary-tinged but common',
  },
  'deber': {
    headword: 'deber', pos: 'noun', cefr: 'B1', freq: 1280, lang: 'es',
    inflection: 'el deber · pl. los deberes',
    contextualSense: 'duty, obligation',
    definitionLabel: 'Español',
    definition: 'Aquello a lo que está obligado el ser humano por las leyes naturales, divinas o positivas.',
    register: 'neutral-formal',
  },
};

// Phrase entries — keyed by lowercase joined surface
const READ_PHRASES = {
  'echo de menos': {
    surface: 'echo de menos',
    citation: 'echar de menos',
    literal: 'to throw of less',
    idiomatic: 'to miss (someone or something)',
    register: 'neutral · very common',
    example: { tl: 'Echo de menos a mi familia.', en: "I miss my family." },
    synonyms: [{ word: 'extrañar', note: 'Latin-American equivalent' }],
    lang: 'es',
  },
};

// Sentence entries — keyed by lowercased sentence text (trimmed)
const READ_SENTENCES = {
  'aunque estaba cansado, siguió trabajando hasta el amanecer.': {
    sentence: 'Aunque estaba cansado, siguió trabajando hasta el amanecer.',
    translation: 'Even though he was tired, he kept working until dawn.',
    chunks: [
      { es: 'Aunque estaba cansado', role: 'subordinate clause', note: "concessive ‘aunque’ + imperfect for background state" },
      { es: 'siguió trabajando', role: 'main verb', note: "seguir + gerund = ‘to keep doing’" },
      { es: 'hasta el amanecer', role: 'time complement', note: "‘until dawn’" },
    ],
    grammarNotes: [
      "Concessive clauses with ‘aunque’",
      "seguir + gerundio (continuous action)",
      "Preterite vs imperfect contrast",
    ],
    lang: 'es',
  },
};

Object.assign(window, { READ_PASSAGES, READ_WORDS, READ_PHRASES, READ_SENTENCES });
