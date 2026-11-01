# Theory audit — TR A2 (28 pages, prod, 2026-11-01)

G&K = Göksel & Kerslake, *Turkish: A Comprehensive Grammar* (mirror at /Users/seal/dev/language-tools/Turkish/turkish-grammar-book/turkish-grammar-md).

## tr-a2-correlative-conjunctions
- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls, "Negating the verb after ne … ne": "A common mistake is to write «Ne çay ne kahve içmem» with a negative verb. This creates a double negative… the verb must stay positive" (with a ✗/✓ callout). Also when to use it: "The verb that follows stays in the positive form"; and the example note on «Ne param ne de zamanım var»: "Using «yok» here would be a double negative and is non-standard."
- **Problem**: Sentences with ne … ne can take either an affirmative or a negative predicate. The two differ only in intonation and stress. «Ne çay ne kahve içmem» is grammatical. The page marks a correct form as wrong.
- **Source**: G&K §20.4 ("Sentences containing ne . . . ne can have either affirmative or negative predicates", ex. 39 vs 40; ex. 38 *alamadık*)

## tr-a2-adversative-connectors
- **Severity**: error
- **Confidence**: high
- **Location**: when to use it: "ama (not fakat) links them directly"; formation table: "fakat | between clauses only"; example note: "fakat is not used between adjectives."
- **Problem**: Ama and fakat can both conjoin adjectival constructions. The book's own example of this (*Sıcak ama bunaltıcı olmayan…*) is the one the page copied.
- **Source**: G&K §28.3.4.1 ("Ama and fakat can also conjoin adjectival constructions", ex. 55)

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls, first callout: "✗  Hava soğuk çünkü dışarı çıkmak istemiyorum.  (intended: "
- **Problem**: The text is truncated mid-parenthesis, so the learner sees an unfinished sentence. Separately, the ✗ sentence is itself grammatical ("It's cold, because I don't want to go out" — odd logic, but not a connector error), and it is not a minimal pair with the ✓ sentence (*istiyorum*). The callout does not illustrate the pitfall.
- **Source**: expert knowledge

- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "they *must* open a new sentence — they cannot sit mid-clause the way ama and fakat do", with ✗ "Semra hep gezmek istiyor ancak zamanı yok."
- **Problem**: G&K describe ancak/yalnız as used "mainly" to introduce a sentence, not obligatorily. Clause-joining "…, ancak …" is very common in written Turkish. Calling the in-sentence use wrong is too strong. The "formal" register label for *yalnız* is also unsupported, since adversative yalnız is common in speech.
- **Source**: G&K §28.3.4.1 ("slightly more restricted… used mainly to introduce a sentence")

## tr-a2-aorist  (manual-approved)
- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls, "Using -(I)yor for habitual statements": "*Her sabah kahve içiyorum is not wrong in isolation, but it implies you are drinking coffee right now, not that you do so every morning as a habit."
- **Problem**: -(I)yor regularly has habitual meaning, and with *her sabah* it is unambiguously habitual. G&K's example is *Fatma genellikle Ankara'ya otobüsle gidiyor*. The asterisk and the "right now" claim are false. The real difference is aspectual or stylistic: the aorist gives a characteristic or general statement, -Iyor gives a current habit.
- **Source**: G&K §21.3.2 (ex. 30, "-(I)yor occurs with both progressive and habitual meaning")

## tr-a2-past-copula  (manual-approved)
- **Severity**: misleading
- **Confidence**: high
- **Location**: what is it?: "-(y)mIş, which marks a past state reported second-hand or inferred (e.g. hastaymış — «she was apparently ill»)". The page also calls both "two past copulas", and the -(y)mIş table glosses every cell as "was apparently ill".
- **Problem**: The evidential copula -(y)mIş has no tense content. *Hastaymış* is ambiguous between "apparently she is ill" and "apparently she was ill", and the non-past reading is the default without a time adverbial. Presenting it as a past copula (and setting it beside -(y)DI as the evidential counterpart of the past) will make learners avoid it for present-state hearsay. This page also contradicts tr-a2-mis-evidential, which glosses the same *hastaymış* as "is ill".
- **Source**: G&K §21.4.3.1 ("Unlike the verbal suffix -mIş, the copular -(y)mIş has no tense or aspect content", ex. 134 vs 135)

## tr-a2-reflexive-reciprocal-pronouns
- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls: "Do not add a separate plural marker: «*birbirleri» is not standard."
- **Problem**: *Birbirleri* is a standard form. With interacting groups it is the neutral form, and *birbiri* is the colloquial one. Examples: *birbirlerini seviyorlar*, *birbirlerine*. The related example *Birbirine yardım ettiler* is fine, but *birbirlerine* is equally correct and is the neutral choice.
- **Source**: G&K §18.1.4 ("birbiri/birbirleri… interchangeable… birbirleri is the neutral form"), §6.2(ii)(b)

## tr-a2-converb-temporal
- **Severity**: error
- **Confidence**: high
- **Location**: formation: "the capital letters «A» and «I» represent the four-way and two-way vowel harmony alternations respectively"
- **Problem**: This is reversed. A is two-way (a/e) and I is four-way (ı/i/u/ü).
- **Source**: G&K §6.1.1 / expert knowledge

- **Severity**: error
- **Confidence**: high
- **Location**: examples, note on *Okuldan döndükten sonra dinlendim*: "the suffix is -dükten (back rounded vowel harmony)"
- **Problem**: ö/ü are front rounded vowels, not back.
- **Source**: G&K ch. 3 / expert knowledge

## tr-a2-indefinite-compound
- **Severity**: error
- **Confidence**: high
- **Location**: examples, note on *Bir otobüs bileti istiyorum*: "the head «bilet» takes -i (back unrounded vowel harmony)"
- **Problem**: i is a front unrounded vowel, and *bilet*'s last vowel e is front.
- **Source**: expert knowledge

## tr-a2-ability-necessity
- **Severity**: error
- **Confidence**: high
- **Location**: what is it?: "Both suffixes attach to the bare verb stem and obey standard four-way vowel harmony."
- **Problem**: -(y)Abil and -mAlI follow two-way harmony (-abil/-ebil, -malı/-meli). The page's own formation section says this, so the page contradicts itself.
- **Source**: G&K §21.4.2 / expert knowledge

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation callout: "The personal suffix after -mAlI ends in a vowel (-yım / -yim for first person singular), so a buffer -y- is inserted"
- **Problem**: The reasoning is garbled. The -y- appears because the stem *-mAlI* ends in a vowel and the person suffix -(y)Im begins with one. The person suffix does not end in a vowel.
- **Source**: expert knowledge

## tr-a2-converbs
- **Severity**: error
- **Confidence**: high
- **Location**: formation callout "Vowel harmony reminder": "The vowels in the suffixes follow four-way harmony: -(y)Ip … ; -(y)ArAk as -erek / -arak; -mAdAn as -meden / -madan. The repeated converb -(y)A alternates as -e / -a."
- **Problem**: Only -(y)Ip is four-way. -(y)ArAk, -mAdAn and -(y)A are two-way, and the page's own listed alternants show this.
- **Source**: expert knowledge

## tr-a2-nominalization
- **Severity**: error
- **Confidence**: high
- **Location**: formation table (possessive endings), row "sen (you)": "gelmен"
- **Problem**: The cell contains Cyrillic characters (е, н). It should read *gelmen*. The form displays as wrong and fails search or copy.
- **Source**: n/a (data defect)

- **Severity**: misleading
- **Confidence**: high
- **Location**: formation: "The vowels in the suffixes follow four-way vowel harmony (A → a/e; I → ı/i/u/ü)."
- **Problem**: A is two-way. Only I is four-way. As written, -mAk/-mA are described as four-way.
- **Source**: expert knowledge

## tr-a2-clitics-da-bile
- **Severity**: error
- **Confidence**: high
- **Location**: formation table, back-vowel row: example "sen da" — "you too"
- **Problem**: *Sen* has a front vowel, so the form is *sen de*. *Sen da* is wrong, and it sits in the row the learner uses to learn the rule.
- **Source**: G&K §11 (clitic dA) / expert knowledge

- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "The locative suffix … follows 4-way harmony (-da / -de / -ta / -te)"
- **Problem**: The locative -DA has two-way vowel harmony plus a d/t consonant alternation. "Four-way harmony" is the term for the I-type (ı/i/u/ü) alternation, so this misuses the term.
- **Source**: G&K §8.1.3 / expert knowledge

## tr-a2-possessive-case-stacking
- **Severity**: misleading
- **Confidence**: high
- **Location**: what is it?: "a buffer consonant -n- is inserted between the possessive ending and the case suffix to prevent two vowels from meeting". When to use it callout: "only triggered by 3sg… and 3pl… possessives, because those endings finish with a vowel". Pitfall: "omitting the buffer creates an illegal vowel cluster".
- **Problem**: The 3rd-person "pronominal n" appears before all case suffixes, including the consonant-initial locative and ablative (*evinde*, *odasından*, *evlerinde*). It is not hiatus avoidance. A learner who follows the stated rationale will produce *\*odasıda* and *\*evleride*. The page's own example *evlerinde* contradicts its explanation.
- **Source**: G&K §6.2(ii)(b) (*hepsinde*, *bazılarından*)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: examples: "Selin odasına gidiyorum." — "I am going to Selin's room."
- **Problem**: A personal-name possessor needs the genitive: *Selin'in odasına*. Without it, *Selin odası* reads as a bare -(s)I compound, like a room named "Selin". This is the exact error the possessive frame is meant to teach against.
- **Source**: G&K ch. 10 (-(s)I compounds vs genitive-possessive, §14.4) / expert knowledge

## tr-a2-spatial-postpositions
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation callout: "The landmark noun always takes the genitive suffix". Pitfall: "«*Ev önünde» is incorrect".
- **Problem**: Spatial possessive-marked postpositions take a bare, non-genitive complement when the complement is non-specific, categorial or generic, or when the use is metaphorical: *bir kağıt üstünde*, *yargıç önüne*, *kardeşler arasında*, *ter içinde*, *iki saat içinde*. "Always" is false. Bare forms like *kapı önünde* are idiomatic.
- **Source**: G&K §17.3.1.2

## tr-a2-purpose-icin-uzere
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it: "That subject takes the genitive case and the verbal noun takes a third-person possessive suffix." Formation: "the verbal noun takes the third-person singular possessive suffix -(s)I".
- **Problem**: The possessive agrees with the embedded subject's person: *benim anlamam için*, *senin anlaman için*, *bizim anlamamız için*. The page only gives 3sg, and the translations "(they) understand" in the table are also wrong for a 3sg suffix: 3pl would be *anlamaları*.
- **Source**: G&K §24.4 (-mA + possessive agreement) / expert knowledge

## tr-a2-indefinite-pronouns
- **Severity**: misleading
- **Confidence**: high
- **Location**: what is it?: "the latter group always requires a negative verb". Formation callout: "Rows marked «neg. verb» require the verb to carry the negation…"
- **Problem**: In affirmative questions, *kimse* occurs with a positive verb: *İçeride kimse var mı?*, *Evde kimse var mı?*. The page even glosses kimse as "anyone in questions", which contradicts its "always" rule. Learners will avoid or garble the very common *Kimse var mı?*
- **Source**: G&K §20.5.3 (ex. 60), §20.5 (ex. 45)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "The suffix -si is optional and adds a slight definiteness: biri «someone», birisi «one of them / that one»."
- **Problem**: *Birisi* is commonly just "someone": *Kapıda birisi var*. The "one of them / that one" contrast is invented.
- **Source**: G&K ch. 18 (ex. *Kapıda birisi var.*)

## tr-a2-mis-evidential
- **Severity**: misleading
- **Confidence**: medium
- **Location**: what is it?: "Using the witnessed past -DI instead would claim first-hand knowledge … a factual error in Turkish". Callout: "If you were not present — for any reason — use -mIş."
- **Problem**: This is overstated. -DI is the normal form for established or accepted facts the speaker did not witness: historical events (*İstanbul 1453'te fethedildi*), one's own birth (*1990'da doğdum*), news and written narration. "For any reason" will make learners put -mIş on textbook history and biography.
- **Source**: expert knowledge (cf. G&K §21.4.3.1, where -mIş is tied to relaying received information, not to every unwitnessed fact)

## tr-a2-enumerator-tane
- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it: "Not used with human nouns … not «üç tane öğretmen»". Pitfall: "«üç tane öğretmen» sounds unnatural or dismissive".
- **Problem**: Tane is usually used with non-human nouns, but its use with humans is normal, especially in speech: *iki tane çocuğu var*, and G&K's own *birkaç (tane) çocuk*. "Not used" and "dismissive" overstate a tendency.
- **Source**: G&K §15.8 ("usually … non-human"; ex. 108 *birkaç (tane) [oynayan] çocuk*)

## tr-a2-optative
- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation: "The vowel in the suffix follows 4-way vowel harmony (A = a/e, I = ı/i/u/ü)."
- **Problem**: The A is two-way. The I in -(y)AyIm / -(y)AlIm always follows an a/e, so it surfaces only as ı/i (*alayım*, *gideyim*), never u/ü. "4-way" invites *\*okuyayum*-type errors.
- **Source**: G&K §21.4.4.3 / expert knowledge

## tr-a2-relative-an
- **Severity**: error
- **Confidence**: high
- **Location**: examples, note on *Oynayan çocuklar mutlu*: "Consonant-final stem «oyna-» ends in a vowel → buffer -y- inserted"
- **Problem**: The note contradicts itself. *Oyna-* is a vowel-final stem.
- **Source**: n/a

## tr-a2-suffix-order-buffers
- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it / formation table / pitfalls: "-y-… Also applies to the irregular stems «su» and «ne» before any vowel-initial suffix"; "Both words take -y- before every vowel-initial suffix… su-y-u, su-y-a, su-y-um; ne-y-i, ne-y-e"
- **Problem**: The irregularity is misidentified. su/ne take y where other vowel-final nouns take **s** (3sg possessive *suyu*, not *\*susu*) or **n** (genitive *suyun*, not *\*sunun*), in the possessive and genitive only. *Suyu* (ACC), *suya* and *neye* are perfectly regular -(y)I / -(y)A forms. A learner told "su takes y before vowels" still doesn't know *suyun* / *suyu* (poss.).
- **Source**: G&K §6.2(iii)

- **Severity**: error
- **Confidence**: medium
- **Location**: examples: *Mektup çocuklarına geldi* — "The letter came to their children." Note: "çocuk + -lar (plural) + -ı (3sg possessive) + -n- + -a"
- **Problem**: The analysis and the gloss disagree. Plural + 3sg possessive gives "his/her children". "Their children" needs the 3pl possessive -lArI, which merges with the plural. The learner gets a wrong morpheme-to-meaning mapping.
- **Source**: G&K §8.1.2 / expert knowledge

- **Severity**: misleading
- **Confidence**: medium
- **Location**: examples: *Bardakta suyu içtim* — "I drank the water in the glass."
- **Problem**: "The water in the glass" needs the -ki relative: *Bardaktaki suyu içtim*. As written, the sentence means "I drank the water in/from a glass" (locative adverbial). It also sits on the page that teaches -ki.
- **Source**: G&K §8 (-ki) / expert knowledge

- **Severity**: misleading
- **Confidence**: medium
- **Location**: what is it?: "Because Turkish vowel harmony forbids two vowels meeting at a suffix boundary"
- **Problem**: This misattributes the rule. Vowel harmony governs which vowel a suffix takes. The ban on adjacent vowels is a separate hiatus-avoidance rule, handled by buffer consonants and vowel deletion.
- **Source**: G&K §6.1.3 / expert knowledge

## tr-a2-ca-suffix
- **Severity**: misleading
- **Confidence**: medium
- **Location**: common pitfalls: "there is no need to add … a separate word like «*Türkçe'de» or «*Türkçe olarak» in this adverbial use"
- **Problem**: *Türkçe olarak* ("in Turkish", as in *Türkçe olarak yayımlandı*) is grammatical and common, especially in writing. Starring it as ungrammatical is wrong; bare *Türkçe* is simply the more usual choice. (*Türkçe'de* is also misspelled — TDK writes *Türkçede* — and it is correct in its own sense, "in the Turkish language".)
- **Source**: expert knowledge

---

**Clean pages (no findings):** tr-a2-causal-connectors, tr-a2-consonant-doubling, tr-a2-distributive, tr-a2-gibi-kadar, tr-a2-pekistirme, tr-a2-reported-speech, tr-a2-with-without-li-siz
