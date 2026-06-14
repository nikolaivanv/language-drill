// Shared sample data for the Free-writing drill (desktop + mobile web).
// Spanish · B2. One worked example end-to-end: a remote-work argument.

window.FW = {};

FW.lang = { code: 'es', name: 'español', level: 'B2' };

// ─── The prompt / brief ────────────────────────────────────────
FW.prompt = {
  title: 'El teletrabajo: ¿avance o aislamiento?',
  task: 'Argumenta a favor o en contra del teletrabajo. Defiende una postura clara y respóndela.',
  domain: 'opinión · argumentación',
  register: 'formal',
  length: { min: 150, max: 200 },
  minutes: 20,
  required: [
    { id: 'cond',   label: 'Usa al menos dos oraciones condicionales', detail: 'si + imperfecto de subjuntivo → condicional', met: true,  count: '3 detectadas' },
    { id: 'counter',label: 'Incluye y rebate un contraargumento',        detail: 'reconoce la otra postura, luego respóndela', met: true },
    { id: 'connect',label: 'Usa dos conectores de contraste',            detail: 'sin embargo · por otro lado · aunque…',      met: true,  count: '«Sin embargo», «Por otro lado»' },
  ],
  cefr: 'B2',
};

// ─── The student's draft ───────────────────────────────────────
FW.wordCount = 162;

// ─── Getting unstuck ───────────────────────────────────────────
FW.unstuck = {
  brainstorm: [
    { side: 'A favor', tone: 'ok', points: ['ahorro de tiempo en los desplazamientos', 'mejor conciliación de la vida laboral y personal', 'autonomía y flexibilidad horaria'] },
    { side: 'En contra', tone: 'accent', points: ['aislamiento y menos cohesión de equipo', 'dificultad para desconectar del trabajo', 'la productividad depende de la persona'] },
  ],
  vocab: [
    { w: 'el teletrabajo', g: 'remote work' },
    { w: 'conciliar la vida laboral y personal', g: 'work–life balance' },
    { w: 'la flexibilidad horaria', g: 'flexible hours' },
    { w: 'el aislamiento', g: 'isolation' },
    { w: 'desconectar', g: 'to switch off' },
    { w: 'fomentar la productividad', g: 'to boost productivity' },
    { w: 'un modelo híbrido', g: 'a hybrid model' },
    { w: 'a largo plazo', g: 'in the long run' },
    { w: 'en cuanto a', g: 'as regards' },
    { w: 'no obstante', g: 'nevertheless' },
  ],
  starter: 'Hoy en día, el teletrabajo se ha convertido en un tema de debate. En mi opinión,',
};

// ─── Inline error markup ───────────────────────────────────────
// draft as paragraphs of segments. Each segment is one of:
//   { t: 'plain text' }
//   { good: 'text' }                              ← positive highlight
//   { e: 1, old: 'tendría', new: 'tuviera', sev:'high' }  ← located error
FW.marked = [
  [
    { t: 'En mi opinión, el trabajo a distancia ofrece más ventajas que inconvenientes. ' },
    { good: 'Si las empresas confiaran más en sus empleados, muchas personas serían más productivas en casa.' },
    { t: ' Además, se ahorra mucho tiempo que antes se perdía en ' },
    { e: 2, old: 'el transporte', new: 'los desplazamientos', sev: 'med' },
    { t: '.' },
  ],
  [
    { good: 'Sin embargo,' },
    { t: ' hay quien piensa que trabajar desde casa provoca aislamiento. Es verdad que algunos trabajadores se sienten solos, pero si se organizan reuniones regulares, este problema se podría resolver fácilmente.' },
  ],
  [
    { t: 'Por otro lado, el trabajo a distancia permite conciliar mejor la vida laboral y personal. Si yo ' },
    { e: 1, old: 'tendría', new: 'tuviera', sev: 'high' },
    { t: ' la oportunidad, elegiría un modelo híbrido, porque combina lo mejor de los dos mundos.' },
  ],
  [
    { t: 'En conclusión, aunque el trabajo remoto tiene algunos desafíos, creo que sus beneficios son ' },
    { e: 3, old: 'mas', new: 'más', sev: 'low' },
    { t: ' importantes.' },
  ],
];

FW.errors = [
  { n: 1, sev: 'high', type: 'Modo verbal', old: 'tendría', new: 'tuviera',
    where: 'oración condicional · §3',
    note: 'Tras «si» para una hipótesis se usa el imperfecto de subjuntivo, no el condicional: «Si tuviera la oportunidad, elegiría…».' },
  { n: 2, sev: 'med', type: 'Colocación', old: 'el transporte', new: 'los desplazamientos',
    where: 'naturalidad · §1',
    note: '«Perder tiempo en los desplazamientos» es la colocación habitual en registro formal; «el transporte» suena algo literal.' },
  { n: 3, sev: 'low', type: 'Ortografía', old: 'mas', new: 'más',
    where: 'tilde · §4',
    note: '«más» (cantidad) lleva tilde. Sin tilde, «mas» es una conjunción equivalente a «pero».' },
];

// ─── Improved version (corrections + enhancements) ─────────────
// segments: { t } plain · { up: 'text' } enhancement/upgrade highlight
FW.improved = [
  [
    { t: 'En mi opinión, el ' }, { up: 'teletrabajo' }, { t: ' ofrece más ventajas que inconvenientes. Si las empresas confiaran más en sus empleados, muchas personas serían ' }, { up: 'considerablemente' }, { t: ' más productivas en casa. Además, se ahorra mucho tiempo que antes se perdía en ' }, { up: 'los desplazamientos' }, { t: '.' },
  ],
  [
    { t: 'Sin embargo, hay quien ' }, { up: 'sostiene' }, { t: ' que trabajar desde casa ' }, { up: 'genera' }, { t: ' aislamiento. Es cierto que algunos trabajadores se sienten solos; ' }, { up: 'no obstante' }, { t: ', si se ' }, { up: 'organizaran' }, { t: ' reuniones ' }, { up: 'periódicas' }, { t: ', este problema se ' }, { up: 'resolvería' }, { t: ' con facilidad.' },
  ],
  [
    { t: 'Por otro lado, el teletrabajo permite conciliar mejor la vida laboral y personal. Si yo ' }, { up: 'tuviera' }, { t: ' la oportunidad, elegiría un modelo híbrido, porque combina lo mejor de ' }, { up: 'ambos mundos' }, { t: '.' },
  ],
  [
    { t: 'En conclusión, aunque el trabajo remoto ' }, { up: 'plantea' }, { t: ' algunos desafíos, ' }, { up: 'considero' }, { t: ' que sus beneficios son más importantes.' },
  ],
];
FW.improvedWordCount = 168;

// ─── Grading: 4 IELTS-style criteria, each 0–1 + CEFR estimate ──
FW.result = {
  overallCefr: 'B2',
  headline: 'Persuasivo y bien organizado — la gramática lo frena.',
  summary: 'Cumples la consigna con una postura clara, un contraargumento rebatido y la longitud correcta. La cohesión es tu punto fuerte. El único fallo serio es el modo verbal en la oración condicional.',
  gradedMs: 1400,
  cost: '$0.011',
  criteria: [
    { id: 'task', label: 'Task achievement',            score: 0.85, cefr: 'B2', note: 'Postura clara, contraargumento rebatido y los tres elementos obligatorios presentes. 162 palabras, dentro del rango.' },
    { id: 'coh',  label: 'Coherence & cohesion',         score: 0.90, cefr: 'C1', note: 'Cuatro párrafos bien delimitados (tesis · concesión · desarrollo · cierre). Conectores variados y bien colocados.' },
    { id: 'lex',  label: 'Lexical resource',             score: 0.75, cefr: 'B2', note: 'Vocabulario adecuado al tema. Alguna repetición de «trabajo a distancia» y una colocación poco natural.' },
    { id: 'gram', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1+', note: 'Buen repertorio (condicionales, subjuntivo, pasiva refleja), pero el error de modo en la oración con «si» pesa en la precisión.' },
  ],
};

// ─── Drill hub: drill types (free writing is the new one) ──────
FW.drills = [
  { id: 'cloze',     name: 'Gap-fill in context', skill: 'grammar',  desc: 'Rellena la forma que falta en una frase tuya.', icon: 'cloze' },
  { id: 'conjug',    name: 'Conjugation sprint',  skill: 'grammar',  desc: 'Conjuga contra el reloj por tiempo y modo.',    icon: 'conjug' },
  { id: 'listen',    name: 'Dictation',           skill: 'listen',   desc: 'Escribe lo que oyes, frase a frase.',           icon: 'listen' },
  { id: 'freewrite', name: 'Free writing',        skill: 'writing',  desc: 'Redacta con consigna y restricciones; corrección IELTS de Claude.', icon: 'write', feature: true },
  { id: 'read',      name: 'Close reading',       skill: 'reading',  desc: 'Lee un pasaje y responde para comprobar comprensión.', icon: 'read', soon: true },
  { id: 'speak',     name: 'Shadowing',           skill: 'speaking', desc: 'Repite en voz alta y compara tu pronunciación.', icon: 'speak', soon: true },
];

Object.assign(window, { FW: window.FW });
