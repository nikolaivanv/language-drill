# TR-B2 theory patch notes

All 13 pages with findings were patched. The patch file builds cleanly with `apply_patch.py`: every page prints `ok` and there are no mixed-script warnings. The four clean pages (compound-past-hikaye, participle-mis, reported-questions, reported-statements) were left untouched.

## tr-b2-as-if-gibi
- F1 "Only -mIş can precede gibi": **fixed**. Checked against G&K §26.3.8(ii) ex. 67. The pitfall now says -mIş (or the copula -(y)mIş) normally precedes gibi and that the aorist is also possible (uykuda gezer gibi). The ✗ gördü gibi example is kept, but the reason is now "-dI reports a real event and does not give the «as if» reading".
- F2 nominal -(y)mIş / -(I)yormuş = -(I)yor + copula: **fixed**. Checked against G&K §26.1.5 ex. 19. Formation now names -(I)yormuş as -(I)yor + the evidential copula and adds the nominal form (sanki) hastaymış gibi. The "when to use" and pitfall lines now say "predicate marked with -mIş / -(y)mIş" where they used to say "verb stem + -mIş".
- F3 ✗ duymuyor gibi: **fixed (reframed)**. The pitfall no longer calls it ungrammatical. It now contrasts duymuyor gibi (the «seems not to hear» reading) with duymuyormuş gibi (pretence).

## tr-b2-aspectual-verbs
- F1 kapayıver t-drop: **fixed**. G&K ex. 74 itself uses kapa-yıver. The note now says the form comes from the separate verb kapa- (vowel-final, so buffer y), and that kapat- gives kapatıver-.
- F2 productivity: **fixed**. Checked against G&K §13.3.1.1. Only -(y)Iver is fully productive *among the bound forms*, and the free -(y)Ip dur-/kal- forms are said to be productive (more so than the bound ones). The pitfall "Only -(y)Iver…" is scoped to the bound auxiliaries.
- F3 -(y)Akal verbs: **fixed**. "don-, kal-, şaşır-" became "bak-, don-, şaş-" (bakakal-, donakal-, şaşakal-), following G&K.
- F4 "back vowel a/e": **fixed**. Now reads "two-way harmony a/e".
- F5 Cyrillic: **fixed**. gelivер- → geliver-, gidiverdі → gidiverdi.

## tr-b2-compound-evidential-rivayet
- F1 -mIş as host vs. "stacking twice is ungrammatical": **fixed**. Formation was kept, since G&K ch. 23 ex. 27 has bitirmişmiş, and çalışmışmış was added to its list. The pitfall now says the copula appears once per word (*geliyormuşmuş) and that perfective -mIş can host it (bitirmişmiş).
- F2 otururlarmış "as is standard": **fixed**. The note now says otururmuşlar is equally standard and points to geliyormuşlar in the table.

## tr-b2-concessive
- F1 gerektiği hâlde marked as both wrong and right: **fixed**. The wrong form is now *gerektik hâlde.
- F2 "negative-style -mA": **fixed**. Now reads "action-noun suffix -mA (not the negative -mA, though the two look alike and can co-occur: gel-me-me-si)".

## tr-b2-conditional-formal
- F1 *gecikme hâlinde: **fixed (reframed)**. Formation now says the possessive is required when the clause has its own subject (ödeme gecikmesi hâlinde), and that a bare noun is also standard (gecikme hâlinde, ihtiyaç hâlinde, yangın durumunda). The pitfall's ✗ example is now *ödeme gecikme hâlinde, which really is wrong.

## tr-b2-converb-until
- F1 invented subject distinction and register: **fixed**. Checked against G&K §26.3.16(vii) and §8.5.2.2. -(y)IncAyA kadar is described as the formal form and -(y)AnA kadar as its colloquial version, with the same two meanings ("until" / "by the time") and either subject. Example notes 3/0 and 3/2 were changed to match.
- F2 -mAksIzIn on the "negative stem": **fixed**. It now attaches to the plain stem; its -mA- comes from the infinitive -mAk (contrasted with -mAdAn).
- F3 -AnA → -(y)AnA: **fixed**. Changed in the subtitle, intro, formation and table head. Added the buffer-y rule and a row okumak → okuyana kadar.

## tr-b2-dir-generalizing
- F1 "never combines with past": **fixed**. The bullet is now "Not on the -DI past". It lists -mIş + -DIr as the past-assumption form (gitmiştir, bir yerlerde karşılaşmışızdır) and drops evde olmalıydı. The pitfall now uses *geldidir / *evdeydidir and points to gelmiştir. The old "*evdeydir" wasn't even a past form.
- F2 meşgul -dür: **fixed**. The table's "final sound" cell now explains it is a loanword with a front l, so it takes a front vowel.

## tr-b2-double-voice
- F1 "always -t-": **fixed**. Checked against G&K §8.2.1.1. After -DIr-/-Ir-/-Ar- the second causative is -t- (yaptırt-, yazdırt-), and after -t- it is -DIr- (okuttur-, beklettir-). This is now applied in "when to use", the formation callout (adds *okutt-) and the pitfall.

## tr-b2-duration-throughout
- F1 "süre + dative -ce": **fixed**. Now reads "süre + the suffix -ce — the equative/adverbial -CA, not the dative (süreye)".
- F2 "no possessive": **fixed**. Formation now allows a possessive (yokluğum süresince). The callout pattern became "[noun (± possessive)]" with the yokluğum example, and the pitfall says "nominative (may carry a possessive)".
- F3 süresince meaning / "both are alternatives to boyunca": **fixed**. Checked against G&K §17.3(vi). The intro now gives süresince = «during / for the duration of», a formal near-synonym of boyunca that does *not* stress the length of the period, and says -DIğI sürece has no boyunca equivalent. The "when to use" bullet was changed to match. Example glosses ("throughout the lecture/war") were left as they are, since they remain acceptable translations.

## tr-b2-instead-of
- F1 -AcAğI yerde possessive and person mismatch: **fixed**. Formation now says the possessive agrees with the subject (-AcAğIn yerde / -AcAğI yerde). The table head is now "3rd sg. form". The example became "Televizyon seyredeceğin yerde kitap oku." with a 2sg note (t→d, k→ğ). The pitfall now says "possessive + yerde".
- F2 same-subject requirement: **fixed**. The bullet was replaced with "Different subjects": Sen gideceğine ben gideyim, and -mA + possessive + yerine (Senin gitmen yerine ben gideyim) for -mAk yerine.
- F3 "not the locative of yer": **fixed**. Now reads "yer + the locative -DA, used idiomatically".

## tr-b2-participle-aorist
- F1 inanmaz = "unbelievable": **fixed**. The row meaning is now "believing / unbelieving (for «unbelievable» use the passive inanılmaz)".

## tr-b2-proportion-assoon
- F1 aorist rule reversed: **fixed**. The callout was rewritten: vowel stems take -r; monosyllabic consonant stems take -Ar except the 13 -Ir verbs (listed); polysyllabic stems take -Ir. This now matches the table (çıkar, kaynar, gelir, görür).
- F2 co-reference note: **fixed**. The note now says both clauses share the subject (ben) and gives a different-subject example (Sen geldikçe sevinirim).

## tr-b2-reported-directives
- F1 senden … gelmenizi: **fixed**. Changed to "Senden erken gelmeni değil, …" (2sg throughout). The gloss is unchanged and still matches.

No findings were skipped.
