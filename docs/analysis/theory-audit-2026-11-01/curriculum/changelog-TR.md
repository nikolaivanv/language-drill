# TR curriculum fixes — `packages/db/src/curriculum/tr.ts`

Worktree: `.claude/worktrees/curriculum-theory-audit-fixes` (uncommitted; CURRICULUM_VERSION_TR not touched by me).
G&K = Göksel & Kerslake, *Turkish: A Comprehensive Grammar* (md mirror). `vitest run src/curriculum`: 144/144 pass.

## A1

### tr-a1-vowel-harmony
- description: "4-way (i/ı/u/ü): accusative -(y)I, possessive -(s)I, dative, past -DI." → "4-way …: accusative -(y)I, possessive -(s)I, past -DI; dative -(y)A is 2-way (-(y)a/-(y)e)." (G&K §3, §8.1.3 — -(y)A has low vowel)

### tr-a1-beri-dir
- description: "Predicate stays ongoing (-iyor)." → "Predicate is normally ongoing (-iyor / nominal); a negative/quantified "since" predicate may take -DI (O zamandan beri görmedim)." (G&K §17.2.3 (ii), ex. 43–45)
- directive `den-beri-since-point`: "The predicate stays ongoing" → "The predicate is normally ongoing" (same)

### tr-a1-accusative-definite-object
- description: "proper names and pronouns are inherently definite" → "proper names and personal/demonstrative pronouns are inherently definite … (indefinite bir şey / hiçbir şey stay bare)" (G&K §22, §14.3.3.1)
- directive `pronoun-accusative`: "because pronouns are inherently definite" → "because personal pronouns are …"

### tr-a1-dan-a-kadar
- examplesPositive: "Pazartesi'den cuma'ya kadar" → "pazartesiden cumaya kadar" (common-noun day names, no apostrophe; cf. G&K §17.2.3 ex. 38 "Pazartesiden beri")
- commonErrors: deleted "Omitting "kadar" on the goal (… the construction needs both halves)" — -DAn … -(y)A without kadar is grammatical (sabahtan akşama çalışıyor).

### tr-a1-clock-time-dates
- description: "days of the week stay caseless" → "as an "on <day>" adverbial a weekday stays caseless"
- commonError: "— days stay caseless (çarşamba günü)" → "— as an "on <day>" adverbial a weekday stays caseless (çarşamba günü); other cases are fine (pazartesiden, cumaya kadar)." (G&K §17.2.3 ex. 38)

### tr-a1-genitive-possessive
- commonError "Omitting the genitive on the possessor." → "… when a specific possessor is meant (a pronoun possessor is routinely dropped: kitabı; a bare first noun forms a valid indefinite compound)." (G&K §14.5, §10.2, §18.1.1 pro-drop)

### tr-a1-instrumental-ile
- description: "Pronouns take the genitive: benimle, seninle, onunla, kiminle." → "In the standard language singular pronouns and kim take the genitive first (…), but plural onlar does not (onlarla). Colloquial benle/senle/onla are informal, not wrong." (G&K §8.1.4, §6.2, §17.2.1)
- examplesPositive gloss: "o becomes onunla, not *onla" → "standard onunla; colloquial onla"
- directive `ile-pronoun-genitive`: "which must take the genitive stem first" → "which in standard writing takes the genitive stem first …; plural onlar stays bare (onlarla)"
- examplesNegative: removed "*Benle gel." (colloquial, not ungrammatical); *Arabala geldim remains.
- commonError "Attaching ile/-lA to a bare pronoun (*benle, *senle, *onla) …" → "Mis-forming the pronoun + -lA: standard writing uses the genitive form (…— bare benle/onla are colloquial), but plural onlar takes -lA directly (onlarla, not *onlarınla)."

### tr-a1-gore-bence
- commonError: "the 3rd-person opinion is "ona göre", not a *-CE form." → "the usual 3rd-person opinion is "ona göre" (onca exists but is rare)." (G&K §6.2 lists onca 'according to him/her')

### tr-a1-questions
- description: "it carries the person ending;" → "it carries the person ending (except 3pl -lAr: geliyorlar mı);" (G&K §11.1.1.5: Uyanırlar mı?, Okuldalar mı? — 3pl -lAr stays on the predicate)

## A2

### tr-a2-correlative-conjunctions
- description: "(predicate normally positive)" → "(predicate affirmative or negative: içerim / içmem)" (G&K §20.4: "Sentences containing ne . . . ne can have either affirmative or negative predicates", ex. 39/40)
- examplesPositive notes: "— verb stays positive." removed; "— predicate stays positive: var." → "— affirmative predicate var."
- directive `ne-ne`: "with the predicate kept POSITIVE" → "here with an affirmative predicate"
- examplesNegative: deleted "*Ne çay ne kahve içmem."; commonErrors: deleted "Negating the verb after ne … ne …".

### tr-a2-adversative-connectors
- description: "and open their sentence" → "and mainly open their sentence" (G&K §28.3.4.1 "used mainly to introduce a sentence")

### tr-a2-aorist
- examplesNegative: deleted "*Her sabah kahve içiyorum. (in a generic-truth context)" (correct; -(I)yor is habitual too, G&K §21.3.2)
- commonError "Substituting the present continuous -(I)yor for habitual statements." → "Using -(I)yor for a characteristic trait or general truth (*Kaplumbağa yavaş yürüyor …) — -(I)yor can express a current habit (Her sabah kahve içiyorum), but general statements take the aorist." (G&K §21.3.2, §21.4.1.1)

### tr-a2-past-copula
- description: "evidential -(y)mIş (hastaymış)" → "evidential -(y)mIş (hastaymış "apparently is/was ill" — tenseless, context sets the time)" (G&K §21.4.3.1: copular -(y)mIş "has no tense or aspect content")

### tr-a2-reflexive-reciprocal-pronouns
- commonError: "…or pluralising it as *birbirleri instead of agreeing via the possessive (…)" → "…or not agreeing via the possessive (birbirimizi, birbirinizi; 3pl birbirlerini is also standard)." (G&K §18.4: birbirleri is the neutral form for groups)

### tr-a2-clitics-da-bile
- commonError: "-DA (attached, 4-way, devoiced -ta/-te)" → "-DA (attached, 2-way harmony + d/t alternation: -da/-de/-ta/-te)" (G&K §8.1.3)

### tr-a2-possessive-case-stacking
- description: "3sg/3pl insert a buffer -n- before the case suffix (odası → odasına)" → "3sg/3pl insert pronominal -n- before every case suffix, consonant-initial too (odası → odasına, evinde)" (G&K §6.2 pronominal n)

### tr-a2-spatial-postpositions
- examplesNegative: "*ev önünde (wrong — the complement takes the genitive …)" → "*ev önünde [for "in front of the house"] (wrong — a specific complement takes the genitive: evin önünde)"
- commonError: "Omitting the genitive on the complement" → "Omitting the genitive on a specific complement (… "in front of the house")" (G&K §17.3.2; entry's own bare-complement exception)

### tr-a2-purpose-icin-uzere
- description: "-mAsI için 'so that' (anlaması için)" → "-mA + possessive + için 'so that' (anlaman / anlaması için)"
- directive `masi-icin-different-subject`: "-mAsI için, …" → "-mA + possessive + için (-mAm / -mAn / -mAsI için…), … (…; Anlaman için tekrar ettim)"
- commonError: "requires -mAsI için (…)" → "requires -mA + possessive + için (…; anlaman için)" (G&K §26.3.6, §24.4.2 -mA + POSS)

### tr-a2-indefinite-pronouns
- description: "REQUIRE a negative verb: Kimse gelmedi." → "REQUIRE a negative verb in statements: Kimse gelmedi (a question may be positive: Evde kimse var mı?)." (G&K §20.5.3, ex. 60)
- directive `negative-polarity-kimse-hicbir`: "paired with the obligatory NEGATIVE verb" → "in a STATEMENT, paired with the obligatory NEGATIVE verb"

### tr-a2-mis-evidential
- description: "Obligatory when the event was not witnessed — -DI instead would claim first-hand knowledge." → "Expected for reported or inferred events — -DI there would claim first-hand knowledge; established facts (history, news narration) normally keep -DI." (G&K §21.4.3.1, ex. 133a news report in -DI)

### tr-a2-enumerator-tane
- description: "The general counter tane for discrete non-human nouns," → "The general counter tane, usually for discrete non-human nouns," (G&K §15.8 "usually when modifying nouns denoting discrete, non-human entities"; human-noun note dropped for the 450 cap)
- commonErrors: deleted "Using tane with human nouns where kişi is natural (üç tane öğretmen → …)."

### tr-a2-suffix-order-buffers
- examplesPositive: "çocuklarına (to your/their children — çocuk-lar-ın-a …)" → "çocuklarına (to his/her/their children: çocuk-lar-ı-n-a; or to your children: çocuk-lar-ın-a — …)"
- examplesPositive: "suyu (the water [ACC] — irregular stem su takes a -y- buffer …)" → "suyum / suyu (my / his-her water — irregular su takes y, not s, before the possessive and genitive: su-y-um, su-y-u, su-y-un; likewise ne → neyi)"
- examplesNegative: "*suu / *nei (…)" → "*susu / *sunun (wrong — su takes y before the possessive and genitive: suyu "his/her water", suyun)"
- commonError: "…they take a -y- buffer before any vowel-initial suffix (suyu, suya, suyum; neyi, neye), never *suu / *sui / *nee." → "…before the possessive and genitive they take y where other vowel-final nouns take s / n / nothing (suyum, suyu "his/her water", suyun; neyi), never *sum / *susu / *sunun." (G&K §6.2 (iii))

### tr-a2-ca-suffix
- commonError: "needing an extra word or case — …" → "needing a case suffix — … ; Türkçe olarak is also fine, especially in writing."

## B1

### tr-b1-causative-voice
- description: "polysyllabic / vowel-, l-, r-final stems take -t (kapat-, uyut-); … elsewhere -DIr (yaptır-, öldür-)." → "polysyllabic stems ending in a vowel, l or r take -t (kaynat-, uyut-, oturt-); … elsewhere -DIr (yaptır-, konuştur-), monosyllabic l/r stems included (öldür-, gördür-)." (G&K §8.2.1.1)
- directive `causative-dir`: "on a polysyllabic stem not ending in a vowel, l or r (…)" → "on a monosyllabic stem outside the -Ir/-Ar/-It set, or a polysyllabic stem ending in another consonant (…, konuş- → konuştur-)" (G&K §8.2.1.1)
- directive `causative-t`: "on a stem ending in a vowel, l or r" → "on a POLYSYLLABIC stem ending in a vowel, l or r" (G&K §8.2.1.1)
- commonError "Forgetting the causee marking (-A dative for the demoted agent)." → "Wrong causee marking: accusative when the base verb is intransitive (çocuğu uyuttum), dative when it is transitive (Deniz'e kapıyı açtırdı)." (G&K §13.2.1, ex. 28)

### tr-b1-abstract-postpositions
- description: "personal pronouns take genitive (…)" → "… — except plural onlar (onlar hakkında)." (G&K §17.2.1 genitive-attracting pronouns exclude plural forms; applies to §17.3)

### tr-b1-converb-while-yken
- description: "-ken attaches to an aorist/imperfective verb base or a nominal …" → "-ken attaches mostly to an aorist base or a nominal (also -(I)yor / -mIş / -(y)AcAk, never -DI) … gelmişken." (G&K §26.3.8 (iii), §26.2.3 (ii), ex. 42 göstermişken)
- examplesNegative gloss: "-ken attaches to the aorist/imperfective base, not -DI past: gelirken" → "-ken never attaches to the -DI past: gelirken / gelmişken"

### tr-b1-obligation-periphrases
- examplesNegative "*Gitmek lazım benim." re-glossed: "gerek/lazım take -mA + possessive" → "a personal obligation puts the possessive on the verbal noun: gitmem lazım; bare gitmek lazım is impersonal "one must go""
- commonError "-mA+possessive for gerek/lazım/şart." → "-mA+possessive for personal gerek/lazım/şart (an impersonal -mAk subject is also fine: gitmek lazım, beklemek gerekiyor)." (G&K §21.4.4, ex. 118 and following impersonal -mAk)

### tr-b1-olarak
- examplesNegative "*avukatı olarak" → "*avukata olarak (wrong — olarak takes no case: avukat olarak)"
- commonError "(avukatı olarak → avukat olarak)." → "(avukata olarak → avukat olarak); a possessive-marked complement is fine (şirketin avukatı olarak)."

### tr-b1-passive-voice
- description: "Agent via "tarafından";" → "Agent via "tarafından" (animate agents; inanimate causes take -DAn/-DA);" (G&K §13.2.2: tarafından "can normally only refer to animate entities"; inanimate via ablative/locative)
- examplesPositive gloss: "Burada sigara içilmez. (… impersonal passive.)" → "(Smoking is not allowed here — personal passive of transitive iç-, generic reading.)"
- directive `impersonal-passive-intransitive`: example "Burada sigara içilmez" → "Burada koşulmaz"
- commonError "Expressing the agent with -DAn instead of "tarafından"." → "Using tarafından for an inanimate cause (fırtına tarafından yıkıldı → fırtınadan yıkıldı); tarafından is for animate, mostly human agents."

### tr-b1-real-conditional
- commonError: "the aorist conditional -(I)rsA (gelirse)" → "-(A/I)rsA (gelirse, yaparsa)" (G&K §8.2.3.1 aorist allomorphy)

### tr-b1-reciprocal-voice
- description: added "noun + -lAş also forms mutual-activity verbs (mektuplaş-, haberleş-);" (G&K §7.2 -lAş (ii))
- examplesPositive gloss: "Mektuplaştılar. (They corresponded with each other.)" → "(… — noun mektup + -lAş.)"

### tr-b1-when-converbs
- description: appended "…, though it is also often used like -(y)IncA." (G&K §26.3.8 (ii) "sometimes used interchangeably with -(y)IncA")

## B2

### tr-b2-as-if-gibi
- description: "(hayalet görmüş gibi bakıyor)." → "(hayalet görmüş gibi bakıyor), copular -(y)mIş on nominals (hastaymış gibi), or aorist -(A/I)r gibi (uykuda gezer gibi)." (G&K §26.1.5, §26.3.8 (ii) ex. 67)
- commonError "Using a finite verb before gibi instead of -mIş (…)." → "Using a finite verb before gibi for "as if" (…); finite + gibi means "seems to" (Beni duymuyor gibi)." (G&K §24.5)
- commonError "(duymuyor gibi vs duymuyormuş gibi)" → "(duymuyor gibi "seems not to hear" vs duymuyormuş gibi "as if not hearing")"

### tr-b2-aspectual-verbs
- description: "Only -Iver is fully productive." → "Of the bound auxiliaries only -Iver is fully productive; the free -(y)Ip dur-/kal- are productive too." (G&K §13.3.1, ex. 78–79: free dur-/kal- "more productive")
- directive `yiver-quick-easy`: "The only fully productive member" → "The only fully productive BOUND auxiliary"

### tr-b2-conditional-formal
- description: "(-mA + possessive: gecikmesi hâlinde)" → "(-mA + possessive: gecikmesi hâlinde; a bare noun also works: gecikme hâlinde, yangın durumunda)" (G&K §27.6.1; lexical noun + hâlinde/durumunda is a regular compound)
- examplesNegative: deleted "*gecikme hâlinde"; commonErrors: deleted "Dropping the possessive on the -mA noun (gecikme hâlinde → gecikmesi hâlinde)."

### tr-b2-converb-until
- description: "-(y)IncAyA kadar / -AnA kadar (also" → "-(y)IncAyA kadar / colloquial -(y)AnA kadar (okuyana kadar; also" (G&K §26.3.8 (vii) "↓-(y)AnA kadar")

### tr-b2-dir-generalizing
- description: "Non-past; distinct from hearsay -mIş." → "Never on past -(y)DI, but -mIş + -DIr gives a past assumption (gitmiştir); distinct from hearsay -mIş." (G&K §21.4.1.4 ex. 81 karşılaşmışızdır; §21.4.1 -mIştIr)
- examplesNegative "*Dün evdeydir (… -DIr is non-past; past assumption is evde olmalıydı)" → "(wrong — -DIr cannot mark a past copula; a past assumption is -mIş + -DIr: Dün evde kalmıştır)"
- commonError "Attaching -DIr to a past predicate (evdeydir)." → "Attaching -DIr to a past-copula predicate (evdeydir); a past assumption uses -mIş + -DIr (kalmıştır)."

### tr-b2-double-voice
- directive `causative-of-causative`: "(yaptır- → yaptırt-, yazdır- → yazdırt-)" → ": -t after -DIr/-Ir/-Ar (yaptır- → yaptırt-, yazdır- → yazdırt-), -DIr after -t (okut- → okuttur-)" (G&K §8.2.1.1 "-t follows -DIr, -Ir or -Ar … and -DIr follows -t")

### tr-b2-duration-throughout
- description: ""Throughout / as long as" beyond B1 boyunca: süresince is its formal twin on a bare noun (konferans süresince "throughout the lecture");" → ""During / as long as" beyond B1 boyunca: süresince "during" (without boyunca's stress on the whole span) on a caseless, optionally possessed noun (konferans süresince, yokluğum süresince);" (G&K §17.3.2 (vi), ex. 94)
- examplesNegative gloss: "süresince takes a bare noun, no case" → "süresince takes a caseless noun"

### tr-b2-participle-aorist
- examplesNegative "*akmaz su (wrong allomorph and sense — …)" → "*aker su (wrong allomorph — back-vowel ak- takes -ar: akar su)" (akmaz su 'still water' is grammatical: negative aorist participle, G&K §8.2.3.1 / §25.5)
- commonError "(akmaz / aker for akar)" → "(aker / akır for akar)"

## Skipped (with reasons)

1. **tr-a2-past-copula, example gloss** "Yorgunmuş, o yüzden gelmemiş. (She was apparently tired…)" — in this context (gelmemiş) the past reading is the right one; fixed only the description's tense claim.
2. **tr-b1-reciprocal-voice, remove selamlaş- from the -(I)ş list** — selamlaş- = verb selamla- 'greet' + reciprocal -(I)ş (G&K §7.2 analyses -lAş as -lA + -(I)ş), so listing it with -(I)ş is defensible. Added the noun + -lAş note and the mektuplaş annotation instead.
3. **tr-a2-mis-evidential, commonError "…where evidential -mIş is obligatory"** (hearsay/inference) — G&K §21.4.3.1 says evidential marking of hearsay "is not a matter of choice"; left as is.
4. **tr-b1-real-conditional, description/name allomorph rule** — description already shows both allomorphs (gelirse, yağarsa, olursa); point `name` left unchanged (names untouched); only the commonError's "-(I)rsA" corrected.
5. **tr-b2-converb-until, point name "-AnA kadar"** — name left as is; (y) added in the description.
6. **tr-a2-enumerator-tane, "with humans it is common in speech"** — dropped from the description because of the 450-char cap; G&K's own "usually" now hedges it and the false commonError is deleted.
7. **tr-a1-dan-a-kadar "-A kadar also stands alone"** — not part of a from–to point; not added.
8. **tr-a1-vowel-harmony coverageSpec code comment ("4-way -(y)I/-(y)A")** — a code comment, not injected; left.
9. **tr-b1-when-converbs cloze code comment** — not injected; left.
