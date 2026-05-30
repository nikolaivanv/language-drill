// Shared sample data for the Vocabulary Review feature.
// Schema mirrors the spec: per-(user,language,lemma) scheduler card with FSRS state,
// surface forms accumulated as occurrences {surface, sentence, contextualSense, whyThisForm}.

window.RV = {};

// ─── Lemmas (review cards) ──────────────────────────────────────
RV.LEMMAS = [
  {
    id: 'tr-ev', lang: 'tr', lemma: 'ev', gloss: 'house', pos: 'noun', cefr: 'A1', freqRank: 142,
    monolingualDef: 'Bir ailenin yaşadığı yapı; barınak.',
    occurrences: [
      {
        surface: 'evlerinden',
        sentence: 'Çocuklar okula gitmek için evlerinden erkenden çıkarlar.',
        translation: 'The children leave their houses early to go to school.',
        source: 'Daily routine · A2 reader',
        contextualSense: 'from their houses',
        whyThisForm: 'ablative case (-den) marks motion away from something',
        morphology: [
          { p: 'ev', r: 'house' },
          { p: '-ler', r: 'plural' },
          { p: '-i', r: '3p possessive' },
          { p: '-n', r: 'buffer' },
          { p: '-den', r: 'ablative ("from")' },
        ],
        grammarPoints: ['ablative case', '3p possessive', 'plural -ler'],
      },
      {
        surface: 'eve',
        sentence: 'Akşam yedide eve dönüyorum.',
        translation: "I'm going back home at seven.",
        source: 'Yeni Hitit · A2',
        contextualSense: 'to (the) house',
        whyThisForm: 'dative case (-e) marks destination',
        morphology: [{ p: 'ev', r: 'house' }, { p: '-e', r: 'dative ("to")' }],
        grammarPoints: ['dative case'],
      },
      {
        surface: 'evler',
        sentence: 'Bu sokakta eski evler var.',
        translation: 'There are old houses on this street.',
        source: 'Önce Türkçe · B1',
        contextualSense: 'houses',
        whyThisForm: 'simple plural',
        morphology: [{ p: 'ev', r: 'house' }, { p: '-ler', r: 'plural' }],
        grammarPoints: ['plural -ler'],
      },
    ],
    fsrs: { stability: 4.2, difficulty: 6.1, reps: 5, lapses: 1, lastReview: '4d', nextInterval: 8, dueIn: 'now', state: 'learning' },
    history: ['ok', 'ok', 'miss', 'ok', 'ok'], // recent first
  },
  {
    id: 'es-aprovechar', lang: 'es', lemma: 'aprovechar', gloss: 'to take advantage of', pos: 'verb', cefr: 'B1', freqRank: 842,
    monolingualDef: 'sacar provecho de algo o usarlo de manera útil',
    occurrences: [
      {
        surface: 'aprovechar',
        sentence: 'Voy a aprovechar el fin de semana para descansar.',
        translation: "I'll take advantage of the weekend to rest.",
        source: 'El País · op-ed (saved)',
        contextualSense: 'to make good use of',
        whyThisForm: 'infinitive after "voy a"',
        grammarPoints: ['ir a + infinitive'],
      },
      {
        surface: 'aprovechó',
        sentence: 'Aprovechó la oportunidad y se mudó a Madrid.',
        translation: 'She seized the opportunity and moved to Madrid.',
        source: 'short story · B2',
        contextualSense: 'seized',
        whyThisForm: 'preterite 3rd person',
        grammarPoints: ['preterite'],
      },
    ],
    fsrs: { stability: 12.5, difficulty: 4.2, reps: 9, lapses: 0, lastReview: '11d', nextInterval: 18, dueIn: '−2d', state: 'mature' },
    history: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'miss', 'ok'],
  },
  {
    id: 'es-soler', lang: 'es', lemma: 'soler', gloss: 'to usually do', pos: 'verb', cefr: 'A2', freqRank: 489,
    occurrences: [
      {
        surface: 'suelo',
        sentence: 'Suelo levantarme temprano los lunes.',
        translation: 'I usually get up early on Mondays.',
        source: 'Aula 3 · A2',
        contextualSense: 'I usually',
        whyThisForm: 'present 1s of o→ue stem-change',
        grammarPoints: ['o→ue stem change', 'soler + infinitive'],
      },
    ],
    fsrs: { stability: 1.1, difficulty: 7.8, reps: 3, lapses: 2, lastReview: '1d', nextInterval: 1, dueIn: 'now', state: 'learning' },
    history: ['miss', 'ok', 'miss', 'miss'],
  },
  {
    id: 'es-madrugada', lang: 'es', lemma: 'madrugada', gloss: 'early-morning hours', pos: 'noun (f.)', cefr: 'B1', freqRank: 3201,
    occurrences: [
      {
        surface: 'madrugada',
        sentence: 'Llegamos a las tres de la madrugada.',
        translation: 'We arrived at 3 in the early morning.',
        source: 'BBC Mundo · article',
        contextualSense: 'early morning hours',
        whyThisForm: 'lemma form',
        grammarPoints: ['time expressions'],
      },
    ],
    fsrs: { stability: 8.0, difficulty: 3.9, reps: 6, lapses: 0, lastReview: '6d', nextInterval: 12, dueIn: '6h', state: 'mature' },
    history: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  },
  {
    id: 'es-imprescindible', lang: 'es', lemma: 'imprescindible', gloss: 'essential, indispensable', pos: 'adj.', cefr: 'B2', freqRank: 2104,
    occurrences: [
      {
        surface: 'imprescindible',
        sentence: 'Un buen diccionario es imprescindible para aprender una lengua.',
        translation: 'A good dictionary is essential for learning a language.',
        source: 'language blog · B2',
        contextualSense: 'essential, indispensable',
        whyThisForm: 'lemma',
        grammarPoints: ['ser + adj'],
      },
    ],
    fsrs: { stability: 0.4, difficulty: 8.9, reps: 4, lapses: 4, lastReview: '12h', nextInterval: 0.5, dueIn: 'now', state: 'leech' },
    history: ['miss', 'miss', 'ok', 'miss', 'miss'],
  },
  {
    id: 'es-apenas', lang: 'es', lemma: 'apenas', gloss: 'barely, hardly', pos: 'adverb', cefr: 'B1', freqRank: 612,
    occurrences: [
      {
        surface: 'apenas',
        sentence: 'Apenas podía oírlo sobre el ruido.',
        translation: 'I could barely hear him over the noise.',
        source: 'dialogue · B1',
        contextualSense: 'barely',
        whyThisForm: 'lemma',
        grammarPoints: ['adverbs of degree'],
      },
    ],
    fsrs: { stability: 22.0, difficulty: 2.8, reps: 12, lapses: 0, lastReview: '20d', nextInterval: 32, dueIn: '12d', state: 'mature' },
    history: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  },
  {
    id: 'es-echar', lang: 'es', lemma: 'echar de menos', gloss: 'to miss (someone)', pos: 'phrase', cefr: 'B1', freqRank: 1820,
    isPhrase: true,
    occurrences: [
      {
        surface: 'Echo de menos',
        sentence: 'Echo de menos a mi familia, pero el deber me llama.',
        translation: 'I miss my family, but duty calls.',
        source: 'Aunque cansado · short story',
        contextualSense: 'I miss',
        whyThisForm: 'present 1s; phrase is fixed',
        grammarPoints: ['idiomatic phrases'],
      },
    ],
    fsrs: { stability: 5.2, difficulty: 5.5, reps: 3, lapses: 1, lastReview: '5d', nextInterval: 9, dueIn: '4d', state: 'learning' },
    history: ['ok', 'miss', 'ok'],
  },
  {
    id: 'es-hartar', lang: 'es', lemma: 'hartar', gloss: 'to fed up / sicken', pos: 'verb', cefr: 'B2', freqRank: 4520,
    occurrences: [
      {
        surface: 'me harté',
        sentence: 'Me harté de esperar y me fui.',
        translation: "I got fed up of waiting and left.",
        source: 'novela · B2',
        contextualSense: 'I got fed up',
        whyThisForm: 'reflexive preterite',
        grammarPoints: ['reflexive verbs', 'preterite'],
      },
    ],
    fsrs: { stability: 2.4, difficulty: 7.2, reps: 4, lapses: 2, lastReview: '2d', nextInterval: 3, dueIn: 'now', state: 'learning' },
    history: ['miss', 'ok', 'miss', 'ok'],
  },
];

// ─── Queue mix per language for hub ──────────────────────────────
RV.QUEUE = {
  es: { due: 18, new: 4, leech: 1, total: 23, mix: { cloze: 9, meaning: 5, useit: 3, recog: 2, listen: 4 } },
  tr: { due: 8,  new: 3, leech: 0, total: 11, mix: { cloze: 5, meaning: 3, useit: 1, recog: 2, listen: 0 } },
  fr: { due: 0,  new: 0, leech: 0, total: 0,  mix: {} },
  de: { due: 0,  new: 0, leech: 0, total: 0,  mix: {} },
};

// ─── Grammar points (radar deltas after a session) ───────────────
RV.GRAMMAR_DELTAS = [
  { name: 'ablative case', from: 62, to: 71, evidence: 'evlerinden cloze · correct' },
  { name: 'preterite (regular -ar)', from: 78, to: 80, evidence: 'aprovechó · use-it · natural' },
  { name: 'o→ue stem change', from: 41, to: 33, evidence: 'soler · miss × 2' },
  { name: 'reflexive verbs', from: 58, to: 60, evidence: 'hartarse · partial' },
];

// ─── Session log used by summary ─────────────────────────────────
RV.SESSION = {
  duration: '11m 28s',
  total: 12, correct: 9, partial: 1, missed: 2,
  promoted: ['aprovechar', 'apenas'],  // moved into 'mature'
  lapsed: ['imprescindible'],          // dropped to 'leech'
  newCards: 2,
  costClaude: '$0.018',
  items: [
    { lemma: 'ev',             type: 'cloze',   result: 'ok',   surface: 'evlerinden', t: '24s' },
    { lemma: 'aprovechar',     type: 'useit',   result: 'ok',   surface: 'aprovechó la fiesta',  t: '1m 12s', note: 'natural · minor article slip' },
    { lemma: 'apenas',         type: 'meaning', result: 'ok',   surface: 'apenas',     t: '8s'  },
    { lemma: 'imprescindible', type: 'cloze',   result: 'miss', surface: 'imprescindible', t: '32s', note: '4th miss → leech' },
    { lemma: 'madrugada',      type: 'listen',  result: 'ok',   surface: 'madrugada',  t: '14s' },
    { lemma: 'soler',          type: 'cloze',   result: 'miss', surface: 'suelo',      t: '21s' },
    { lemma: 'echar de menos', type: 'useit',   result: 'partial', surface: 'echaba de menos los días', t: '1m 02s', note: 'tense off — should be present' },
    { lemma: 'hartar',         type: 'meaning', result: 'ok',   surface: 'me harté',   t: '11s' },
  ],
};
