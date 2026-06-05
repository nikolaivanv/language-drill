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
