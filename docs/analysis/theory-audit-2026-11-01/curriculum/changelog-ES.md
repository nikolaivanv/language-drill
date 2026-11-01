# ES curriculum fixes (`packages/db/src/curriculum/es.ts`)

Each edit was checked against Butt & Benjamin (B&B) before it was made. Nothing is committed and CURRICULUM_VERSION_ES has not been bumped.
Tests: `vitest run src/curriculum` passed 144/144. While I worked, a too-long description (451 chars) made the run fail once; I trimmed it and the rerun is clean.

**Totals:** 34 points changed (covering 38 of the 40 inherited/partial rows plus both curriculum-only items), 58 edits, 3 audit rows skipped (one of them already covered by another fix).

## A1

### es-a1-articles
- desc: "the article required before the subject of gustar" → "the definite article required before a generic noun as the subject of gustar (other determiners also work: me gusta tu casa)". B&B §3.2.6 note 2–3. The variant was left as it was (it only asks for definite-article instances, as the worklist said).

### es-a1-gustar-basic
- desc: "takes the definite article (Me gusta la paella)" → "and, as a generic noun, takes the definite article (Me gusta la paella); a possessive or demonstrative also works (Me gusta tu casa)". B&B §3.2.6.

### es-a1-negation-tampoco
- variant `pre-verb-negation-no` directive: "no placed immediately before the conjugated verb" → "no placed before the conjugated verb and any object or reflexive pronouns attached to it (… No lo sé)". B&B §27.2.1.
- desc: "no placed immediately before the verb" → "no placed before the verb and any object pronouns (No lo tengo; No me gusta)". B&B §27.2.1.
- commonErrors: added "Placing no between an object pronoun and the verb, e.g. *me no gusta / *lo no sé …". B&B §27.2.1.

### es-a1-noun-gender
- variant `gender-of-e-or-consonant-nouns`: example "la ciudad" → "la flor". B&B §1.3.7 (-dad is feminine by form).
- desc: "nouns in other vowels or consonants learned with their article, common exceptions (el problema, el día, la mano, la foto)" → "other vowel/consonant endings learned with the article (but -dad/-ción are feminine), common exceptions (el problema, el día, la mano)". B&B §1.3.7. "la foto" was dropped to stay under 450 chars; it is still in the exceptions variant.

### es-a1-noun-plural
- desc: "stressed -í/-ú usually take -es (jabalí → jabalíes)" → "stressed -í/-ú take formal -es or, usually, -s (jabalíes; menús)". "(el lunes / los lunes, la crisis / las crisis)" was shortened to "(los lunes, las crisis)" for length. B&B §2.1.3(c) "Nouns ending in -í, -ú or -á" (formal -es, speech -s; champús/menús/sofás always -s).

### es-a1-prepositions-a-en
- desc: added "— apart from a few fixed phrases with a (a la derecha, a la vuelta, sentado a la mesa) —". B&B §38.2.2.
- commonError: "Using a for a static location instead of en" → "Using a after estar/vivir + a place instead of en". B&B §38.2.2.

### es-a1-present-yo-go
- desc: "-zco forms of -cer/-cir verbs (conozco, agradezco, conduzco)" → "-zco forms of most vowel + -cer/-cir verbs (conozco, agradezco, conduzco; but venzo, cuezo)". B&B §16.11.10, §16.10.1.

### es-a1-relative-que-basic
- commonError (que is invariable): appended "(el/la que "the one who/that" is a separate, correct structure)". B&B ch. 40 (nominalizers).

### es-a1-ser-estar-basic
- desc: "estar for location" → "estar for the location of people and things (but events take ser: la fiesta es en mi casa)". B&B §33.2.5, §33.3.2.
- commonError: "Using ser for location" → "Using ser for the location of a person, object or place". B&B §33.2.5.

## A2

### es-a2-periphrases-obligation-aspect
- variant `hay-que-infinitive`: "hay never changes form (Hay que llegar temprano; Hay que reservar antes)" → "hay never changes for person, only for tense (Hay que llegar temprano; Había que reservar antes)". B&B §25.4.2.

### es-a2-indirect-object-pronouns-se
- variant `dative-of-possession` (id unchanged): "where se + a dative clitic replaces a possessive … in an involuntary event" → "where a dative clitic replaces a possessive on a body part or belonging — often with a pronominal verb (romperse, perderse) in an involuntary event, whose se is the verb's own, not le → se (Se le rompió…; Se me perdieron…; Le robaron la cartera)". B&B §9.3.4, §30.4.1.
- desc: "(Se le rompió el brazo)" → "(Le robaron la cartera; Se le rompió el brazo)". B&B §9.3.4.

### es-a2-estar-gerundio
- desc: "with stem changes like durmiendo/pidiendo" → "with -ir stem changes like durmiendo/pidiendo, plus poder → pudiendo,". B&B §16.11.34.

### es-a2-preterito-perfecto
- commonError: "Using the simple preterite (hice) instead of the perfect when …" → "In Peninsular Spanish, using … (most of Latin America uses the preterite here — ya llegó, hoy hice — and that is correct too)". B&B §18.2.1 note 2, §18.2.8.
- desc: appended "; Latin America mostly uses the preterite (ya llegó)". B&B §18.2.8.

### es-a2-si-present-conditional
- desc: "si is never followed by the future tense" → "\"if\" si never takes the future (\"whether\" si can: no sé si vendrá)". B&B §29.8.1 notes 2–3.
- variant `si-present-apodosis-future`: "never after si" → "never after conditional si". B&B §29.8.1.

### es-a2-comparatives-superlatives
- commonError: "Saying "más bueno" instead of the suppletive form "mejor"." → "… for quality ("better"); más bueno/más malo are correct only for moral character (es más bueno que el pan)". B&B §6.3.1 note 3.

## B1

### es-b1-deber-obligation-probability
- commonError: "Treating deber and deber de as freely interchangeable, blurring …" → "Over-correcting the distinction: plain deber for probability (debe ser tarde) is widespread and accepted, although deber de is preferred for conjecture — only deber de for obligation is non-standard." B&B §25.3.2 note 1 (NGLE 28.6k).
- commonError (curriculum-only item): "Using the plain present of deber for advice instead of … ('*debes hacer ejercicio' …)" → "Missing the register difference in advice: the conditional deberías softens it ("deberías hacer ejercicio"), while the plain present debes is a firmer, more direct recommendation ("debes hacer ejercicio")". The asterisk is gone. B&B §25.3.1 and note 3.

### es-b1-discourse-connectors
- commonError: "Using the subjunctive after aunque for a known, factual concession … ('*aunque llueva, salimos' …)" → "Missing the mood contrast after aunque: the indicative concedes a known fact (aunque llueve…), the subjunctive an unrealized one (aunque llueva = even if it rains); with a known fact the subjunctive is not wrong but discounts it (aunque sea tu padre, no tiene derecho)". The asterisk is gone. B&B §20.4.10 and note 1.

### es-b1-indirect-questions
- desc: the bare infinitive was attached only to wh-questions. It is restructured so that both si and wh-words take "a finite clause or, with same-subject reference, a bare infinitive (No sé si ir; No sé qué hacer, …)". B&B ch. 22 / the point's own variant `indirect-yn-si-infinitive`.

### es-b1-influence-verbs-infinitive
- desc: "with a dative clitic + infinitive" → "with an object clitic + infinitive", plus "With an intransitive infinitive dejar/hacer take lo/la (la hice bajar, lo dejaron ir), le/les when it has its own object (le dejaron comprar un helado)". B&B §15.6.5 note 2. No le for a feminine object was introduced.
- commonError: "Dropping the dative clitic … '*mis padres no dejan salir'" → "Dropping the clitic when a specific person is meant: "mis padres no dejan salir" makes the permission generic (nobody may go out), not "mis padres no me dejan salir"". The asterisk is gone. B&B §22.2.3 note 1.

### es-b1-llevar-time-expressions
- variant `past-tense-durante-period`: "Never llevar or hace…que here" → "Never llevar or hace…que + present here". B&B §36.4.
- desc: "llevar / hace…que only cover still-ongoing events" → "llevar / hace…que + present only cover still-ongoing events (with a preterite: "ago")". "its past-shifted form" became "its past form", and "varios años" became "años", for length. B&B §36.3.2, §36.4.
- commonError (tense pairs): scoped to "for an ongoing state", and appended "hace ... que + preterite is correct but means "ago" (hace un año que lo vi)". B&B §36.4.

### es-b1-present-subjunctive
- commonError: "Forgetting the stem changes that carry over from the present indicative." → "…, or the extra nosotros/vosotros change of -ir stem-changers, e→i and o→u (sintamos, pidamos, durmamos)". B&B §16.6.5, §16.6.7, §16.6.8.

### es-b1-reported-speech
- desc: "reported commands with que + present subjunctive (Dice que te sientes)" → "… (Dice que te sientes; after a past verb, imperfect: Dijo que te sentaras)". The example "; Pensé que estabas cansado" was dropped for length. B&B §20.8(a)/(e).

## B2

### es-b2-appreciative-suffixes (two audit rows plus the curriculum-only seed mismatch)
- desc: "with the -c-/-e- allomorph after words ending in -n/-r (mujercita) or -e/ie-ue (cochecito)" → "with the -c-/-ec- allomorph after polysyllables in -n/-r (mujercita), words in -e (cochecito), words with ie/ue in the first syllable (viejecito) and monosyllables (florecita, solecito) — Latin America often keeps plain -ito (puertita, viejito)". The rule now generates the seeds florecita, solecito, vocecita, pececito, barecito (monosyllables), puentecito, parquecito, pobrecito (-e), piedrecita, viejecito (ie/ue). cafecito is a B&B-listed special case. No seeds were removed. B&B §43.2.1 notes 1–2.
- commonError (*sillacita): "reserving it for words ending in -n/-r or in -e/ie-ue" → "reserving it for polysyllables in -n/-r, words in -e, words with ie/ue in the first syllable, and monosyllables". B&B §43.2.1.

### es-b2-causal-connectors
- commonError: "…enunciative use of porque …, and reaching for ya que instead in that context." → "… (Están en casa, porque veo luz), a slot ya que and puesto que also fill naturally (Están en casa, ya que hay luz)". B&B §37.5.2 (ya que/puesto que = "since/given that"; NGLE external causals).

### es-b2-cleft-sentences
- desc: "plain que alone in this slot is the classic anglophone error" → "Plain que alone after a person or thing focus is the classic anglophone error (*fue Juan que llamó); after a place, time or prepositional focus it is common informal Latin American usage (fue ahí que la vi), avoided in Spain and formal register." B&B §41.2 and notes (a)–(b).
- commonError: "in careful register ("*es con ella que tienes que hablar" …)" → "in Peninsular or careful register ("es con ella que tienes que hablar", informal Latin American usage, …)". The asterisk is gone. B&B §41.2(a). "*Fue Juan que llamó" stays starred (person focus).

### es-b2-complex-conditionals
- commonError: "Mixing tenses across the two clauses (e.g. simple conditional in the result clause)." → "Using the simple conditional in the result clause when the result is also past ("*si hubiera estudiado, aprobaría el examen el lunes pasado"); the simple conditional is correct only for a present result (si hubieras estudiado, ahora tendrías trabajo)". B&B §29.4 note 3.
- desc: appended "A present result takes the simple conditional (Si hubieras estudiado, ahora tendrías trabajo)." B&B §29.4 note 3.

### es-b2-correlative-comparison
- variant `cada-vez-mas`-type directive (id unchanged): "the only idiomatic rendering … — never *más y más" → "the usual idiomatic rendering … — do not use the less idiomatic más y más". B&B §6.12.
- desc: "— never *más y más." → "(más y más exists but is far less idiomatic)." B&B §6.12.
- examplesNegative: removed "*La ciudad está más y más cara." The remaining item is "*Más practicas, más aprendes."
- commonError: "as "*más y más" instead of "cada vez más"" → "as "más y más" — attested but far less idiomatic — instead of the usual "cada vez más"". B&B §6.12.

### es-b2-nosotros-imperative
- variant `vamonos-irregular`: "the only verb whose affirmative nosotros command is not the plain subjunctive" → "… is usually not the plain subjunctive, though vayamos also occurs, esp. in set phrases like vayamos al grano". B&B §21.5 note 1.

### es-b2-past-subjunctive
- desc: "Imperfect subjunctive (-ara/-iera)" → "Imperfect subjunctive in -ra (hablara/comiera) or the equivalent -se form (hablase/comiese), interchangeable except where -ra replaces the conditional,". B&B §16 / §20.1.3.

### es-b2-remote-conditionals (two audit rows)
- commonError (si + imperfect indicative): "— that pattern is only correct as a reported open condition in the past (…)" → "— si + imperfect indicative is fine for a past or habitual open condition (si llovía, nos quedábamos en casa), but with a conditional main clause only as a reported open condition (…)". B&B §29.2, §29.7.

### es-b2-reported-speech-backshift
- examplesNegative: removed "*Me pidió que la ayude con la mudanza." The remaining item is "*Dijo que vendrá a la fiesta."
- commonError: "Reporting a past command with the present subjunctive, producing "*me pidió que la ayude" …" → "Defaulting to the present subjunctive in a reported past command ("me pidió que la ayude") — the imperfect subjunctive "me pidió que la ayudara" is the default; the present is accepted only while the request still applies (common in the media and Latin America)". B&B §20.8(e) and note 4.

### es-b2-subjunctive-negated-opinion (two audit rows)
- variant `negated-verb-of-saying-past-subjunctive` directive: added "because its content is denied or doubted". B&B §20.3.15 note 2.
- desc: "and negated verbs of saying (No me dijo que hubiera venido)." → "and negated verbs of saying when the content is doubted (No me dijo que hubiera venido; indicative if taken as true: no me dijo que había venido). Negative orders and questions keep the indicative (No creas que es fácil; ¿No es verdad que lo ha dicho?)." B&B §20.3.15 notes 1–2, §20.3.16.
- commonError: "('*no me dijo que había venido' as a denial …)" → "Using the indicative when a negated assertion denies or doubts its content ("no me dijo que hubiera venido") — the indicative "no me dijo que había venido" is right only when the speaker takes the fact as true (he came but didn't tell me)". The asterisk is gone. B&B §20.3.15 note 2.

### es-b2-subjunctive-temporal-concessive
- desc: "por mucho/más que + subjunctive;" → "por mucho/más que + subjunctive (realized: indicative);". B&B §20.5.2.
- variant (por mucho/más que): added "about something not yet real". B&B §20.5.2.

### es-b2-verbs-of-change
- desc: "hacerse (voluntary lasting conversion)" → "hacerse (usually voluntary lasting conversion)". B&B §31.3.3.
- variant `hacerse-voluntary-conversion` (id unchanged): "a lasting conversion the subject brought about" → "a lasting conversion, typically one the subject brought about". B&B §31.3.3.
- commonError: "Using hacerse for an involuntary or unwanted change instead of volverse ("*se hizo loco" …)" → "Using hacerse where idiom requires volverse, as with loco ("*se hizo loco" …) — hacerse is not limited to voluntary changes (se hizo rico, se hace tarde), but loco takes volverse." B&B §31.3.3 notes 2–3.

## Skipped

1. **es-b2-perception-verbs — "ver/oír que + clause is not a neutral alternative" (inherited).** B&B contradicts the finding. §24.6 note 2 gives *oí entrar a alguien / oí que alguien entraba* as equivalent ('I heard someone come in'), and note 1 gives *lo vi venir / lo vi que venía*. The realize/hear-that reading exists too, but calling the que-clause a neutral alternative is supported by the book.
2. **es-b2-reported-speech-backshift — "dijo que llegó" called imprecise in careful style (inherited).** This is a defensible register simplification. B&B §18.3.1 note 1 calls the preterite-for-pluperfect colloquial ("especially in Latin America"), so "careful style wants había llegado" matches the book. The text is not starred.
3. **es-b2-remote-conditionals — the "quick rule" row (partial).** No separate edit was needed. It points at the same commonError, and the inherited fix above covers it.

## Observations outside the worklist (not changed)
- es-b1-reported-speech desc: "after a past one Spanish requires the shift even when the statement still holds". This is probably overstated (an unshifted present or future for still-valid content is common).
- es-b2-reported-speech-backshift: "*Dijo que vendrá a la fiesta" (examplesNegative plus the first commonError). This is acceptable when the event still lies in the future relative to now, the same defect class as the *me pidió que la ayude* item.
- es-b2-past-subjunctive commonError: "Using present subjunctive after a past-tense main verb" is overgeneral by B&B §20.8(e).
- es-b2-complex-conditionals: "never hubiese" in the result clause. This may be worth checking against §29.4 (B&B lists only habría/hubiera there, so it is probably fine).
