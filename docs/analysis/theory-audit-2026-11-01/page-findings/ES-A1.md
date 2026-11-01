# Theory audit: ES A1 (25 pages, prod `theory_topics`, auto-approved)

Book refs = Butt & Benjamin, *A New Reference Grammar of Modern Spanish* (markdown mirror).

## es-a1-articles
- **Severity**: misleading
- **Confidence**: medium
- **Location**: examples in context, note on "Me gusta la música clásica": "With gustar, the thing liked is the grammatical subject and always takes the definite article."
- **Problem**: The subject of gustar needs *a determiner* when it is a generic noun, but not always the definite article. Possessives, demonstratives, indefinites and quantifiers are normal: *me gusta tu casa*, *me gustan estos zapatos*, *me gusta un chico*, *me gustan muchas cosas*. "Always the definite article" would lead learners to write *me gusta la tu casa* or to mark correct answers wrong. Better: "a generic noun after gustar takes the definite article (me gusta el chocolate)." The same overstatement appears in es-a1-gustar-basic.
- **Source**: expert knowledge

## es-a1-coordination-basic
- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "It becomes **e** before a word that starts with the sound /i/ (spelled i- or hi-)"; formation table: "e (before i-, hi-)"
- **Problem**: "spelled hi-" also covers *hie-/hia-* words, which start with a /j/ glide, not /i/, so they keep *y*: *agua y hielo*, *carbón y hierro* (never *e hielo*). The table states the bare spelling rule "before i-, hi-", so a learner following it will write *e hielo*.
- **Source**: B&B §37.3 ("not before a y sound… *carbón y hierro*")

## es-a1-gender-agreement
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "For adjectives that end in a consonant (like español or inglés), the feminine is formed by adding -a directly to the masculine form"
- **Problem**: This is stated for consonant-final adjectives in general, on a page about descriptive adjectives in general. Most consonant-final adjectives are invariable for gender: *fácil, azul, joven, feliz, natural, gris* (so not *fácila*, *azula*). Only nationality adjectives and those in -or, -ón, -án, -ín (plus a few others) add -a. The rule must be limited to gentilicios and those endings.
- **Source**: B&B §5.2.2 ("nearly all adjectives whose masculine singular ends with a consonant, except those ending in -ín, -án, -ón, -or, -és" have no separate feminine); §5.2.1 note 1 (*español, andaluz* vs *feroz, natural*)

## es-a1-gustar-basic
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation callout: "The liked thing always takes the **definite article** in Spanish, even when English would use no article"; when to use it: "The noun takes the definite article." / "The noun still takes the definite article."
- **Problem**: Same overstatement as in es-a1-articles. Any determiner works: *me gusta tu casa*, *me gustan estos libros*, *me gusta una chica de mi clase*. The definite article is required only for generic or unique nouns where English has a bare noun or "the".
- **Source**: expert knowledge

## es-a1-hay-estar
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "Estar, by contrast, is a regular verb that conjugates fully."
- **Problem**: Estar is irregular: yo *estoy* (-oy) and stressed endings *estás, está, están*. The book lists it among the irregular -oy verbs and gives it its own model paradigm. This page's own table shows *estoy*, and the sister page es-a1-present-irregular-core calls it irregular.
- **Source**: B&B §16.5 note (dar/estar/ir/ser: "four irregular verbs have a first-person singular ending in -y"), §16.11.21

## es-a1-negation-tampoco
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "place **no** immediately before any conjugated verb to make the sentence negative. Nothing else in the sentence changes." Also what is it: "placing it directly before the verb with no other changes."
- **Problem**: Object and reflexive clitics are never separated from the verb, so *no* goes before the clitic: *no lo tengo*, *no me gusta*, *no se llama Juan*. "Immediately before the verb" produces the classic learner error *me no gusta* / *lo no tengo*. This matters a lot at A1 because gustar is taught at the same level.
- **Source**: B&B §27.2.1 ("object pronouns… are never separated from a verb: *no lo dije nunca*")

## es-a1-noun-gender
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "Nouns ending in -e, a consonant, or another vowel have no reliable gender rule. Learn them together with their article: el coche, la clase, la ciudad."; pitfalls: "There is no reliable rule for nouns like … el hotel vs. la ciudad."
- **Problem**: The page's own example *la ciudad* is fully predictable. Nouns in -dad, -tad, -tud, -ción, -sión, -ez, -umbre are reliably feminine (*la ciudad, la universidad, la estación, la canción*), and many A1 nouns end in these suffixes. Saying "no reliable rule" withholds the most useful gender rule after -o/-a. The -e/consonant claim is fine for *coche/clase/hotel* but should not cover these suffixes.
- **Source**: B&B §1.3.7 (feminine by form: "-ez, -eza, -ción, -ía, -sión, -dad, -tad, -tud, -umbre…")

## es-a1-noun-plural
- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls: "Although país ends in a vowel letter, the final syllable is stressed and ends in -s, so it takes -es."
- **Problem**: *país* ends in the consonant letter *s*, not a vowel. It is an ordinary consonant-final noun taking -es (Rule 2). The "stressed syllable" explanation in Rule 3 and in the table ("stressed syllable ending in -s → +es") muddles the rule and attaches país to the -í/-ú rule.
- **Source**: B&B §2.1.3 (*el país – los países* listed with consonant-final nouns)

- **Severity**: misleading
- **Confidence**: high
- **Location**: formation: "Rule 2 — ends in a consonant: add -es. This includes nouns ending in -l, -r, -n, -d, etc."; pitfalls: "Nouns that end in a consonant require -es"
- **Problem**: Stated as absolute. Nouns ending in an unstressed vowel + -s (or -x) do not change in the plural: *el lunes → los lunes*, *la crisis → las crisis*, *el análisis → los análisis*. The weekday names are A1 vocabulary, and this rule will produce *los luneses*. Stress is what matters for final -s, which is what the page half-gestures at with país but never states.
- **Source**: B&B §2.1.5(a) (*el – los lunes, la – las dosis, el – los análisis*)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation: "Rule 3 — ends in stressed -í or -ú: add -es."
- **Problem**: Presented as the only option. Everyday nouns add only -s (*menú → menús*, *champú → champús*, and stressed -á: *sofá → sofás*, *mamá/papá → mamás/papás*). The -es form (*marroquíes, hindúes*) is formal or written, and -s is accepted and increasingly normal. A learner applying this rule will write *menúes*.
- **Source**: B&B §2.1.3(c) and its exceptions list (*el menú – los menús, el champú – los champús*)

## es-a1-prepositions-a-en
- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "When the subject is not moving, the correct preposition is always **en**"; callout: "is the subject already there (→ en) or going/arriving there (→ a)?"
- **Problem**: Static *a* is common at A1: *a la derecha / a la izquierda*, *al lado de* (used with estar on the es-a1-locative-prepositions page: *La farmacia está al lado del supermercado*), *a la mesa*, *a la puerta*, *a 5 km de*. "Always en" contradicts the sister page and leads to *en la derecha*.
- **Source**: B&B §38.2.2 (static *a*: *a la mesa, a la barra, a la puerta*)

## es-a1-present-indicative-regular
- **Severity**: misleading
- **Confidence**: medium
- **Location**: pitfalls callout: "The endings -as / -es (tú), -emos / -imos (nosotros), and -éis / -ís (vosotros) are the three pairs most often mixed up. Keep the vowel of the infinitive class in mind: a for -ar, e for -er, i for -ir."
- **Problem**: The tip is applied to the tú pair as well, but -ir verbs take *e* in tú/él/ellos (*vives, vive, viven*), not *i*. Followed literally it produces *vivis / vivin*. The theme vowel *i* appears only in nosotros/vosotros (and the infinitive) for -ir verbs, which the page's own formation section says correctly.
- **Source**: expert knowledge (paradigm in B&B §16.2)

## es-a1-present-irregular-core
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "the written accents on estar (all forms except estamos and estáis carry a written accent on the final vowel)"
- **Problem**: Wrong on both counts. *estoy* has no written accent, and *estáis* does have one. Correct statement: *estás, está, estáis, están* carry an accent; *estoy* and *estamos* do not. The table on the same page is correct, so the prose contradicts it.
- **Source**: B&B §16.11.21 (present: *estoy, estás, está, estamos, estáis, están*)

## es-a1-present-yo-go
- **Severity**: error
- **Confidence**: high
- **Location**: what is it: "A group of common verbs is regular in the present except in the yo form … All the other persons follow the normal present pattern."; formation callout: "Compare the two persons: hago but haces; tengo but tienes. The irregular part lives only in yo."; pitfalls: "Say tú dices…"
- **Problem**: Four of the eight -go verbs listed are also irregular outside yo: *tener → tienes, tiene, tienen*; *venir → vienes, viene, vienen*; *decir → dices, dice, dicen*; *oír → oyes, oye, oyen*. The callout's own example *tienes* shows an irregular e→ie change and contradicts the claim. A learner will produce *tenes, venes, deces, oíes*. Only hacer, poner, salir, traer (and the -zco verbs) fit "irregular only in yo".
- **Source**: B&B §16.11.46 (tener), §16.11.16 (decir)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: what is it: "verbs ending in -cer or -cir add a -zco (as in conozco)"
- **Problem**: Stated without the "after a vowel" qualifier (which only appears later). It contradicts the page's own -go list: *hacer → hago*, *decir → digo*. Also *cocer → cuezo*, and consonant + -cer/-cir verbs (*vencer → venzo*) don't fit. The rule is vowel + -cer/-cir, excluding hacer, decir and their compounds, and cocer/mecer.
- **Source**: B&B §16.11.12 (cocer), §16.11.16, §16.11.23

## es-a1-relative-que-basic
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "The verb inside the clause is conjugated to agree with the antecedent, not with the subject of the main clause."; callout: "Only the verb inside the clause changes to match the antecedent."
- **Problem**: True only when *que* is the subject. When *que* is the object, the verb agrees with its own subject: *los libros que leo* (yo), not *leen*. The page's own table (*los libros que leo*) and example note ("the verb agrees with yo") contradict the rule. A learner applying it will write *los libros que leen* to mean "the books I read".
- **Source**: expert knowledge; B&B §39.1.2–39.1.3

- **Severity**: error
- **Confidence**: medium
- **Location**: common pitfalls: "Some learners write *la que vive or *los ques viven as if que were an adjective."
- **Problem**: *la que vive aquí* ("the one who lives here") is fully grammatical. It is the standard nominalized relative (*el/la/los/las que*), so marking it ungrammatical is false. Only *ques* is an impossible form.
- **Source**: B&B §40.1.4 (*la que está fuera* 'the one who is outside')

## es-a1-ser-estar-basic
- **Severity**: misleading
- **Confidence**: high
- **Location**: common pitfalls: "Location always requires estar … This applies to every location — streets, buildings, people, objects."; examples note: "Location always takes estar"; callout: "if you can ask «¿Dónde?» (where?), use estar."
- **Problem**: The location of events takes *ser*: *la fiesta es en mi casa*, *¿dónde es la clase/el concierto?* B&B singles this out as an error learners constantly make. The "¿Dónde? → estar" rule of thumb gives exactly the wrong answer for events.
- **Source**: B&B §33.1 ("Learners constantly forget that ser must be used for the location of events… *¿dónde es la fiesta?*"), §33.2.5

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it (ser): "Inherent or defining characteristics … El agua es fría. (water is cold by nature)"; what is it: "Using the wrong verb produces a grammatically incorrect sentence"
- **Problem**: (a) *El agua es fría* is a poor model. Water is not inherently cold, and for a learner describing water the natural sentence is *el agua está fría*. Using it as the ser example for inherent qualities teaches the wrong choice. A clean example would be *el hielo es frío* or *la casa es grande*. (b) The claim that the wrong verb is always ungrammatical contradicts the page's own callout (*ser aburrido* vs *estar aburrido*, both grammatical with different meanings).
- **Source**: expert knowledge; B&B §33.4.4 (change of meaning)

## es-a1-telling-time
- **Severity**: error
- **Confidence**: high
- **Location**: formation table row: "1:45 | es | la | es la una menos cuarto | it is quarter to one"
- **Problem**: 1:45 is *son las dos menos cuarto* (quarter to two). *Es la una menos cuarto* is 12:45. The English gloss "quarter to one" is right for 12:45, but the hour column says 1:45, so the row is self-contradictory and teaches the wrong time. The 4:40 row (*son las cinco menos veinte*) shows the correct pattern.
- **Source**: expert knowledge (B&B §36.10.1 gives the clock table only as an image)

---
Clean pages (no findings): es-a1-demonstratives, es-a1-interrogatives, es-a1-locative-prepositions, es-a1-noun-modifiers-de, es-a1-numbers-ordinals, es-a1-porque-para, es-a1-possessives-atonic, es-a1-quantifiers-muy-mucho, es-a1-querer-poder-infinitive, es-a1-subject-pronouns
