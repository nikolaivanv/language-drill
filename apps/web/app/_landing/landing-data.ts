// Content for the dark marketing landing ("drill").
// Three live languages — Spanish, German, Turkish — plus a coming-soon set.
// Each language carries: one literary passage (deep annotation) and one cloze
// item the hero plays as a typed-production demo (wrong attempt → correct).
// Ported verbatim from the design handoff (landing/drill-data.jsx).

export interface LandingLang {
  id: string;
  label: string;
  tag: string;
  cefr: string;
}

export interface Token {
  w: string;
  lemma: string;
  pos: string;
  gloss: string;
  note: string;
}

export interface Passage {
  title: string;
  source: string;
  tokens: (string | Token)[];
}

export interface ClozeItem {
  pre: string;
  post: string;
  en: string;
  blank: string;
  wrongTyped: string;
  helper: string;
  skill: string;
  explainOk: string;
  explainNo: string;
}

export interface SeedVocab {
  w: string;
  lang: string;
  gloss: string;
  due: string;
}

export const D_LANGS: LandingLang[] = [
  { id: 'es', label: 'Español', tag: 'ES', cefr: 'B2' },
  { id: 'de', label: 'Deutsch', tag: 'DE', cefr: 'B2' },
  { id: 'tr', label: 'Türkçe', tag: 'TR', cefr: 'B1' },
];

export const D_SOON: { label: string; tag: string }[] = [
  { label: 'Français', tag: 'FR' },
  { label: 'Português', tag: 'PT' },
  { label: 'Italiano', tag: 'IT' },
];

// token helper: da(word, lemma, pos, gloss, note)
const da = (w: string, lemma: string, pos: string, gloss: string, note: string): Token => ({
  w,
  lemma,
  pos,
  gloss,
  note,
});

// The same lighthouse scene in every language, so the switcher tells one story.
export const D_PASSAGES: Record<string, Passage> = {
  es: {
    title: 'El farero',
    source: 'pasaje original · B2',
    tokens: [
      'Aunque la ',
      da('niebla', 'la niebla', 'sust. f.', 'fog, mist', 'From Latin nebula. The valley below has vanished under it.'),
      ' cubría el valle, el viejo ',
      da('farero', 'el farero', 'sust. m.', 'lighthouse keeper', 'faro (lighthouse) + -ero (one who tends). A near-extinct profession.'),
      ' subió la ',
      da('escalera de caracol', '—', 'loc. nom.', 'spiral staircase', 'Literally “snail staircase” — caracol = snail. Languages love naming spirals after snails.'),
      ' sin ',
      da('vacilar', 'vacilar', 'verbo', 'to hesitate, waver', 'Here in the infinitive after sin. He climbs without a moment’s doubt.'),
      ', como si conociera cada ',
      da('peldaño', 'el peldaño', 'sust. m.', 'step (of a stair)', 'A single step; the whole flight is la escalera.'),
      ' de memoria.',
    ],
  },
  de: {
    title: 'Der Wärter',
    source: 'Originaltext · B2',
    tokens: [
      'Obwohl der ',
      da('Nebel', 'der Nebel', 'Subst. m.', 'fog', 'Cognate with English “nebulous.” It has covered the valley.'),
      ' das Tal bedeckte, stieg der alte ',
      da('Leuchtturmwärter', 'der Leuchtturmwärter', 'Subst. m.', 'lighthouse keeper', 'Leucht-turm-wärter: light + tower + warden. German stacks the whole job into one word.'),
      ' die ',
      da('Wendeltreppe', 'die Wendeltreppe', 'Subst. f.', 'spiral staircase', 'wendeln (to wind) + Treppe (stairs). No snail here — it simply “winds.”'),
      ' ohne zu ',
      da('zögern', 'zögern', 'Verb', 'to hesitate', 'Infinitive after ohne zu. He ascends without a flicker of doubt.'),
      ' hinauf, als kenne er jede ',
      da('Stufe', 'die Stufe', 'Subst. f.', 'step', 'One step of the flight. The whole staircase is die Treppe.'),
      ' auswendig.',
    ],
  },
  tr: {
    title: 'Fener Bekçisi',
    source: 'özgün metin · B1',
    tokens: [
      da('Sis', 'sis', 'isim', 'fog, mist', 'A single, soft word for the fog that has swallowed the valley.'),
      ' vadiyi ',
      da('örtmesine rağmen', 'örtmek', 'yapı', 'although it covered', '-mesine rağmen = “although it does.” A compact concession Turkish builds onto the verb.'),
      ', yaşlı ',
      da('deniz feneri bekçisi', '—', 'isim öbeği', 'lighthouse keeper', 'deniz (sea) + fener (lamp) + bekçi (keeper). Turkish chains nouns to name the trade.'),
      ', her ',
      da('basamağı', 'basamak', 'isim', 'the step (acc.)', 'basamak + -ı: the accusative -ı marks it as the specific, known object.'),
      ' ezbere ',
      da('biliyormuş gibi', 'bilmek', 'yapı', 'as if he knew', '-muş gibi = “as if.” The -muş hints it is reported or inferred, not witnessed.'),
      ', ',
      da('sarmal merdiveni', 'sarmal merdiven', 'isim öbeği', 'the spiral staircase', 'sarmal = coiled, spiral. Here in the accusative as the object of “climbed.”'),
      ' ',
      da('tereddüt etmeden', 'tereddüt etmek', 'yapı', 'without hesitating', '-meden = “without doing.” He climbs without a flicker of doubt.'),
      ' çıktı.',
    ],
  },
};

// One cloze per language for the hero's typed-production demo.
// wrongTyped = the plausible slip we play first; blank = the form that sticks.
export const D_CLOZE: Record<string, ClozeItem> = {
  es: {
    pre: 'No creo que ',
    post: ' tiempo para eso esta semana.',
    en: '“I don’t think I’ll have time for that this week.”',
    blank: 'tenga',
    wrongTyped: 'tiene',
    helper: 'tener · 3.ª persona sg.',
    skill: 'subjuntivo · duda',
    explainOk: '“no creo que” plants doubt — and doubt takes the subjunctive: tenga.',
    explainNo: '“tiene” is the indicative. “no creo que” expresses doubt, which triggers the subjunctive: tenga.',
  },
  de: {
    pre: 'Wenn ich mehr Zeit ',
    post: ', würde ich öfter lesen.',
    en: '“If I had more time, I’d read more often.”',
    blank: 'hätte',
    wrongTyped: 'hatte',
    helper: 'haben · Konjunktiv II',
    skill: 'Konjunktiv II · Hypothese',
    explainOk: 'A hypothetical “if” takes Konjunktiv II — hätte, with the umlaut.',
    explainNo: '“hatte” is the simple past. A hypothetical condition needs Konjunktiv II: hätte.',
  },
  tr: {
    pre: 'Her sabah saat altıda ',
    post: '.',
    en: '“Every morning at six, I get up.”',
    blank: 'kalkarım',
    wrongTyped: 'kalkıyorum',
    helper: 'kalkmak · geniş zaman, 1. tekil',
    skill: 'geniş zaman · alışkanlık',
    explainOk: '“Her sabah” marks a habit — and habits take the geniş zaman (aorist): kalkarım.',
    explainNo: '“kalkıyorum” is happening right now. A daily habit takes the aorist: kalkarım.',
  },
};

// Pre-seeded review queue so the vocabulary section reads as a real deck
// before the visitor saves anything from the passage.
export const D_SEED_VOCAB: SeedVocab[] = [
  { w: 'farero', lang: 'ES', gloss: 'lighthouse keeper', due: 'due now' },
  { w: 'Wendeltreppe', lang: 'DE', gloss: 'spiral staircase', due: 'in 2 days' },
];

/* ─── Practice types for the carousel (cloze reuses D_CLOZE, reading reuses D_PASSAGES) ───
   Each entry, per language, is a compact worked example of one practice mode. */

export interface TranslationItem {
  en: string;
  target: string;
  /** [text, hot] — hot chunks are the graded/idiomatic spans, underlined green. */
  chunks: [string, number][];
  note: string;
  skill: string;
}

export interface DictationItem {
  heard: string;
  en: string;
  note: string;
  skill: string;
}

export interface FreewriteItem {
  prompt: string;
  draft: string;
  /** [from, to, why] — from === to marks a clean draft (no fix needed). */
  fixes: [string, string, string][];
  note: string;
  skill: string;
}

export const D_PRACTICE: {
  translation: Record<string, TranslationItem>;
  dictation: Record<string, DictationItem>;
  freewrite: Record<string, FreewriteItem>;
} = {
  translation: {
    es: {
      en: 'Whatever happens, call me.',
      target: 'Pase lo que pase, llámame.',
      chunks: [['Pase lo que pase', 1], [', ', 0], ['llámame', 1], ['.', 0]],
      note: '“pase lo que pase” is a fixed subjunctive concession — drilled until it’s automatic.',
      skill: 'traducción · subjuntivo',
    },
    de: {
      en: 'Whatever happens, call me.',
      target: 'Was auch passiert, ruf mich an.',
      chunks: [['Was auch passiert', 1], [', ', 0], ['ruf', 1], [' mich ', 0], ['an', 1], ['.', 0]],
      note: '“ruf … an” is a separable verb — the prefix flies to the end. That split is the whole point.',
      skill: 'Übersetzung · trennbare Verben',
    },
    tr: {
      en: 'Whatever happens, call me.',
      target: 'Ne olursa olsun, beni ara.',
      chunks: [['Ne olursa olsun', 1], [', ', 0], ['beni ', 0], ['ara', 1], ['.', 0]],
      note: '“ne olursa olsun” = “whatever happens.” A set concessive frame you reuse everywhere.',
      skill: 'çeviri · koşul',
    },
  },
  dictation: {
    es: {
      heard: 'No sabía que habías llegado.',
      en: 'I didn’t know you had arrived.',
      note: 'Pluscuamperfecto: habías + participle. Accents and spelling are graded, not glossed over.',
      skill: 'dictado · tiempos',
    },
    de: {
      heard: 'Ich wusste nicht, dass du angekommen warst.',
      en: 'I didn’t know you had arrived.',
      note: 'Plusquamperfekt with warst at the clause end. Word order is part of the answer.',
      skill: 'Diktat · Plusquamperfekt',
    },
    tr: {
      heard: 'Geldiğini bilmiyordum.',
      en: 'I didn’t know you had arrived.',
      note: '“Geldiğini” packs a whole clause into one word. You hear it, you spell it.',
      skill: 'dikte · ortaç',
    },
  },
  freewrite: {
    es: {
      prompt: 'Describe tu rutina de mañana en 2–3 frases.',
      draft: 'Cada mañana me levanto a las seis. Bebo un café y después ',
      fixes: [['Bebo un café', 'Tomo un café', 'collocation: coffee is “tomado,” not “bebido,” in everyday Spanish']],
      note: 'A bounded prompt at your level. drill corrects what you wrote — it doesn’t write it for you.',
      skill: 'escritura libre · presente',
    },
    de: {
      prompt: 'Beschreibe deinen Morgen in 2–3 Sätzen.',
      draft: 'Jeden Morgen stehe ich um sechs auf. Ich trinke ein Kaffee und dann ',
      fixes: [['ein Kaffee', 'einen Kaffee', 'accusative object: Kaffee is masculine → einen']],
      note: 'A bounded prompt at your level. drill corrects what you wrote — it doesn’t write it for you.',
      skill: 'freies Schreiben · Präsens',
    },
    tr: {
      prompt: 'Sabah rutinini 2–3 cümleyle anlat.',
      draft: 'Her sabah saat altıda kalkarım. Bir kahve içerim ve sonra ',
      fixes: [['Bir kahve içerim', 'Bir kahve içerim', 'clean — natural collocation, correct aorist']],
      note: 'A bounded prompt at your level. drill corrects what you wrote — it doesn’t write it for you.',
      skill: 'serbest yazma · geniş zaman',
    },
  },
};

// Practice-type tab metadata (order = carousel order). Reading + cloze pull from existing data.
export type PracticeModeId = 'cloze' | 'translation' | 'dictation' | 'freewrite' | 'reading';

export interface PracticeMode {
  id: PracticeModeId;
  label: string;
  tag: string;
}

export const D_MODES: PracticeMode[] = [
  { id: 'cloze', label: 'Cloze', tag: 'fill the gap' },
  { id: 'translation', label: 'Translation', tag: 'produce the sentence' },
  { id: 'dictation', label: 'Dictation', tag: 'hear it, spell it' },
  { id: 'freewrite', label: 'Free writing', tag: 'bounded, corrected' },
  { id: 'reading', label: 'Reading', tag: 'read, tap, save' },
];

/* ─── ChatGPT contrast: the four pains, as chat-vs-drill rows ─── */

export interface ChatPain {
  id: string;
  chatLabel: string;
  chat: string;
  drill: string;
}

export const D_CHAT_PAINS: ChatPain[] = [
  {
    id: 'track',
    chatLabel: 'Scattered across the thread',
    chat: 'Your wins and misses are buried in 40 messages of chat. Nothing adds up.',
    drill: 'Every attempt is logged. One dashboard shows accuracy, streaks and your weak spots.',
  },
  {
    id: 'load',
    chatLabel: 'You run the tutor',
    chat: 'You have to set the level, the topic, the format — and police it every turn.',
    drill: 'The syllabus is set. You open it and practise. Zero prompt-engineering.',
  },
  {
    id: 'review',
    chatLabel: 'Mistakes evaporate',
    chat: 'Miss a word today and the chat forgets it. Nothing brings it back.',
    drill: 'Misses drop into a spaced queue and return exactly when you’re about to forget.',
  },
  {
    id: 'repeat',
    chatLabel: 'Same ten words',
    chat: 'It leans on the vocabulary it likes — casa, comer, bueno — over and over.',
    drill: 'Curated, level-tuned word lists. Deliberate spread, no accidental loops.',
  },
];

// A short scripted "chat gone wrong" transcript for the compare visual.
export interface ChatMsg {
  who: 'you' | 'ai';
  text: string;
  flag?: string;
}

export const D_BAD_CHAT: ChatMsg[] = [
  { who: 'you', text: 'Give me an A1 Spanish exercise.' },
  {
    who: 'ai',
    text: '¡Claro! Rellena el hueco: “Si yo ____ (tener) más tiempo, viajaría.”',
    flag: 'That’s the conditional — a B1 structure, not A1.',
  },
  { who: 'you', text: 'Too hard. And you already told me the verb.' },
  {
    who: 'ai',
    text: 'Disculpa, tienes toda la razón. Reformularé el ejercicio para que se ajuste mejor a tu nivel y no resulte tan exigente.',
    flag: 'Its apology is B2 Spanish. An A1 learner can’t read the fix for the problem.',
  },
];

// Point-by-point rows for the standalone "Why not ChatGPT?" page:
// [dimension, how the chat fails it, how drill handles it].
export const WN_ROWS: [string, string, string][] = [
  ['Level', 'Drifts up or down mid-session; you re-specify “A1” every few turns.', 'Locked to your CEFR level. Every item is calibrated a notch above — never over your head.'],
  ['Difficulty of the task', 'Often reveals the answer inside the prompt, making it trivial.', 'Hides just enough. You produce the form from nothing — real retrieval, every time.'],
  ['Vocabulary', 'Leans on a handful of favourite words, again and again.', 'Curated, level-tuned lists with deliberate spread — no accidental loops.'],
  ['Language of instruction', 'Explains in the target language, often above your level — the fix is as unreadable as the problem.', 'Explanations always in a language you read. Your target language stays for producing, not decoding.'],
  ['Tracking', 'Wins and misses scattered across a long thread. Nothing accumulates.', 'Every attempt logged. Accuracy, streaks and weak spots on one dashboard.'],
  ['Review of mistakes', 'Forgets what you missed the moment the chat scrolls on.', 'Misses enter a spaced queue and resurface right before you’d forget.'],
  ['Mental load', 'You set the level, topic, format — and police all of it, every turn.', 'The syllabus is set. You open it and practise. No prompt-engineering.'],
];

// The three "keep the chatbot for this" cards on the standalone page.
export const WN_KEEP: [string, string][] = [
  ['Ask anything, once', 'One-off “why is it subjunctive here?” — a chatbot is perfect for the ad-hoc question.'],
  ['Open-ended talk', 'Free conversation with no syllabus. Rambling practice when you just want to chat.'],
  ['Explain a curveball', 'Paste a weird sentence from the wild and get it unpicked on the spot.'],
];
