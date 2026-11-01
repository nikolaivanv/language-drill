# Theory audit — DE A2 (31 pages, production, auto-approved)

Book = Durrell, Hammer's German Grammar and Usage (md mirror).

## de-a2-adjective-declension-indefinite

- **Severity**: error
- **Confidence**: high
- **Location**: formation callout "Rule of thumb: Ask whether the ein-word itself already shows a gender ending. If yes → adjective takes ==-en==." and pitfalls callout "look at the ein-word. Does it end in `-e, -en, -em, -er, -es`? If yes, the adjective takes ==-en==."
- **Problem**: Both self-checks give wrong answers. (1) *eine* ends in -e, yet feminine nom/acc takes -e (*eine neue Lampe*), which the page's own table shows; the check yields *\*eine neuen Lampe*. (2) *unser* / *euer* end in -er in their endingless nom. masc. / nom.-acc. neuter forms, so the "ends in -er" check yields *\*unser alten Tisch* instead of *unser alter Tisch*, *\*unser kleinen Kind* instead of *unser kleines Kind*. Correct rule: the adjective takes the strong ending when the ein-word has **no inflectional ending** (ein, kein, mein, unser...). It takes -e after *eine* (fem. nom./acc.) and -en in every other inflected slot.
- **Source**: §6.1.3(b)/(c)(ii), Table 6.5; §6.1.3 example "unser klein**es** Kind"

- **Severity**: misleading
- **Confidence**: high
- **Location**: common pitfalls: "Adjectives ending in -el or -er drop the stem -e- when inflected. Write ==ein dunkles Zimmer== ... and ==ein teures Auto=="
- **Problem**: This holds for -el adjectives always, but for -er adjectives only after -au-/-eu- (teuer, sauer) and in foreign words (makaber). Other -er adjectives normally keep the -e- in writing: *ein munterer*, *ein bitterer*, *ein sauberes Hemd*, *ein heiteres Wetter*. Stated as a blanket rule, it produces *\*ein saubres Zimmer*.
- **Source**: §6.1.5(a)(i),(iii)

## de-a2-akkusativ-prepositions

- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "**bis** — ... Note: `bis` is often used without an article, especially with place names and bare time expressions." (bis is also listed among the six "core accusative-only prepositions" whose masculine article becomes *den*)
- **Problem**: *bis* is **never** followed by an article or determiner. It stands alone only before names, adverbs and some time phrases (*bis Frankfurt*, *bis Montag*, *bis nächsten Montag*). Before an article, a second preposition is required, and that preposition sets the case: *bis zum Bahnhof*, *bis an die Tür*. Saying "often" without an article implies *\*bis den Bahnhof* is possible.
- **Source**: §18.1.1

## de-a2-comparison

- **Severity**: error
- **Confidence**: high
- **Location**: formation: "Adjectives whose stem ends in _-t, -d, -s, -z, -ß_ insert an extra _-e-_ before _-sten_" vs the table row "groß | größer | am größten"
- **Problem**: The rule and the table contradict each other. *groß* ends in -ß but has the irregular superlative *größt-* (am größten, not *\*am größesten*). The rule needs *groß* named as an exception. Also, -d/-t adds -est only "mostly": present-participle adjectives such as *bedeutend* take *-st*.
- **Source**: §6.5.1 (groß/hoch/nah irregular; "-ß ... always -est" is the general rule apart from groß)

## de-a2-dass-clauses

- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "A quick test: if you can replace the word with «welches», it is the article/pronoun; if not, it is the conjunction and needs double-s."
- **Problem**: *welches* only replaces the **relative pronoun** *das*. It does not replace the article: in *Ich lese das Buch*, you cannot swap in *welches* and keep a statement. So a learner applying the test to the article reaches "conjunction" and writes *\*dass Buch*. The usual test is *dieses/jenes/welches* (article or demonstrative → *dieses*, relative → *welches*). If none of these fits, it is *dass*.
- **Source**: expert knowledge

## de-a2-dativ-prepositions

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls: "A common mistake is writing «mit den Bus» (accusative plural form used wrongly for a singular masculine noun)"
- **Problem**: *den* is not an accusative plural form; the accusative plural article is *die*. In *mit den Bus*, *den* is the **masculine accusative singular** (which is the point of a pitfall titled "Using accusative endings"). *den* is otherwise the **dative** plural.
- **Source**: §4.1.1 (article declension table)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "«Er arbeitet bei dem Bäcker.» (He works at the bakery.)" and "«Ich gehe zu dem Arzt.» (I am going to the doctor.)"
- **Problem**: In these neutral, non-emphatic sentences, German uses the contracted forms *beim Bäcker* / *zum Arzt*. The page's own callout says the contractions are "standard and preferred". The uncontracted forms imply a stressed, demonstrative "that particular baker/doctor". Model sentences should be *Er arbeitet beim Bäcker*, *Ich gehe zum Arzt*.
- **Source**: §4.1.1(c)(i)

## de-a2-demonstratives-welch

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "In informal speech, _im selben Haus_ (in the same house) is also accepted." / formation: "_im selben_ (contracted, informal)" / pitfalls: "_im selben_ ... is acceptable in informal use"
- **Problem**: *im selben*, *am selben Tag* and *zur selben Zeit* are fully standard in writing, not informal. Hammer cites *Sie wohnt im selben Haus* as normal usage and notes that *derselbe*, unlike *derjenige*, can take a contracted preposition. Labelling it informal would push learners toward the stiffer *in demselben*.
- **Source**: §5.1.5

## de-a2-destination-prepositions

- **Severity**: error
- **Confidence**: high
- **Location**: what is it: "Each triggers a specific set of nouns and, where an article is present, requires the accusative case." / formation: "When the preposition is followed by a definite article, the article takes the **accusative** form." (table directly below: "zu | dem | zum", "zu | der | zur")
- **Problem**: *zu* always governs the **dative**: *zum* = zu + **dem**, *zur* = zu + **der*, as the page's own table shows. The same applies to *nach* (dative), which the page discusses with an article (*\*nach dem Arzt*). Only *in*, *an* and *auf* take the accusative here, as two-way prepositions expressing direction.
- **Source**: §18 (zu, nach = dative prepositions); §4.1.1(c)

- **Severity**: error
- **Confidence**: high
- **Location**: formation: "nach and auf do **not** contract with articles."
- **Problem**: *auf + das = aufs* is a standard contraction: *aufs Land fahren*, *aufs Dach*. It is common in speech and used in writing in set phrases. Only the statement about *nach* is true.
- **Source**: §4.1.1(c)(ii)

## de-a2-indefinite-pronouns-basic

- **Severity**: misleading
- **Confidence**: high
- **Location**: formation: "**etwas**, **nichts**, **alles**, and **alle** do not change their form across cases at A2 level."
- **Problem**: *etwas* and *nichts* are invariable, but *alle* and *alles* decline: the dative plural is *allen* (*Ich habe mit allen gesprochen*) and the dative of *alles* is *allem* (*mit allem*, *trotz allem*). These are everyday A2 phrases. The claim produces *\*mit alle*.
- **Source**: §5.5.1

## de-a2-nicht-sondern

- **Severity**: misleading
- **Confidence**: medium
- **Location**: callout: "Quick test: can you remove the negation and still have a meaningful, true first clause? If yes, use **aber**. If the negation is essential because you are replacing the negated element, use **sondern**."
- **Problem**: The test fails on the page's own aber example. In *Er arbeitet nicht gern, aber er macht es*, removing the negation gives *Er arbeitet gern*, which is not true, so the test predicts *sondern*. The page's later warn callout states the real criterion: does the second part **replace the negated element** (sondern), or contrast with the whole clause (aber)? The quick test contradicts it.
- **Source**: expert knowledge

## de-a2-past-participle-formation

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls: "Inseparable prefixes (be-, er-, ver-, zer-, ent-, emp-, ge-…) already carry the stress; ge- is not added."
- **Problem**: The reverse is true. Inseparable prefixes are **unstressed**; the stress falls on the stem (be-SU-chen, ver-STEH-en). The rule is that verbs **not stressed on the first syllable** take no ge-, which is the same reason -ieren verbs lack it (the page states that part correctly). Separable prefixes are the stressed ones.
- **Source**: §10.2.1 ("verbs which are not stressed on the first syllable have no prefix ... (i) Verbs with inseparable prefixes")

- **Severity**: error
- **Confidence**: medium
- **Location**: formation table: "weak, stem ends in -t/-d or consonant cluster | ge- + stem + -et | arbeiten | gearbeitet"
- **Problem**: "consonant cluster" is far too broad. The linking -e- is added only after -t/-d, or after -m/-n preceded by a consonant other than l/r (*geöffnet*, *geregnet*, *geatmet*). Most verbs with a cluster take plain -t: *gelernt*, *gewünscht*, *gekämpft*, *gefilmt*, *gewohnt*. As stated, the rule produces *\*gelernet*.
- **Source**: §10.2.1(a), incl. (iii) "Verbs with l or r before m or n have no linking -e-"

## de-a2-perfekt-with-haben

- **Severity**: error
- **Confidence**: high
- **Location**: examples in context: "Habt ihr das Film gesehen? | Did you (all) see the film?"
- **Problem**: *Film* is masculine, so the accusative is *den Film*. The model sentence is ungrammatical. It should read *Habt ihr den Film gesehen?*
- **Source**: expert knowledge (der Film)

## de-a2-perfekt-with-sein

- **Severity**: misleading
- **Confidence**: medium
- **Location**: callout: "A quick test: if you can ask «Wohin?» (where to?) or «Woher?» (where from?) about the action, the verb almost certainly takes **sein**."
- **Problem**: Many high-frequency A2 transitive verbs of placing or sending answer *Wohin?* but take *haben*: *Wohin hast du das Buch gelegt / gestellt / gebracht / geschickt / gehängt?* This is the very set of verbs learners meet with two-way prepositions. The test only works for **intransitive** verbs, where the subject itself moves.
- **Source**: §12.3 (haben/sein: sein with intransitive verbs of motion); expert knowledge

## de-a2-praeteritum-modals

- **Severity**: error
- **Confidence**: high
- **Location**: formation: "Take the infinitive stem, drop any umlaut, add **-te-**" (and what is it: "Each modal drops the umlaut ... and adds a **-te-** stem") vs the table row "mögen | moch-te- | mochte"
- **Problem**: The rule gives *\*mogte* for *mögen*. *mögen* also changes its consonant (g → ch): *mochte*. The table shows *mochte*, so prose and table contradict each other. The rule needs *mögen* named as an exception.
- **Source**: §10 (modal conjugation); §15.4.1

- **Severity**: error
- **Confidence**: medium
- **Location**: when to use it: "**Describing past wishes or intentions** — use ==wollte== or ==mochte==: «Er wollte nach Hause gehen.»"
- **Problem**: *mochte* is the past of *mögen* in the sense of "liked" (*Ich mochte ihn*). It is not the past of the wish form *möchte*. With an infinitive it is used only in the negative (*Er mochte nicht allein stehen*). The past of "would like to / want to" is *wollte*. Presented as a synonym of *wollte*, it invites *\*Er mochte nach Hause gehen* for "He wanted to go home".
- **Source**: §15.4.1(b)(ii); §15.4.1 (past of möchte → wollte / hätte gern)

## de-a2-quantifiers-other

- **Severity**: error
- **Confidence**: high
- **Location**: callout: "When **ander-** follows _etwas_ or _nichts_, it is written with a capital letter and takes the neuter ending: ==etwas anderes== (something else), ==nichts anderes== (nothing else)."
- **Problem**: The rule contradicts its own examples, which are lowercase. In current spelling *ander* stays lowercase in most contexts, including *etwas anderes* and *nichts anderes*. A capital is optional only when it refers to something specific.
- **Source**: §21.2 ("ander, beide and ein have small letters in most contexts ... etwas anderes")

## de-a2-reflexive-verbs

- **Severity**: error
- **Confidence**: high
- **Location**: formation callout: "Only the first and second person singular have unique reflexive pronouns (==mich==, ==dich==). All other persons use forms identical to the personal pronouns (==sich, uns, euch, sich==)."
- **Problem**: This is backwards. *mich*, *dich*, *uns* and *euch* **are** the ordinary personal pronouns. The only distinct reflexive form is *sich* (3rd person and Sie), which differs from *ihn/sie/es/ihm/ihr/Ihnen*. A learner trusting this callout gets nothing useful about *sich*.
- **Source**: §3.2.1, Table 3.2

- **Severity**: error
- **Confidence**: high
- **Location**: when to use it: "**Obligatorily reflexive verbs.** A small set of verbs must always carry the reflexive pronoun. Without it the sentence is ungrammatical. Examples: _sich freuen_ ..., _sich beeilen_ ..., _sich treffen_ (to meet)."
- **Problem**: *treffen* is not obligatorily reflexive. *Ich treffe meinen Freund* ("I meet my friend") is standard and very common. *sich treffen* is the reciprocal "meet each other", which the page itself uses as its reciprocal example (*Wir treffen uns*).
- **Source**: expert knowledge; §3.2.3 (reciprocal sich)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation: "place the reflexive pronoun **directly after the finite verb** in a main clause"
- **Problem**: This is true only when the subject comes first. With inversion, a pronoun subject comes between the verb and *sich*. The page's own example *Heute duscht er sich* contradicts "directly after". With a noun subject, *sich* usually comes **before** the subject: *Heute freut sich mein Bruder*, *Morgen trifft sich die Gruppe*.
- **Source**: §19 (position of reflexive pronoun); expert knowledge

## de-a2-relative-clauses-nom-acc

- **Severity**: error
- **Confidence**: high
- **Location**: formation: "The relative pronouns for nominative and accusative are identical to the definite article for most forms. The only difference appears in the masculine accusative, which is ==den== (not _der_)."
- **Problem**: There is no difference from the article. The masculine accusative definite article is also *den*, so nominative and accusative relative pronouns are identical to the definite article in **all** forms. Divergences such as *dessen*, *deren* and *denen* exist only in the genitive and dative. The sentence confuses "differs from the nominative" with "differs from the article".
- **Source**: §5.4.1

## de-a2-seit-present

- **Severity**: misleading
- **Confidence**: high
- **Location**: what is it: "Negated or completed events use the Perfekt instead." / when to use it: "**Negated or completed events** — when the situation is _not_ ongoing (e.g. «I haven't seen him for years»), use the **Perfekt** with seit"
- **Problem**: Negation alone does not trigger the Perfekt. If the negated state continues up to now, the present is used: *Seit Weihnachten arbeitet er nicht mehr*, *Ich rauche seit zwei Jahren nicht mehr*. The Perfekt is used for non-occurrence of a (repeatable) event: *Ich habe ihn seit Jahren nicht gesehen*. As stated, the rule produces *\*Ich habe seit zwei Jahren nicht mehr geraucht* for an ongoing abstention.
- **Source**: §12.1.2(b)(i)

## de-a2-weil-deshalb

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "**weil** — use this when you want to state the result first and then give the reason." / callout: "**Direction matters.** With _weil_ and _denn_, the result comes first and the reason follows."
- **Problem**: This is true for *denn*, which must follow the main clause. A *weil*-clause can freely come first: *Weil ich krank bin, bleibe ich zu Hause*. That order is common and is a key verb-second pattern (verb–verb at the clause boundary). Telling learners *weil* fixes the order "result first" both misstates *weil* and hides the main difference from *denn*.
- **Source**: §17 (subordinate clause position); expert knowledge

## de-a2-wissen-kennen

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls: "wissen cannot take a bare noun phrase as its direct object. ... The only noun-like objects wissen accepts are pronouns such as es or das that stand in for a whole clause." (also what is it: "it almost always introduces a subordinate clause")
- **Problem**: *wissen* routinely takes noun-phrase objects that denote information: *Ich weiß die Antwort*, *Weißt du seine Telefonnummer / die Adresse / den Weg / ihren Namen?* It also takes *etwas*, *nichts*, *alles* and *viel* (*Ich weiß nichts davon*). The real contrast is information (*wissen*) vs acquaintance (*kennen*), not clause vs noun phrase. *\*Ich weiß den Film* is wrong because of meaning, not syntax. Learners following this rule would reject *Ich weiß die Antwort* in favour of the wrong *\*Ich kenne die Antwort*.
- **Source**: expert knowledge

---

**Clean pages (no findings):** de-a2-adjective-declension-definite, de-a2-adjective-declension-zero, de-a2-dative-accusative-objects, de-a2-indirect-questions, de-a2-konjunktiv-ii-polite, de-a2-lassen, de-a2-measure-expressions, de-a2-passive-present, de-a2-separable-prefix-verbs, de-a2-two-way-prepositions-core, de-a2-verb-preposition-complements, de-a2-wenn-als

Note (not a factual finding): de-a2-wenn-als callout text is truncated or malformed ("If you can only say "at the time when (once)**als**."), and de-a2-wissen-kennen what-is-it has a similar broken quote ("where English uses "to know**wissen**"). These look like rendering or markup defects worth a glance.
