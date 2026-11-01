# TR theory-audit findings vs curriculum (`packages/db/src/curriculum/tr.ts`, main @ 3d1ecc9a)

Verdicts: **inherited** = the curriculum states the same wrong claim; **partial** = the curriculum is overgeneral or vague in a way that plausibly seeded the page error; **page-only** = the curriculum is fine on this point.

Totals: 106 findings. 25 inherited, 21 partial, 60 page-only.

Line numbers refer to `packages/db/src/curriculum/tr.ts`. The fields named (description, examplesPositive/Negative, commonErrors, constructionVariants directive) are all injected verbatim into the theory-generation and exercise-generation prompts.

## A1

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| tr-a1-beri-dir | *saattan beri* (should be *saatten*) | page-only | L1704 has the correct "iki saatten beri" | — |
| tr-a1-beri-dir | "predicate is always ongoing (-iyor)" | partial | L1656 description "Predicate stays ongoing (-iyor)."; L1675 directive "The predicate stays ongoing" | "Predicate is normally imperfective (-iyor / copula); a negative or quantified predicate often takes -DI (İki yıldır onu görmedim)." |
| tr-a1-beri-dir | *sabahtan beri* glossed "for the morning" | page-only | L1660 gloss is "since morning" | — |
| tr-a1-accusative-definite-object | -(y)I called "two-way" harmony | page-only | — | — |
| tr-a1-accusative-definite-object | "personal (and other) pronouns always take the accusative" | partial | L1054 "proper names and pronouns are inherently definite and take it"; L1092 directive "because pronouns are inherently definite" | Say "personal and demonstrative pronouns". Note that indefinite/negative pronouns stay unmarked (bir şey aldım, hiçbir şey görmedim). |
| tr-a1-ablative-dative | t/d decided by the "last consonant" | page-only | L1201 correctly says "after a voiceless consonant" | — |
| tr-a1-dan-a-kadar | "both halves required; dropping kadar is wrong" | **inherited** | L1546 commonError "Omitting "kadar" on the goal ("sabahtan akşama" without "kadar" — the construction needs both halves)." | Delete the commonError, or reword it: "-DAn … -A without kadar is also fine (sabahtan akşama çalışıyor); -A kadar also stands alone (cumaya kadar)." |
| tr-a1-dan-a-kadar | apostrophe on day names (*Pazartesi'den cuma'ya*) | **inherited** | L1536 examplesPositive "Pazartesi\'den cuma\'ya kadar (from Monday to Friday)" | Change to "pazartesiden cumaya kadar". |
| tr-a1-clock-time-dates | "days of the week never take a case suffix" | partial | L1755 "days of the week stay caseless"; L1819 commonError "days stay caseless (çarşamba günü)"; L1815 "days of the week take no locative" | Scope it: "used as an 'on <day>' time adverbial, a day name takes no locative". Day names inflect elsewhere (pazartesiden, cumaya kadar). |
| tr-a1-genitive-possessive | "neither suffix can be dropped"; *öğretmen kitabı* starred | partial | L1252 "*öğretmen kitabı (when "the teacher\'s book" is meant)" (qualified, so OK); L1256 commonError "Omitting the genitive on the possessor." has no exceptions | Add to the commonError: "…when a specific possessor is meant; a pronominal possessor is routinely dropped (kitabı, kedisi var), and a bare first noun makes a valid indefinite compound." |
| tr-a1-locative | *ev*'s "e" called a back vowel | page-only | — | — |
| tr-a1-var-yok | "var ends in a vowel" | page-only | — | — |
| tr-a1-var-yok | *vaktim* harmony note garbled, vowel drop missing | page-only | L1007 bare example, no note | — |
| tr-a1-postpositions-once-sonra | garbled "ben → benden, not *benden" | page-only | L1478 "ben → benden" is correct | — |
| tr-a1-postpositions-once-sonra | *dersten* explained by "cluster", not voicelessness | page-only | — | — |
| tr-a1-vowel-harmony | loanword exception stated backwards (*lokallar*) | page-only | L328 states it correctly (meşgul → meşguller, saat → saati) | — |
| tr-a1-instrumental-ile | *benle/senle/onla* starred; *onlar* omitted | **inherited** | L1420 "Pronouns take the genitive: benimle, seninle, onunla, kiminle."; L1429 "o becomes onunla, not *onla"; L1457 "*Benle gel. (wrong — …)"; L1462 commonError "Attaching ile/-lA to a bare pronoun (*benle, *senle, *onla)"; L1451 directive "must take the genitive stem first" | Description: "Singular pronouns and kim take the genitive in standard writing (benimle, seninle, onunla, kiminle); plural onlar does not (onlarla). Colloquial benle/senle/onla are informal, not wrong." Drop the `*Benle` negative example and reword the commonError as a register note. |
| tr-a1-gore-bence | "no 3rd-person -CE form" (*onca* exists) | **inherited** | L1639 commonError "the 3rd-person opinion is "ona göre", not a *-CE form." | "…the usual 3rd-person form is ona göre; onca exists but is rare/formal." |
| tr-a1-future | -(y)AcAk "the only choice" for decisions | page-only | L761 is hedged ("when -(y)AcAk is more idiomatic"); aorist offers are taught in tr-a2-aorist | — |
| tr-a1-questions | "person ending always on mI", with no 3pl -lAr exception | partial | L863 "In nominal/present predicates it carries the person ending"; L921 commonError "Attaching the personal ending to the predicate instead of to mI" | Add: "…except 3pl -lAr, which stays on the predicate (geliyorlar mı?, öğrenciler mi?)." |
| tr-a1-personal-pronouns | pronoun locative called "rare" | page-only | — | — |
| tr-a1-stem-changes | *aklı/burnu* glossed "(acc.)" + "his/her" | page-only | L358/L360 glosses are correct ("his/her mind", "its nose") | — |

## A2

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| tr-a2-correlative-conjunctions | *Ne çay ne kahve içmem* marked wrong | **inherited** | L2615 "(predicate normally positive)"; L2620 "verb stays positive"; L2624 "predicate stays positive: var"; L2635 directive "with the predicate kept POSITIVE"; L2640 "*Ne çay ne kahve içmem. (wrong — with ne … ne the verb stays POSITIVE in Turkish…)"; L2644 commonError "Negating the verb after ne … ne" | Delete the L2640 negative example and the L2644 commonError. Description: "ne … ne may take either an affirmative or a negative predicate (Ne çay ne kahve içerim / içmem)." Drop "stays positive" from the example notes and the directive, which can keep asking for the positive form without calling the negative wrong. |
| tr-a2-adversative-connectors | "fakat not used between adjectives" | page-only | L3180 example uses ama but claims nothing about fakat | — |
| tr-a2-adversative-connectors | truncated ✗ callout, not a minimal pair | page-only | — | — |
| tr-a2-adversative-connectors | ancak/yalnız "must open a new sentence" | partial | L3172 description "ancak and yalnız … open their sentence"; L3214 has the correct "mainly" | Description: "…mainly open their sentence (clause-joining ', ancak …' is also common in writing)". |
| tr-a2-aorist | *Her sabah kahve içiyorum* starred / "means right now" | **inherited** | L2314 examplesNegative "*Her sabah kahve içiyorum. (in a generic-truth context)" (the same sentence as positive example L2291); L2318 commonError "Substituting the present continuous -(I)yor for habitual statements." | Delete the L2314 negative example. CommonError: "-(I)yor also expresses current habits (Her sabah kahve içiyorum is fine); the aorist gives a characteristic or general statement." |
| tr-a2-past-copula | -(y)mIş presented as a past copula ("was apparently ill") | **inherited** | L2965 description "The past of "to be" on non-verbal predicates: … evidential -(y)mIş (hastaymış)"; L2972 "Yorgunmuş… (She was apparently tired…)" | Description: "…evidential -(y)mIş (hastaymış) has no tense: 'apparently is/was ill', non-past by default." Gloss L2972 as "apparently she is/was tired". |
| tr-a2-reflexive-reciprocal-pronouns | *birbirleri* starred as non-standard | **inherited** | L1920 commonError "…or pluralising it as *birbirleri instead of agreeing via the possessive" | Drop the *birbirleri clause. Optionally add "birbirleri is the neutral 3pl form (birbirlerini seviyorlar)". |
| tr-a2-converb-temporal | A/I harmony labels reversed | page-only | — | — |
| tr-a2-converb-temporal | ö/ü called back rounded | page-only | — | — |
| tr-a2-indefinite-compound | i called back unrounded | page-only | — | — |
| tr-a2-ability-necessity | -(y)Abil/-mAlI called four-way | page-only | — | — |
| tr-a2-ability-necessity | -y- buffer reasoning garbled | page-only | — | — |
| tr-a2-converbs | -(y)ArAk/-mAdAn/-(y)A called four-way | page-only | — | — |
| tr-a2-nominalization | Cyrillic in *gelmen* | page-only | — | — |
| tr-a2-nominalization | A called four-way | page-only | — | — |
| tr-a2-clitics-da-bile | *sen da* | page-only | L3006 says 2-way de/da | — |
| tr-a2-clitics-da-bile | locative -DA called "4-way harmony" | **inherited** | L3034 commonError "…the locative suffix -DA (attached, 4-way, devoiced -ta/-te)." | "(attached, 2-way harmony + d/t alternation: -da/-de/-ta/-te)". |
| tr-a2-possessive-case-stacking | 3rd-person -n- explained as hiatus avoidance | partial (terminology only) | L2197 "3sg/3pl insert a buffer -n- before the case suffix" (the rule is right and L2206 *evlerinde* shows it before a consonant, but "buffer" invites the hiatus reading; L2034 groups it with -y- as "Buffers") | Call it "pronominal n" and add: "it appears before every case, consonant-initial too (evinde, odasından), not to separate vowels." |
| tr-a2-possessive-case-stacking | *Selin odasına* with no genitive | page-only | — | — |
| tr-a2-spatial-postpositions | "landmark always takes the genitive"; *ev önünde* starred | partial | L2931 "in a genitive-possessive frame"; L2943 "*ev önünde (wrong — the complement takes the genitive…)"; L2948 commonError "Omitting the genitive on the complement (ev önünde → evin önünde)". L2945/L2951 do teach the bare exception, so the entry contradicts itself. | Qualify L2943/L2948 with "(for a specific house)", or swap in a clearly specific example (*Ali'nin ev önünde*-type). |
| tr-a2-purpose-icin-uzere | different-subject purpose given with 3sg possessive only | partial | L2779 "a different subject needs -mAsI için 'so that' (anlaması için)"; L2800 directive "-mAsI için"; L2811 "a separate subject requires -mAsI için" | Write it as "-mA + possessive + için (anlamam / anlaman / anlaması için)" and add a non-3sg example. |
| tr-a2-indefinite-pronouns | kimse "always requires a negative verb" | **inherited** | L2127 "Negative-polarity kimse, hiçbiri, hiçbir+N, hiçbir şey REQUIRE a negative verb"; L2153 directive "obligatory NEGATIVE verb"; L2167 "demand a negative verb" | Add: "…in statements; in yes/no questions kimse takes a positive verb (Evde kimse var mı?)." |
| tr-a2-indefinite-pronouns | *birisi* = "one of them / that one" | page-only | L2127 "biri(si) someone" is correct | — |
| tr-a2-mis-evidential | -mIş "for any unwitnessed event" | **inherited** | L2234 "Obligatory when the event was not witnessed — -DI instead would claim first-hand knowledge."; L2254 "…where evidential -mIş is obligatory" | "Used for hearsay, inference and surprise. Established facts the speaker did not witness (history, one's own birth, news narration) normally take -DI." |
| tr-a2-enumerator-tane | tane "not used with human nouns" | **inherited** | L3073 "The general counter tane for discrete non-human nouns"; L3103 commonError "Using tane with human nouns where kişi is natural (üç tane öğretmen → …)" | "…mostly non-human nouns; with humans it is common in speech (iki tane çocuğu var)". Drop the L3103 commonError or mark it as a register note. |
| tr-a2-optative | "4-way harmony" | page-only | — | — |
| tr-a2-relative-an | "consonant-final stem oyna- ends in a vowel" | page-only | — | — |
| tr-a2-suffix-order-buffers | su/ne "take -y- before any vowel suffix" | **inherited** | L2043 "suyu (the water [ACC] — irregular stem su takes a -y- buffer…; likewise ne → neyi)"; L2050 "*suu / *nei"; L2055 commonError "su (water) and ne (what) are irregular — they take a -y- buffer before any vowel-initial suffix (suyu, suya, suyum; neyi, neye)" | Relocate the irregularity: "su/ne take y where other vowel-final nouns take s/n — 3sg possessive suyu (not *susu), genitive suyun / neyin (not *sunun / *nenin). The ACC/DAT forms suyu/suya/neye are regular." |
| tr-a2-suffix-order-buffers | *çocuklarına* "their" with a plural + 3sg analysis | partial | L2039 "çocuklarına (to your/their children — çocuk-lar-ın-a…)": the segmentation is 2sg and "his/her" is missing | "to his/her/their (çocuk-lar-ı-n-a) or your (çocuk-lar-ın-a) children". |
| tr-a2-suffix-order-buffers | *Bardakta suyu* for "water in the glass" | page-only | — | — |
| tr-a2-suffix-order-buffers | hiatus ban attributed to vowel harmony | page-only | L2034 "-y- joins two vowels" is fine | — |
| tr-a2-ca-suffix | *Türkçe olarak* starred | partial | L2743 commonError "Treating 'in [a language]' as needing an extra word or case — the bare -CA form is both…" | "…bare Türkçe is the usual form; Türkçe olarak is also fine, especially in writing." |

## B1

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| tr-b1-causative-voice | causee dative for intransitive bases too (*Ali'ye koşturdum*) | partial | L3469 commonError "Forgetting the causee marking (-A dative for the demoted agent)." (gives the dative as the only marking) | "Causee is accusative when the base is intransitive (Ali'yi koşturdum, çocuğu uyuttum), dative when it is transitive (Deniz'e kapıyı açtırdı)." |
| tr-b1-causative-voice | -t on "polysyllabic OR vowel/l/r-final" stems; *kapat → kapat-* | **inherited** | L3428 "polysyllabic / vowel-, l-, r-final stems take -t (kapat-, uyut-)"; L3459 directive "-DIr causative on a polysyllabic stem not ending in a vowel, l or r (yaz- → yazdır-, yap- → yaptır-, öl- → öldür-)"; L3460 directive "-t causative on a stem ending in a vowel, l or r" | Per G&K 8.2.1.1: "-t only on POLYSYLLABIC stems ending in a vowel, l or r (uyut-, kaynat-, oturt-); ~30 monosyllables take -Ir/-Ar/-It; everything else, including monosyllabic l/r stems, takes -DIr (öldür-, gördür-, konuştur-)." Replace *kapat-* with *kaynat-*. Fix both directives: L3459 should say "on a monosyllabic stem, or a polysyllabic stem ending in another consonant", and L3460 should say "on a POLYSYLLABIC stem ending in…". |
| tr-b1-causative-voice | *içir-* called regular | page-only | — | — |
| tr-b1-abstract-postpositions | *onların hakklarında* | partial (genitive part only; the misspelling is page-only) | L4509 "but personal pronouns take genitive (benim hakkımda, onun yüzünden)" (no plural exception) | "…singular personal pronouns (and biz/siz) take the genitive; plural onlar stays bare (onlar hakkında)." |
| tr-b1-abstract-postpositions | "Group-1 = ile/için"; "all locative/ablative" | page-only | L4509 correctly says "Group-2" | — |
| tr-b1-converb-while-yken | "imperfective only" (ignores -mIşken, -AcAkken) | partial | L3589 "-ken attaches to an aorist/imperfective verb base or a nominal"; L3613 "attaches to the aorist/imperfective base, not -DI"; L3618 "Choosing the wrong base aspect" | "…attaches to any tense/aspect base except -DI (gelirken, geliyorken, gelmişken, gelecekken) or to a nominal." |
| tr-b1-obligation-periphrases | *bitmemiz gerekiyor* | page-only | L3381 uses the correct *bitirmemiz* | — |
| tr-b1-obligation-periphrases | "only zorunda takes bare -mAk" | **inherited** | L3398 "*Gitmek lazım benim. (wrong — gerek/lazım take -mA + possessive: gitmem lazım)"; L3402 commonError "Wrong nominalization: -mAk for zorunda vs -mA+possessive for gerek/lazım/şart." (contradicted by its own L3394 directive "Beklemek gerekiyor") | "Personal obligation uses -mA + possessive (gitmem lazım); an impersonal -mAk subject is also fine (gitmek lazım, beklemek gerekiyor)." Re-gloss L3398 as a word-order/person-mismatch error, or drop it. |
| tr-b1-obligation-periphrases | *almak malıyım* ✗ | page-only | — | — |
| tr-b1-olarak | *avukatı olarak* starred (possessive reading is fine) | **inherited** | L4489 "*avukatı olarak (wrong — olarak takes a bare noun, no case: avukat olarak)"; L4493 commonError "Case-marking the complement of olarak (avukatı olarak → avukat olarak)."; L4444 "after a bare noun" | Use a real case error such as *avukata olarak*. Add: "a possessive-marked complement is fine (şirketin avukatı olarak)". |
| tr-b1-olarak | *masaya benziyor* "needs gibi" | page-only | — | — |
| tr-b1-participles-dik-acak | "both suffixes 4-way" | page-only | — | — |
| tr-b1-passive-voice | *Burada sigara içilmez* called an impersonal passive of an intransitive | **inherited** | L3492 "Burada sigara içilmez. (Smoking is not done here — impersonal passive.)"; L3505 directive "the IMPERSONAL passive on an INTRANSITIVE verb … (Burada sigara içilmez; …)" | Replace with real intransitive impersonals (Burada koşulmaz; Bu yoldan gidilir; Nasıl gidilir?). Re-label *sigara içilmez* as a personal passive with a generic reading. |
| tr-b1-passive-voice | "always tarafından" for the agent | **inherited** | L3485 "Agent via "tarafından""; L3513 commonError "Expressing the agent with -DAn instead of "tarafından"." | "tarafından for animate (mostly human) agents; inanimate causes take -DAn or -DA (fırtınadan / fırtınada yıkıldı); institutions take -CA (okulumuzca)." Drop the L3513 commonError. |
| tr-b1-real-conditional | aorist given as -(I)r for all consonant stems | partial | L3240 name "Open / real conditional -(I)rsA"; L3259 "the aorist conditional -(I)rsA (gelirse)" | Write the marker as -(A/I)rsA, and add: "monosyllabic stems take -Ar (yaparsa), except the 13 -Ir verbs (gelirse, alırsa…); polysyllabic stems take -Ir". |
| tr-b1-real-conditional | git/et/de called irregular aorists | page-only | — | — |
| tr-b1-conditional-irrealis | -Irdı called "aorist conditional" | page-only | not in curriculum | — |
| tr-b1-reciprocal-voice | *yardımlaştık* starred | partial | L3562 "Unproductive reciprocal -(I)ş on a closed set"; L3576 "Treating -(I)ş as productive." (never mentions the productive noun + -lAş) | Add: "Noun + -lAş productively expresses mutual activity (yardımlaş-, mektuplaş-, haberleş-, selamlaş-)." |
| tr-b1-reciprocal-voice | *selamlaş-/mektuplaş-* analysed as verb + -(I)ş | **inherited** | L3562 "(öpüş-, görüş-, dövüş-, selamlaş- greet)" listed as reciprocal -(I)ş; L3569 "Mektuplaştılar." given as an example of the same | Remove selamlaş- from the -(I)ş list and annotate *Mektuplaştılar* as "noun mektup + -lAş". |
| tr-b1-reflexive-voice-kendi | *örtü- → örtün-* | page-only | L3530 lists "örtün-" with no wrong segmentation | — |
| tr-b1-since-converb | invented 3rd-person optative "-(y)AlI" | page-only | L3647 "Confusing -(y)AlI with the optative." is harmless | — |
| tr-b1-since-converb | -(y)AlI called four-way | page-only | — | — |
| tr-b1-when-converbs | -(y)IncA vs -DIğIndA "not interchangeable" | partial | L4618 description splits them strictly ("sequential trigger" vs "when the main situation is ongoing"); the L4605 comment calls them "a CONTRAST pair with different meanings"; L4625 example "Onu gördüğüm zaman çok mutlu oldum" is sequential, so the entry contradicts itself | "-DIğIndA / -DIğI zaman is characteristically the ongoing-background 'when', but it is often used interchangeably with -(y)IncA for sequence (Eve geldiğimde ararım)." |

## B2

| key | finding (short) | verdict | curriculum quote + line | suggested curriculum fix |
|---|---|---|---|---|
| tr-b2-as-if-gibi | "only -mIş can precede gibi" (aorist -Ir gibi exists) | partial | L4350 "(sanki) + -mIş gibi — a hypothetical/counterfactual manner clause on evidential -mIş + gibi"; L4348 name "(sanki) …-mIş gibi" | Add: "also aorist -(A/I)r gibi (uykuda gezer gibi) and -(A/I)rcAsInA / -mIşçAsInA". |
| tr-b2-as-if-gibi | nominal -(y)mIş gibi missing; -(I)yormuş mis-segmented | partial | L4350 "on evidential -mIş" (verbal only) | Add: "copular -(y)mIş on nominals: hastaymış gibi, çocukmuş gibi". |
| tr-b2-as-if-gibi | finite *duymuyor gibi* "ungrammatical" | **inherited** | L4374 commonError "Using a finite verb before gibi instead of -mIş (gördü gibi → görmüş gibi)."; L4376 "(duymuyor gibi vs duymuyormuş gibi)" | "Finite verb + gibi is grammatical but means 'seems to' (Beni duymuyor gibi); the 'as if' pretence needs -mIş/-(y)mIş." |
| tr-b2-aspectual-verbs | invented t-drop (*kapat- → kapayıver*) | page-only | L4288 uses *kapayıver* with no note (correct, from kapa-) | — |
| tr-b2-aspectual-verbs | "only -(y)Iver fully productive" (puts free -Ip dur- among the restricted forms) | **inherited** | L4284 description "Only -Iver is fully productive." (said after listing the free forms); L4297 directive "The only fully productive member" | "Among the BOUND auxiliaries only -(y)Iver is productive; the free -(y)Ip dur- / -(y)Ip kal- are productive too." |
| tr-b2-aspectual-verbs | *şaşır-* for *şaş-* | page-only | L4299 uses the correct "Şaşakaldı" | — |
| tr-b2-aspectual-verbs | -(y)A "back vowel a/e" | page-only | — | — |
| tr-b2-aspectual-verbs | Cyrillic in *gelivер-*, *gidiverdі* | page-only | — | — |
| tr-b2-compound-evidential-rivayet | -mIş host vs "no double -mIş" contradiction | page-only | L3872 omits -mIş from the host list; L3906 "*geliyormuşmuş" | — |
| tr-b2-compound-evidential-rivayet | *otururlarmış* "as is standard" | page-only | L3877 is a bare example | — |
| tr-b2-concessive | *gerektiği hâlde* both starred and correct | page-only | L4200/L4204 "*gerek hâlde" are coherent | — |
| tr-b2-concessive | "negative-style -mA" | page-only | — | — |
| tr-b2-conditional-formal | *gecikme hâlinde* starred | **inherited** | L4257 "-mAsI hâlinde … (-mA + possessive: gecikmesi hâlinde)"; L4267 "*gecikme hâlinde (wrong — needs the possessive on -mA: gecikmesi hâlinde)"; L4271 commonError "Dropping the possessive on the -mA noun (gecikme hâlinde → gecikmesi hâlinde)." | Delete L4267/L4271. Add: "hâlinde/durumunda also follow a bare noun (gecikme hâlinde, yangın durumunda); the possessive is needed when the clause has its own subject (ödeme gecikmesi hâlinde)." |
| tr-b2-converb-until | invented same/different-subject split; register reversed | page-only | L3783 has no such split | — |
| tr-b2-converb-until | -mAksIzIn "on the negative stem" | page-only | L3799 is correct | — |
| tr-b2-converb-until | -AnA without the (y) buffer | partial | L3781 name / L3783 description "-AnA kadar" | Write "-(y)AnA kadar" and add a vowel-stem example (okuyana kadar). |
| tr-b2-dir-generalizing | "-DIr never combines with past forms" | **inherited** | L4323 "Non-past"; L4333 "*Dün evdeydir (wrong — -DIr is non-past; past assumption is evde olmalıydı)"; L4338 "Attaching -DIr to a past predicate (evdeydir)." | "-DIr does not attach to -(y)DI, but -mIş + -DIr is the standard past assumption (gitmiştir, karşılaşmışızdır). evde olmalıydı mainly means 'should have been'." Replace the L4333 correction with *evde olmuştur / gitmiştir*. |
| tr-b2-dir-generalizing | *meşguldür* unexplained front harmony | page-only | — | — |
| tr-b2-double-voice | "second causative always -t" | partial | L4155 directive "a SECOND causative stacked directly on the first (yaptır- → yaptırt-, yazdır- → yazdırt-)": every example is -DIr → -t; L4160/L4165 are correct but narrow | Add the other direction: "-t follows -DIr/-Ir/-Ar; -DIr follows -t (okut-tur-, beklet-tir-, bit-ir-t-tir-)". |
| tr-b2-duration-throughout | *sürece* = süre + dative | page-only | — | — |
| tr-b2-duration-throughout | süresince "only after a bare noun" vs *Yokluğum süresince* | **inherited** | L3952 "süresince is its formal twin on a bare noun"; L3961 "süresince takes a bare noun, no case"; L3957 example *Yokluğum süresince* contradicts it | "süresince follows a caseless noun, which may be possessed (yokluğum süresince)". |
| tr-b2-duration-throughout | süresince = formal twin of boyunca / "throughout the whole" | **inherited** | L3952 "'Throughout / as long as' beyond B1 boyunca: süresince is its formal twin…" | "süresince 'during', without boyunca's emphasis on the whole span". |
| tr-b2-instead-of | *seyredeceği yerde* person mismatch | page-only | L4228 uses the correct *seyredeceğin yerde* | — |
| tr-b2-instead-of | "same subject required" | page-only | — | — |
| tr-b2-instead-of | "yerde is not the locative" | page-only | — | — |
| tr-b2-participle-aorist | *inanmaz* glossed "unbelievable" | page-only | L3734 "inanılmaz … inan-ıl-maz" is correct | — |
| tr-b2-proportion-assoon | aorist rule reversed | page-only | the curriculum does not state the rule | — |
| tr-b2-proportion-assoon | *gördükçe* "no co-reference" | page-only | L3925 is a bare example | — |
| tr-b2-reported-directives | *senden … gelmenizi* | page-only | — | — |

## Curriculum-only errors

These are high-confidence errors the audit did not flag. All of them are in fields that reach the prompts.

1. **tr-a1-vowel-harmony, L308 description**: "4-way (i/ı/u/ü): accusative -(y)I, possessive -(s)I, **dative**, past -DI." The dative -(y)A is 2-way (a/e). The L319 example (*köprüye … → -ye*) is itself 2-way. **Fix:** move "dative -(y)A" into the 2-way list. (The L280 coverageSpec code comment "4-way -(y)I/-(y)A" has the same slip, but it is not injected.)
2. **tr-b1-causative-voice, L3459 directive**: "-DIr causative on a **polysyllabic** stem not ending in a vowel, l or r (yaz- → yazdır-, yap- → yaptır-, öl- → öldür-)". All three examples are monosyllabic, and *öl-* ends in l. Separately, **L3460 directive** "-t causative on a stem ending in a vowel, l or r" drops the polysyllabic condition, which would license *\*gelt-* or *\*ölt-*. This overlaps the inherited allomorphy finding, but these are distinct injected fields from the description the audit traced. G&K 08-inflectional-suffixes.md L335: "Polysyllabic stems ending in a vowel, 'l' or 'r' combine with -t. In all other circumstances -DIr is used."
3. **tr-b2-participle-aorist, L3739 / L3743**: "*akmaz su (wrong **allomorph** and sense…)" and "Wrong aorist allomorph on the stem (**akmaz** / aker for akar)". *-mAz* is the negative aorist, not an allomorph of -Ar, and *akmaz su* ("still / non-flowing water") is grammatical. **Fix:** relabel it "opposite meaning (negative participle)", and keep only *\*aker* as the allomorph error.

Not counted as errors, but worth noting:
- tr-a2-spatial-postpositions stars *ev önünde* (L2943) while its own L2945/L2951 teach the bare-complement exception (listed above as partial).
- tr-b1-obligation-periphrases bans bare -mAk with gerek/lazım (L3402) while its own directive (L3394) uses *Beklemek gerekiyor* (listed above as inherited).
