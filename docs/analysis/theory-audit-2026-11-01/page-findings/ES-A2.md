# Theory audit: ES A2 (33 approved pages, prod)

Book = Butt & Benjamin (B&B), `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md/chapters/`.

## es-a2-por-para
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "When por or para is followed by the article el, only por contracts: por + el → por el (no contraction). Neither por nor para contract with el the way a does"
- **Problem**: The sentence contradicts itself. It says por contracts, then says it does not. The correct statement: neither por nor para contracts with el (por el, para el). Only a+el → al and de+el → del contract.
- **Source**: expert knowledge

## es-a2-periphrases-obligation-aspect
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "hay que is invariable: it is always hay que regardless of tense or person."
- **Problem**: hay que does not change for person, but it does change for tense: había que, hubo que, habrá que, habría que, ha habido que. A learner who follows the page will produce *"ayer hay que trabajar".
- **Source**: expert knowledge (B&B ch. 34 on the tenses of haber)

## es-a2-indirect-object-pronouns-se
- **Severity**: error
- **Confidence**: high
- **Location**: what is it?: "This same se also appears in the dative-of-possession construction…". Also when to use it: "Dative of possession … Spanish uses se le/les plus a definite article instead of a possessive adjective: «se le cayó el vaso a Juan»"
- **Problem**: These are two different things. The se in "se le cayó" is the pronominal (accidental/unplanned-event) se of caerse. It is not the se that replaces le before lo/la. The le is the dative. A true dative of possession needs no se at all: "le robaron la cartera", "me duele la cabeza", "le lavé la cara". The page teaches learners that possession requires "se le", which leads to errors like *"se le robaron la cartera".
- **Source**: B&B §30 (pronominal/unplanned se, e.g. *se me olvidó*, ch. 30 l.682); §14.5 (se replacing le)

## es-a2-imperfect
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "ver keeps its v- and takes the regular -er endings (veía, veías…)"
- **Problem**: The page lists ver as irregular, but this explanation would produce the regular form *vía. The irregularity is the stem ve-, which keeps the e: ve- + -ía = veía. The correct statement: "ver keeps the e of its infinitive (ve-) before the endings: veía, not the expected *vía".
- **Source**: B&B §16 (imperfect irregulars: "veía … (not the expected *vía*)")

## es-a2-gustar-type-verbs
- **Severity**: misleading
- **Confidence**: high
- **Location**: formation: "The verb takes only two forms in the present: third-person singular … and third-person plural"
- **Problem**: The subject can be 1st or 2nd person: me gustas (I like you), le gusto (he likes me), nos encantáis. The 3rd-person-only rule is true only for things. Stated as an absolute, it hides the very common "me gustas" and makes it look ungrammatical.
- **Source**: expert knowledge (B&B ch. 35 attests *me gustas mogollón, María*)

## es-a2-tonic-pronouns-prepositions
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "After any preposition except con — use mí or ti". Also common pitfalls: "This applies after all prepositions: sin ti, de ti, sobre ti, etc."
- **Problem**: entre, según, excepto, salvo, menos, incluso, and hasta (meaning "even") take yo/tú, not mí/ti: entre tú y yo, según tú, excepto yo. B&B explicitly flags *entre ti y mí and *excepto mí as typical English-speaker errors, and this page teaches exactly those errors.
- **Source**: B&B §13.1 (and note 1 "Important"); §38 (entre)
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation: "Only the 1st and 2nd person singular have special tonic forms… The fusion with con is unique to mí and ti."
- **Problem**: The reflexive also has a special form: sí, which fuses with con as consigo ("lo lleva consigo").
- **Source**: B&B §13.3

## es-a2-estar-gerundio
- **Severity**: misleading
- **Confidence**: high
- **Location**: common pitfalls: "This change only affects -ir verbs, not -er verbs." Also the warn callout: "The stem-change rule for the gerund applies only to -ir verbs."
- **Problem**: poder (an -er verb) has the gerund pudiendo. The absolute rule would make learners produce *podiendo. (The callout's example, volver → volviendo, is correct.)
- **Source**: B&B §24.2 (exceptions table: "poder: pudiendo")

## es-a2-imperative-affirmative
- **Severity**: misleading
- **Confidence**: high
- **Location**: formation: "vosotros form (regular): Replace the final -r of the infinitive with -d. This rule is completely regular, with no exceptions." The page also says enclitic pronouns are "always attached to the end of the verb".
- **Problem**: When reflexive os is attached, the -d drops: levantaos, sentaos, lavaos (not *levantados). The only exception is idos. The page teaches enclisis on the same page, so its two rules combine to give learners *sentados.
- **Source**: B&B §21.2.4

## es-a2-preterito-perfecto
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "Ya … always pairs with the pretérito perfecto, not the simple preterite." Also common pitfalls: "When ya, todavía no, or hoy appear … the pretérito perfecto is required … Use hoy he hecho instead."
- **Problem**: This is a Peninsular (central Spain) norm presented as a universal rule. In most of Latin America, and in Galicia, Asturias and the Canaries, "ya llegó", "todavía no terminé" and "hoy hice" are standard. Learners of Latin American Spanish would be marked wrong for correct forms.
- **Source**: B&B §18.2 (intro: "*ya llegó* (Latin America)"), §18.2.8
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation: "Three high-frequency verbs have irregular participles that must be memorised: hacer, escribir, ver"
- **Problem**: The wording implies these are the only ones. Equally high-frequency irregular participles include dicho, puesto, vuelto, abierto, roto, muerto and cubierto, and learners will produce *decido or *ponido.
- **Source**: expert knowledge (B&B §16 participle list)

## es-a2-si-present-conditional
- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "In Spanish, si is never followed by the future tense in the same clause."
- **Problem**: This is true only for conditional "if". When si means "whether", the future is fine: "no sé si vendrá". The absolute "never" would make learners reject correct indirect questions.
- **Source**: B&B §29.8.1 notes 2–3

## es-a2-todo-otro-quantifiers
- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "When it modifies a noun, it must be followed by a definite article …, a possessive …, or a demonstrative". Also formation: "the determiner … is obligatory"
- **Problem**: todo + bare singular noun is standard, with the meaning "every/any": todo español sabe…, en todo caso, todo tipo de. The determiner is required only for the "the whole of / all" reading. The page itself glosses todo as "every".
- **Source**: B&B §10.17(a)

## es-a2-exclamatives-impersonals
- **Severity**: error
- **Confidence**: medium
- **Location**: what is it?: "Both sets of structures are impersonal: no noun or pronoun acts as a grammatical subject."
- **Problem**: The exclamatives on this page have ordinary subjects. In "¡Qué caro es este restaurante!" the subject is este restaurante. In "¡Qué bien cocinas!" it is tú. In "¡Que tengas un buen viaje!" it is tú. "Estamos a quince grados" also has a 1st-plural verb. Only hace + weather noun is impersonal. Learner impact is low, but the statement is false.
- **Source**: expert knowledge

## es-a2-diacritic-pairs
- **Severity**: misleading
- **Confidence**: medium
- **Location**: what is it?: "The accent does not change pronunciation — both words are common, short words — but it signals …". The next sentence says "The accented member is always the word that carries its own lexical stress".
- **Problem**: The page contradicts itself. The tilde diacrítica marks the stressed (tonic) word against its unstressed (atonic) twin: tú vs tu, mí vs mi, sí vs si. So the two words do differ in pronunciation, in stress.
- **Source**: expert knowledge (B&B ch. 44 accent rules)

## es-a2-direct-object-pronouns
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation table row: "una idea / una cláusula (neuter) → lo — Lo sé."
- **Problem**: If the replaced object is the feminine noun "una idea", the pronoun is la ("Tengo una idea → La tengo"). Neuter lo stands for a clause or proposition, not for a noun phrase. Listing "una idea" as a neuter noun contradicts the page's own gender-agreement rule.
- **Source**: expert knowledge (B&B ch. 8 neuter lo)

---
Clean pages (no findings): es-a2-adjective-apocopation, es-a2-articles-use, es-a2-cada-mismo, es-a2-connectors, es-a2-hace-ago, es-a2-indefinites-double-negation, es-a2-ir-a-future, es-a2-mente-adverbs, es-a2-personal-a, es-a2-possessives-tonic, es-a2-present-irregular-stem-changes, es-a2-preterite-irregular, es-a2-preterite-regular, es-a2-preterite-stem-spelling, es-a2-preterite-strong-stems, es-a2-preterite-yo-spelling, es-a2-reflexive-verbs, es-a2-saber-poder-ability, es-a2-temporal-clauses

Considered and not reported: periphrases "*lo hay que hacer is ungrammatical". B&B §22 calls it "popular though widespread" (??), so treating it as wrong for learners is defensible.
