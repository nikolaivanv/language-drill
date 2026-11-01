# DE curriculum fixes (`packages/db/src/curriculum/de.ts`)

26 points changed, 40 edits, 1 item skipped. No keys or constructionVariants ids renamed; CURRICULUM_VERSION_DE not bumped.
"Durrell" = Hammer's German Grammar and Usage (the md mirror).

## A1

### de-a1-noun-gender
- commonError: "Ignoring suffix-based gender rules for -ung, -heit, -keit (all feminine)." → "…for the derivational suffixes -ung, -heit, -keit (all feminine: die Zeitung; not suffixless nouns like der Sprung)." — Durrell §1.1.1 (Table 1.2), §1.1.2a (der Sprung is a suffixless strong-verb noun, so it is masculine).

### de-a1-plural-formation
- commonError "…because a number word is present ("*drei Buch")." → added "; masculine/neuter measure nouns are the exception (zwei Euro, drei Kilo, zwei Glas Bier)." — Durrell §1.2.x measure nouns (zwei Glas Bier, zwei Pfund, drei Stück).

### de-a1-modal-verbs-present
- Removed commonError "Adding können to sensation verbs … not "*Ich kann das Meer sehen"". *können* + *sehen/hören* is ordinary standard German. Durrell ch. 15 uses können + sehen freely (e.g. §15.x "Sie kann das Auto … gesehen haben"). 4 commonErrors remain.

### de-a1-imperative
- description: "(Geh!, Nimm!, Fahr! — …" → "(Geh!, Nimm!, Fahr!; -e obligatory after -t/-d, -ig or consonant + m/n: Arbeite!, Öffne! — …" — Durrell §10.2 (Table 10.5 and the linking -e- notes: "always have the ending -e in the imperative singular: arbeite!, finde!, warte!"; "-ig, and -m or -n after another consonant always keep the ending -e").

### de-a1-numbers-ordinals
- description: "year-reading (1998 = neunzehnhundertachtundneunzig)" → "…; from 2000: zweitausendeinundzwanzig)" — Durrell §8.x (years 1100–1999 in hundreds; years since the millennium with zweitausend, 2021 = zweitausendeinundzwanzig).
- commonError: "…standard "der siebte", not "*der siebente")" → "…"der siebte" is standard; "der siebente" is a less frequent variant, not an error)" — Durrell §8.x ordinals ("the alternative regular form das siebente is less frequent, but it is often used in eastern Germany and Austria").
- commonError: "Reading years with tausend by English interference — 1998 is …" → "Reading years 1100–1999 with tausend … (years from 2000 do use zweitausend)." — same §.
- seed comment: "Year-reading: hundred-based, not tausend." → "hundred-based for 1100–1999, zweitausend from 2000." (it was inconsistent with the seed zweitausendsechsundzwanzig).

### de-a1-praeteritum-sein-haben
- description: "the standard way to talk about past states even in speech, where most other verbs use the Perfekt:" → "much more common in speech than the Präteritum of most other verbs (the Perfekt ist gewesen / hat gehabt is also natural, esp. in the south):" — Durrell §12.x past vs perfect in speech ("Vorige Woche war ich in Bremen | … bin ich in Bremen gewesen" are "equally frequent" in North German speech; the past tense is rare in southern speech).
- Removed commonError "Using the wordy Perfekt "ist gewesen / hat gehabt" where war/hatte is the idiomatic choice." — same §. 2 commonErrors remain.

### de-a1-temporal-prepositions
- examplesNegative: "*Wir bleiben für den ganzen Tag zu Hause." → "*Wir fahren um Montag nach Berlin." (the für sentence is grammatical; the replacement is a real error that the existing "um for days" commonError already covers).
- Removed commonError "Inserting für into bare accusative duration phrases ("*für den ganzen Tag bleiben" …)". It also contradicted the entry's own `fuer-accusative-duration` variant. 3 commonErrors remain. No Durrell § says the für form is wrong; ch. 18 für + duration.

## A2

### de-a2-adjective-declension-indefinite
- commonError: "Keeping the stem -e- of -el/-er adjectives when inflected (…)" → "Keeping the stem -e- of -el adjectives, or of -er adjectives after au/eu, when inflected (…); other -er adjectives usually keep it in writing (ein sauberes Zimmer)." — Durrell §6.x (iii) ("Foreign adjectives and those with -au- or -eu- before the -er always drop the -e-: teuren, saure … Other adjectives in -er most often keep the -e- in written German").

### de-a2-akkusativ-prepositions
- description: appended "; bis stands alone only before names and time phrases (bis Montag, bis nächsten Montag) — before an article it needs a second preposition (bis zum Bahnhof)." — Durrell §18.x bis (i)/(ii) ("If the following noun has an article, an appropriate preposition must follow"; bis Montag, den 5. September).

### de-a2-reflexive-verbs (covers both audit items)
- description: "(sich freuen, sich duschen, sich treffen): …; the pronoun follows the finite verb in main clauses." → "(sich freuen, sich duschen, sich beeilen): …; the pronoun follows the finite verb in main clauses (after a pronoun subject: Heute duscht er sich; before a noun one: Heute freut sich mein Bruder)." — Durrell §16.x reflexive verbs (sich beeilen is the model obligatory reflexive; treffen is transitive). The reciprocal "Wir treffen uns" example stays. Position: Durrell §19.4.1d ("immediately after the finite verb … and after a pronoun in the nominative, if there is one").

### de-a2-praeteritum-modals
- description: "umlaut dropped, -te- endings" → "umlaut dropped (mögen also g → ch: mochte), -te- endings" — Durrell §10.x / ch. 15 (mochte).

### de-a2-konjunktiv-ii-polite (curriculum-only item 1)
- commonError: "Doubling würde with a modal ("*Würdest du mir helfen können?" for a simple request)." → "Stacking würde onto a modal (Würdest du mir helfen können?) for a simple request — grammatical but wordier; the plain Konjunktiv II modal (Könntest du mir helfen?) is preferred." — Durrell §14.2.3b(ii) ("with the modal auxiliaries … the simple forms könnte, müsste etc. are preferred"). That is a preference, not ungrammaticality, so the star is gone and the preference stays.

### de-a2-seit-present (audit item + curriculum-only item 2)
- description: "negated or repeated events take the Perfekt instead (Ich habe ihn seit Jahren nicht gesehen)." → "the Perfekt is used when an event has not occurred (Ich habe ihn seit Jahren nicht gesehen) or for a series of separate occurrences (Er ist seit Mai oft krank gewesen); a continuing negated state or habit stays present (Ich rauche seit Mai nicht mehr)." — Durrell §12.1.2(b)(i)–(ii).
- variant `seit-perfekt-negated` directive: "for an event that is negated or otherwise not ongoing (…)" → "for a (repeatable) event that has not occurred, or a series of separate completed occurrences — not for a continuing negated state, which stays present (…)". Same §. The id is unchanged.

### de-a2-wissen-kennen
- description: "wissen = to know facts, takes a clause (Ich weiß, wo er wohnt); kennen = to be familiar with, takes a noun phrase (Ich kenne den Film);" → "wissen = to know facts/information, takes a clause or a noun phrase denoting a fact (Ich weiß, wo er wohnt; Ich weiß die Antwort); kennen = to be familiar/acquainted with a person, place or thing (Ich kenne den Film);" — Durrell §13.1.2b lists wissen among transitive verbs; §8.x "Er weiß alles nur halb".
- commonError: "Using wissen with a plain noun phrase ("*Ich weiß den Film")." → "Using wissen for acquaintance with a person, place or thing ("*Ich weiß den Film" instead of "Ich kenne den Film")." The negative example *Ich weiß diesen Film stays (it is genuinely wrong).

## B1

### de-b1-dass-clause-perfekt
- description: appended "(exception: with a modal/lassen Perfekt the auxiliary precedes the double infinitive — dass sie es hat machen müssen; see de-b2-modal-perfect-word-order)" — Durrell §19.1.3b ("If there are two infinitives at the end of the clause, the finite verb comes before both").

### de-b1-genitive
- description: "(der Titel des Buches)" → "(der Titel des Buches; weak masculines -(e)n: des Studenten)" — Durrell §1.3.2. (des Namens/des Herzens was dropped to stay under 450 chars.)

### de-b1-articles-use
- description: "(Die Geduld ist eine Tugend — but partial: Er hat Geduld), with feminine/masculine/plural country names (die Schweiz, der Iran, die Niederlande);" → "(Die Zeit vergeht schnell; optional, none in proverbs: Geduld ist eine Tugend), with feminine/plural country names (die Schweiz, die Niederlande; optional: (der) Iran);" — Durrell §4.2.1b–c (abstract nouns in general statements take the article or none; no article in proverbs, e.g. "Stolz ist keine Tugend") and §4.4.1a (masculine country names: article "usual, but optional", (der) Iran). The "partial: Er hat Geduld" aside was dropped for length.
- variant `definite-article-gendered-country-name` directive: "required by a feminine, masculine or plural COUNTRY name (…; im Iran)" → "required by a feminine or plural COUNTRY name (Sie kommt aus der Schweiz; in den Niederlanden; in der Türkei)". Same §. The id is unchanged.

## B2

### de-b2-dass-equivalents
- description: "zu-infinitive when the subjects are identical (…)" → "zu-infinitive when its understood subject is the main-clause subject or object (…; Ich bitte dich, früher zu kommen)" — Durrell §11.2.3a (Christian bat Ellen ihn mitzunehmen).
- variant `obligatory-correlate-darauf-damit` directive: example "(Wir freuen uns darauf, dass ihr uns besucht)" → "(Ich verlasse mich darauf, dass ihr pünktlich kommt) — not a verb where it is optional, like sich freuen or aufpassen" — Durrell §16.5.14 (sich verlassen darauf as an anticipated object; sich freuen auf/über and aufpassen auf are in the list of verbs where the correlate "is often left out"). The id is unchanged.
- commonError: "Dropping an obligatory correlate ("Wir freuen uns darauf, dass …" — some verbs require …)." → "…("Ich verlasse mich darauf, dass …" — some verbs require da(r)+preposition; with sich freuen, hoffen, aufpassen it is optional)." Same §.
- commonError: "Using the zu-infinitive when the subjects differ." → "Using the zu-infinitive when its subject is neither the main-clause subject nor its object ("*Ich hoffe, ihn morgen zu kommen" for "Ich hoffe, dass er morgen kommt")." — Durrell §11.2.3a.
- Kept: the examplesPositive "Wir freuen uns darauf, dass ihr uns besucht." It is correct, because the correlate is never wrong (§16.5.14).

### de-b2-relatives-advanced
- Removed commonError "Inserting an unneeded resumptive der after wer when cases match ("Wer zu spät kommt, muss …" needs no der)." — Durrell §5.4.5a treats the correlative as an optional addition and does not call it wrong. The replacement the audit suggested ("required when the cases differ") is contradicted by Durrell's own example *Wen es zum Lehrerberuf hinzieht, bevorzugt …*, so I deleted the item instead of replacing it. 2 commonErrors remain.

### de-b2-fixed-prepositions
- commonError: "Dropping the da(r)-correlate before a dass-clause where the noun/adjective requires it." → appended " (with many adjectives it is optional: Ich bin (daran) gewöhnt, früh aufzustehen)" — Durrell §6.4.1c.

### de-b2-indefinite-pronouns
- commonError: "Missing welche as the partitive pronoun for mass nouns." → "Missing welch- as the partitive pronoun for mass nouns, or not agreeing it in gender (Käse → welchen, Milch → welche, Brot → welches)." — Durrell §5.5.26 ("Hast du Käse? Ja, ich habe welchen"; dieser endings).

### de-b2-mittelfeld-word-order
- description: "then noun phrases; adverbials default to temporal–causal–modal–local (TeKaMoLo); nicht stands before the element it negates, otherwise late;" → "then noun phrases (adverbials usually after a dative object, before a new accusative one) and TeKaMoLo order; nicht stands before the element it negates, otherwise late but before manner adverbials and verb complements (Er fährt nicht nach Berlin);" — Durrell §19.5.1 ("adverbials typically come after the noun subject and the dative object, but before the accusative object") and §19.6a(ii)–(iii). TeKaMoLo is now named without being spelled out, to fit the 450-char limit.
- variant `nicht-placement` directive: added ", though still before manner adverbials and verb complements (…; Ich warte nicht auf ihn; …)". — Durrell §19.6a(iii) (nicht precedes prepositional objects). The id is unchanged.

### de-b2-modal-particles-advanced
- commonError: "Confusing warning bloß with plain nur." → "Using bloß for the reassuring sense of nur ("Kommen Sie nur herein!") — bloß always warns; in warnings both work, bloß slightly more emphatic." — Durrell §9.1.25 ("bloß is slightly more emphatic than nur … bloß is not used in this 'reassuring' sense, and commands with bloß always have a 'warning' tone") and §9.1.5.

### de-b2-passive-alternatives
- commonError: "Reading sein + zu as ability only ("ist einzureichen" usually = must be handed in)." → "Reading sein + zu as ability only — it can express necessity ("ist bis Freitag einzureichen" = must be handed in) as well as possibility ("Er ist nicht zu erreichen")." — Durrell §13.4.5a ("has the sense of können, müssen or sollen").

### de-b2-verb-prefixes
- description: "variable prefixes (um-, über-, durch-, unter-) split literal-separable vs figurative-inseparable readings, with distinct participles" → "variable prefixes (um-, über-, durch-, unter-): separable = prefix's own sense, inseparable often figurative/encircling; distinct participles". Also "error or change" → "error/change" for length. — Durrell §20.7.1 (durch- means "through" either way), §20.7.6a–c (separable um- = turning/changing; inseparable = encirclement, including the literal umfahren "travel round" and umarmen).
- variant `variable-prefix-separable-literal` directive: "used SEPARABLY with its literal reading" → "used SEPARABLY (stressed prefix, with its own adverbial sense: turning over, through, over, under)". The id is unchanged.
- variant `variable-prefix-inseparable-figurative` directive: "used INSEPARABLY with its figurative reading" → "used INSEPARABLY (unstressed, with a lexicalized meaning — often figurative, or encircling/covering as with um-)". The id is unchanged. Durrell §20.7 (stress) and §20.7.6.

### de-b2-word-formation
- commonError: "("*Freundlichheit" — adjectives in -lich/-ig take -keit)" → "("*Freundlichheit" — adjectives in -lich/-ig/-bar/-sam and most in -el/-er take -keit; -haft/-los take -igkeit)" — Durrell §20.2.1.

## Skipped

- **de-b2-word-formation, "Confusing -lich and -ig pairs with distinct meanings" (partial, weak).** The statement is vague but not false. Durrell's mirror has no -lich/-ig minimal-pair discussion (no hit for geistig/geistlich, zeitig/zeitlich), so I could not check the pairs the audit suggests against the reference. Left as is.

## Notes

- Not touched, per the worklist: page-only rows, and the A2 "*Ich gebe das Buch meinem Bruder gern." star, which the worklist itself calls defensible (Durrell §19.4.2).
- `pnpm --filter @language-drill/db exec vitest run src/curriculum`: 3 files, 144/144 passed. An earlier run failed only on `tr-a1-beri-dir` (tr.ts, another agent's edit); the TR agent has since fixed that. Run separately, the DE subset passes every per-entry invariant.
