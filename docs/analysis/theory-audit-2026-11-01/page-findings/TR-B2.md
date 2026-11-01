# Theory audit — TR B2 (17 pages, prod `theory_topics`, read 2026-11-01)

Book = Göksel & Kerslake, *Turkish: A Comprehensive Grammar* (markdown mirror, chapters/).

## tr-b2-as-if-gibi

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls — "Only the evidential/reported suffix -mIş can precede gibi in this construction." (also when to use it: "it always requires a verb stem carrying -mIş or -(I)yormuş before gibi")
- **Problem**: G&K lists the aorist form -(A/I)r gibi as an "as if" form too ("(Sanki) uykuda gezer gibi dolaştım" = "I wandered around as if sleepwalking"), along with -(A/I)rcAsInA, -mIşçAsInA and -(y)mIşçAsInA. "Only -mIş" is false.
- **Source**: G&K §26.3.8 (ii), ex. (67)

- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it / common pitfalls — "The «as if» construction always has a verb stem + -mIş before gibi"
- **Problem**: The marker can also be the evidential copula -(y)mIş on a nominal predicate (sanki hastaymış gibi, çocukmuş gibi, evde değilmiş gibi). G&K names "-mIş/-(y)mIş gibi" explicitly. Learners are told nominal "as if" clauses are impossible. The page also calls -(I)yormuş the "-(I)yor + -muş" evidential past, but it is really -(I)yor + the copula -(y)mIş (G&K ex. 19: davran-ıyor-muş-uz gibi).
- **Source**: G&K §26.1.5

- **Severity**: error
- **Confidence**: medium
- **Location**: common pitfalls — "✗ duymuyor gibi (ungrammatical — finite present cannot precede gibi here)"
- **Problem**: A finite verb + gibi is grammatical in the "seems" reading (Beni duymuyor gibi = "he seems not to hear me"), and G&K gives a finite predicate before gibi dur- ("…memnunsunuz gibi duruyor"). It is not the counterfactual "as if" frame, but calling it ungrammatical is wrong.
- **Source**: G&K §24.5 ex. (139b); expert knowledge

## tr-b2-aspectual-verbs

- **Severity**: error
- **Confidence**: high
- **Location**: examples in context, note on "Şu pencereyi kapayıver." — "kapat- → kapayıver (stem-final t drops before the converb vowel in colloquial speech; the buffer -y- appears after the resulting vowel)"
- **Problem**: There is no t-dropping rule. kapayıver- is built on the separate verb kapa- ("close"), and kapat- gives kapatıver- (the page's own table lists kapatıver-). The invented rule would lead learners to produce *gideyiver- and similar forms.
- **Source**: expert knowledge (kapa-/kapat- are distinct lexical verbs)

- **Severity**: misleading
- **Confidence**: high
- **Location**: what is it? — "Of all these patterns, only -(y)Iver is fully productive in modern Turkish; the others are restricted to a fixed set of verbs or registers."
- **Problem**: G&K says the free forms -(y)Ip dur- and -(y)Ip kal- are *more productive* than their bound counterparts (gidip duruyor, etc.). Only the bound -(y)Agel/-(y)Ayaz/-(y)Akal/-(y)Adur forms are (semi-)lexicalized. The sentence puts -(y)Ip dur- among the restricted forms.
- **Source**: G&K §13.3.1.1 ("These separate verb forms are more productive than their suffixed counterparts")

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it — "-(y)Akal … The set of verbs that take this auxiliary is small (e.g. don-, kal-, şaşır-)."
- **Problem**: G&K: -(y)Akal is "almost exclusively used with bak-, don-, şaş-" (bakakal-, donakal-, şaşakal-). The stem is şaş-, not şaşır- (*şaşırakal- is not the standard form).
- **Source**: G&K §13.3.1.1

- **Severity**: error
- **Confidence**: high
- **Location**: formation — "Bound auxiliaries take the -(y)A converb (back vowel a/e)"
- **Problem**: -(y)A is two-way a/e harmony. "e" is a front vowel, so "back vowel" is wrong. The table states it correctly ("2-way harmony").
- **Source**: expert knowledge

- **Severity**: error (typo, but a wrong form is displayed)
- **Confidence**: high
- **Location**: formation callout "gelivер-" and pitfalls "✓ gidiverdі"
- **Problem**: These contain Cyrillic letters (е, р / і), so the "correct" forms are not valid Turkish strings. Copy-paste or search would fail.
- **Source**: n/a

## tr-b2-compound-evidential-rivayet (manual-approved)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation — "After a consonant-final suffix (-Iyor, -Ir/-Ar, -AcAk, -mIş) -mIş attaches directly" vs. common pitfalls — "stacking it twice … is ungrammatical. One instance of -(y)mIş is always sufficient."
- **Problem**: The page contradicts itself. Formation lists -mIş as a host for -(y)mIş, which implies gelmişmiş, but the pitfall says double -mIş is ungrammatical. Pick one position (colloquial -mIşmIş does exist, with a sceptical nuance).
- **Source**: internal contradiction

- **Severity**: misleading
- **Confidence**: medium
- **Location**: examples, "otururlarmış" note — "The 3rd plural aorist -lAr precedes the copula here, as is standard for 3rd plural aorist evidential."
- **Problem**: otururmuşlar (-lAr after the copula) is equally standard and arguably more common. The page's own person table puts -lAr after (geliyormuşlar). "As is standard" implies otururmuşlar is wrong.
- **Source**: expert knowledge (cf. G&K §8.3 on the position of 3pl -lAr with copular markers)

## tr-b2-concessive

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls — "gerek hâlde or gerektiği hâlde without the possessive is not standard. The correct form is gerektiği hâlde"
- **Problem**: This contradicts itself. It flags gerektiği hâlde as non-standard and then gives the identical string as correct. The intended wrong form was presumably *gerektik hâlde.
- **Source**: internal contradiction

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation — "add the negative-style nominal suffix -mA (action noun)"
- **Problem**: The nominalizer -mA is not negative. It is homophonous with the negative -mA but is a different suffix with different stress behaviour. Calling it "negative-style" invites confusion with gelmemesine.
- **Source**: G&K §26.3.8(iv) note on the two -mA's; expert knowledge

## tr-b2-conditional-formal (manual-approved)

- **Severity**: error
- **Confidence**: high
- **Location**: common pitfalls — "write gecikmesi hâlinde, not *gecikme hâlinde. Omitting the possessive breaks the construction."
- **Problem**: hâlinde/durumunda freely follow a bare noun or action noun: gecikme hâlinde, ihtiyaç hâlinde, kaza hâlinde, yangın durumunda. "Ödemede gecikme hâlinde…" is standard contract language. The possessive is required only when the -mA clause has its own subject (Ödeme gecikmesi hâlinde). Starring gecikme hâlinde is wrong. The "possessive must never be dropped" line in formation has the same problem.
- **Source**: expert knowledge (G&K §27.6.1 covers only the clausal -mAsI form)

## tr-b2-converb-until

- **Severity**: error
- **Confidence**: high
- **Location**: when to use it — "-(y)IncAyA kadar — use when the subject of the subordinate clause is different…" / "-AnA kadar — use when the subject of the subordinate clause is the same as the main-clause subject"
- **Problem**: This subject distinction is invented. G&K treats the two as the same construction with the same two meanings ("until" / "by the time"). The only difference is register: -(y)AnA kadar is the colloquial version. "Sen gelene kadar bekleyeceğim" is perfectly normal. The page also says -(y)IncAyA is "the more common … spoken form", but it is the more formal one.
- **Source**: G&K §26.3.16 (vii); §8.5.2.2 ("-(y)AnA is a colloquial version")

- **Severity**: error
- **Confidence**: medium
- **Location**: formation — "-mAksIzIn is a fixed suffix added directly to the negative verb stem (the -mA- base)"
- **Problem**: -mAksIzIn attaches to the plain verb stem (dur-maksızın, not dur-ma-ksızın). Its -mA- comes from the infinitive -mAk, not the negative. G&K makes this point for -mAdAn versus -mAksIzIn.
- **Source**: G&K §26.3.8 (iv)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation — "-AnA kadar uses the converb suffix -AnA"
- **Problem**: The suffix is -(y)AnA. Vowel-final stems take buffer y (okuyana kadar, uyuyana kadar). The table only shows consonant stems, so a learner would produce *okuana.
- **Source**: G&K §8.5.2.2

## tr-b2-dir-generalizing (manual-approved)

- **Severity**: misleading
- **Confidence**: high
- **Location**: when to use it — "It never combines with past-tense forms — a past inference uses a different construction (evde olmalıydı)."
- **Problem**: The standard past-assumption form is -mIş + -DIr: Herhalde bir yerlerde karşılaşmışızdır ("We have probably met somewhere"), gitmiştir, evde olmuştur. The page lists gelmiştir under formation itself. Also, evde olmalıydı mainly reads as "she should have been at home". Only -DI-past hosts are excluded.
- **Source**: G&K §21.4.1 ex. (81); §21.4.1.2 (-mIştIr)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: formation table — "meşgul (busy) | l — voiced | -dür | meşguldür"
- **Problem**: The form is correct, but the table implies that harmony after a back vowel "u" gives -dür, which contradicts the 4-way harmony rule it has just taught. meşgul is a loanword with a palatal (front) l, which is why it takes front-vowel suffixes. Without that note the row teaches a wrong harmony rule.
- **Source**: expert knowledge (G&K ch. 3 on exceptional loanword harmony)

## tr-b2-double-voice

- **Severity**: error
- **Confidence**: high
- **Location**: when to use it / formation callout / pitfalls — "The second causative suffix is always -t-, not a second -dir-" ("Always use the short -t- for the second causative slot.")
- **Problem**: Which causative form appears is decided by the preceding segment, not by slot. -t follows -DIr/-Ir/-Ar (which end in r), but -DIr follows -t or -Art: okut-tur-, bekle-t-tir-, bit-ir-t-tir-. "Always -t-" produces *okutt-, *beklett-.
- **Source**: G&K §8.2.1.1 ("Thus -t follows -DIr, -Ir or -Ar … and -DIr follows -t or -Art: bit-ir-t-tir-di")

## tr-b2-duration-throughout

- **Severity**: error
- **Confidence**: high
- **Location**: formation — "sürece (which is süre + dative -ce in its lexicalised form)"
- **Problem**: -CA is the equative/adverbial suffix, not the dative. The dative of süre is süreye.
- **Source**: G&K §8.1 / §7.2.2.2 on -CA

- **Severity**: error
- **Confidence**: high
- **Location**: formation — "Place it directly after the noun in its bare (nominative) form — no case suffix, no possessive." vs. example "Yokluğum süresince" (note: "carries a possessive suffix")
- **Problem**: This contradicts the page's own example, which is G&K's example. Possessed nouns before süresince are normal.
- **Source**: G&K §17.3 (vi) ex. (94)

- **Severity**: misleading
- **Confidence**: medium
- **Location**: what is it? — "Both are formal alternatives to the more common boyunca" and süresince = "throughout / during the whole of"
- **Problem**: -DIğI sürece is not an alternative to boyunca, which cannot take a clause. G&K also says süresince differs from boyunca precisely in *not* emphasizing the length or whole span ("During my absence…"). The page gives it the meaning that belongs to boyunca.
- **Source**: G&K §17.3 (vi)

## tr-b2-instead-of

- **Severity**: error
- **Confidence**: high
- **Location**: formation — "-AcAğI yerde uses the same future participle with a 3rd-person possessive" + example "Televizyon seyredeceği yerde kitap oku." ("Read a book instead of watching TV.")
- **Problem**: The possessive agrees with the subject, as with every -DIK/-AcAK clause. An imperative addressed to "you" needs seyredeceğin yerde. The example sentence has a person mismatch and the rule is wrong.
- **Source**: G&K §8.1.3 (possessive on -(y)AcAK marks the subordinate subject)

- **Severity**: error
- **Confidence**: high
- **Location**: when to use it — "All three frames require the subject of the rejected action and the preferred action to be the same person. When subjects differ, use yerine with a noun phrase instead."
- **Problem**: -(y)AcAğInA carries its own person-marked possessive, so different subjects are fine: Sen gideceğine ben gideyim. For -mAk yerine, the different-subject version is -mAsI yerine (senin gitmen yerine), which is a clause, not "a noun phrase".
- **Source**: expert knowledge; G&K §26.3.15

- **Severity**: misleading
- **Confidence**: medium
- **Location**: when to use it — "Yerde here means «in place of» and is not the locative of yer"
- **Problem**: Morphologically it is exactly yer + locative -DA. The meaning is idiomatic, but saying it is "not the locative" is false.
- **Source**: expert knowledge

## tr-b2-participle-aorist (manual-approved)

- **Severity**: error
- **Confidence**: high
- **Location**: formation table — "inanmak | inanır | inanmaz | believing / unbelievable"
- **Problem**: inanmaz means "not believing / unbelieving" (inanmaz bir bakış). "Unbelievable" is the passive inanılmaz, which the page correctly derives elsewhere (inan-ıl-mAz). The table conflates the two.
- **Source**: expert knowledge

## tr-b2-proportion-assoon

- **Severity**: error
- **Confidence**: high
- **Location**: formation callout — "The aorist marker for most consonant-final stems is -Ir/-Ur/-Ür … A small set of monosyllabic consonant-final stems take -Ar (e.g. gel-ir is regular; var-ır is also regular). Consult your aorist reference for the irregular group."
- **Problem**: This reverses the rule. Monosyllabic consonant-final stems take -Ar by default (çıkar, yapar, kaçar), except 13 that take -Ir (al, bil, bul, dur, gel, gör, kal, ol, öl, san, var, ver, vur). Polysyllabic stems take -Ir. The examples in parentheses are the -Ir exceptions mislabelled as illustrating -Ar, and the page's own table (çıkar, kaynar) contradicts it. This is the same class of bug as the known aorist-page defect.
- **Source**: G&K §8.2.3 (aorist); the B2 participle-aorist page states the correct rule

- **Severity**: misleading
- **Confidence**: high
- **Location**: examples, note on "Onu gördükçe anneni hatırlıyorum." — "the subordinate subject (ben) differs from the object (onu), illustrating that -DIkçA does not require co-reference"
- **Problem**: Both clauses have the same subject (ben), so the example shows co-reference, the opposite of the claim. Comparing a subject with an object is meaningless here.
- **Source**: internal logic

## tr-b2-reported-directives

- **Severity**: error
- **Confidence**: high
- **Location**: examples — "Senden erken gelmenizi değil, benden erken gitmemi rica etti."
- **Problem**: Person mismatch. senden (2sg) is paired with gelmenizi (2pl). It should be senden … gelmeni or sizden … gelmenizi.
- **Source**: expert knowledge

Clean pages (no findings): tr-b2-compound-past-hikaye, tr-b2-participle-mis, tr-b2-reported-questions, tr-b2-reported-statements
