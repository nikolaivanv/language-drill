# DE theory-audit findings vs curriculum (`packages/db/src/curriculum/de.ts`, fresh main)

Verdicts: **inherited** = the curriculum states the same wrong claim; **partial** = the curriculum is overgeneral or vague in a way that plausibly seeded the error; **page-only** = the curriculum is fine on this point.

Totals: 83 findings. 12 inherited, 20 partial, 51 page-only.

## A1

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| de-a1-accusative | "noun itself does not change" (ignores weak masculines) | page-only | L588 talks about articles only | — |
| de-a1-dative | Eltern dative-plural note contradicts itself | page-only | L612 "+ -n on plural nouns unless the plural already ends in -n or -s" (correct) | — |
| de-a1-imperative | du-form -e presented as optional for all regular verbs | partial | L874 "du-form without -st and **usually without -e** (Geh!, Nimm!, Fahr! …)" | Add: "-e is obligatory after stems in -t/-d, consonant + m/n, and -ig (Arbeite! Öffne! Entschuldige!)" |
| de-a1-modal-verbs-present | *Ich kann das Meer sehen* starred as wrong | **inherited** | L850 commonError: "Adding können to sensation verbs … ("Ich sehe das Meer" is the default, not "\*Ich kann das Meer sehen")" | Delete this commonError. *können + sehen/hören* is standard. |
| de-a1-noun-gender | -ung "always feminine, no exceptions" | partial | L478 "suffix-based gender rules for -ung, -heit, -keit (all feminine)"; L471 "-ung → die" | Say "the derivational suffix -ung (on verb stems: Wohnung, Zeitung)". Note der Sprung/Schwung/Ursprung. |
| de-a1-numbers-ordinals | Years always read in hundreds; *tausend* "unnatural" | partial | L991 "year-reading (1998 = neunzehnhundertachtundneunzig)"; L1005 "Reading years with tausend by English interference — 1998 is …"; L1017 comment "Year-reading: hundred-based, not tausend" (yet L1019 seeds *zweitausendsechsundzwanzig*) | Say "1100–1999 in hundreds; from 2000 with zweitausend (2021 = zweitausendeinundzwanzig)". Scope the commonError to 1100–1999. |
| de-a1-numbers-ordinals | "no space after the ordinal dot" | page-only | L991 "written with a dot (der 8. Mai)" (correct) | — |
| de-a1-numbers-ordinals | *siebente* starred alongside *\*dreite* | **inherited** | L1002 "standard "der siebte", not "\*der siebente"" | Drop the star. Say "siebte (siebente is a less frequent variant, eastern Germany/Austria)". |
| de-a1-personal-pronouns | "ihn is the only 3sg form differing acc/dat" | page-only | L641 paradigm only | — |
| de-a1-plural-formation | Plural "always" after numerals >1 (ignores *zwei Euro / drei Kilo*) | partial | L534 commonError "Leaving the noun unchanged because a number word is present ("\*drei Buch")" | Add "(except masc./neut. measure nouns: zwei Euro, drei Kilo, zwei Glas — see de-a2-measure-expressions)". |
| de-a1-possessive-articles | Possessives replace *ein* "when the noun is not yet known" | page-only | L670 "with ein-word endings" (form only) | — |
| de-a1-praeteritum-sein-haben | Perfekt *ist gewesen / hat gehabt* called unnatural or clumsy | **inherited** | L963 "the standard way to talk about past states even in speech"; L975 commonError "Using the wordy Perfekt "ist gewesen / hat gehabt" where war/hatte is the idiomatic choice." | Remove the commonError. Reword L963 to "much more common than the Präteritum of other verbs in speech; the Perfekt forms are also natural, especially in the south". |
| de-a1-present-irregular | werden description garbled (d / vowel) | page-only | L394, L408 are correct | — |
| de-a1-temporal-prepositions | *von … bis* labelled dative as a pair | page-only | L897 "von … bis and ab for spans" (no case given) | — |
| de-a1-temporal-prepositions | *für den ganzen Tag bleiben* starred | **inherited** | L929 examplesNegative "\*Wir bleiben für den ganzen Tag zu Hause."; L934 commonError "Inserting für into bare accusative duration phrases ("\*für den ganzen Tag bleiben" …)" | Remove the star and the commonError. If anything, say "the bare accusative is the more usual way". It also clashes with the L921 *für*-duration variant. |
| de-a1-zero-article | *Wir kaufen einige Äpfel* starred | page-only | L825 example is "\*eine Milch", not *einige* | — |

## A2

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| de-a2-adjective-declension-indefinite | Rule of thumb "ein-word has an ending → -en" is wrong (*eine*, *unser*) | page-only | L1221 is correct ("where ein has no ending … feminine nom/acc takes -e") | — |
| de-a2-adjective-declension-indefinite | All -er adjectives drop the stem -e- | partial | L1234 "Keeping the stem -e- of -el/-er adjectives when inflected ("\*ein dunkeles Zimmer", "\*ein teueres Auto")" | Say "-el adjectives, and -er adjectives after au/eu (teuer, sauer)". Others keep it (sauberes, bitterer). |
| de-a2-akkusativ-prepositions | *bis* "often" without an article (implies *bis den*) | partial | L1126 "always take the accusative: durch, für, gegen, ohne, um, **bis**. Article and adjective endings change accordingly." | Take *bis* out of the article list: "bis stands alone before names/time phrases (bis Montag, bis nächsten Montag); before an article it needs a second preposition (bis zum Bahnhof)". |
| de-a2-comparison | -est rule contradicts *größten* | page-only | L1661 "\*am großten" for "am größten" (correct) | — |
| de-a2-dass-clauses | "welches" test for das/dass is broken | page-only | L1360 generic | — |
| de-a2-dativ-prepositions | *mit den Bus*: den called "accusative plural" | page-only | L1153 example correct, no label | — |
| de-a2-dativ-prepositions | Uncontracted *bei dem Bäcker / zu dem Arzt* as model sentences | page-only | — | — |
| de-a2-demonstratives-welch | *im selben* labelled informal | page-only | L1941 "im selben Haus" given neutrally | — |
| de-a2-destination-prepositions | zu/nach + article said to take the accusative | page-only | L1808 fine | — |
| de-a2-destination-prepositions | "auf does not contract" (aufs) | page-only | — | — |
| de-a2-indefinite-pronouns-basic | alle/alles "do not change form" | page-only | L1724 lists "alles/alle" without a claim | (optional: add allen/allem) |
| de-a2-nicht-sondern | Quick test contradicts its own example | page-only | L1675 states the correct replacement criterion | — |
| de-a2-past-participle-formation | Inseparable prefixes "carry the stress" | page-only | L1079/L1100 no stress claim | — |
| de-a2-past-participle-formation | -et after any "consonant cluster" | page-only | L1079 "weak ge-…-t (gemacht, gearbeitet)" | — |
| de-a2-perfekt-with-haben | *das Film* | page-only | — | — |
| de-a2-perfekt-with-sein | Wohin?-test → sein (fails for legen/stellen) | page-only | L1063 "verbs of motion and change of state" (could add "intransitive") | — |
| de-a2-praeteritum-modals | "drop umlaut + -te" yields \*mogte | partial | L1504 "konnte, musste, durfte, wollte, sollte, mochte: umlaut dropped, -te- endings" | Add "(mögen also changes g → ch: mochte)". |
| de-a2-praeteritum-modals | *mochte* given as the past of *möchte* (wishes) | page-only | L1504 lists *mochte* with no meaning claim | (optional: "past of möchte = wollte") |
| de-a2-quantifiers-other | *etwas Anderes* capitalized | page-only | L1068 "etwas anderes" (lowercase, correct) | — |
| de-a2-reflexive-verbs | "only mich/dich are unique reflexive forms" | page-only | L1482 lists the paradigm correctly | — |
| de-a2-reflexive-verbs | *sich treffen* called obligatorily reflexive | partial | L1482 "Verbs with an accusative reflexive pronoun (sich freuen, sich duschen, **sich treffen**)" next to L1493 "obligatorily reflexive verbs" | Swap *sich treffen* for an obligatory one (sich beeilen), or mark treffen/duschen as optionally reflexive or reciprocal. |
| de-a2-reflexive-verbs | Pronoun "directly after the finite verb" | partial | L1482 "the pronoun follows the finite verb in main clauses" | Add "after a pronoun subject when inverted (Heute duscht er sich); usually before a noun subject (Heute freut sich mein Bruder)". |
| de-a2-relative-clauses-nom-acc | "masc. acc. den differs from the article" | page-only | L1455 fine | — |
| de-a2-seit-present | Negation alone triggers the Perfekt | **inherited** | L1862 "negated or repeated events take the Perfekt instead"; L1878 variant "for an event that is negated or otherwise not ongoing" | "Non-occurrence of a (repeatable) event takes the Perfekt (Ich habe ihn seit Jahren nicht gesehen); a continuing negated state or habit stays in the present (Ich rauche seit zwei Jahren nicht mehr)." Durrell §12.1.2(b)(i)–(ii). |
| de-a2-weil-deshalb | weil = "result first" only | page-only | L1310 fine | (optional: add a fronted-weil example) |
| de-a2-wissen-kennen | wissen "cannot take a noun phrase" | **inherited** | L1894 "wissen = to know facts, **takes a clause** … kennen … takes a noun phrase"; L1922 commonError "Using wissen with a plain noun phrase ("\*Ich weiß den Film")" | Reframe by meaning: "wissen = information (a clause, or an NP denoting a fact: die Antwort, seine Nummer, etwas/nichts); kennen = acquaintance". Change the commonError to "wissen for acquaintance (\*Ich weiß den Film)". |

## B1

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| de-b1-hin-her | *hinein* "splits into hin- … -ein" | page-only | L2972 "Sie ging ins Haus hinein" (correct) | — |
| de-b1-subordinate-conjunctions | *mach … aus* glossed as *ausgehen* | page-only | — | — |
| de-b1-konjunktiv-ii-past | "participle always final" (wrong in subclauses and with modals) | page-only | L2375 doesn't state an order (mentions "regrets" without the modal double infinitive; could cross-link de-b2-modal-perfect-word-order) | — |
| de-b1-praeteritum | Strong verbs "same endings" (-n vs -en) | page-only | L2094 "no ending in 1sg/3sg" (correct) | — |
| de-b1-comparison-attributive | Superlative "always weak" (mein bester Freund) | page-only | L2755 only examples | — |
| de-b1-comparison-attributive | Comparative row: -es vs *ein besserer Plan* | page-only | — | — |
| de-b1-progressive-equivalents | *beim + infinitive* labelled colloquial | page-only | L3054 presents *beim* neutrally; L3082 correctly marks the *am*-progressive colloquial | — |
| de-b1-genitive | -(e)s stated as absolute (des Studenten, des Namens) | partial | L2594 "des/der/des/der + -(e)s on masculine and neuter nouns"; L2630 "Dropping the -(e)s on masculine/neuter nouns" | Add "(weak masculines take -(e)n: des Studenten, des Herrn; Name/Herz: des Namens, des Herzens)". |
| de-b1-articles-use | Masculine country names "always require" the article | **inherited** | L3092 "with feminine/masculine/plural country names (die Schweiz, **der Iran**, die Niederlande)"; L3115 variant "a definite article **required** by a feminine, masculine or plural COUNTRY name (… im Iran)" | Say "required with feminine/plural names; usual but optional with masculine ones ((der) Iran, in/im Irak)". Restrict the variant to feminine/plural. Durrell §4.4.1a. |
| de-b1-articles-use | *Die Geduld ist eine Tugend* as the model | **inherited** | L3092 "(Die Geduld ist eine Tugend — but partial: Er hat Geduld)" | Use a non-proverbial example (Die Zeit vergeht schnell). Note that the article is optional in general statements and usually absent in proverbs (Geduld ist eine Tugend). Durrell §4.2.1b–c. |
| de-b1-dass-clause-perfekt | "Auxiliary always last" (breaks with the double infinitive) | partial | L2153 "both the past participle and the auxiliary go to the end, **in that order**" | Add "(with a modal/lassen Perfekt the auxiliary precedes the double infinitive: dass sie es hat machen müssen — see de-b2-modal-perfect-word-order)". |
| de-b1-passive-werden | Modal passive "always ends with werden" | page-only | L2221, L2232 main-clause only, not wrong | — |

## B2

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| de-b2-dass-equivalents | *Wir freuen uns, dass …* starred: correlate "obligatory" | **inherited** | L3955 variant "an **OBLIGATORY** da(r)+preposition correlate … required by the governing verb (Wir freuen uns darauf, dass ihr uns besucht)"; L3961 commonError "Dropping an obligatory correlate ("Wir freuen uns darauf, dass …" — some verbs require …)"; L3933 "obligatory/optional correlates" | Re-anchor on a verb where it really is obligatory (sich verlassen darauf, dass …). State that with sich freuen, achten, aufpassen it is optional. Rename the variant id/directive. Durrell §16.5.14. |
| de-b2-dass-equivalents | "Modals cannot form a zu-infinitive" | page-only | — | — |
| de-b2-dass-equivalents | zu-infinitive "only with identical subjects" | **inherited** | L3933 "zu-infinitive when the subjects are identical"; L3962 commonError "Using the zu-infinitive when the subjects differ." | Say "when the infinitive's understood subject is the main-clause subject **or object** (Ich bitte dich, früher zu kommen)". Drop or narrow the commonError. Durrell §11.2.3. |
| de-b2-fixed-prepositions | Correlate "required" before a clause | partial | L4067 variant "the da(r)-CORRELATE … because the complement is a clause"; L4074 "Dropping the da(r)-correlate before a dass-clause where the noun/adjective requires it" | Add "often optional with adjectives (stolz/froh, dass … is standard)". Durrell §6.4.1c. |
| de-b2-indefinite-pronouns | *irgendein* determiner given pronoun endings | page-only | L4091 "irgendein-" (no endings) | — |
| de-b2-indefinite-pronouns | *welche* for all mass nouns (Käse → welchen) | partial | L4091 "einer/keiner/welche as stand-alone pronouns (Hast du Milch? — Ja, es ist noch welche da)"; L4103 "Missing welche as the partitive pronoun for mass nouns" | Say "welch- agreeing in gender with the mass noun (Käse → welchen, Milch → welche, Brot → welches)". |
| de-b2-indefinite-pronouns | *einige* "always plural" | page-only | L4091 lists "mehrere, einige" without a claim | — |
| de-b2-konjunktiv-i | 3sg "always ends in -e" (sei) | page-only | L3268 shows "er sei" | — |
| de-b2-konjunktiv-ii | Präteritum stems konn-/durf-/soll-/woll- | page-only | — | — |
| de-b2-konjunktiv-ii | Umlaut "added where possible" (weak verbs, sollte/wollte) | page-only | L3183 fine | — |
| de-b2-mittelfeld-word-order | Clausal *nicht* after all adverbials and complements | partial | L4159 "nicht stands before the element it negates, **otherwise late**"; L4185 variant "late in the Mittelfeld for whole-clause negation" | Add "but before manner adverbials and verb complements (directional/prepositional objects, predicatives): Er fährt nicht nach Berlin; Ich warte nicht auf ihn". Durrell §19.6a. |
| de-b2-mittelfeld-word-order | Pitfall "at least one NP" should be "both NPs" | page-only | L4159 states the pronoun rule correctly | — |
| de-b2-mittelfeld-word-order | Slot table puts the acc. NP before the adverbials | partial | L4159 "pronouns come first …, then noun phrases; adverbials default to TeKaMoLo" (reads as NPs then adverbials) | Add "adverbials typically follow the dative object but precede a (new-information) accusative object (Ich habe gestern im Büro den Bericht gelesen)". Durrell §19.5.1. |
| de-b2-modal-particles-advanced | "One particle per clause" | page-only | — | — |
| de-b2-modal-particles-advanced | *nur* = mild, *bloß* = strong warning | partial | L4261 commonError "Confusing warning bloß with plain nur" (contradicts the L4254 variant "bloß or nur adding URGENCY") | Drop the commonError or reword: "bloß is slightly more emphatic/colloquial; both mark warnings". Durrell §9.1.5. |
| de-b2-modal-perfect-word-order | *wäre kommen sollen* "rare" | page-only | L3538 uses haben throughout | (optional: state "modals always take haben") |
| de-b2-nominalization | -heit/-keit on verbs | page-only | — | — |
| de-b2-nominalization | Nominalized adj. "strong endings after an article" | page-only | L3356 "still carrying its adjective ending" | — |
| de-b2-nominalization | Nominalized infinitives "always singular" | page-only | L3372 is about gender only | — |
| de-b2-noun-verb-collocations | *sich Mühe geben* "no single-verb equivalent" | page-only | L4025 lists it without that claim | — |
| de-b2-passive-alternatives | sein + zu: possibility only "occasional" | partial | L3464 commonError "Reading sein + zu as ability only ("ist einzureichen" usually = must be handed in)" | Add "possibility is equally common, esp. negated (Er ist nicht zu erreichen)". Durrell §13.4.5a. |
| de-b2-relatives-advanced | *Wer …, der muss* starred as redundant | **inherited** | L4016 commonError "Inserting an unneeded resumptive der after wer when cases match ("Wer zu spät kommt, muss …" needs no der)" | Delete it, or replace with "the resumptive is required when the cases differ (Wer …, dem …) and optional/emphatic when they match". Durrell §5.4.5a. |
| de-b2-relatives-advanced | wo(r)- for abstract noun antecedents | page-only | L3971 "wo(r) + preposition for clause antecedents" (correct) | — |
| de-b2-subjective-modals | *Er will alles wissen* as the claim example | page-only | L3484, L3522 use *will nichts gesehen haben* | — |
| de-b2-text-reference-words | *der solche Fehler* "rare" (it is ungrammatical) | page-only | L4203 "solch-/derartig" no endings | — |
| de-b2-text-reference-words | Sentence-anaphor das "never inflects" (dem) | page-only | L4203 "dies/das as sentence anaphors" | — |
| de-b2-verb-prefixes | Separable = literal / inseparable = figurative | **inherited** | L4277 "variable prefixes (um-, über-, durch-, unter-) split **literal-separable vs figurative-inseparable** readings"; L4313 variant "SEPARABLY with its literal reading"; L4318 variant "INSEPARABLY with its figurative reading … (Wir haben die Baustelle umfahren — drove around it)" | Reframe: separable = the prefix's own adverbial meaning (turn over/change, through, over/across); inseparable = a lexicalized, often encircling/covering meaning, which can be fully literal (umfahren, umarmen, durchqueren). Rename the variant ids. Durrell §20.7. |
| de-b2-word-formation | Invented *freundig* (-lich/-ig pair) | partial (weak) | L4151 commonError "Confusing -lich and -ig pairs with distinct meanings" (names no pair) | Name real pairs: geistig/geistlich, zeitig/zeitlich, verständig/verständlich. |
| de-b2-word-formation | -keit "only after -lich/-ig" | partial | L4149 "adjectives in -lich/-ig take -keit" | Add "also -bar, -sam, most -el/-er (Dankbarkeit, Einsamkeit, Sauberkeit); -igkeit after -haft/-los". Durrell §20.2.1. |

## Curriculum-only errors (not flagged by the audit)

1. **de-a2-konjunktiv-ii-polite, L1569**: commonError "Doubling würde with a modal ("\*Würdest du mir helfen können?" for a simple request)". *Würdest du / Würden Sie mir helfen können?* (also *Würden Sie mir sagen können, …?*) is grammatical, very frequent polite German. At most it is wordier than *Könntest du mir helfen?* Starring it teaches a false correction to both generators and the evaluator. Fix: drop the star and say "könnte is the leaner choice", or remove the item.
2. **de-a2-seit-present, L1862**: in addition to the negation finding above, "**repeated** events take the Perfekt" is overgeneral. Durrell §12.1.2(b)(ii): a habit continuing up to now stays in the present (*Seit ihrer Erkrankung liest sie viele Bücher*). Only a series of separate completed occurrences takes the Perfekt (*Er ist seit Weihnachten mehrmals krank gewesen*). Fold this into the L1862 rewrite.
3. **de-a1-numbers-ordinals, L1017** (part of the year-reading item, listed here because it is self-inconsistent): the seed comment says "hundred-based, not tausend" while L1019 seeds *zweitausendsechsundzwanzig*. Correct the comment when fixing L991/L1005.

Checked but not listed: the A2 *"\*Ich gebe das Buch meinem Bruder gern. (neutral order)"* star (L1993) is defensible per Durrell §19.4.2(a)–(b), since accusative-before-dative noun order is marked.
