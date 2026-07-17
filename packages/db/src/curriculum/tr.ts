import { CefrLevel, Language } from '@language-drill/shared';

import type { GrammarPoint } from './types';

// TR curriculum aligned to Yedi İklim A1+A2 parity (2026-05-28) plus B1
// (2026-06-19), B2 (2026-07-07), and G&K reverse-coverage passes:
// 27 A1 + 22 A2 + 11 B1 + 19 B2 grammar entries, 15 themed vocab
// umbrellas (5 each A1/A2/B1), 3 dictation, 9 free-writing. B2 is grammar-only
// this cycle (no B2 vocab/dictation/free-writing umbrellas). See
// docs/superpowers/specs/2026-07-07-tr-b2-curriculum-design.md.
const TR = Language.TR;
const { A1, A2, B1, B2 } = CefrLevel;

/**
 * Per-language curriculum version. Bump in the same commit as any edit to
 * this file's grammar entries (analogous to `*_PROMPT_VERSION` in
 * `packages/ai/src/`). The scheduler in `infra/lambda/src/generation/`
 * compares this to the value recorded on the most recent succeeded
 * generation_jobs row for each cell — when they differ, any
 * "saturated-dedup" or "low-yield" suppression on that cell clears, on the
 * assumption that the curriculum edit may have unblocked the search space.
 *
 * Current value `2026-06-13` was bumped to clear the scheduler's `low-yield`
 * suppression on `tr-a1-possessive-suffixes` cloze (and any other
 * low-yield-suppressed TR cell) after the 2026-06-12 generation + validation
 * prompt fixes (#265 / #269). Those fixes unblocked the cell's approval rate but,
 * being prompt-only, did not touch this constant — and `decideEnqueue` keys
 * suppression-clearing on the curriculum version, NOT on the prompt version, so
 * the scheduler kept skipping the cell (its 06-08 run approved 1 < the low-yield
 * threshold of 3). Bumping here forces a fresh attempt under the new prompts.
 * A later same-day edit sharpened the `tr-a1-vowel-harmony` commonErrors to name
 * the soft-l ("ince l") loanword plural exception (meşgul → meşguller); the
 * version value is unchanged because it is already today's date and the
 * YYYY-MM-DD format (asserted in curriculum.test.ts) admits no same-day variant.
 * The generator reads the curriculum live at run time, so its next scheduled run
 * picks up the new bullet regardless; the version only gates suppression-clearing,
 * which the (non-suppressed) vowel-harmony cell does not need. Prior `2026-06-07`
 * was the #220 book-grounded audit of all 40 grammar points + Yedi İklim A1+A2 parity.
 *
 * 2026-06-16: added the tr-a1/a2-dictation umbrellas (clears suppression so the
 * scheduler enumerates the new dictation cells).
 * 2026-06-16b: clears the saturated-dedup suppression on tr-a1-dictation after the
 * generation-diversity fix (domain rotation + lower targets); curriculum entries unchanged.
 * 2026-06-16c: flags two verb-morphology points (`tr-a1-dili-past`, `tr-a2-aorist`)
 * with `conjugationSuitable: true` + a merged `polarity` axis; the bump clears any
 * low-yield / saturated-dedup suppression so the new CONJUGATION cells run.
 * 2026-06-17: added 3 A1 + 3 A2 free-writing topic umbrellas (kind 'free-writing');
 * bump enumerates the new free-writing cells.
 * 2026-06-19: TR B1 enabled — 10 grammar + 5 vocab + dictation + 3 free-writing
 * (Yedi İklim B1, G&K-grounded). Bump clears low-yield/saturation suppression.
 * 2026-06-19b: five TR A1 nominal-inflection points flagged conjugationSuitable
 * with case/number/stacking coverage specs (personal-suffixes copula, possessive
 * +case stacking, locative, accusative-definite-object, ablative-dative); clears
 * suppression so the new CONJUGATION cells are enqueued.
 * 2026-06-20b: G&K reverse-coverage audit pass — adds 1 A1 + 4 A2 grammar
 * points that were missing from the Yedi İklim-derived set: tr-a1-stem-changes
 * (consonant softening + vowel drop), tr-a2-indefinite-compound (belirtisiz
 * isim tamlaması), tr-a2-suffix-order-buffers (ordering template + y/n/s
 * buffers + su/ne), tr-a2-optative, tr-a2-indefinite-pronouns. Bump enumerates
 * the new cells.
 * 2026-06-20c: G&K audit round 2 — adds tr-a2-consonant-doubling (gemination),
 * tr-a2-reflexive-reciprocal-pronouns (kendi/birbiri), tr-a2-distributive
 * (-(ş)Ar), and tr-b1-real-conditional (open -(I)rsA). Folds: -(y)Iş manner,
 * headless relatives, and the de-/ye- vowel raising into existing points.
 * 2026-06-21: flags tr-a1-stem-changes, tr-a2-consonant-doubling, and
 * tr-a2-reflexive-reciprocal-pronouns as clozeUnsuitable after the 2026-06-21
 * run showed their single-blank cloze cells emitting ambiguous /
 * feature-invisible drafts (1/41, 5/57, 9/39 approved); translation + (where
 * set) conjugation remain. Also adds a person×case coverageSpec to
 * tr-a2-suffix-order-buffers — its translation cell dedup-gave-up 19/88 (7
 * approved); the buffers are person/case conditioned, so the spec targets them
 * with the allowed axes. Bump retires those cloze cells and re-runs survivors.
 * 2026-06-23: caps tr-a2-consonant-doubling translation via targetOverride: 10
 * after the 2026-06-22 run yielded 2/27 — gemination is bypassable in free
 * translation and the closed Arabic-origin set is tiny, so the A2 default (30)
 * just ground out dedup/ambiguous waste. Pairs with a generate@2026-06-23
 * prompt rule (force the vowel suffix + enumerate synonym renderings) and a new
 * indefinite-noun-compound cloze rule (bare-head hint, nominative answer, no
 * case-stacking) for tr-a2-indefinite-compound (8/49). Bump clears the
 * low-yield suppression on consonant-doubling translation so it re-runs.
 * 2026-06-23b: tr-a1-dictation gets targetOverride: 15 (was the level default
 * 6, where the pool had stalled). Pairs with dictation generate+validate
 * @2026-06-23 prompts now receiving the curriculum level-scope, so in-scope A1
 * morphology (consonant softening, present-continuous -iyor) is no longer
 * mis-flagged as A2, plus a per-ordinal frequency seed for clip diversity.
 * Bump clears any lingering tr-a1-dictation suppression so need=15-6=9 re-runs.
 * 2026-06-25: clears the low-yield suppression on tr-a2-indefinite-compound
 * cloze. The 2026-06-24 run produced only 2/19 approved (< LOW_YIELD_THRESHOLD)
 * because the new head-only-blank generation rule (generate@2026-06-23) was
 * rejected by the unchanged validator as grammar-point-mismatch — generate and
 * validate disagreed on the cell's correct shape. Pairs with a per-cell
 * validation note (validation-prompts.ts clozeCellScoringNote) that accepts the
 * head-only blank as BY DESIGN, plus a dictation generate@2026-06-25 anti-
 * stacking constraint + level/safety-subordinate seed line. Bump re-runs the
 * suppressed cloze cell against the corrected validator.
 * 2026-06-25b: raises the dictation target to 30 for all three TR levels
 * (tr-a1-dictation 15→30, tr-a2-dictation + tr-b1-dictation default→30) to build
 * deeper dictation pools. Bump clears any target-reached/low-yield suppression so
 * each cell re-runs for need = 30 - approved.
 * 2026-06-28: flags the two remaining full-paradigm A1 finite TENSE points —
 * tr-a1-present-continuous (-(I)yor) and tr-a1-future (-(y)AcAk) — with
 * conjugationSuitable: true (default verb seed). Both already carry a person-axis
 * coverageSpec, so the new CONJUGATION cells inherit person (and, for present-
 * continuous, polarity) variety. This brings the conjugation-drill surface to
 * parity with the already-enabled -DI past + aorist. Other person-marked verb
 * points are deliberately NOT flagged: mis-evidential / ability-necessity regress
 * under person rotation (see the eval-excluded set in curriculum.test.ts), and
 * conditional-irrealis / passive / reflexive- & reciprocal-voice / reported-speech
 * are multi-construction or closed-set (free per-person production is ambiguous,
 * which is why their free-production surfaces are already off). Bump enumerates the
 * two new conjugation cells + clears any suppression on them.
 * 2026-06-29: switches the six nominal-inflection conjugation points (personal-
 * suffixes, possessive-suffixes, locative, accusative-definite-object, ablative-
 * dative, possessive-case-stacking) from conjugationSeedKind 'none' (unseeded) to
 * 'noun' — they now seed each ordinal from the noun band. Unseeded, the model
 * converged on a couple of nouns (ablative-dative collapsed onto okul/uçak, ~4
 * distinct identities) and the cells exhausted their identity space, churning
 * drafts into dedup give-ups for near-zero approvals. Seeding distinct nouns
 * restores lexical variety so the pools grow. Bump clears the target-reached/
 * low-yield suppression so each cell re-runs with the noun seed.
 * 2026-06-30: re-keys personal-suffixes from conjugationSeedKind 'noun' to
 * 'predicate-nominal' with a curated predicate pool. The 06-29 noun seeding
 * fixed the dedup collapse but, on the COPULA, fed object nouns into "subject IS
 * <noun>" frames — "Sen kedisin / dalgasın" ("you are a cat / a wave") — which
 * the validator rejected (23% approval). Predicate-nominal seeds professions /
 * roles / nationalities / adjectives that form natural copular predicates. Bump
 * clears suppression so the cell re-runs with the predicate seed.
 * 2026-07-08: digit-form elicitation for tr-a1-numbers-ordinals
 * (selfRevealingElicitation + curated value pool) after the identity-space
 * collapse (18/20 approved translations contained 'üçüncü'). Bump clears
 * suppression so below-target TR cells re-run; the collapsed numbers-ordinals
 * rows must ALSO be demoted (pnpm demote:pool) or the cells stay at target
 * and never regenerate.
 * 2026-07-10: G&K reverse-audit fills — 5 A2 + 2 B1 core gaps found missing vs
 * Göksel & Kerslake: spatial relational postpositions (evin önünde), nominal
 * past/evidential copula (hastaydım), focus clitics dA/bile, -lI/-sIz, enumerator
 * tane; suppletive ol-, olarak. Bump enumerates the new cells + clears
 * suppression. See docs/superpowers/specs/2026-07-10-tr-audit-gap-fills-design.md.
 * 2026-07-10a: adds the `kind: 'paraphrase'` umbrella (`tr-b1-paraphrase`) that
 * owns the new contextual-paraphrase generation cell; the bump enumerates it on
 * the next scheduler tick.
 * 2026-07-16a: clears low-yield suppression on the A1 vocab cells (home-objects
 * approved 2/6 on 2026-07-16; transport-places 3/8 with 3 ambiguous flags)
 * after the vocab_recall near-synonym rule in `generate@2026-07-16` /
 * `validate@2026-07-16`: definitions that equally fit istasyon/gar or
 * alışveriş merkezi/mağaza can now enumerate the alternates in the new
 * vocab `acceptableAnswers` content field instead of flagging ambiguous.
 * 2026-07-16b: 5 new points from the G&K book-coverage triage (clock time,
 * adversative connectors, abstract postpositions, -DIğI için reason clauses,
 * "when" converbs) + 63 fold widenings across 38 points; see
 * docs/analysis/tr-gk-book-coverage-audit-2026-07-16.md.
 * 2026-07-17: adds a person (2sg/2pl) + polarity coverageSpec to
 * tr-a1-imperative — the unspec'd pool had collapsed onto affirmative 2sg
 * (bare stem), so 2pl/formal -(y)In and the negative -mA halves of the point
 * were never drilled. Bump clears target-reached suppression so the imperative
 * cells re-run under the floors.
 * 2026-07-17a: Tier-1 of the full-curriculum coverageSpec audit
 * (docs/analysis/coverage-spec-audit-2026-07-17.md) — adds specs to five
 * spec-less points whose paradigm halves were collapse-prone (personal-
 * pronouns person×case incl. the bana/onu irregulars; optative 1sg/1pl +
 * polarity; spatial-postpositions 3-case split; participles-dik-acak and
 * reason-digi-icin possessive-agreement paradigms) and closes the
 * tr-a1-future polarity gap (gelmeyecek claimed core; only finite tense
 * without polarity). Bump clears target-reached suppression so the touched
 * cells re-run under the floors; at-target cells additionally need
 * demote:pool (see docs/curriculum-authoring.md retrofit section).
 * 2026-07-17b: Tier-2 of the coverageSpec audit, floors confirmed against
 * measured prod-pool collapse before commit — vowel-harmony (case; the
 * translation pool was 43/43 plural pairs), questions (person; miyim/miyiz/
 * misiniz absent), demonstratives (case; zero -n--buffer forms),
 * gore-bence (person; ~85% Bence), relative-an (polarity 28/2),
 * indefinite-pronouns (polarity 51/9), reflexive-reciprocal-pronouns
 * (person; 3rd-person dominated). Bump clears suppression; collapsed cells
 * are demoted post-deploy per the audit's demote list.
 * 2026-07-17c: TR B2 enabled — 17 grammar points from Yedi İklim B2 (Units 1–8),
 * grouped by function and deduped vs A1–B1, plus two G&K reverse-audit additions
 * (-DIr generalizing, "as if" -mIş gibi). Two points from the original 19 were
 * dropped as already taught at B1 by the 2026-07-16b book-coverage cycle
 * (temporal-when → tr-b1-when-converbs, causal-subordinate →
 * tr-b1-reason-digi-icin) and two re-scoped around it (instead-of,
 * duration-throughout). Grammar-only (no B2 vocab/dictation/free-writing).
 * New points authored WITH coverageSpecs per docs/curriculum-authoring.md.
 * Bump enumerates the new B2 cells + clears any suppression. See
 * docs/superpowers/specs/2026-07-07-tr-b2-curriculum-design.md.
 * 2026-07-17d: themed vocab umbrellas at B2 (5 new: work-professional,
 * science-technology, society-politics, culture-arts, global-issues) —
 * the B2 vocab track that the B2 grammar cycle deferred. Enqueues 5 vocab cells.
 * 2026-07-18: adds a comparison-axis coverageSpec to
 * tr-a1-comparative-superlative.
 */
export const CURRICULUM_VERSION_TR = '2026-07-18';

const trCurriculum: readonly GrammarPoint[] = [
  // ---------------------------------------------------------------------------
  // A1
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a1-vowel-harmony',
    coverageSpec: {
      axes: [
        // Forces both harmony patterns via case suffixes: 4-way -(y)I/-(y)A
        // (accusative/dative) + 2-way -DA/-DAn (locative/ablative). The
        // 2026-07-17 audit found the translation pool 43/43 "X-lar ve Y-ler"
        // plural pairs — exactly the plural-suffix collapse the generation
        // prompt's cell-level rule warns against.
        { name: 'case', floors: { accusative: 4, dative: 4, locative: 4, ablative: 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Vowel harmony',
    description:
      "Suffix vowels harmonise with the stem's last vowel. 2-way (e/a): plural -lAr, locative -DA, ablative -DAn. 4-way (i/ı/u/ü): accusative -(y)I, possessive -(s)I, dative, past -DI. Drill both patterns.",
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evler (houses) — front vowel /e/ → -ler',
      'okullar (schools) — back vowel /u/ → -lar',
      'evi (the house, accusative) — front unrounded /e/ stem → -i',
      'kapıyı (the door, accusative) — back unrounded /a/ stem → -ı',
      'okulu (the school, accusative) — back rounded /u/ stem → -u',
      'gülü (the rose, accusative) — front rounded /ü/ stem → -ü',
      'işte (at work, locative) — front unrounded /i/ stem → -te',
      'köprüye (to the bridge, dative) — front rounded /ü/ stem → -ye',
    ],
    examplesNegative: [
      '*okuller (wrong — back-vowel stem requires -lar)',
      '*evyi (wrong — accusative on /e/ stem is -(y)i with /y/ buffer → "evi", not "evyi")',
      '*okulı (wrong — back rounded /u/ stem requires -u, not -ı)',
    ],
    commonErrors: [
      'Defaulting to one vowel form (-ler) regardless of the stem vowel.',
      "Forgetting harmony follows the stem's last vowel even in loanwords (otobüs → otobüsler, kitap → kitaplar); and conversely that some loanwords whose final l is a soft, palatalised \"ince l\" take FRONT-vowel suffixes despite a back last vowel — including the plural: meşgul → meşguller (not *meşgullar), rol → roller, hal → haller; the same softening drives the 4-way set too (saat → saati, gol → golü).",
      'Picking the wrong member of the 4-way high-vowel set — e.g. using -ı on a rounded stem where -u is required (okulı vs. okulu), or using -i on a back-vowel stem where -ı is required.',
      'Conflating the 2-way (low-vowel) and 4-way (high-vowel) harmony patterns — applying -lAr/-lEr logic to suffixes that take the 4-way pattern, such as the accusative -(y)I.',
    ],
  },
  // G&K §2.1 (voiceless/voiced consonant alternation) + §2.3 (vowel/Ø
  // alternation). Two stem-internal changes triggered by a vowel-initial
  // suffix; both are LEXICAL (dictionary-marked), not fully predictable, so
  // the point teaches the patterns + that most words do NOT change.
  {
    key: 'tr-a1-stem-changes',
    // clozeUnsuitable (2026-06-21): softening / vowel-drop only surfaces WITH a
    // vowel-initial (case) suffix, so a single whole-word blank either shows the
    // bare nominative (no change visible) or forces an accusative — dragging in a
    // 2nd grammar point and producing ungrammatical subject-slot accusatives.
    // 2026-06-21 run: 1/41 approved (grammar-point-mismatch + duplicate
    // distractors). Translation (6/56) is the viable surface.
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Stem changes: consonant softening & vowel drop',
    description:
      'Before a vowel-initial suffix, final p/t/k/ç soften to b/d/ğ/c (kitap→kitabım, ağaç→ağacı), and some disyllables drop their 2nd-syllable high vowel (şehir→şehri, akıl→aklı). Lexical, per word.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'kitap → kitabım (my book — final p softens to b before a vowel suffix)',
      'ağaç → ağacı (its tree — ç softens to c)',
      'çocuk → çocuğum (my child — vowel+k softens to ğ; this k→ğ is the one general rule)',
      'renk → renge (to the colour — k after n softens to g, not ğ)',
      'şehir → şehri (the city, accusative — 2nd-syllable vowel drops: şeh(i)r-i)',
      'akıl → aklı (his/her mind — vowel drop: ak(ı)l-ı)',
      'omuz → omzum (my shoulder — vowel drop: om(u)z-um)',
      'burun → burnu (its nose — vowel drop: bur(u)n-u)',
    ],
    examplesNegative: [
      '*kitapım (wrong — p softens before a vowel suffix: kitabım)',
      '*akılı (wrong — the 2nd-syllable vowel drops: aklı for "his/her mind")',
      '*omuzum (wrong — vowel drop gives omzum for "my shoulder")',
    ],
    commonErrors: [
      'Not softening final p/t/k/ç before a vowel-initial suffix (*kitapım, *ağaçı → kitabım, ağacı).',
      'Forgetting that final k→ğ is the GENERAL rule for nominals ending in vowel+k (çocuk→çocuğu, yaprak→yaprağı), while k after n→g (renk→renge) and recent European loans keep k (bank→bankı).',
      'Re-inserting the dropped vowel (*akılı, *omuzum, *şehiri [ACC] → aklı, omzum, şehri): these disyllables lose their 2nd-syllable high vowel before a vowel suffix.',
      'Over-applying either rule — most words do NOT change (saç→saçım, top→topum, bilet→biletim) and verb roots are largely exempt (ak-→akan); both changes are lexical and dictionary-marked.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-personal-suffixes',
    conjugationSuitable: true,
    // Copula — the drill makes a "subject IS <predicate>" sentence, so the seed
    // must be a PREDICATE nominal (profession / role / nationality / adjective),
    // not an arbitrary object noun. The generic noun band yielded nonsensical
    // copular predicates ("Sen kedisin / dalgasın" = "you are a cat / a wave")
    // that the validator (correctly) rejected — 23% approval on 2026-06-30.
    // Curated A1 predicate pool, sized well above the 30-person-floor target so
    // the lemma-keyed exclude has room before it exhausts.
    conjugationSeedKind: 'predicate-nominal',
    conjugationSeedWords: [
      // Professions / roles
      'doktor',
      'öğretmen',
      'öğrenci',
      'mühendis',
      'hemşire',
      'aşçı',
      'şoför',
      'polis',
      'asker',
      'müdür',
      'avukat',
      'garson',
      'ressam',
      'futbolcu',
      // Nationalities
      'Türk',
      'Alman',
      'Fransız',
      'İngiliz',
      'İspanyol',
      // Predicate adjectives
      'mutlu',
      'yorgun',
      'hasta',
      'hazır',
      'aç',
      'üzgün',
      'meşgul',
      'genç',
      'zengin',
      'güzel',
      'akıllı',
      'çalışkan',
      'hızlı',
      'iyi',
      'kızgın',
      'heyecanlı',
      'yalnız',
      'tembel',
      'nazik',
    ],
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Personal (copular) suffixes',
    description:
      'Copular person suffixes on nominal predicates: 1sg -(y)Im, 2sg -sIn, 3sg Ø, 1pl -(y)Iz, 2pl -sInIz, 3pl -lAr (optional, human only). After a vowel-final stem insert -y- (hastayım).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğretmenim.', // 1sg -(y)Im — I am a teacher
      'Sen öğrencisin.', // 2sg -sIn — you are a student
      'O bir doktor.', // 3sg Ø — s/he is a doctor (no suffix is the correct form)
      'Biz hazırız.', // 1pl -(y)Iz — we are ready
      'Siz yorgunsunuz.', // 2pl -sInIz — you (pl) are tired
      'Kediler küçük.', // 3pl, non-human subject → no -lAr — the cats are small
      'Öğrenciler çalışkanlar.', // 3pl, human subject → optional -lAr — the students are hardworking
      'Ben hastayım.', // 1sg after a vowel-final stem → buffer -y-: hasta + -yım (I am ill)
      'Çok iyiyiz.', // 1pl after a vowel-final stem → buffer -y-: iyi + -yiz (we are very well)
      'Kim o? — Benim!', // pronoun predicate complement — the suffix agrees with the pronoun, not the subject: "It's me" (not *Ayşe ben)
    ],
    examplesNegative: [
      '*Ben öğretmen.', // dropped the obligatory 1sg -(y)Im
      '*Kediler küçükler.', // -lAr forced onto a non-human plural subject
      '*Bu masa güzeldir.', // -DIr as a conversational default (should be "Bu masa güzel")
      '*Ben hastaım.', // vowel-final stem needs the -y- buffer before -(y)Im → hastayım
    ],
    commonErrors: [
      'Dropping the obligatory personal suffix (e.g. *Ben öğretmen for Ben öğretmenim).',
      'Using -DIr as a default spoken copula (Bu güzeldir instead of Bu güzel).',
      'Adding 3pl -lAr to non-human subjects (*Kediler küçükler).',
      'Treating 3pl -lAr as mandatory; with human subjects it is optional, with non-human subjects it is omitted.',
      'Dropping the -y- buffer after a vowel-final stem (*iyiim, *hastaım instead of iyiyim, hastayım).',
    ],
  },
  {
    key: 'tr-a1-plural-suffix',
    kind: 'grammar',
    name: 'Plural suffix -lAr',
    description:
      'Plural -lar/-ler attaches by vowel harmony (kitaplar, evler). It is not added after a numeral or quantifiers like çok/her/birkaç, which already imply number (üç kitap, çok ev). These quantified subjects keep the predicate singular too: Birçok kişi çocukluğunu düşünmez, not *düşünmezler.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'kitaplar (books)',
      'üç kitap (three books)',
      'evler (houses — front-vowel -ler after e)',
      'çok kitap (a lot of books — singular head after çok)',
      "Ahmet'ler gelmedi. (Ahmet and his family/group didn't come — -lAr on a name means the household; kin terms take the possessive BEFORE plural: ablamlar.)",
      'kırk yaşlarında (about forty — on time/place words -lAr gives approximation: buralarda = around here)',
    ],
    examplesNegative: [
      '*üç kitaplar',
      '*çok evler (çok and similar quantifiers keep the noun singular → çok ev)',
    ],
    commonErrors: [
      'Adding -lAr after a numeral (üç kitap, not üç kitaplar) — plurality is already marked by the numeral.',
      'Adding -lAr after quantifiers that require the singular (her/çok/birkaç + noun).',
      'Choosing the wrong harmonised form (-lar after a front vowel).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-locative',
    conjugationSuitable: true,
    // Nominal case inflection — declines a noun, not a verb; seed from the noun band.
    conjugationSeedKind: 'noun',
    coverageSpec: { axes: [{ name: 'number', floors: { singular: 6, plural: 6 } }] },
    kind: 'grammar',
    name: 'Locative case -DA',
    description:
      'The locative -da/-de/-ta/-te marks "in/at/on" and harmonises with the stem; the consonant softens to -ta/-te after voiceless stems.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evde (at home)',
      'sokakta (on the street)',
      'Ali işte. (Ali is at work — voiceless ş, so -te.)',
      'dört yaşında bir çocuk (a four-year-old child — a locative phrase can modify an indefinite noun, typically for age/size/style)',
      'haftada iki kez (twice a week — quantified frequency puts the locative on the time unit: ayda bir = once a month)',
    ],
    examplesNegative: [
      '*sokakda',
      '*işde (wrong — final ş is voiceless, so -te not -de: işte)',
    ],
    commonErrors: [
      'Forgetting the consonant assimilation after voiceless final consonants.',
      'Confusing locative -DA with ablative -DAn.',
      'Applying -ta/-te only to back-vowel stems and forgetting that front-vowel voiceless stems also soften (işte, sepette).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-present-continuous',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        // Present continuous is naturally mostly affirmative; ensure negatives
        // still appear. Coarse, skewed floors — not uniform-by-default.
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Present continuous -(I)yor',
    description:
      'Present continuous -(I)yor: high-vowel buffer harmonises with the stem (geliyor, oturuyor, görüyor). After a vowel-final stem, the stem vowel is raised to high (başla- → başlıyor).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Geliyorum. (I am coming.)',
      'Çay içiyoruz. (We are drinking tea.)',
      'Başlıyor. (It is starting.)',
      'Okula otobüsle gidiyorum. (I go to school by bus — note git- voices to gid-.)',
      'Çocuklar bahçede oynuyor. (The children are playing — high-vowel-final oyna- → oynuyor.)',
    ],
    examplesNegative: [
      '*Başlayor. (wrong — stem-final /a/ must raise to /ı/ before -yor: başlıyor)',
      '*Gitiyorum. (wrong — git- voices its final t before -yor: gidiyorum)',
    ],
    commonErrors: [
      'Failing to raise the stem-final low vowel to a high vowel before -yor (başlayor instead of başlıyor).',
      'Picking the wrong harmonised buffer vowel after a consonant-final stem (gelıyor instead of geliyor).',
      'Forgetting that git-, et-, tat-, güt- voice stem-final t→d before -(I)yor (*gitiyor / *etiyor instead of gidiyor / ediyor).',
      'Assuming -(I)yor is only "be …ing": it also covers habitual actions (her sabah koşuyorum = I run every morning).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-negation',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Verbal negation -mA',
    description:
      'Verbal negation -ma/-me between stem and tense. Before -(I)yor it fuses as -mIyor with the vowel raised and harmonised: gel- → gelmiyor, oku- → okumuyor. Some time adverbs shift sense with a negative predicate: artık = "no longer" (Artık evimiz yok), daha/henüz = "not yet" (Daha hazır değilim), bir daha = "(n)ever again" (Bir daha gelmem).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Gelmiyorum. (I am not coming.)',
      'Dün gelmedim. (I did not come yesterday.)',
    ],
    examplesNegative: [
      '*Gelmeyorum. (wrong — -me + -yor fuses to -miyor: gelmiyorum)',
    ],
    commonErrors: [
      'Failing to raise the negation vowel before -yor (gelmeyor instead of gelmiyor).',
      'Placing the negation suffix after the tense suffix instead of between stem and tense.',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a1-dili-past',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        // Negative past (-medi/-madı) is the high-value drill — ensure it appears.
        { name: 'polarity', floors: { affirmative: 6, negative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Definite past -DI ("dili" past)',
    description:
      'The witnessed/definite past suffix -di/-dı/-du/-dü (with -ti/-tı/-tu/-tü after voiceless stems) plus personal endings.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Dün eve gittim.',
      'Geçen yaz İstanbul\'a gittik.',
      'Onu dün görmedim. (I didn\'t see him yesterday — negation -me- before -di.)',
      'Sınavı geçtin mi? (Did you pass the exam? — question particle mi after the verb.)',
    ],
    examplesNegative: [
      '*Dün eve gitdim.',
      '*Filmi izledisin. (wrong person ending — -DI uses the group-1 endings: izledin, not izledisin.)',
      '*Acıkıyorum. (wrong for "I\'m hungry now" — entry-into-state verbs express a current state with -DI: "Acıktım".)',
    ],
    commonErrors: [
      'Forgetting consonant assimilation (-d → -t after voiceless stems).',
      'Confusing -DI (witnessed) with the -mIş evidential past.',
      'Using the present/aorist (group-2) personal endings on -DI: *gittisin instead of gittin — -DI takes the group-1 set (-m, -n, -k, -nIz).',
      'Confusing the verbal past -DI (geldim) with the past copula -(y)DI on nominal / adjectival predicates (hastaydım, evdeydik).',
      'Using -(I)yor for a current state with entry-into-state verbs — the state is expressed with -DI: Acıktım = "I\'m hungry", Susadım = "I\'m thirsty", Yoruldum = "I\'m tired" (not *acıkıyorum); posture verbs split event/state the same way (oturdu "sat down" vs oturuyordu "was sitting").',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-future',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        // The raised negative (gelmeyecek) is claimed core; every sibling
        // finite tense carries polarity — future was the only one without
        // (2026-07-17 spec audit). Floors mirror dili-past's 6/6.
        { name: 'polarity', floors: { affirmative: 6, negative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Future -(y)AcAk',
    description:
      'Future -(y)AcAk: -acak/-ecek by harmony. After a vowel-final stem insert -y- (oku → okuyacak); k → ğ before vowel suffixes (gidecek → gideceğim). Negative raises -mA: gelmeyecek.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Yarın geleceğim.',
      'Onlar tatile gidecekler.',
      'Kitabı bekleyeceğiz. (vowel stem bekle- takes the -y- buffer)',
      'Annem yarın çorba yapacak. (3sg, no buffer after a consonant stem)',
    ],
    examplesNegative: [
      '*Yarın gelecekım.',
      '*Onlar okuacaklar. (vowel stem oku- needs the -y- buffer → okuyacaklar)',
      '*Ben gelmayacağım. (negative -mA harmonises and raises before the suffix → gelmeyeceğim)',
    ],
    commonErrors: [
      'Failing to soften final -k to -ğ before vowel-initial suffixes.',
      'Substituting the present -(I)yor for planned future events when -(y)AcAk is more idiomatic.',
      'Dropping the -y- buffer after a vowel-final stem (*okuacak instead of okuyacak).',
      'Forming the negative without raising/harmonising -mA (*gelmayacak instead of gelmeyecek).',
      'Forgetting that the verbs ye- "eat" and de- "say" raise their vowel to i before the -y- of this suffix: yiyecek, diyecek (not *yeyecek, *deyecek).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-imperative',
    coverageSpec: {
      axes: [
        // The A1 imperative paradigm is 2sg (bare stem: gel!) vs 2pl/formal
        // -(y)In (gelin!). Partial person floors — 3rd-person commands are the
        // optative/-sIn territory of tr-a2-optative, never targeted here.
        { name: 'person', floors: { '2sg': 8, '2pl': 8 } },
        // Negative imperative (stem + -mA: gelme!/gelmeyin!) is the high-value
        // drill — without a floor the pool collapses to affirmative commands.
        { name: 'polarity', floors: { affirmative: 10, negative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Imperative (Emir)',
    description:
      '2sg imperative is the bare stem (gel!); 2pl/formal is stem + -(y)In with 4-way harmony and -y- after vowels (gelin!, okuyun!). Negative is stem + -mA (gelme!, okumayın!).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Gel! (Come! — 2sg, bare stem)',
      'Gelin! (Come! — 2pl/formal)',
      'Okuyun! (Read! — vowel stem + -yun)',
      'Gelme! (Don\'t come! — 2sg negative, stem + -mA)',
      'Burada bekleyin. (Wait here. — 2pl/formal, vowel stem + -y- + -in)',
      'Sakın unutma! (Mind you don\'t forget! — the warning adverb sakın reinforces a negative imperative/optative and must co-occur with -mA: Sakın geç kalmayalım!)',
    ],
    examplesNegative: [
      '*Gele! (wrong — 2sg imperative is the bare stem "gel", not "gele")',
      '*Gel yok. (wrong — "don\'t come" is not formed with yok; the negative imperative is stem + -mA: "Gelme!")',
      '*Gelün! (wrong — -In harmonises to the stem vowel; after "gel" it is -in: "Gelin!")',
      '*Sakın geç kal! (wrong — sakın requires a negative verb in -mA: "Sakın geç kalma!")',
    ],
    commonErrors: [
      'Adding the -y- buffer to consonant-final stems (*gelyin instead of gelin).',
      'Confusing the 2sg imperative (bare stem) with the optative -sIn (gelsin = "let him come").',
      'Forming the negative imperative with the bare stem or yok/değil instead of stem + -mA (Gelme!, not *Gel yok).',
      'Using one fixed form of -In instead of harmonising it four ways (-in/-ın/-un/-ün): *gelün, *okuyin.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-questions',
    coverageSpec: {
      axes: [
        // In nominal/present predicates mI carries the person ending —
        // miyim/misin/miyiz/misiniz are distinct fused surfaces. Pool audit
        // 2026-07-17: bare 3sg "…mı?" dominant, 1sg/1pl/2pl absent. 3pl
        // unfloored (least natural on the clitic).
        { name: 'person', floors: { '1sg': 3, '2sg': 5, '3sg': 4, '1pl': 3, '2pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Question formation (mı + WH-words)',
    description:
      'Yes/no: clitic mI follows the focused word. In nominal/present predicates it carries the person ending; in the -DI past the ending stays on the verb (geldin mi). WH-words sit before the verb.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Geliyor musun? (Are you coming?)',
      'Sen öğrenci misin? (Are you a student?)',
      'Bu ne? (What is this?)',
      'Nerede oturuyorsun? (Where do you live?)',
      'Dün sinemaya gittin mi? (Did you go to the cinema yesterday? — past: the -n ending is on the verb, mı is bare.)',
      'Evde süt var mı? (Is there milk at home? — yes/no question on var.)',
      'Çay mı kahve mi istersin? (Do you want tea or coffee? — alternative questions repeat mI after each option, optionally joined by yoksa: Çay mı yoksa kahve mi?)',
      'Ankara\'ya mı gidiyorsun? (Is it ANKARA you\'re going to? — mI attaches directly to a focused non-predicate constituent, which moves before the verb.)',
      'Acaba yarın yağmur yağacak mı? (I wonder if it will rain tomorrow — invariable acaba adds an "I wonder" tone to any question, usually sentence-initially or -finally.)',
    ],
    examplesNegative: [
      '*Sen öğrencisin mi? (wrong — the person ending attaches to mI, not the predicate: "Sen öğrenci misin?")',
      '*Dün geldi misin? (wrong — in the -di past the person ending stays on the verb, not on mI → "Dün geldin mi?")',
    ],
    commonErrors: [
      'Attaching the personal ending to the predicate instead of to mI ("öğrencisin mi" instead of "öğrenci misin").',
      'Choosing the wrong harmonised form of mI.',
      'Fronting a WH-word English-style instead of leaving it in its normal sentence position.',
      'Over-applying the present-tense pattern to the past ("geldi misin" instead of "geldin mi") — in the -di past the ending attaches to the verb, leaving mı bare.',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a1-degil',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Nominal negation (değil)',
    description:
      '"değil" negates nominal / copular predicates and takes the personal endings: öğrenci değilim, müsait değilsin. Used with adjectives, nouns, and locative predicates (evde değilim).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğrenci değilim. (I am not a student.)',
      'Bu çay değil. (This is not tea.)',
      'Evde değilim. (I am not at home.)',
      'Bu senin telefonun, değil mi? (This is your phone, isn\'t it? — değil mi = tag question.)',
      'Elma değil, armut yiyorum. (I\'m eating pears, not apples — değil also negates a single constituent contrastively, replacing a repeated predicate: Büyük değil, küçük bir elma istemiştim.)',
    ],
    examplesNegative: [
      '*Ben öğretmen yokum. (wrong — nominal predicates are negated with "değil", not "yok": "öğretmen değilim")',
      '*Ben değil öğretmen. (wrong — değil follows the complement, it does not precede it → "öğretmen değilim")',
    ],
    commonErrors: [
      'Using yok (existential negation) instead of değil for nominal predicate negation ("öğretmen yokum" instead of "öğretmen değilim").',
      'Dropping the personal ending on değil ("ben öğrenci değil" instead of "değilim").',
      'Placing değil before the predicate complement instead of after it ("ben değil öğretmen" instead of "öğretmen değilim").',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes'],
  },
  {
    key: 'tr-a1-var-yok',
    kind: 'grammar',
    name: 'Existence and possession (var / yok)',
    description:
      'var = "there is/exists", yok = "there isn\'t". Possession: possessive suffix on the thing owned + var/yok — arabam var (I have a car). Past tense uses the copula: vardı / yoktu.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Evde kitap var. (There is a book at home.)',
      'Bir arabam var. (I have a car.)',
      'Vaktim yok. (I have no time.)',
      'Eskiden burada bir lokanta vardı. (There used to be a restaurant here — past = var + -dı.)',
      'Dün hiç vaktim yoktu. (I had no time at all yesterday — yok + -tu.)',
    ],
    examplesNegative: [
      '*Ben bir araba var. (wrong — possession requires the possessive suffix on the possessed noun: "Bir arabam var")',
      '*Bir arabam oldu. (for "I had a car" — past possession is the copula on var: "Bir arabam vardı"; oldu = "came to have")',
    ],
    commonErrors: [
      'Calquing English "I have X" with a subject pronoun instead of marking the possessed noun ("ben bir araba var" instead of "bir arabam var").',
      'Using değil to negate existence/possession instead of yok ("kitap değil" instead of "kitap yok" for "there is no book").',
      'Conjugating olmak for the past instead of adding the copula to var/yok ("araba oldu" instead of "arabam vardı" for "I had a car").',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-accusative-definite-object',
    conjugationSuitable: true,
    // Nominal case inflection — declines a noun, not a verb; seed from the noun band.
    conjugationSeedKind: 'noun',
    coverageSpec: { axes: [{ name: 'number', floors: { singular: 6, plural: 6 } }] },
    kind: 'grammar',
    name: 'Accusative -(y)I for definite objects',
    description:
      'Definite direct objects take accusative -(y)I. Indefinite ones (bir kitap, or a bare noun right before the verb) stay unmarked; proper names and pronouns are inherently definite and take it. A specific indefinite may optionally take -(y)I too: bir kitap arıyorum (any book) vs bir kitabı arıyorum (a particular book in mind).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Kitabı okudum. (the book)',
      'Bir kitap okudum. (a book)',
      "Osman'ı dün gördüm. (proper name — inherently definite → -ı)",
      'Seni seviyorum. (pronoun object → accusative -i)',
      'Bu evi çok beğendim. (demonstrative → definite → -i)',
    ],
    examplesNegative: [
      '*Kitap okudum, çok beğendim. (when "the book" is meant)',
      "*Ali gördüm. (proper-name object is inherently definite → \"Ali'yi gördüm\")",
      '*Ali doktorlar sevmez. (wrong — a plural generic object takes the accusative: "Ali doktorları sevmez".)',
      '*Kitap dün okudum. (wrong — an unmarked object stays right before the verb: "Dün kitap okudum" or "Kitabı dün okudum".)',
    ],
    commonErrors: [
      'Marking every direct object with -(y)I regardless of definiteness.',
      'Failing to use -y- as a buffer consonant after a vowel-final stem.',
      "Omitting accusative on inherently-definite objects — proper names and pronouns (*Ali gördüm / *sen seviyorum → Ali'yi gördüm / seni seviyorum).",
      'Leaving a plural generic object unmarked: a bare singular generic stays unmarked (Sen çocuk sevmezsin), but a plural generic object must take the accusative (Ali doktorları sevmez, not *doktorlar sevmez).',
      'Moving a non-case-marked object away from the verb — it must stay immediately preverbal or take the accusative (*kitap dün okudum → dün kitap okudum or kitabı dün okudum).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-ablative-dative',
    conjugationSuitable: true,
    // Nominal case inflection — declines a noun, not a verb; seed from the noun band.
    conjugationSeedKind: 'noun',
    coverageSpec: { axes: [{ name: 'case', floors: { ablative: 6, dative: 6 } }] },
    kind: 'grammar',
    name: 'Ablative -DAn and dative -(y)A',
    description:
      'Ablative -dan/-den/-tan/-ten ("from") and dative -a/-e ("to/for"); both harmonise and the dative buffers with -y- after vowels. Many verbs govern a fixed case: dative with inan-, güven-, bin-, yardım et- (bana inan, otobüse bindim); ablative with kork-, hoşlan-, nefret et-, bık- (köpekten korkuyorum).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Okuldan geliyorum.',
      'Ankara\'ya gidiyorum.',
      'Anneme çiçek aldım. (I bought flowers for my mother — dative -e marks the recipient.)',
      'Uçaktan indik. (We got off the plane — ablative -tan, voiceless k forces -t-.)',
      'tahtadan bir masa (a table made of wood — the ablative also marks material: altından bir yüzük = a ring of gold)',
    ],
    examplesNegative: [
      '*Ankara gidiyorum.',
      '*Kitapdan bir sayfa okudum. (wrong — after voiceless p the ablative is -tan/-ten: "Kitaptan bir sayfa okudum".)',
      '*Seni inanıyorum. (wrong — inan- governs the dative: "Sana inanıyorum".)',
    ],
    commonErrors: [
      'Dropping the dative case on the goal of motion.',
      'Confusing ablative -DAn with locative -DA.',
      'Writing the ablative as -dan/-den after a voiceless consonant (p, ç, t, k, s, ş, h, f) instead of assimilating to -tan/-ten: *kitapdan → kitaptan.',
      'Calquing English transitives with the accusative on fixed-case verbs (*köpeği korkuyorum, *seni inanıyorum instead of köpekten korkuyorum, sana inanıyorum).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-locative'],
  },
  {
    key: 'tr-a1-genitive-possessive',
    kind: 'grammar',
    name: 'Genitive-possessive construction',
    description:
      '"X-(n)In Y-(s)I" pattern: genitive on the possessor and 3sg possessive on the possessed (öğretmenin kitabı = the teacher\'s book).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'öğretmenin kitabı',
      'Türkiye\'nin başkenti',
      'Evin kapısı açık. (The door of the house is open — buffer -n- in the genitive, -s- in the 3sg possessive.)',
      'Onun bir kedisi var. (He/She has a cat — the possessive on the head is obligatory in var sentences.)',
      'dergilerin hepsi (all of the magazines — partitives use the same construction: paranın yarısı = half of the money, öğrencilerin çoğu = most of the students)',
    ],
    examplesNegative: [
      '*öğretmen kitabı (when "the teacher\'s book" is meant)',
      '*Onun araba var. (for "he has a car" — the head keeps its possessive even with var: "Onun arabası var")',
    ],
    commonErrors: [
      'Omitting the genitive on the possessor.',
      'Omitting the 3sg possessive on the possessed.',
      'Dropping the buffer consonants: genitive -(n)In takes -n- after a vowel (odanın, Türkiye\'nin) and 3sg possessive -(s)I takes -s- after a vowel (kapısı, arabası), not *odaın / *kapıı.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony', 'tr-a1-possessive-suffixes'],
  },
  {
    key: 'tr-a1-demonstratives',
    coverageSpec: {
      axes: [
        // Pronominal case forms take the -n- buffer (bunu, buna) — the
        // claimed trap. Pool audit 2026-07-17: 40/40 rows nominative
        // (bu/burası determiners), zero case-marked pronouns.
        { name: 'case', floors: { nominative: 6, accusative: 5, dative: 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Demonstratives (bu / şu / o, burası / şurası / orası)',
    description:
      'bu/şu/o ("this/that") are pronouns and invariant determiners (bu kitap, bu kitaplar). As pronouns they take an -n- buffer before case (bunu, buna). Locational burası/orası inflect like nouns.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bu kitap çok güzel. (This book is very nice.)',
      'Şu çantayı al. (Take that bag.)',
      'Orası çok uzak. (That place is very far.)',
      'Burada bekleyelim. (Let us wait here.)',
      'Bu kitaplar çok pahalı. (These books are very expensive — the determiner stays "bu"; plural is on the noun.)',
      'Bunu sevdim. (I liked this one — pronoun "bu" + accusative with the -n- buffer.)',
      'Aşağısı çok dağınık. (It\'s very untidy downstairs — the burası/orası pattern extends to directional adverbs: içerisi, dışarısı, aşağısı, yukarısı.)',
    ],
    examplesNegative: [
      '*Bu uzak. (when meaning "this place is far" — "bu" modifies a noun; the noun for "this place" is "burası": "Burası uzak.")',
      '*Bunlar kitaplar pahalı. (wrong — the determiner does not pluralise → "Bu kitaplar pahalı"; "bunlar" is a pronoun.)',
    ],
    commonErrors: [
      'Confusing bu (pronoun/adjective "this") with bura/burası (the noun "this place / here"): *Bu uzak instead of Burası uzak.',
      'Misreading şu as merely "medial": bu = near/already-known, o = far/already-known, but şu chiefly flags something pointed at or introduced for the first time.',
      'Pluralising the demonstrative determiner instead of the noun: *bunlar kitaplar instead of bu kitaplar (bu/şu/o never inflect as adjectives).',
      'Dropping the -n- buffer when adding case to a demonstrative pronoun: *buyu / *bua instead of bunu / buna.',
    ],
  },
  {
    key: 'tr-a1-personal-pronouns',
    coverageSpec: {
      axes: [
        // The irregulars live at specific person×case cells: dative bana/sana,
        // genitive benim/bizim, 3rd-person -n- buffer (onu/ona/onda/ondan) —
        // dative/genitive weighted because that's where the irregulars are.
        {
          name: 'case',
          floors: { nominative: 3, accusative: 3, dative: 4, genitive: 4, locative: 2, ablative: 2 },
        },
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Personal pronouns and their case forms',
    description:
      'Subject pronouns ben/sen/o/biz/siz/onlar and case forms. Irregular: dative bana/sana (not *bene), 1st-person genitive benim/bizim, and 3rd-person -n- buffer (onu, ona, onun, onda, ondan).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ben öğrenciyim. (I am a student — subject.)',
      'Bana ver. (Give to me — dative.)',
      'Senin kitabın. (Your book — genitive.)',
      'Onu gördüm. (I saw him/her/it — accusative.)',
      'Bu benim. (This is mine — 1st-person genitive benim, not *benin.)',
      'Sana bir şey söyleyeceğim. (I\'ll tell you something — dative sana, not *sene.)',
    ],
    examplesNegative: [
      '*Beni geldim. (wrong — subject is "ben", not the accusative "beni": "Ben geldim.")',
      '*Bene ver. (wrong — the 1sg dative is irregular: the stem vowel becomes a → "Bana ver".)',
    ],
    commonErrors: [
      'Using oblique forms (beni, bana) where the subject is needed — the subject pronoun is always the bare form ben.',
      'Forgetting the irregular -n- buffer before case suffixes in 3rd person: onu, ona, onun, onda, ondan (not *ou, *oa).',
      'Regularising the irregular dative of ben/sen: writing *bene / *sene instead of bana / sana.',
      'Using the regular genitive -in on 1st-person pronouns (*benin, *bizin) instead of the irregular -Im forms benim, bizim.',
      'Overusing overt subject pronouns English-style: person marking on the predicate already identifies the subject, so neutral statements drop the pronoun (Geliyorum, not Ben geliyorum) — also across sentences once the referent is clear (Bugün Ayşe\'yi gördüm. Sana selam söyledi. — no "O" needed); overt ben/sen etc. signals contrast, focus or a new topic.',
    ],
  },
  {
    key: 'tr-a1-numbers-ordinals',
    kind: 'grammar',
    name: 'Numbers and ordinals (-(I)ncI)',
    description:
      'Cardinals juxtapose (yüz yirmi üç = 123). Ordinals add -(I)ncI: birinci, ikinci, üçüncü; the I drops after a vowel (ikinci) but appears after a consonant (beşinci). "ilk" = first.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'üç kitap (three books)',
      'yüz yirmi üç (123 — compound, no connector)',
      'birinci sınıf (first class / grade)',
      'üçüncü kat (third floor)',
      'dördüncü kat (fourth floor — stem softens dört → dörd-)',
      'ilk gün (the first day — "ilk" = birinci)',
    ],
    examplesNegative: [
      '*yüz ve yirmi üç. (wrong — compound numbers juxtapose without "ve": "yüz yirmi üç")',
      '*ikiinci (wrong — the suffix\'s initial vowel drops after a vowel-final stem → ikinci)',
      '*dörtüncü (wrong — final t softens to d before the vowel suffix → dördüncü)',
      '*bir genç adam (for a neutral "a young man" — the article bir follows the adjective: "genç bir adam")',
    ],
    commonErrors: [
      'Inserting "ve" between parts of a compound number ("yüz ve yirmi üç" instead of "yüz yirmi üç").',
      'Picking the wrong harmonised form of the ordinal -(I)ncI suffix (*üçinci instead of üçüncü).',
      'Pluralising the noun after a numeral ("üç kitaplar" — see tr-a1-plural-suffix).',
      'Doubling the vowel after a vowel-final stem (*ikiinci, *altııncı) — the suffix\'s initial (I) drops here: ikinci, altıncı.',
      'Failing to soften final t→d in dört before the ordinal suffix (*dörtüncü instead of dördüncü).',
      'Defaulting to bir + adjective + noun order for a neutral indefinite (*bir genç adam): as the article, bir follows the adjective (genç bir adam, açık bir pencere); pre-adjective bir reads as the numeral "one".',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
    selfRevealingElicitation: 'digit-form',
    elicitationSeedValues: [
      'birinci', 'ikinci', 'üçüncü', 'dördüncü', 'beşinci', 'altıncı',
      'yedinci', 'sekizinci', 'dokuzuncu', 'onuncu', 'on birinci',
      'on ikinci', 'yirminci', 'otuzuncu', 'kırkıncı', 'ellinci',
      'altmışıncı', 'yüzüncü',
      'yüz yirmi üç', 'iki yüz elli', 'üç yüz kırk beş', 'beş yüz on',
      'bin dokuz yüz', 'iki bin yirmi altı',
    ],
  },
  {
    key: 'tr-a1-possessive-suffixes',
    conjugationSuitable: true,
    // Nominal possessive inflection — declines a noun, not a verb; seed from the noun band.
    conjugationSeedKind: 'noun',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
      ],
    },
    kind: 'grammar',
    name: 'Possessive suffixes (İyelik ekleri)',
    description:
      'Possessive suffixes mark the possessed noun: -(I)m, -(I)n, -(s)I, -(I)mIz, -(I)nIz, -lArI (harmonised). The buffer vowel (I) drops after a vowel (araba-m); 3sg adds -s- after a vowel (kapı-sı).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'evim (my house)',
      'kitabın (your book)',
      'arabası (his/her car) — vowel-final stem + -sı',
      'evimiz (our house)',
      'arabam (my car — vowel-final stem, no buffer vowel: araba + m)',
      'gözüm (my eye — round-vowel stem, suffix harmonises to -üm)',
    ],
    examplesNegative: [
      '*evi (when meaning "my house" — "evi" is 3sg "his/her house"; "my house" is "evim")',
      '*arabaım (wrong — after a vowel the 1sg buffer vowel drops: "arabam")',
    ],
    commonErrors: [
      'Confusing 1sg -(I)m with 3sg -(s)I: "evim" (my house) vs "evi" (his/her house).',
      'Dropping the -s- buffer in 3sg after a vowel-final stem (*arabaı instead of arabası).',
      'Marking the possessor instead of the possessed (possessive suffix goes on the possessed noun; the possessor takes the genitive).',
      'Inserting a buffer vowel after a vowel-final stem (*arabaım, *kapıım instead of arabam, kapım — the buffer (I) only appears after consonants).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-instrumental-ile',
    kind: 'grammar',
    name: 'Instrumental ile / -(y)lA',
    description:
      'Instrumental/comitative "with/by" — postposition ile or harmonised suffix -la/-le (-y- buffer after vowels: arabayla). Pronouns take the genitive: benimle, seninle, onunla, kiminle.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Arkadaşımla geldim. (I came with my friend.)',
      'Kalemle yazıyorum. (I am writing with a pen.)',
      'Otobüsle gidiyoruz. (We go by bus.)',
      'Arabayla geldim. (I came by car — -y- buffer after vowel.)',
      'Benimle gelir misin? (Will you come with me? — pronoun takes genitive: ben+im+le.)',
      'Onunla konuştum. (I talked with him/her — o becomes onunla, not *onla.)',
    ],
    examplesNegative: [
      '*Arabala geldim. (wrong — vowel-final stem needs -y- buffer: "arabayla")',
      '*Benle gel. (wrong — the pronoun ben takes the genitive before -le: "benimle gel".)',
    ],
    commonErrors: [
      'Forgetting the -y- buffer on vowel-final stems (*arabala instead of arabayla).',
      'Picking the wrong harmonised form of -lA (*arkadaşle instead of arkadaşla on a back-vowel stem).',
      'Attaching ile/-lA to a bare pronoun (*benle, *senle, *onla) instead of the genitive form (benimle, seninle, onunla, kiminle).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a1-postpositions-once-sonra',
    kind: 'grammar',
    name: '-DAn önce / -DAn sonra (before / after)',
    description:
      '"Before/after" a noun: ablative -DAn + önce/sonra — yemekten sonra, dersten önce. Pronouns too: benden önce. A time span before önce/sonra means "ago/later": beş dakika önce, bir saat sonra.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Yemekten sonra çay içeriz. (After the meal we drink tea.)',
      'Dersten önce kahve aldım. (I had coffee before class.)',
      'Akşamdan sonra yağmur yağdı. (After evening it rained.)',
      'Benden önce geldi. (He arrived before me — pronoun + ablative: ben → benden.)',
      'Beş dakika önce çıktı. (She left five minutes ago — "X önce" = "X ago".)',
      'Önce duş aldım, sonra kahvaltı ettim. (First I showered, then I had breakfast — bare önce/sonra sequence whole sentences with no noun.)',
    ],
    examplesNegative: [
      '*Yemek sonra çay içeriz. (wrong — önce / sonra need the noun in the ablative: "yemekten sonra")',
      '*Ben önce geldi. (wrong — a pronoun complement also needs the ablative: "benden önce".)',
    ],
    commonErrors: [
      'Omitting the ablative -DAn on the noun before önce/sonra (*yemek sonra instead of yemekten sonra).',
      'Confusing this nominal -DAn önce / sonra with the A2 converbal -mAdAn önce / -DIktAn sonra, which attach to verb stems.',
      'Forgetting the ablative on a pronoun complement (*ben sonra instead of benden sonra; ben → benden).',
      'Adding -DAn to a time span used as "ago/later": it is bare before önce/sonra ("beş dakika önce", not *beş dakikadan önce).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-dan-a-kadar',
    kind: 'grammar',
    name: '-DAn … -A kadar (from … to / until)',
    description:
      '"From X to Y" uses ablative -DAn on the source and dative -A + kadar on the goal: sabahtan akşama kadar (morning to evening), evden okula kadar (home to school).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Sabahtan akşama kadar çalıştım. (I worked from morning till evening.)',
      'Evden okula kadar yürüyorum. (I walk from home to school.)',
      'Pazartesi\'den cuma\'ya kadar (from Monday to Friday)',
      'Saat dokuzdan beşe kadar çalışıyorum. (I work from nine to five.)',
    ],
    examplesNegative: [
      '*Sabah akşama kadar. (wrong — the source must take ablative: "sabahtan akşama kadar")',
      '*Sabahtan akşam kadar. (wrong — kadar needs the dative on the goal → "sabahtan akşama kadar")',
      '*Evden okulakadar. (wrong — kadar is a separate word, never suffixed → "evden okula kadar")',
    ],
    commonErrors: [
      'Omitting the ablative on the source ("sabah akşama kadar" instead of "sabahtan akşama kadar").',
      'Omitting "kadar" on the goal ("sabahtan akşama" without "kadar" — the construction needs both halves).',
      'Dropping the dative -(y)A on the goal: kadar governs the dative, so it is "akşama kadar", never "akşam kadar".',
      'Writing kadar joined to the goal noun ("okulakadar") — kadar is always a separate word.',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
  },
  {
    key: 'tr-a1-ki-relativizer',
    kind: 'grammar',
    name: 'Relativiser -ki / -DAki',
    description:
      'Relativiser -ki turns a locative/genitive/time phrase into a modifier: masadaki kitap, benimki (mine). No vowel harmony — except dün/gün → dünkü, bugünkü.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Masadaki kitap çok kalın. (The book on the table is very thick.)',
      'Benimki yeşil. (Mine is green.)',
      'Evdekiler uyuyor. (The ones at home are sleeping.)',
      'Bugünkü gazete masada. (Today\'s newspaper is on the table — -ki on a time word, surfaces as -kü after gün.)',
      'Dünkü film çok güzeldi. (Yesterday\'s film was very nice — dün + -kü.)',
    ],
    examplesNegative: [
      '*Masada kitap kalın. (intending "the book on the table is thick" — needs -ki: "Masadaki kitap kalın.")',
      '*Dünki film. (wrong — after dün/gün -ki is spelt -kü → "dünkü film".)',
    ],
    commonErrors: [
      'Omitting -ki when a case-marked phrase modifies a noun ("masada kitap" instead of "masadaki kitap").',
      '-ki does not take normal vowel harmony ("evdeki", "masadaki", never *evdekı / *masadekı). The only exception is after dün/gün, where it becomes -kü (dünkü, bugünkü).',
      'Placing a determiner before the -ki phrase when it should modify the head noun: öbür gazetedeki resim = "the picture in the OTHER paper"; for "the other picture in the paper" the determiner follows: gazetedeki öbür resim.',
    ],
    prerequisiteKeys: ['tr-a1-locative'],
  },
  {
    key: 'tr-a1-gore-bence',
    coverageSpec: {
      axes: [
        // The -CE paradigm (bence/sence/bizce/sizce) and pronoun+göre forms
        // (bana/sana/ona göre) are the whole surface variation. Pool audit
        // 2026-07-17: ~85% "Bence …" (1sg collapse). Safe to pin because the
        // surviving surface is translation, where the L1 prompt fixes person.
        { name: 'person', floors: { '1sg': 4, '2sg': 3, '3sg': 3, '1pl': 3, '2pl': 3 } },
      ],
    },
    kind: 'grammar',
    name: '-A göre, bence ("according to / in my opinion")',
    description:
      'Opinion / "according to": dative + göre (bana göre, öğretmene göre). -CE forms bence/sence/bizce/sizce = "in my/your/our opinion". göre also means "suited to": Bu iş bana göre değil.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bana göre bu doğru. (According to me, this is right.)',
      'Öğretmene göre sınav kolay. (According to the teacher, the exam is easy.)',
      'Bence çok güzel. (In my opinion it is very nice.)',
      'Sizce bu doğru mu? (In your (pl/formal) opinion, is this right?)',
      'Bu iş bana göre değil. (This job isn\'t right for me — göre = "suited to".)',
    ],
    examplesNegative: [
      '*Ben göre bu doğru. (wrong — göre requires the dative: "Bana göre bu doğru.")',
      '*Bençe çok güzel. (wrong spelling — ben ends in voiced -n, so the suffix stays -ce: "Bence çok güzel.")',
    ],
    commonErrors: [
      'Using a bare pronoun before göre instead of the dative ("ben göre" instead of "bana göre").',
      'Conjugating bence with a personal ending ("bencem") — it is a frozen form taking no person marking.',
      'Forgetting that the opinion adverbs are pronoun + -CE (bence/sence/bizce/sizce); the 3rd-person opinion is "ona göre", not a *-CE form.',
      'Confusing göre\'s senses: besides "according to", göre means "suited to / right for" (Bu bana göre = this suits me).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
    // A sentence-initial opinion slot accepts ANY opinion-holder
    // (bence/sence/bizce/sizce/bana göre/ona göre…); a single L2 sentence
    // cannot force one person, so cloze drafts are irreducibly ambiguous
    // (lifetime cloze approval ~14% vs ~35% for translation). Drill via
    // translation, where the L1 prompt fixes the person. See
    // docs investigation 2026-06-07.
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a1-beri-dir',
    kind: 'grammar',
    name: '-DEn beri / -DIr (since / for)',
    description:
      'Duration up to now/then. -DEn beri = "since" a point AND "for" a span (sabahtan beri; üç günden beri). -DIr = "for" a span, on the period noun (iki saattir). Predicate stays ongoing (-iyor). A completed duration or a distance is a bare noun phrase (Dün iki saat bekledim; Beş kilometre yürüdük) — -DIr / -DEn beri only for spans still continuing.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Sabahtan beri çalışıyorum. (I have been working since morning.)',
      'İki saattir bekliyorum. (I have been waiting for two hours.)',
      '2020\'den beri Türkiye\'de yaşıyor. (He has lived in Turkey since 2020.)',
      'Üç gündür buradayım. (I have been here for three days — -DIr on the period noun.)',
      'İki günden beri hastayım. (I have been ill for two days — beri also expresses "for".)',
    ],
    examplesNegative: [
      '*İki saatten bekliyorum. (wrong — for-a-duration uses -DIr on the duration noun: "İki saattir bekliyorum.")',
      '*Sabah beri çalışıyorum. (wrong — beri needs the ablative on its complement → "Sabahtan beri çalışıyorum".)',
    ],
    commonErrors: [
      'Confusing -DEn beri (since a point) with -DIr (for a duration): sabahtan beri vs iki saattir.',
      'Assuming beri only means "since": -DEn beri also expresses "for" a span (üç günden beri = iki saattir = "for three days / two hours").',
      'Using "için" for an elapsed duration ("iki saat için bekliyorum") — an elapsed duration takes -DIr or -DEn beri (iki saattir / iki saatten beri bekliyorum).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
    // -DEn beri and -DIr are near-synonymous "since/for" alternants that
    // both fit almost any sentence (iki saattir ≈ iki saatten beri), so a
    // cloze is ambiguous unless the context names the target form — which
    // spoils the answer. The canonical clozeUnsuitable case ("near-synonym
    // alternants both fit"); lifetime cloze approval ~6%. Drill via
    // translation. See docs investigation 2026-06-07.
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a1-comparative-superlative',
    kind: 'grammar',
    name: 'Comparative (daha) and superlative (en)',
    description:
      'Comparative: ablative -DEn + daha + adjective (Ali Ayşe\'den daha uzun = Ali is taller than Ayşe). Superlative: en + adjective (en güzel film = the most beautiful film).',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Ali Ayşe\'den daha uzun. (Ali is taller than Ayşe.)',
      'Bu kitap o kitaptan daha ilginç. (This book is more interesting than that one.)',
      'En güzel film. (The most beautiful film.)',
      'O sınıfın en zeki öğrencisi. (The smartest student in that class.)',
      'Bu araba ondan ucuz. (This car is cheaper than that one — daha can be dropped once the ablative standard is present.)',
      'Bu kitap o kitaptan daha az ilginç. (This book is less interesting than that one — "less" = daha az.)',
    ],
    examplesNegative: [
      '*Ali Ayşe daha uzun. (wrong — the standard of comparison takes ablative: "Ayşe\'den daha uzun")',
    ],
    commonErrors: [
      'Omitting the ablative on the standard of comparison ("Ali Ayşe daha uzun" instead of "Ali Ayşe\'den daha uzun").',
      'Placing "daha" after the adjective instead of before it ("Ali uzun daha" instead of "Ali daha uzun").',
      'Expressing "less" by negating the adjective instead of using daha az ("daha az ilginç" = less interesting).',
      'Assuming daha is obligatory: when an ablative standard is present, daha is often dropped ("ondan ucuz" = cheaper than that).',
    ],
    prerequisiteKeys: ['tr-a1-ablative-dative'],
    coverageSpec: {
      axes: [{ name: 'comparison', floors: { comparative: 12, superlative: 6, less: 2 } }],
    },
  },
  // G&K §16.4.1.1 (location in time: clock time, days, dates). Added by the
  // 2026-07-16 book-coverage triage — the whole time-telling system had no
  // owning point (the ES ledger pass surfaced the same gap → es-a1-telling-time).
  // No sentenceConstructionSuitable: multi-frame (locative vs geçe/kala vs
  // caseless days), so a single-construction prompt would be ambiguous.
  {
    key: 'tr-a1-clock-time-dates',
    kind: 'grammar',
    name: 'Clock time and dates (saat üçte, ikiyi beş geçe)',
    description:
      'Telling time and dating events: locative on the hour (saat üçte, on buçukta) and on years/months (1995\'te, şubatta); past the hour = accusative + geçe (ikiyi beş geçe), to the hour = dative + kala (dörde yirmi kala), çeyrek for quarters; days of the week stay caseless (çarşamba günü gidiyorum). saat is optional and precedes the numeral.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Toplantı saat altıda başlıyor. (The meeting starts at six o\'clock — locative on the hour.)',
      'Film on buçukta bitti. (The film ended at half past ten — buçuk carries the locative.)',
      'İkiyi beş geçe geldi. (He came at five past two — accusative + geçe.)',
      'Dörde yirmi kala çıktık. (We left at twenty to four — dative + kala.)',
      'Çarşamba günü Konya\'ya gidiyorum. (I\'m going to Konya on Wednesday — no case on the day.)',
      '1995\'te doğdum. (I was born in 1995 — locative on the year.)',
    ],
    examplesNegative: [
      '*Çarşambada geliyorum. (wrong — days of the week take no locative: "çarşamba (günü) geliyorum")',
      '*iki beş geçe (wrong — the hour takes the accusative before geçe: "ikiyi beş geçe")',
    ],
    commonErrors: [
      'Adding the locative to days of the week ("çarşambada") — days stay caseless (çarşamba günü).',
      'Dropping the accusative before geçe or the dative before kala ("iki beş geçe" → "ikiyi beş geçe"; "dört yirmi kala" → "dörde yirmi kala").',
      'Placing saat after the numeral ("üç saatte" = "in three hours", a duration — clock time is "saat üçte").',
    ],
    prerequisiteKeys: ['tr-a1-locative', 'tr-a1-numbers-ordinals'],
  },

  // ---------------------------------------------------------------------------
  // A2
  // ---------------------------------------------------------------------------
  // G&K §2.2 (single→double consonant alternation). Sibling of the A1
  // tr-a1-stem-changes point: a small closed set of Arabic-origin nouns whose
  // final consonant DOUBLES before a vowel-initial suffix. Lexical and
  // dictionary-marked (sır (-rrı), hat (-ttı)), so placed at A2.
  {
    key: 'tr-a2-consonant-doubling',
    // clozeUnsuitable (2026-06-21): sibling of tr-a1-stem-changes — gemination
    // only shows before a vowel suffix, so a whole-word blank is under-constrained.
    // 2026-06-21 run: 5/57 approved (8 ambiguous + 15 low-quality); translation
    // (11/78) is healthy.
    clozeUnsuitable: true,
    // targetOverride (2026-06-23): with cloze retired, translation is the only
    // surface, and it yielded 2/27 on the 2026-06-22 run — gemination is
    // bypassable in free translation (Bu sır benim / haklarımı / karşıtı all
    // dodge the alternation) and the geminating set is a tiny closed class, so
    // the realistic distinct-item supply sits well below the A2 default (30).
    // Cap the per-cell target so the scheduler stops grinding dedup/ambiguous
    // waste; the generate@2026-06-23 prompt rule improves what does get made.
    targetOverride: 10,
    kind: 'grammar',
    name: 'Consonant doubling (gemination)',
    description:
      'A small set of Arabic-origin nouns double the final consonant before a vowel suffix: hak→hakkım, his→hissi, sır→sırrım, hat→hattı. Single before a consonant suffix (histen). Lexical, per word.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'hak → hakkım (my right — kk before the vowel suffix)',
      'his → hissi (his/her feeling — ss)',
      'sır → sırrımız (our secret — rr)',
      'hat → hattı (the line [ACC] — tt)',
      'zıt → zıddı (its opposite — dd)',
      'his → histen (from the feeling — single s before a consonant suffix)',
    ],
    examplesNegative: [
      '*hakım (wrong — the consonant doubles before a vowel suffix: hakkım)',
      '*sırım (wrong — sırrım for "my secret")',
      '*hissten (wrong — the doubling is only before a VOWEL suffix; before a consonant it stays single: histen)',
    ],
    commonErrors: [
      'Not doubling the final consonant before a vowel-initial suffix (*hakım, *sırım → hakkım, sırrım).',
      'Over-doubling before a consonant-initial suffix — the geminate only surfaces before a vowel: histen / haklar (single), but hissi / hakkım (double).',
      'Assuming it is predictable — only a small Arabic-origin set behaves this way (hak, his, sır, hat, hac, zıt, ret…); most nouns never double (at→atım, ev→evim). Dictionary-marked as sır (-rrı), hat (-ttı).',
    ],
    prerequisiteKeys: ['tr-a1-stem-changes'],
  },
  // G&K §18.1.2 (kendi) + §18.1.4 (birbir- 'each other'). The PRODUCTIVE
  // reflexive/reciprocal pronouns, distinct from the closed-set derivational
  // voice suffixes -(I)n / -(I)ş at B1 (tr-b1-reflexive-voice-kendi,
  // tr-b1-reciprocal-voice). Most "self / each other" senses use these.
  {
    key: 'tr-a2-reflexive-reciprocal-pronouns',
    coverageSpec: {
      axes: [
        // kendi + possessive is a full person paradigm (kendim, kendin,
        // kendisi, kendimiz…), as is birbir- (birbirimizi/birbirinizi).
        // Pool audit 2026-07-17: 3rd-person dominated (kendim/kendin rare).
        // Translation-only surface, so the person pin is safe.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    // clozeUnsuitable (2026-06-21): a single blank leaves the case
    // under-constrained — birbirine / birbirini / birbiriyle all fit with no
    // acceptableAnswers (same trap as the voice / stacking points). 2026-06-21
    // run: 9/39 approved, 8 ambiguous flags. Translation is the right surface.
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Reflexive & reciprocal pronouns (kendi, birbiri)',
    description:
      "kendi + possessive = 'self' (kendim, kendin, kendisi…): reflexive (kendimi gördüm), emphatic (kendim yaptım), adjectival 'own' (kendi evim). birbiri = 'each other' (birbirini, birbirine).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Kendimi aynada gördüm. (I saw myself in the mirror — reflexive object.)',
      'Bunu kendim yaptım. (I did this myself — emphatic.)',
      'Kendi evimde yaşıyorum. (I live in my own house — adjectival "own".)',
      'Çocuk kendi kendine giyindi. (The child got dressed by him/herself.)',
      'Birbirimizi yıllardır tanıyoruz. (We have known each other for years — birbiri + accusative.)',
      'Birbirine yardım ettiler. (They helped each other — birbiri + dative.)',
    ],
    examplesNegative: [
      '*Kendi gördüm. (wrong — the reflexive object needs a possessive + case: "Kendimi gördüm".)',
      '*Onlar yardım ettiler each other (wrong — "each other" is birbiri with case: "Birbirine yardım ettiler".)',
      '*kendi evim benim (redundant — adjectival kendi already means "own": "kendi evim".)',
    ],
    commonErrors: [
      'Using bare kendi as a reflexive object without a possessive + case (*kendi gördüm → kendimi gördüm).',
      'Confusing the adjectival "own" (kendi evim) with the emphatic "myself" (evi kendim aldım).',
      'Reaching for the closed-set reflexive/reciprocal voice suffixes (-(I)n / -(I)ş) where the productive pronoun is needed — most "self / each other" senses use kendi / birbiri + a plain verb.',
      'Wrong case on birbiri (birbirini / birbirine / birbiriyle), or pluralising it as *birbirleri instead of agreeing via the possessive (birbirimizi, birbirinizi).',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes', 'tr-a1-personal-pronouns'],
  },
  // G&K §15.7.3 (distributive numerals) + §7 derivation (-(ş)Ar). Productive
  // on numerals and kaç; the deletable ş surfaces after a vowel (ikişer) and
  // drops after a consonant (üçer, beşer, onar). Reduplicated = "X by X".
  {
    key: 'tr-a2-distributive',
    kind: 'grammar',
    name: 'Distributive numerals -(ş)Ar ("… each")',
    description:
      'Distributive -(ş)Ar on numerals = "… each": birer, ikişer, üçer, beşer, onar. The -ş- appears after a vowel (ikişer), drops after a consonant (üçer). Reduplicated = "X by X" (ikişer ikişer).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Herkese birer elma verdim. (I gave everyone one apple each — bir→birer.)',
      'Çocuklar ikişer ikişer girdi. (The children came in two by two — reduplicated.)',
      'Üçer kişilik gruplar kurun. (Form groups of three each — üç→üçer, no -ş-.)',
      'Beşer lira ödedik. (We each paid five lira — beş→beşer.)',
      'Onar dakika ara verdik. (We took breaks of ten minutes each — on→onar.)',
    ],
    examplesNegative: [
      '*Herkese bir elma verdim. for "one each" (a plain numeral means a flat count; "one each" is the distributive birer.)',
      '*ikier (wrong — a vowel-final numeral keeps the -ş-: ikişer)',
      '*üçşer (wrong — a consonant-final numeral drops the -ş-: üçer)',
    ],
    commonErrors: [
      'Using a plain numeral where the distributive "… each" is meant (bir → birer, iki → ikişer).',
      'Mishandling the deletable -ş-: it appears after a vowel (ikişer, altışar, yedişer) and drops after a consonant (üçer, beşer, dörder, onar).',
      'Forgetting that reduplication of the distributive expresses "X by X / in groups of X" (birer birer = one by one).',
    ],
    prerequisiteKeys: ['tr-a1-numbers-ordinals'],
  },
  // G&K §10.2 (-(s)I compounds), contrast §14.4 genitive-possessive. The
  // INDEFINITE noun compound (head takes -(s)I, first noun bare) vs the
  // DEFINITE genitive compound (tr-a1-genitive-possessive: possessor takes
  // genitive). Case stacks onto the compound head with the -n- buffer because
  // the -(s)I marker behaves like a 3sg possessive (şehir merkez-i-n-e).
  {
    key: 'tr-a2-indefinite-compound',
    // No targetOverride/clozeUnsuitable: the 2026-06-22 cloze yield (8/49) is a
    // FORMAT problem, not a structural one — MC-option and head-only blanks pass
    // cleanly; whole-compound blanks, omitted parenthetical heads, and
    // case-stacked answers are what flag `ambiguous`. The fix is the
    // generate@2026-06-23 cloze rule (bare-head hint, nominative answer, no
    // case-stacking), NOT a curriculum cap — targetOverride is point-wide and
    // would also clamp the healthy translation surface (13/41).
    kind: 'grammar',
    name: 'Indefinite noun compound (belirtisiz isim tamlaması)',
    description:
      "Indefinite N+N compound: only the HEAD takes 3sg -(s)I, first noun bare — otobüs bileti, şehir merkezi (vs definite şehrin merkezi). Case stacks after -(s)I via the -n- buffer: merkezine. Nested compounds keep each head's -(s)I (İngiliz Edebiyatı Bölümü); a compound serving as head takes -(s)I only once (Polonya gölge tiyatrosu, not *tiyatrosusu).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'otobüs bileti (a bus ticket — head "bilet" takes -i; "otobüs" stays bare)',
      'şehir merkezi (the city centre — merkez + -i; no genitive on şehir)',
      'el çantası (a handbag — vowel-final "çanta" takes the -s- buffer: çanta-sı)',
      'Türkçe dersi (a Turkish lesson)',
      'Dün şehir merkezine gittim. (I went to the city centre yesterday — case on the head: merkez-i-n-e.)',
      'Otobüs biletini kaybettim. (I lost the bus ticket — accusative on the head: bilet-i-n-i.)',
      'göz hastalıkları hastanesi (an eye-diseases hospital — a compound modifying another compound; each head keeps its own -(s)I)',
    ],
    examplesNegative: [
      '*şehrin merkezi for the kind "city centre" (that is "the centre OF THE city" — a definite/genitive compound; the bare kind is "şehir merkezi")',
      '*otobüsün bileti for a generic "bus ticket" (genitive marks one specific bus\'s ticket; the kind is "otobüs bileti")',
      '*şehir merkez (wrong — the head must take -(s)I: şehir merkezi)',
      '*şehir merkeze (wrong — case stacks AFTER -(s)I with the -n- buffer: şehir merkezine)',
      '*masa güzel örtüsü (wrong — nothing can intervene between the members; modifiers precede the whole compound: güzel bir masa örtüsü)',
    ],
    commonErrors: [
      'Marking the first noun with the genitive when no specific possessor is meant: "otobüs bileti" (a kind of ticket), not "*otobüsün bileti" (one specific bus\'s ticket). Genitive ⇒ definite compound (şehrin merkezi); bare first noun ⇒ indefinite compound (şehir merkezi).',
      'Dropping the -(s)I marker on the head (*şehir merkez → şehir merkezi).',
      'Forgetting the -s- buffer when the head ends in a vowel (el çanta-sı, not *el çantaı).',
      'Adding case directly to the head without the -n- buffer (*merkeze → merkezine): the compound -(s)I behaves like a 3sg possessive, so case takes -n- (merkez-i-n-e).',
      "Inserting an adjective or determiner between the compound's members (*masa güzel örtüsü) — modifiers precede the WHOLE compound: güzel bir masa örtüsü, ilginç çocuk kitapları.",
    ],
    prerequisiteKeys: [
      'tr-a1-possessive-suffixes',
      'tr-a1-genitive-possessive',
      'tr-a2-possessive-case-stacking',
    ],
  },
  // Reference/theory anchor for the whole nominal suffix system. G&K §6.3
  // (order of suffixation), §6.1.3 + §6.2 (buffer consonants y/n + deletable
  // vowels), §8.1 (nominal inflectional suffixes), §8.1.3 (su/ne irregular
  // -y-), §8.1.4 (-ki takes -n- before case). clozeUnsuitable: a single
  // whole-word blank cannot capture a meta-ordering/buffer rule; its value is
  // the theory page + translation practice on multi-suffix words.
  {
    key: 'tr-a2-suffix-order-buffers',
    clozeUnsuitable: true,
    // coverageSpec (2026-06-21): the translation surface dedup-gave-up 19/88 on
    // the 2026-06-21 run (only 7 approved) — a diversity problem, the drafts
    // collapse onto a few canonical words. The buffers are person/case
    // conditioned (3sg/3pl trigger the -s-/-n- buffers; 1sg/2sg don't; -n- sits
    // before case), so a person×case spec targets them with the allowed axes —
    // mirroring the proven tr-a2-possessive-case-stacking fix.
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 2, '2sg': 2, '3sg': 4, '3pl': 3 } },
        { name: 'case', floors: { accusative: 3, dative: 3, locative: 3, ablative: 2 } },
      ],
    },
    kind: 'grammar',
    name: 'Suffix order & buffer consonants (y / n / s)',
    description:
      'Nominal suffix order: root → plural -lAr → possessive → case → -ki → copula (evlerimizdeki). Buffers: -y- joins two vowels (arabaya), -s- on 3sg possessive (kapısı), -n- before case (odasına).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'evlerimizde (in our houses — ev + -ler [plural] + -imiz [possessive] + -de [case], in that fixed order)',
      'çocuklarına (to your/their children — çocuk-lar-ın-a: possessive before case)',
      'arabaya (to the car — -y- buffer between the vowel-final stem and the case vowel: araba-y-a)',
      'kapısı (his/her door — -s- buffer on the 3sg possessive after a vowel: kapı-sı)',
      'odasına (to his/her room — -n- buffer before case on a 3sg possessive: oda-sı-n-a)',
      'suyu (the water [ACC] — irregular stem su takes a -y- buffer: su-y-u; likewise ne → neyi)',
      'evdekinde (in the one at home — -ki itself takes case via the -n- buffer: ev-de-ki-n-de)',
    ],
    examplesNegative: [
      '*evdelerimiz (wrong order — plural and possessive come before case: evlerimizde)',
      '*kapıı (wrong — the 3sg possessive after a vowel needs the -s- buffer: kapısı)',
      '*odasıa (wrong — case after a 3sg possessive needs the -n- buffer: odasına)',
      '*suu / *nei (wrong — su and ne take a -y- buffer before a vowel suffix: suyu, neyi)',
    ],
    commonErrors: [
      'Reversing the template — case before possessive/plural (*ev-de-ler-imiz instead of ev-ler-imiz-de).',
      'Choosing the wrong buffer: -y- joins two vowels (arabaya), -s- appears only on the 3sg possessive after a vowel (kapısı), and -n- appears before a case suffix on 3sg/3pl possessives, demonstrative/3rd-person pronouns, and -ki (odasına, onu, evdekinde).',
      'Forgetting that su (water) and ne (what) are irregular — they take a -y- buffer before any vowel-initial suffix (suyu, suya, suyum; neyi, neye), never *suu / *sui / *nee.',
      'Treating -ki as the end of the word: it can take a further case suffix, and then needs the -n- buffer (evdeki → evdekinde "in the one at home").',
    ],
    prerequisiteKeys: [
      'tr-a1-possessive-suffixes',
      'tr-a2-possessive-case-stacking',
      'tr-a1-ki-relativizer',
    ],
  },
  // G&K §21.4.4.3 (optative/volitional) + §8.2.3.1 (the suffix). Only 1sg
  // -(y)AyIm and 1pl -(y)AlIm are live in modern Turkish; 2nd/3rd persons are
  // archaic (3rd person uses the imperative -sIn). Drill the suggestion/offer
  // sense, which our imperative point (A1) does not cover.
  {
    key: 'tr-a2-optative',
    coverageSpec: {
      axes: [
        // Same collapse shape as tr-a1-imperative (PR #588): the two live
        // forms are 1sg -(y)AyIm and 1pl -(y)AlIm — partial floors only
        // (2nd/3rd person are archaic / belong to imperative & -sIn).
        { name: 'person', floors: { '1sg': 8, '1pl': 8 } },
        // Negative -mAyAyIm/-mAyAlIm is claimed core; without a floor the
        // pool collapses to affirmative suggestions.
        { name: 'polarity', floors: { affirmative: 10, negative: 8 } },
      ],
    },
    kind: 'grammar',
    name: 'Optative / volitional -(y)AyIm / -(y)AlIm ("let me / let\'s")',
    description:
      "Optative: 1sg -(y)AyIm 'let me / shall I?' (gideyim, yardım edeyim mi?) and 1pl -(y)AlIm 'let's / shall we?' (gidelim, başlayalım). Vowel stems insert -y-; negative -mAyAyIm/-mAyAlIm; often with hadi.",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      "Ben gideyim. (Let me go. / I'll get going — 1sg offer to act.)",
      'Sana yardım edeyim mi? (Shall I help you? — 1sg consultative question.)',
      "Hadi sinemaya gidelim. (Let's go to the cinema — 1pl suggestion.)",
      'Biraz dinlenelim mi? (Shall we rest a bit? — 1pl consultative.)',
      'Başlayayım mı? (Shall I begin? — vowel stem başla- takes the -y- buffer: başla-y-ayım.)',
      "Geç kalmayalım. (Let's not be late — negative 1pl.)",
      "Bakalım kim kazanacak. (Let's see who will win — the frozen 1pl optative bakalım frames an anticipated question without seeking an answer.)",
    ],
    examplesNegative: [
      '*Ben gidelim. (wrong person — 1sg is "gideyim"; "gidelim" is 1pl "let\'s go".)',
      '*Başlaayım. (wrong — a vowel-final stem needs the -y- buffer: başlayayım.)',
      '*Sinemaya gidiyor muyuz? for "shall we go?" (a suggestion uses the optative: "gidelim mi?", not the present tense.)',
    ],
    commonErrors: [
      'Using the present -(I)yor or future -(y)AcAK for a suggestion instead of the optative ("gidiyor muyuz?" instead of "gidelim mi?").',
      'Confusing 1sg -(y)AyIm with 1pl -(y)AlIm (gideyim = let me go; gidelim = let\'s go).',
      'Dropping the -y- buffer after a vowel-final stem (*okuayım, *başlaalım → okuyayım, başlayalım).',
      'Reaching for the optative in the 2nd/3rd person: those forms are archaic — "let him come" is -sIn (gelsin) and a command to "you" is the imperative (gel / gelin), not *gelesin.',
      'Confusing the optative "let\'s / let me" with necessity -mAlI "must" (gidelim ≠ gitmeliyiz).',
    ],
    prerequisiteKeys: ['tr-a1-imperative', 'tr-a1-present-continuous'],
  },
  // G&K §18.6 (pronominal quantifiers), §20.5.2–.3 (negative-polarity items
  // require a negative verb), §12.2.2 (herkes takes singular agreement).
  {
    key: 'tr-a2-indefinite-pronouns',
    coverageSpec: {
      axes: [
        // Two claimed halves: NPIs requiring a negative verb (kimse, hiçbiri)
        // vs the non-NPI members (biri, herkes, hepsi). Pool audit
        // 2026-07-17: 51/9 negative-skewed — the positive half starved.
        { name: 'polarity', floors: { affirmative: 12, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Indefinite & quantifier pronouns (biri / herkes / hiçbir / kimse / hepsi)',
    description:
      'Indefinite pronouns: biri(si) someone, herkes everyone (singular verb), hepsi all, bazısı some. Negative-polarity kimse, hiçbiri, hiçbir+N, hiçbir şey REQUIRE a negative verb: Kimse gelmedi.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Kapıda biri var. (There is someone at the door.)',
      'Herkes geldi. (Everyone came — herkes takes a SINGULAR verb, not *geldiler.)',
      'Kimse gelmedi. (No one came — the negative verb is obligatory; literally "anyone came-not".)',
      'Hiçbir şey görmedim. (I saw nothing / I did not see anything.)',
      'Bu ilaçlardan hiçbirini beğenmedim. (I did not like any of these medicines — case + -n- buffer: hiçbir-i-n-i; an ablative-marked set forms the partitive: arkadaşlarımdan biri "one of my friends". As direct object the -(s)I head obligatorily takes the accusative.)',
      'Herkese yardım ettim. (I helped everyone — dative on herkes.)',
      'Çamaşır makinesi bozuldu, yenisini aldık. (The washing machine broke down; we bought a new one — the same -(s)I pronominalises adjectives, numerals and determiners: yenisi, eskisi, ikisi (de), hangisi, başkası.)',
    ],
    examplesNegative: [
      '*Kimse geldi. for "nobody came" (wrong — Turkish requires a negative verb: "Kimse gelmedi".)',
      '*Herkes geldiler. (wrong — herkes is grammatically singular: "Herkes geldi".)',
      '*Hiçbir şey gördüm. (wrong — needs the negative verb: "Hiçbir şey görmedim".)',
      '*Karısından asla özür diler. (wrong — asla is a negative-polarity item like kimse: it requires a negative verb → "Karısından asla özür dilemez".)',
    ],
    commonErrors: [
      'Calquing English "nobody / nothing came" with a positive verb (*Kimse geldi, *Hiçbir şey oldu) — kimse / hiçbiri / hiçbir / hiçbir şey demand a negative verb (-mA), değil, or yok: Kimse gelmedi, Hiçbir şey yok.',
      'Giving herkes a plural verb (*Herkes geldiler) — it always takes singular agreement (Herkes geldi).',
      'Dropping case / the -n- buffer on these pronouns: kimseyi, kimseye, hiçbirine, hiçbirini, hepsine, hepsini (not *hiçbiriye, *hepsiye).',
      'Confusing biri "someone / one of them" with her biri "each one" and hiçbiri "none of them".',
      'Forgetting that the adverb asla "never" obeys the same negative-polarity rule — it needs -mA, değil or yok: Karısından asla özür dilemez ("he never apologizes"), not *asla özür diler.',
    ],
    prerequisiteKeys: ['tr-a1-negation', 'tr-a1-var-yok', 'tr-a1-personal-pronouns'],
  },
  {
    key: 'tr-a2-possessive-case-stacking',
    // Dedicated home for possessive+case suffix STACKING. Bolting a `case` axis
    // onto the A1 `tr-a1-possessive-suffixes` point (2026-06-19b) made the
    // validator flag every stacked form: grammar-point-mismatch (the case suffix
    // reads as a second grammar point) + level-mismatch (stacking is above A1).
    // An explicit A2 point whose description/examples teach possessive+case
    // clears both checks. cloze is suppressed (same under-constrained-blank trap
    // as the voice points); conjugation + translation are the right surfaces.
    conjugationSuitable: true,
    clozeUnsuitable: true,
    // Nominal possessive+case inflection — declines a noun, not a verb; seed from the noun band.
    conjugationSeedKind: 'noun',
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 3, '2sg': 3, '3sg': 3, '1pl': 3, '2pl': 3, '3pl': 3 } },
        { name: 'case', floors: { accusative: 4, dative: 4, locative: 4, ablative: 4 } },
      ],
    },
    kind: 'grammar',
    name: 'Possessive + case stacking',
    description:
      'Possessive then case, stacked in that order (evimizden = ev-imiz-den). 3sg/3pl insert a buffer -n- before the case suffix (odası → odasına); 1sg/2sg do not (çantam → çantamı).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'çantamı (my bag, accusative — çanta-m-ı, no buffer -n-)',
      'evimizden (from our house — ev-imiz-den, ablative)',
      'arabanızda (in your(pl) car — araba-nız-da, locative)',
      'kitabını (his/her book, accusative — 3sg buffer -n-: kitab-ı-n-ı)',
      'odasına (to his/her room — 3sg buffer -n-: oda-sı-n-a)',
      'evlerinde (in their house — 3pl buffer -n-: ev-leri-n-de)',
    ],
    examplesNegative: [
      '*evdenimiz (case before possessive — order must be possessive then case: evimizden)',
      '*kitabıı (3sg accusative missing the buffer -n-: should be kitabını)',
      '*odasıa (3sg dative missing the buffer -n-: should be odasına)',
    ],
    commonErrors: [
      'Reversing the order — case before possessive (*ev-den-imiz instead of ev-imiz-den).',
      'Dropping the buffer -n- before the case suffix on 3sg/3pl possessives (*kitabıı → kitabını, *odasıa → odasına).',
      'Over-applying the buffer -n- to 1sg/2sg/1pl/2pl, which do not take it (*çantamnı → çantamı).',
      'Vowel-harmony or consonant-softening slips across the longer suffix chain.',
    ],
    prerequisiteKeys: [
      'tr-a1-possessive-suffixes',
      'tr-a1-accusative-definite-object',
      'tr-a1-ablative-dative',
      'tr-a1-locative',
    ],
  },
  {
    key: 'tr-a2-mis-evidential',
    // personRotation deliberately ABSENT (2026-06-12): the rotation eval
    // collapsed this chronically weak cell further (2/12 -> 0/12 approved,
    // 4 low-quality rejects) - non-3sg evidentials need their own treatment.
    kind: 'grammar',
    name: 'Evidential past -mIş',
    description:
      'Indirect past -mIş (verbal) and copular -(y)mIş: hearsay, inference from a result, or surprise. Obligatory when the event was not witnessed — -DI instead would claim first-hand knowledge.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hava soğukmuş.',
      'Ahmet evlenmiş.',
      'Yollar ıslak, yağmur yağmış. (inference from a result — unwitnessed)',
      'Yeni komşumuz çok kibarmış. (hearsay / newly learned — copular -mış)',
    ],
    examplesNegative: ['*Dün hava soğukmuş. (when the speaker felt the cold)'],
    commonErrors: [
      'Using -mIş for events the speaker actually witnessed.',
      'Confusing the -mIş evidential with the -mIş perfect participle.',
      'Defaulting to witnessed -DI for hearsay or inference, where evidential -mIş is obligatory.',
      'Dropping copular -(y)mIş on nominal / adjectival predicates when reporting (hastaymış, not hastaydı).',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'tr-a2-aorist',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 8, '2sg': 8, '3sg': 8, '1pl': 8, '2pl': 8, '3pl': 8 } },
        // Negative aorist (-mAz, irregular -mAm/-mAyIz) is the high-value drill.
        { name: 'polarity', floors: { affirmative: 6, negative: 6 } },
      ],
    },
    kind: 'grammar',
    name: 'Aorist -(I/A)r',
    description:
      'Aorist -(A/I)r marks general truths, characteristic behaviour, and offers (Çay içer misin?). Negative is -mAz (içmez), irregular in 1sg -mAm / 1pl -mAyIz. Contrast with observed -(I)yor.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Her sabah kahve içerim.',
      'Çay ister misiniz?',
      'Kaplumbağa yavaş yürür. (characteristic / general truth → aorist)',
      'Ali sigara içmez. (negative aorist -mez = "is a non-smoker")',
      'İçmem, teşekkürler. (1sg negative — irregular -mem, not *içmezim)',
    ],
    examplesNegative: [
      '*Her sabah kahve içiyorum. (in a generic-truth context)',
      '*Ali sigara içmer. (negative aorist is -mez: "içmez", never *içmer)',
    ],
    commonErrors: [
      'Substituting the present continuous -(I)yor for habitual statements.',
      'Picking the wrong aorist suffix for monosyllabic stems.',
      'Forming the negative with *-mAr instead of -mAz (içmer → içmez).',
      'Using regular endings in the 1sg/1pl negative instead of the irregular -mAm / -mAyIz (*içmezim → içmem).',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'tr-a2-ability-necessity',
    // personRotation deliberately ABSENT (2026-06-12): rotation amplified this
    // cell's pre-existing spoil trap (3 -> 9 context-spoils-answer rejects,
    // 4/12 -> 0/12 approved in the eval) - fix the spoil issue first.
    kind: 'grammar',
    name: 'Ability -(y)Abil and necessity -mAlI',
    description:
      "Ability: -(y)Abil+tense (yapabilirim; vowel stems take -y-: okuyabilirim). Negative is irregular -(y)AmA, not -Abilme (yapamam). Necessity -mAlI ('must', speaker-felt) vs lazım/gerek ('have to').",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yüzebilirim. (I can swim.)',
      'Türkçe konuşabiliyor musun? (Can you speak Turkish?)',
      'Yapamam. (I cannot do it — negative ability.)',
      'Erken kalkmalıyım. (I must get up early.)',
      'Okuyabilirim. (I can read — vowel stem oku- takes the buffer -y-.)',
      'Eve gitmem lazım. (I have to go home — objective necessity with lazım, vs. speaker-felt gitmeliyim.)',
    ],
    examplesNegative: [
      '*Yüzmek yapabilirim. (wrong — ability is a suffix on the verb stem, not a separate auxiliary: "yüzebilirim")',
      '*Okuabilirim. (wrong — a vowel-final stem needs the buffer -y- before -(y)Abil → "okuyabilirim".)',
    ],
    commonErrors: [
      'Treating -(y)Abil as a separate auxiliary ("yüzmek yapabilirim") instead of suffixing it ("yüzebilirim").',
      'Confusing negative ability "yapamam" (I cannot) with simple verbal negation "yapmam" (I do not).',
      'Forgetting vowel harmony on -mAlI (*gitmalıyım instead of gitmeliyim on a front-vowel stem).',
      'Dropping the buffer -y- after a vowel-final stem (*okuabilirim instead of "okuyabilirim").',
      'Using -mAlI for an external/objective obligation where Turkish prefers lazım/gerek ("have to"); -mAlI is the speaker\'s own felt obligation ("must").',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
  },
  {
    key: 'tr-a2-converbs',
    kind: 'grammar',
    name: 'Converbs (-(y)Ip, -(y)ArAk, -mAdAn, -(y)A…-(y)A)',
    description:
      'Adverbial converbs link clauses without a finite verb: -(y)Ip (sequence), -(y)ArAk (manner), -mAdAn (without doing), -(y)A…-(y)A (repeated action).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Eve gelip yemek yedim. (I came home and ate — sequence.)',
      'Gülerek konuştu. (She spoke smiling — manner.)',
      'Yemeden gitme. (Don\'t leave without eating — without.)',
      'Bağıra bağıra koştu. (He ran shouting and shouting — repeated.)',
      'Koşup düştü. (He ran and fell — the converb verb has no tense; only "düştü" carries the past.)',
      'Müziği açarak ders çalıştı. (She studied with the music on — manner; "çalıştı" supplies the tense.)',
    ],
    examplesNegative: [
      '*Eve geldim ve yemek yedim. (overuses finite "ve" coordination where a converb is more idiomatic: "Eve gelip yemek yedim.")',
      '*Eve geldip yemek yedim. (wrong — the converb verb takes no tense and stays bare: "Eve gelip yemek yedim".)',
      '*Annem yapıp ben kurdum. (wrong — -(y)Ip needs the same subject for both verbs → use finite coordination: "Annem yaptı ve ben kurdum".)',
      '*Onunla hiçbir zaman görüşmeyip konuşamadık. (wrong — in a -(y)Ip chain the final negative scopes over the whole chain: görüşüp konuşamadık.)',
    ],
    commonErrors: [
      'Defaulting to "ve" coordination instead of using converbs to link clauses.',
      'Confusing -(y)Ip (sequence: did X, then Y) with -(y)ArAk (manner: did Y by/while doing X).',
      'Treating -mAdAn ("without doing") as ordinary verbal negation rather than an adverbial converb.',
      'Putting tense/person on the converb verb (*geldip) — the converb stays bare; only the final main verb is inflected for the whole chain, including negation: Onunla hiçbir zaman görüşüp konuşamadık ("we never managed to meet and talk"), not *görüşmeyip.',
      'Using -(y)Ip / -(y)ArAk when the two clauses have different subjects — these converbs normally require the same subject; use finite coordination instead.',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-converb-temporal',
    kind: 'grammar',
    name: 'Temporal converbs -mAdAn önce / -DIktAn sonra',
    description:
      'Temporal converbs on a verb stem: -mAdAn (önce) ("before doing"; önce optional — gitmeden = before going) and -DIktAn sonra ("after doing"; yedikten sonra). Subject stays a bare noun.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gitmeden önce ara beni. (Call me before you go.)',
      'Yedikten sonra dişlerimi fırçalarım. (I brush my teeth after eating.)',
      'Okuldan döndükten sonra dinlendim. (I rested after coming back from school.)',
      'Uyumadan dişlerini fırçala. (Brush your teeth before sleeping — -mAdAn alone, önce dropped.)',
      'Sen gittikten sonra herkes üzüldü. (Everyone was sad after you left — converb subject is the bare noun "sen".)',
    ],
    examplesNegative: [
      '*Gitmek önce ara beni. (wrong — "before going" needs -mAdAn on the verb stem: "Gitmeden önce ara beni"; the nominal -DAn önce takes a noun, not an infinitive.)',
      '*Sen gittiğinden sonra herkes üzüldü. (wrong — -DIktAn sonra takes no person marking; use the bare form: "Sen gittikten sonra herkes üzüldü".)',
    ],
    commonErrors: [
      'Using the nominal -DAn önce / sonra (with a noun) where the verbal temporal converb is needed: "gitmek önce" → "gitmeden önce".',
      'Confusing -mAdAn ("without doing") with -mAdAn önce ("before doing"): yemeden gitme vs yemeden önce ellerini yıka.',
      'Adding person / possessive marking to -DIktAn sonra (it never agrees): "gittiğinden sonra" → "gittikten sonra".',
      'Thinking önce is obligatory after -mAdAn: -mAdAn on its own can already mean "before" (uyumadan = before sleeping).',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
    sentenceConstructionSuitable: true,
  },
  {
    key: 'tr-a2-nominalization',
    kind: 'grammar',
    name: 'Verbal nouns -mA / -mAk / -Iş',
    description:
      'Verbal nouns: -mAk (infinitive, same subject as the main verb: okumak güzel), -mA + possessive (different subject: onun gelmesi zor), -Iş (manner / single act, often lexicalised: yürüyüş, gidiş).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Okumak çok eğlenceli. (Reading is very fun — -mAk.)',
      'Yüzmek istiyorum. (I want to swim — -mAk as object; also before yerine: ders çalışmak yerine televizyon izledi "he watched TV instead of studying".)',
      'Onun gelmesi zor. (His coming is difficult — -mA with possessive.)',
      'Bu yürüyüş güzeldi. (This walk was nice — -Iş lexicalised.)',
      'Gelmek istiyorum. (I want to come — same subject, so plain -mAk.)',
      'Onun gelmesini istiyorum. (I want him to come — different subject, so -mA + possessive + accusative.)',
      "Kardeşimin gelme ihtimali var. (There's a chance my brother will come — a -mA verbal noun modifying a -(s)I compound head; -mA is preferred over -mAk in this slot.)",
    ],
    examplesNegative: [
      '*Onun gelme zor. (wrong — -mA action nouns take a possessive suffix when used as an embedded subject: "Onun gelmesi zor".)',
      '*Onun gelmek istiyorum. (wrong — when the embedded subject differs, use -mA + possessive: "Onun gelmesini istiyorum".)',
    ],
    commonErrors: [
      'Forgetting the possessive suffix on -mA in embedded clauses ("onun gelme zor" instead of "onun gelmesi zor").',
      'Using -mAk when the embedded subject differs from the main subject: "Onun gelmesini istiyorum" (different subject), not "*Onun gelmek istiyorum" — bare -mAk works only when both subjects are the same.',
      'Picking the wrong harmonised form (*okumek instead of okumak).',
      'Confusing the -(y)Iş action/manner noun (yürüyüş "a walk", bakış "a look", gülüş "a way of laughing") with the -mIş evidential/perfect verb (yürümüş "s/he has walked"): -(y)Iş names the act or manner; -mIş is a finite verb form.',
    ],
    prerequisiteKeys: ['tr-a1-possessive-suffixes'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-relative-an',
    coverageSpec: {
      axes: [
        // The negative participle -mAyAn (with its -y- buffer trap *gelmeen)
        // is claimed core. Pool audit 2026-07-17: translation 28/2
        // affirmative-collapsed.
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Subject relative -(y)An / -(y)En',
    description:
      'Subject relative -(y)An/-(y)En: a tenseless pre-nominal modifier for subject relatives (gelen adam = the man who came/comes). Negative -mAyAn; for "X that is …" use olan (kırmızı olan araba).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Gelen adam babam. (The man who came is my father.)',
      'Oynayan çocuklar mutlu. (The playing children are happy.)',
      'Türkçe konuşan biri. (Someone who speaks Turkish.)',
      'Burada oturan kadın öğretmen. (The woman sitting here is a teacher.)',
      'Kırmızı olan araba bizim. (The car that is red is ours — olan = ol- + -(y)An relativizes a nominal predicate.)',
      'Hiç çalışmayan öğrenci sınıfta kaldı. (The student who doesn\'t study at all failed — negative -mAyAn.)',
      'Çalışan kazanır. (The one who works wins — headless: -(y)An stands alone as the noun phrase, no head.)',
    ],
    examplesNegative: [
      '*Ben okuyan kitap. (wrong — -(y)An only marks SUBJECT relatives; non-subject "the book I read" needs the B2 -DIK form: "benim okuduğum kitap".)',
    ],
    commonErrors: [
      'Using -(y)An for non-subject relatives where -DIK / -(y)AcAK with possessive is required (B2).',
      'Placing -(y)An after the noun English-style ("adam gelen") instead of before it ("gelen adam").',
      'Forgetting the -y- buffer on vowel-final stems (*okuan instead of okuyan).',
      'Forgetting the suppletive olan for relativizing a noun / adjective predicate ("the one that is a teacher" = öğretmen olan).',
      'Dropping the -y- buffer on the negative -mA stem (*gelmeen / *çalışmaan instead of gelmeyen / çalışmayan).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous'],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-gibi-kadar',
    kind: 'grammar',
    name: 'Similarity and equality (gibi, kadar)',
    description:
      'gibi ("like") and kadar ("as…as") follow the compared noun (aslan gibi); pronouns take the genitive before both (benim gibi, senin kadar). kadar also marks approximate quantity. After a finite clause, gibi + gel- with a dative experiencer = "seem (to someone)": Bana haklısın gibi geliyor; after -mIş, gibi makes "as if" clauses, optionally with sanki: (Sanki) hayalet görmüş gibi sapsarı oldu.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Bir aslan gibi güçlü. (Strong like a lion.)',
      'Benim gibi düşünüyor. (He thinks like me.)',
      'Senin kadar uzun. (As tall as you.)',
      'Bir saat kadar bekledim. (I waited about an hour.)',
      'Benim kadar çalışmıyor. (He doesn\'t work as much as I do — kadar attracts the genitive on ben, like gibi.)',
      'O kadar yorgundum ki hemen uyudum. (I was so tired that I fell asleep at once — o kadar/öyle … ki expresses result, "so … that".)',
    ],
    examplesNegative: [
      '*Ben gibi düşünüyor. (wrong — with a pronoun, gibi requires the genitive: "benim gibi", not "ben gibi".)',
      '*Ben kadar uzun. (wrong — kadar attracts the genitive on this pronoun just like gibi: "benim kadar uzun".)',
    ],
    commonErrors: [
      'Using a bare pronoun before gibi instead of the genitive ("ben gibi" instead of "benim gibi").',
      'Confusing gibi (similarity) with kadar (equality / quantity): "aslan gibi güçlü" (strong like a lion) vs "aslan kadar güçlü" (as strong as a lion).',
      'Forgetting that kadar — not only gibi — takes the genitive on ben/sen/biz/siz/bu/şu/o/kim ("ben kadar" instead of "benim kadar").',
      'Adding the genitive to PLURAL pronouns before gibi/kadar: "bizler gibi", "onlar kadar" stay bare (no -in).',
    ],
  },
  {
    key: 'tr-a2-correlative-conjunctions',
    kind: 'grammar',
    name: 'Correlative conjunctions (hem…hem, ne…ne, ya…ya, ister…ister)',
    description:
      'Correlative pairs: hem … hem (de) "both … and", ne … ne "neither … nor" (predicate normally positive), ya … ya (da) "either … or", ister … ister "whether … or"; both halves obligatory.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hem Türkçe hem İngilizce konuşuyor. (She speaks both Turkish and English.)',
      'Ne çay ne kahve içerim. (I drink neither tea nor coffee — verb stays positive.)',
      'Ya bugün ya yarın gelirim. (I will come either today or tomorrow.)',
      'İster sen gel ister o. (Let either you come or him.)',
      'Hem ben hem de kardeşim geldik. (Both I and my brother came — the last half often takes de.)',
      'Ne param ne de zamanım var. (I have neither money nor time — predicate stays positive: var.)',
    ],
    examplesNegative: [
      '*Ne çay ne kahve içmem. (wrong — with ne … ne the verb stays POSITIVE in Turkish: "Ne çay ne kahve içerim".)',
      '*Ya bugün, yarın gelirim. (wrong — both halves of the pair are obligatory: "Ya bugün ya yarın gelirim".)',
    ],
    commonErrors: [
      'Negating the verb after ne … ne ("Ne çay ne kahve içmem"); at A2 keep the predicate POSITIVE ("Ne çay ne kahve içerim") since the correlative already supplies the negation.',
      'Using only one half of the correlative pair (a single "hem"); Turkish requires both halves.',
      'Forgetting that the last conjunct of hem…hem and ya…ya commonly takes de/da ("hem … hem de", "ya … ya da").',
    ],
    clozeUnsuitable: true,
  },
  {
    key: 'tr-a2-causal-connectors',
    kind: 'grammar',
    name: 'Causal connectors (çünkü, bu yüzden, bu sebeple)',
    description:
      'Causal connectors: çünkü "because" (cause follows; informal — can also sit at the END of the clause), bu yüzden / bu sebeple "for that reason, so" (consequence follows the connector). madem(ki) "since / seeing that" fronts a reason both speakers already know, with a question or suggestion following: Madem yorgunsun, evde kal.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Geç kaldım çünkü trafik vardı. (I was late because there was traffic.)',
      'Yağmur yağıyordu, bu yüzden dışarı çıkmadık. (It was raining, so we didn\'t go out.)',
      'Sınavım var, bu sebeple gelemem. (I have an exam, so I can\'t come.)',
      'Gelemedim. Çok yorgundum çünkü. (I couldn\'t come. Because I was very tired — informal clause-final çünkü.)',
    ],
    examplesNegative: [
      '*Geç kaldım için trafik vardı. (wrong — between two finite clauses use çünkü; bare "için" requires a nominalised clause — that is the B1 -DIğI için form.)',
    ],
    commonErrors: [
      'Confusing çünkü (explanation follows the connector) with bu yüzden / bu sebeple (consequence follows the connector).',
      'Using bare için between two finite clauses ("trafik vardı için geç kaldım") — at A2 use çünkü or bu yüzden; the nominalised -DIğI için form is B1.',
      'Forgetting that çünkü can also come at the very end of the clause in speech (Yorgundum çünkü.) — only çünkü, not bu yüzden, allows this.',
    ],
  },
  {
    key: 'tr-a2-ca-suffix',
    kind: 'grammar',
    name: 'Derivational -CA (manner adverbs, language names)',
    description:
      "Derivational -CA (-ca/-ce/-ça/-çe, harmonised; -ç- after voiceless stems): manner adverbs (yavaşça), '-ish' forms (çocukça), and language names used adverbially (Türkçe = Turkish / in Turkish). Many simple adjectives also work bare as manner adverbs (güzel söyledi, zor yürüyor); derived/foreign adjectives instead need bir şekilde/biçimde or olarak (bilimsel olarak).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Yavaşça konuş. (Speak slowly.)',
      'Sessizce oturdu. (He sat silently.)',
      'Kardeşçe paylaştık. (We shared like brothers.)',
      'Türkçe öğreniyorum. (I am learning Turkish.)',
      'Bu kitabı Türkçe okudum. (I read this book in Turkish — the same -CA form, used as an adverb.)',
      'Çok çocukça davrandın. (You behaved very childishly — -CA on çocuk.)',
    ],
    examplesNegative: [
      '*Yavaşce konuş. (wrong — back-vowel stem "yavaş" needs back-vowel -ca: "yavaşça"; -CA harmonises.)',
      '*İngilizde konuşuyorum. (wrong — "in English" is the -CA form İngilizce, not a locative: "İngilizce konuşuyorum".)',
    ],
    commonErrors: [
      'Picking the wrong harmonised form (-ca/-ce/-ça/-çe): *yavaşce instead of yavaşça.',
      'Voicing the -c- after a voiceless stem instead of devoicing to -ç- ("yavaşca" instead of "yavaşça").',
      "Treating 'in [a language]' as needing an extra word or case — the bare -CA form is both the language name and the adverb (Türkçe konuş = speak in Turkish).",
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  {
    key: 'tr-a2-pekistirme',
    kind: 'grammar',
    name: 'Reduplication intensifier (Pekiştirme)',
    description:
      "Intensifier reduplication: prefix = stem's first consonant+vowel + fixed p/s/r/m (vowel-initial stems take p: apaçık), then stem: bembeyaz, kıpkırmızı, yepyeni. Consonant is lexical; no çok/en. Distinct: FULL-word doubling makes adverbs/quantity phrases, not intensified adjectives — yavaş yavaş 'slowly', sık sık 'often', kapı kapı 'door to door', çeşit çeşit yemek 'all kinds of dishes'.",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Kar gibi bembeyaz. (Snow-white.)',
      'Yüzü kıpkırmızı oldu. (His face turned bright red.)',
      'Yepyeni bir araba. (A brand-new car.)',
      'Masmavi bir gökyüzü. (A deep-blue sky.)',
      'Bardak bomboş kalmış. (The glass was left completely empty — boş → bomboş.)',
      'Kapı apaçık duruyordu. (The door was standing wide open — açık → apaçık, vowel-initial takes p.)',
    ],
    examplesNegative: [
      '*beyaz beyaz bir gömlek. (wrong — adjective intensification uses the pekiştirme prefix, not simple repetition: "bembeyaz bir gömlek")',
      '*çok bembeyaz bir gömlek. (wrong — a reduplicated intensifier already means "very", so it rejects çok/en → "bembeyaz bir gömlek")',
    ],
    commonErrors: [
      'Trying to predict the m/p/r/s consonant phonetically — it is lexicalised per word (bembeyaz, kıpkırmızı, simsiyah, yemyeşil).',
      'Substituting simple repetition (*beyaz beyaz) for the reduplication intensifier (bembeyaz).',
      'Adding çok or en to a reduplicated form (*çok bembeyaz, *en yepyeni) — the prefix already carries the "very/most" meaning.',
      'Assuming the consonant is freely chosen for every stem — vowel-initial stems always take p (apaçık, ipince); only consonant-initial stems vary.',
    ],
  },
  {
    key: 'tr-a2-purpose-icin-uzere',
    kind: 'grammar',
    name: 'Purpose / imminence (-mAk için, -mAk üzere)',
    description:
      "Purpose/imminence: -mAk için 'in order to' (same subject); a different subject needs -mAsI için 'so that' (anlaması için). -mAk üzere = 'about to' or formal 'in order to' (gitmek üzereyim).",
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Çalışmak için Almanya\'ya gitti. (He went to Germany in order to work.)',
      'Türkçe öğrenmek için kursa gidiyorum. (I am going to a course in order to learn Turkish.)',
      'Tam çıkmak üzereydim. (I was just about to leave.)',
      'Geç kalmamak için erken çıktım. (I left early in order not to be late — negative purpose -mAmAk için.)',
      'Çocuğun anlaması için yavaş konuştum. (I spoke slowly so that the child would understand — different subject → -mAsI için.)',
      "Kışın üşümeyelim diye kalorifer yaptırdık. (We had heating installed so we won't be cold in winter — colloquial finite purpose: optative + diye, informal alternative to -mAk için.)",
    ],
    examplesNegative: [
      '*Çalışırım için Almanya\'ya gitti. (wrong — purpose uses the infinitive: "çalışmak için", not a finite verb form.)',
      '*Çocuk anlamak için yavaş konuştum. (wrong — the purpose clause has its own subject, so use -mAsI için: "Çocuğun anlaması için yavaş konuştum".)',
    ],
    commonErrors: [
      'Using a finite verb form before için instead of the -mAk infinitive ("çalışırım için" → "çalışmak için").',
      'Confusing the two senses of -mAk üzere: "about to" (imminence) vs the formal "in order to" — context disambiguates.',
      'Using -mAk için when the purpose clause has a different subject — a separate subject requires -mAsI için ("çocuk anlamak için" → "çocuğun anlaması için").',
      'Forgetting that purpose is negated on the infinitive with -mA- ("in order not to be late" = "geç kalmamak için").',
    ],
    prerequisiteKeys: ['tr-a1-future'],
  },
  {
    key: 'tr-a2-reported-speech',
    kind: 'grammar',
    name: 'Reported speech (diye + dolaylı anlatım)',
    description:
      'Reported speech: direct quote + de- (dedi) or diye + reporting verb (sormak, söylemek). söyle- takes only integrated clauses: -DIğInI söyledi; reported command -mAsInI iste-/söyle-. A quoted thought + diye before a non-reporting verb gives the reason, "thinking that": Yağmur yağacak diye şemsiye aldım.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      '"Yarın gelir misin?" diye sordu. (He asked, "Will you come tomorrow?")',
      '"Hayır" diye cevap verdim. (I answered, "No".)',
      'Geleceğini söyledi. (He said he would come — integrated form.)',
      'Gelmemi istedi. (He told me to come — reported imperative.)',
      '"Çok yorgunum" dedi. (She said, "I\'m very tired." — dedi / de- is the everyday verb for quoting; no diye needed. de- may also precede the quote with ki: Suzan dedi ki: "Artık dayanamıyorum." — the ki-clause always follows the verb.)',
      'Annem gelmemi söyledi. (My mother told me to come — söyle- + -mA + possessive + accusative.)',
      'Elif kalıp kalmayacağını söyledi mi? (Has Elif said whether or not she\'ll stay? — a reported yes/no clause doubles the verb with -(y)Ip + the negated -(y)AcAğInI/-DIğInI form.)',
    ],
    examplesNegative: [
      '*"Yarın gelir misin?" sordu. (wrong — diye is required to mark the reported clause: "\\"Yarın gelir misin?\\" diye sordu.")',
    ],
    commonErrors: [
      'Omitting diye between a directly-quoted clause and the reporting verb ("\\"Yarın gelir misin\\" sordu" instead of "\\"Yarın gelir misin\\" diye sordu").',
      'Failing to shift person/tense in integrated reported speech — use -DIğInI / -(y)AcAğInI: "Geleceğini söyledi" = he said he would come.',
      'Using söylemek with a direct quotation — söyle- only takes integrated clauses (-DIğInI / -mAsInI); direct quotes need de- ("…" dedi) or diye.',
      'Forgetting the accusative on the reported command: *gelmem istedi instead of gelmemi istedi (gel-me-m-i).',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
    // sentenceConstructionSuitable intentionally OFF: reported speech admits
    // multiple valid constructions (diye + direct quote vs. integrated
    // -DIğInI söyledi), so every free-production prompt is structurally
    // ambiguous — the validator flagged ~19/20 across the 2026-06-07 and
    // 2026-06-08 runs even after the constrained-prompt fix. Covered by its
    // cloze/translation cells instead.
  },

  // ---------------------------------------------------------------------------
  // A2 — G&K reverse-audit fills (2026-07-10). Core A1–B2 constructions found
  // missing in the all-chapters Göksel & Kerslake sweep. See
  // docs/superpowers/specs/2026-07-10-tr-audit-gap-fills-design.md.
  // ---------------------------------------------------------------------------

  // G&K §17.3.1 (Group-1 relational-noun postpositions), §17.3.1.1 (genitive
  // complement), §17.3.1.3 (üst-/yan-/ara- notes; the -n- buffer before case).
  {
    key: 'tr-a2-spatial-postpositions',
    coverageSpec: {
      axes: [
        // The 3-case split IS the point: location -DA (üstünde), motion-to
        // -(y)A (yanıma), motion-from -DAn (altından). Unpinned drafts
        // collapse to static-location locative.
        { name: 'case', floors: { locative: 12, dative: 9, ablative: 9 } },
      ],
    },
    kind: 'grammar',
    name: 'Spatial postpositions (evin önünde, masanın üstünde)',
    description:
      'Relational nouns ön/arka/üst/alt/iç/yan/ara/karşı in a genitive-possessive frame + a case set by meaning: location -DA (masanın üstünde), motion-to -(y)A (yanıma), motion-from -DAn (altından). A pronominal -n- buffers the 3sg possessive before case (önü-n-de).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Dolabın arkasında bir şey var mı? (Is there anything behind the cupboard?)',
      'Küçük kız yanıma geldi. (The little girl came over to me — motion-to, dative -(y)A.)',
      'Kanepenin altından bir fare çıktı. (A mouse ran out from under the sofa — ablative -DAn.)',
      'Kalemi kitabın üstüne koy. (Put the pen on top of the book — motion-to, üstüne.)',
      'Evle okul arasında bir park var. (There is a park between the house and the school — arasında conjoins its two complements with -(y)lA/ile; the possessive agrees with the second: seninle benim aramda.)',
      "Can'ın arabası evin önünde. (Can's car is in front of the house — a locative-marked postpositional phrase can stand alone as the predicate.)",
    ],
    examplesNegative: [
      '*ev önünde (wrong — the complement takes the genitive: evin önünde)',
      '*masanın üstünde koy (wrong case — putting something onto needs the dative: masanın üstüne koy)',
      '*iki saatin içinde (wrong — a non-specific/durational complement stays bare: iki saat içinde "within two hours")',
    ],
    commonErrors: [
      'Omitting the genitive on the complement (ev önünde → evin önünde).',
      'Dropping the -n- buffer / possessive on the relational noun (masanın üstde → üstünde).',
      'Using the locative where motion needs the dative/ablative (üstünde koy → üstüne koy).',
      'Forcing the genitive onto non-specific, generic or metaphorical complements — these stay bare, with 3sg possessive on the postposition: iki saat içinde ("within two hours"), kardeşler arasında, ter içinde (not *iki saatin içinde).',
    ],
    prerequisiteKeys: ['tr-a1-genitive-possessive', 'tr-a1-ablative-dative'],
  },
  // G&K §8.3.2 (copular -(y)DI / -(y)mIş), §8.4 (group-1 person markers),
  // §21.3.4.1 (nominal past vardı/yoktu vs oldu).
  {
    key: 'tr-a2-past-copula',
    coverageSpec: {
      axes: [{ name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } }],
    },
    kind: 'grammar',
    name: 'Past & evidential copula on nominals (-(y)DI / -(y)mIş)',
    description:
      'The past of "to be" on non-verbal predicates: -(y)DI (hastaydım, evdeydik, güzeldi) with group-1 endings and a -y- buffer after a vowel; past existence vardı/yoktu; evidential -(y)mIş (hastaymış) with group-2 endings. Not the verbal -DI past.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Dün çok hastaydım. (I was very ill yesterday.)',
      'Biz o zaman öğrenciydik. (We were students back then.)',
      'Eskiden burada bir lokanta vardı. (There used to be a restaurant here — past existence.)',
      'Yorgunmuş, o yüzden gelmemiş. (She was apparently tired, so she didn\'t come — evidential -(y)mIş.)',
    ],
    examplesNegative: [
      '*hastadım (wrong — a nominal predicate needs the copula with a -y- buffer after the vowel: hastaydım)',
      '*hastaydıyım (wrong — -(y)DI takes group-1 endings: hastaydım, not group-2 -yIm)',
    ],
    commonErrors: [
      'Attaching the verbal past -DI directly to a nominal (hastadım → hastaydım).',
      'Mixing person-marker groups after -(y)DI (hastaydıyım → hastaydım).',
      'Forgetting the -y- buffer after a vowel (hastadı → hastaydı).',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes', 'tr-a1-var-yok'],
  },
  // G&K §11.1.1.2 (additive dA), §11.1.1.1 (bile), §28.3.2 (X dA Y dA).
  {
    key: 'tr-a2-clitics-da-bile',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Focus clitics dA "too/also" & bile "even"',
    description:
      'Second-position focus clitics: dA "too/also" (a separate word, 2-way de/da, never devoiced — ben de geliyorum; enumerating X dA Y dA "both…and"), and invariable bile "even/already" (çocuklar bile biliyor; gördüm bile). Distinct from the locative suffix -DA.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Ben de geliyorum. (I\'m coming too.)',
      'Ayşe de Semra da geldi. (Both Ayşe and Semra came.)',
      'Çocuklar bile biliyor. (Even the children know.)',
      'O filmi gördüm bile. (I\'ve already seen that film — post-verbal bile.)',
      '(Her) iki çocuk da uyumuş. (Both children had gone to sleep — dA after a numeral-modified noun phrase gives the definite "both/all" reading.)',
    ],
    examplesNegative: [
      '*evde [meaning "the house too"] (wrong — the additive is a separate word: ev de; evde is the locative "at the house")',
      '*De ben geliyorum (wrong placement — dA follows the focused word: Ben de geliyorum)',
    ],
    commonErrors: [
      'Confusing the additive clitic dA (separate word, de/da) with the locative suffix -DA (attached, 4-way, devoiced -ta/-te).',
      'Placing dA/bile before the focused word or clause-finally regardless of focus.',
      'Harmonising or attaching bile (bila / çocuklarbile) — it is an invariable separate word.',
    ],
    prerequisiteKeys: ['tr-a1-locative'],
  },
  // G&K §7.2.2.2 (-lI "with/having", -sIz "without").
  {
    key: 'tr-a2-with-without-li-siz',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Adjective suffixes -lI "with" / -sIz "without"',
    description:
      'Productive adjective-forming suffixes with 4-way harmony: -lI "with/having/characterized by" (şekerli, tuzlu, evli, dikkatli) and its antonym -sIz "without/lacking" (şekersiz, işsiz, sensiz, arabasız). Stem-final devoicing still applies (kitap → kitaplı). Sibling -lIk on numeral+noun makes measure/"for" adjectivals: beş metrelik bir kablo (a five-metre cable), iki kişilik masa (a table for two).',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Şekerli çay içiyorum. (I\'m drinking sugared tea.)',
      'Ben kahveyi şekersiz severim. (I like my coffee without sugar.)',
      'Amcam iki yıldır işsiz. (My uncle has been unemployed for two years.)',
      'Sensiz çok sıkıldım. (I got very bored without you.)',
    ],
    examplesNegative: [
      '*şekerlı (wrong — -lI is 4-way; after e it is -li: şekerli)',
      '*şeker değil kahve [for "coffee without sugar"] (wrong — "without" is the privative -sIz: şekersiz kahve)',
    ],
    commonErrors: [
      'Using 2-way instead of 4-way harmony (tuzli / sütsuz → tuzlu / sütsüz).',
      'Expressing "without" with değil/yok instead of the privative -sIz (şeker değil → şekersiz).',
      'Confusing descriptive -lI/-sIz ("with/without") with adverbial -CA.',
    ],
    prerequisiteKeys: ['tr-a1-vowel-harmony'],
  },
  // G&K §15.8 (the enumerator tane and measure/type terms).
  {
    key: 'tr-a2-enumerator-tane',
    kind: 'grammar',
    name: 'Enumerator tane (üç tane elma)',
    description:
      'The general counter tane for discrete non-human nouns, between a numeral (or kaç) and the noun: üç tane elma, kaç tane?, on tane tabak. The counted noun stays singular (no -lAr). Optional (yedi tane iskemle ~ yedi iskemle); combines with distributives (ikişer tane). Mass nouns (su, müzik) reject numerals/kaç/birkaç unless a measure or type is meant (birkaç bira = bottles); biraz takes mass nouns (biraz su), not count nouns.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Marketten üç tane elma aldım. (I bought three apples from the shop.)',
      'Kaç tane kitap istiyorsun? (How many books do you want?)',
      'Masada on tane tabak var. (There are ten plates on the table.)',
      'Bunlardan iki tane alayım. (Let me take two of these — ablative partitive with a tane/measure head: şu elmadan bir kilo "a kilo of those apples".)',
    ],
    examplesNegative: [
      '*üç tane elmalar (wrong — a noun after a numeral stays singular: üç tane elma)',
      '*tane üç elma (wrong order — numeral + tane + noun: üç tane elma)',
    ],
    commonErrors: [
      'Pluralising the counted noun (beş tane kitaplar → beş tane kitap).',
      'Using tane with human nouns where kişi is natural (üç tane öğretmen → üç öğretmen / üç kişi).',
      'Wrong order (tane üç elma → üç tane elma).',
    ],
    prerequisiteKeys: ['tr-a1-numbers-ordinals'],
  },
  // G&K §28.3.4.1 (ama, fakat, ancak, yalnız 'but'). Added by the 2026-07-16
  // book-coverage triage — the highest-frequency Turkish conjunction had no
  // owning point (ama appeared only inside a free-writing sample sentence).
  // Sibling of tr-a2-causal-connectors in shape and level.
  {
    key: 'tr-a2-adversative-connectors',
    kind: 'grammar',
    name: 'Adversative connectors (ama, fakat, ancak, yalnız)',
    description:
      'Adversative "but": ama and fakat are interchangeable and conjoin conflicting clauses (gezmek istiyor ama zamanı yok); discourse-connective ama can also close the clause in speech (Okuyamadım ama.). ancak and yalnız introduce a disadvantage or limitation and open their sentence; as plain adverbs the same words mean "only".',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Semra hep gezmek istiyor ama zamanı yok. (Semra always wants to travel, but she has no time.)',
      'Sonbahar geldi fakat ağaçlar hâlâ yeşil. (Autumn is here, but the trees are still green.)',
      'Kitabı hevesle aldım. Okuyamadım ama. (I bought the book eagerly. Haven\'t managed to read it, though — clause-final ama, informal.)',
      'Çok iyi bir mimar. Ancak müşterilerini kaçırıyor. (He\'s a very good architect. But he loses his customers.)',
      'Sıcak ama bunaltıcı olmayan bir hava. (Hot but not suffocating weather — ama between adjectives.)',
    ],
    examplesNegative: [
      '*Geldi ama çünkü yorgundu. (wrong — ama marks contrast, çünkü marks cause; pick one: "Geldi ama yorgundu" or "Gelmedi çünkü yorgundu")',
    ],
    commonErrors: [
      'Reaching for çünkü/bu yüzden where the relation is contrast, not cause — "but" is ama/fakat.',
      'Treating ancak/yalnız as free variants of ama — they mainly introduce an inability, failure or disadvantage, and start the sentence.',
      'Forgetting that only ama (not fakat) can sit at the very end of the clause in informal speech (Okuyamadım ama.).',
    ],
  },


  // ===========================================================================
  // B1 — authored fresh from Yedi İklim B1, grounded in Göksel & Kerslake.
  // (B2 is a separate later cycle.)
  // ===========================================================================

  // G&K §27.2.1.1 (open conditionals: aorist + -(y)sA) + §27.2.1.3 (olursa).
  // The VERBAL real/open conditional, distinct from tr-b1-conditional-irrealis
  // (which covers the -sA wish, the -sAydI counterfactual, and the copular
  // -(y)sA on nominals). Here the if-clause is aorist + -sA (gelirse, yağarsa,
  // olursa) for a real future possibility; main clause = aorist or -(y)AcAK.
  {
    key: 'tr-b1-real-conditional',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Open / real conditional -(I)rsA',
    description:
      'Real future condition: aorist + -sA on the if-clause (gelirse, yağarsa, olursa), main clause aorist or -(y)AcAK. A genuine possibility — contrast hypothetical -sA / counterfactual -sAydI. With nominal predicates ol- is optional: yorgun olursam ≈ yorgunsam, olmazsa ≈ değilse/yoksa; -mIş and -(I)yor likewise take -(y)sA directly (satılmışsa = satılmış olursa).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Yağmur yağarsa pikniğe gitmeyiz. (If it rains we will not go to the picnic.)',
      'Param olursa yeni bir telefon alacağım. (If I have the money I will buy a new phone.)',
      'Acele edersek yetişiriz. (If we hurry we will make it.)',
      'Onu görürsen selam söyle. (If you see him, say hello — volitional main clause.)',
      'Beğenmezsen geri verebilirsin. (If you do not like it you can give it back — negative -mezse.)',
      'Toplantı hâlâ sürüyor olursa beklerim. (If the meeting is still going on I will wait — -mIş/-(I)yor/-(y)AcAk + olursa layers relative tense onto the open condition: anneleri gelmemiş olursa = "if their mother hasn\'t come by then".)',
      'Acele et, yoksa geç kalırsın. (Hurry up, or else you will be late — yoksa / aksi halde "otherwise" stands in for a negated repeat of the condition.)',
    ],
    examplesNegative: [
      '*Yağmur yağsa pikniğe gitmeyiz. (for a real possibility — hypothetical -sA reads as a wish/unlikely; the open conditional is "yağarsa".)',
      '*Param olursaydı alırdım. (mixes markers — a real condition is "olursa + non-past"; the counterfactual is "olsaydı, alırdım".)',
    ],
    commonErrors: [
      'Using bare hypothetical -sA (gelse) for a real future possibility instead of the aorist conditional -(I)rsA (gelirse).',
      'Forming the negative as *gelmese for "if … not" instead of the aorist-negative -mAzsA (gelmezse, beğenmezsen).',
      'Pairing the open conditional with a past main clause (*yağarsa gitmedik) — its consequence is non-past (aorist or -(y)AcAK).',
      'Confusing the real conditional (aorist + -sA) with the counterfactual -sAydI (olursa = if it happens; olsaydı = if it had happened).',
    ],
    prerequisiteKeys: ['tr-a2-aorist', 'tr-b1-conditional-irrealis'],
  },
  // G&K §21.3.1–.2 (imperfective: progressive + habitual), §21.2.1 (past)
  {
    key: 'tr-b1-past-continuous-iyordu',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Past continuous -(I)yordu',
    description:
      'Past imperfective -(I)yor + copular -DI: an ongoing or habitual past ("was …ing", "used to"). The -(I)yor buffer/voicing rules carry over; -DI takes harmonised personal endings.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Eve geliyordum. (I was coming home.)',
      'Her sabah erken kalkıyordu. (He used to get up early — habitual.)',
      'Biz yemek yiyorduk. (We were eating.)',
      "Sen Ömer'i benden iyi tanıyordun. (You knew Ömer better — stative.)",
    ],
    examplesNegative: [
      '*Geliyordüm. (wrong — the copular past harmonises to -du after o/u: geliyordum)',
      '*Geldiyordum. (wrong — base is the -(I)yor stem, not the -DI past: geliyordum)',
    ],
    commonErrors: [
      'Using completed -DI where ongoing/habitual -(I)yordu is meant (geldim vs geliyordum).',
      'Wrong vowel harmony on the -DI copula (geliyordüm instead of geliyordum).',
      'Stacking two past markers (*geldiyordum).',
    ],
    prerequisiteKeys: ['tr-a1-present-continuous', 'tr-a1-dili-past'],
  },
  // G&K Ch 27 (§27.1.1 -sA/-(y)sA, §27.2.3 -sA, §27.2.4 -sAydI), wishes §21.4.4.1
  {
    key: 'tr-b1-conditional-irrealis',
    // sentenceConstructionSuitable intentionally OFF: -sA (wish), -sAydI
    // (counterfactual) and copular -(y)sA (real condition) are three distinct
    // constructions, so a free-production prompt is structurally ambiguous —
    // same reasoning as tr-a2-reported-speech. Covered by cloze/translation.
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Conditional & wish -sA / -sAydI / -(y)sA',
    description:
      'Verbal -sA (wish/hypothetical), -sAydI (past counterfactual), and copular -(y)sA ("if it is", real condition). -(y)sA also attaches to tensed verb forms (geldiyse, geliyorsa, gelecekse) and var/yok/değil for a condition knowable from context, often backing an inference or request (Meşgulsen rahatsız etmeyeyim). "Keşke" + -sA(ydI) marks wishes and regrets.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Keşke burada olsa. (If only he were here — present wish.)',
      'Vaktim olsaydı, gelirdim. (If I had had time, I would have come — counterfactual.)',
      'Hava güzelse yürüyelim. (If the weather is nice, let us walk — real condition, copular -(y)sA.)',
      'Param olsa, bir ev alırdım. (If I had money, I would buy a house.)',
      'Bu konuda kime danışsam acaba? (I wonder who I should consult about this — a 1st-person -sA question is deliberative, usually with acaba.)',
      'Üniversiteyi kazansaydı / kazanmış olsaydı, babası ona ev tutacaktı. (If he had got into university, his father would have rented him a flat — -mIş olsaydI is interchangeable with plain -sAydI.)',
      'Çalışsa da/bile sınavı geçemez. (Even if he studies he cannot pass — -sA + dA/bile = concessive "even if"; doubled çalışsa da çalışmasa da = "whether he studies or not".)',
    ],
    examplesNegative: [
      '*Vaktim olsa, geldim. (wrong — counterfactual needs -sAydI + aorist-past main clause: olsaydı, gelirdim)',
      '*Hava güzel olursa yürüdük. (wrong — a real condition pairs -(y)sA/aorist with a non-past main clause)',
    ],
    commonErrors: [
      'Pairing a -sA wish with the wrong main-clause tense.',
      'Using real-conditional -(y)sA where past counterfactual -sAydI is required.',
      'Dropping "keşke" so a regret reads as a neutral condition.',
    ],
    prerequisiteKeys: ['tr-a1-dili-past'],
  },
  // G&K §21.4.2.2 (necessity/obligation): -mAlI is speaker-felt (A2); the
  // lexical periphrases below are objective obligation. Note the nominalization
  // split: zorunda takes -mAk; gerek/lazım/şart take -mA + possessive.
  {
    key: 'tr-b1-obligation-periphrases',
    // clozeUnsuitable: obligation periphrases (zorunda/gerek/lazım/şart) require
    // a nominalization slot (-mAk vs -mA+poss) plus the periphrastic head — a
    // single whole-word blank cannot constrain which form or which lexeme the
    // validator should expect → flags `ambiguous` (2026-06-19 run, 54% approval).
    // Keeps conjugation. See docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Obligation -mAk zorunda / gerek / lazım / şart',
    description:
      'Objective obligation by lexical means (vs speaker-felt -mAlI at A2): -mAk zorunda(yım) (compulsion), -mAm gerek/lazım/şart, gerek-iyor. zorunda/şart are stronger; gerek/lazım milder.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      "Ankara'ya gitmek zorundayım. (I have to go to Ankara — external compulsion.)",
      'Şimdi gitmem lazım. (I need to go now.)',
      'Bunu bitirmemiz gerekiyor. (We need to finish this.)',
      'Daha çok çalışman şart. (It is essential that you work more.)',
    ],
    examplesNegative: [
      '*Gitmem zorunda. (wrong — zorunda takes the bare -mAk infinitive: gitmek zorundayım)',
      '*Gitmek lazım benim. (wrong — gerek/lazım take -mA + possessive: gitmem lazım)',
    ],
    commonErrors: [
      'Using speaker-felt -mAlI where external obligation calls for zorunda.',
      'Wrong nominalization: -mAk for zorunda vs -mA+possessive for gerek/lazım/şart.',
      'Dropping the locative/personal ending on zorunda (gitmek zorunda instead of …zorundayım).',
    ],
    prerequisiteKeys: ['tr-a2-ability-necessity'],
  },

  // G&K §8.2.1.1 (allomorphy), §13.2.1 (causative constructions)
  {
    key: 'tr-b1-causative-voice',
    // clozeUnsuitable: a single whole-word blank conflates the causative
    // morpheme with free tense/polarity/person the carrier can't constrain →
    // validator flags `ambiguous` (2026-06-19 run, 12% approval). Keeps
    // translation + sentence_construction + conjugation. See
    // docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    conjugationSuitable: true,
    sentenceConstructionSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Causative -DIr / -t / -Ir / -Ar',
    description:
      'Adds a causer. Allomorphy: polysyllabic / vowel-, l-, r-final stems take -t (kapat-, uyut-); ~30 monosyllables take -Ir/-Ar/-It (düşür-, çıkar-, korkut-); elsewhere -DIr (yaptır-, öldür-). Stackable.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Müdür raporu bana yazdırdı. (The manager had me write the report — yaz → yazdır.)',
      'Çocuğu uyuttum. (I put the child to sleep — uyu → uyut.)',
      'Suyu kaynattım. (I boiled the water — kayna → kaynat.)',
      'Onu güldürdün. (You made him laugh — gül → güldür.)',
      'Gök gürültüsü hayvanları ürkütüyor. (The thunder frightens the animals — emotion-verb causatives promote the stimulus to subject; likewise korkut- "scare" and sevindir-: Bu haber beni çok sevindirdi.)',
    ],
    examplesNegative: [
      '*yaztır- (wrong allomorph — consonant-final yaz takes -DIr: yazdır-)',
      '*uyudur- (wrong — vowel-final uyu takes -t: uyut-)',
    ],
    commonErrors: [
      'Picking -DIr where the stem requires -t / -Ir / -Ar.',
      'Forgetting the causee marking (-A dative for the demoted agent).',
      'Over-generating causatives on verbs with suppletive transitives (gir- → sok-, not *girdir-).',
    ],
  },
  // G&K §8.2.1.2 (allomorphy), §13.2.2 (passive + impersonal passives)
  {
    key: 'tr-b1-passive-voice',
    // clozeUnsuitable: passive allomorphy (-Il/-In/-n) + free tense/polarity
    // means a single blank is under-constrained → validator flags `ambiguous`
    // (2026-06-19 run, 23% approval). Keeps sentence_construction.
    // See docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Passive -Il / -In / -n',
    description:
      'Passive demotes the subject. Allomorphy: -Il after consonants (yapıl-, görül-), -In after l-final stems (bilin-), -n after vowels (aran-). Agent via "tarafından"; impersonal passive on intransitives.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      "Bu ev 1950'de yapıldı. (This house was built in 1950.)",
      'Mektup dün yazıldı. (The letter was written yesterday.)',
      'Hırsız polis tarafından yakalandı. (The thief was caught by the police.)',
      'Burada sigara içilmez. (Smoking is not done here — impersonal passive.)',
    ],
    examplesNegative: [
      '*yapınıl- (wrong — consonant-final yap takes -Il: yapıl-)',
      '*aranıl- for "be searched" (wrong — vowel-final ara takes -n: aran-)',
    ],
    commonErrors: [
      'Wrong allomorph (-Il vs -In vs -n).',
      'Expressing the agent with -DAn instead of "tarafından".',
      'Confusing the reflexive/passive homophone (yıkan- = "be washed" or "bathe").',
    ],
  },
  // G&K §8.2.1.3 (reflexive -(I)n is unproductive: closed set), §13.2.3.1,
  // kendi §18.1.2.2. Productive "self" usually = kendi + plain verb.
  {
    key: 'tr-b1-reflexive-voice-kendi',
    // clozeUnsuitable: closed-set -(I)n vs kendi+plain split makes the blank
    // under-constrained → validator flags `ambiguous` (2026-06-19 run, 38%
    // approval). Keeps sentence_construction.
    // See docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Reflexive -(I)n & the pronoun "kendi"',
    description:
      'Unproductive reflexive -(I)n on a closed set (yıkan- bathe, giyin- get dressed, taran- comb hair, örtün- cover oneself); pronoun "kendi(m/n/si)" for reflexive/emphatic "self" (kendimi gördüm).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Her sabah yıkanıyorum. (I bathe every morning.)',
      'Çabuk giyindi. (He got dressed quickly.)',
      'Kendimi aynada gördüm. (I saw myself in the mirror.)',
      'Bunu kendin yaptın. (You did this yourself — emphatic.)',
    ],
    examplesNegative: [
      '*Kendimi yıkanıyorum. (wrong — the reflexive verb already means "self"; don’t add kendimi: yıkanıyorum)',
      '*Elbiseyi giyindim. (wrong — reflexive giyin- is intransitive; "put on a garment" is giy-: elbiseyi giydim)',
    ],
    commonErrors: [
      'Treating -(I)n as productive (most reflexive senses use kendi + plain verb).',
      'Doubling a reflexive verb with kendi.',
      'Confusing transitive giy- with intransitive giyin-.',
    ],
  },
  // G&K §8.2.1.4 (reciprocal -(I)ş is unproductive: closed set), §13.2.3.2,
  // birbir- §18.1.4. Productive reciprocity = birbiri + plain verb.
  {
    key: 'tr-b1-reciprocal-voice',
    // clozeUnsuitable: closed-set -(I)ş vs birbiri+plain split makes the blank
    // under-constrained → validator flags `ambiguous` (2026-06-19 run, 31%
    // approval). Keeps sentence_construction.
    // See docs/analysis/generation-run-2026-06-19.md.
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Reciprocal -(I)ş & "birbiri"',
    description:
      'Unproductive reciprocal -(I)ş on a closed set (öpüş- kiss each other, görüş- meet, dövüş- fight, selamlaş- greet); "birbiri(ni/yle)" "each other" expresses reciprocity productively.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Kapıda öpüştüler. (They kissed each other at the door.)',
      'Yarın görüşürüz. (We will see each other tomorrow.)',
      'Birbirimize yardım ettik. (We helped each other.)',
      'Mektuplaştılar. (They corresponded with each other.)',
    ],
    examplesNegative: [
      '*Birbirini öpüştüler. (wrong — -(I)ş already encodes "each other"; don’t add birbirini: öpüştüler)',
      '*Onunla konuştuk birbirimizle. (wrong — konuş- is lexicalized "speak", not a reciprocal of a base verb)',
    ],
    commonErrors: [
      'Treating -(I)ş as productive.',
      'Doubling a reciprocal verb with birbiri.',
      'Wrong case on birbiri (birbirine / birbiriyle / birbirini).',
    ],
  },
  // G&K §26.3 (adverbial clauses: time/simultaneity), §8.5.2.2 (converb suffixes)
  {
    key: 'tr-b1-converb-while-yken',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Converb -(y)ken ("while / when")',
    description:
      '-ken attaches to an aorist/imperfective verb base or a nominal for simultaneity or background: gelirken, çocukken, konuşurken. The clause subject may differ from the main clause.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Eve gelirken ekmek aldım. (I bought bread while coming home.)',
      'Ben çocukken burası bir bahçeydi. (When I was a child, this was a garden.)',
      'O konuşurken herkes sustu. (While he was speaking, everyone fell silent.)',
      'Sen uyurken telefon çaldı. (The phone rang while you were sleeping.)',
      'Herkes filme bayılırken ben sıkıldım. (While everyone adored the film, I was bored — aorist + -(y)ken can also contrast two situations, "while/whereas".)',
    ],
    examplesNegative: [
      '*Geldiyken ekmek aldım. (wrong — -ken attaches to the aorist/imperfective base, not -DI past: gelirken)',
      '*Çocuktuken burası bahçeydi. (wrong — nominal -ken: çocukken)',
    ],
    commonErrors: [
      'Attaching -ken to the -DI past stem.',
      'Choosing the wrong base aspect (gelirken vs geliyorken).',
      'Marking the converb-clause subject incorrectly.',
    ],
    prerequisiteKeys: ['tr-a2-converbs'],
  },
  // G&K §26.3 (adverbial clauses: time/"since"), §8.5.2.2. Verbal "since",
  // distinct from nominal -DEn beri (tr-a1-beri-dir).
  {
    key: 'tr-b1-since-converb',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Converb "since doing" -(y)AlI / -DIğIndAn beri',
    description:
      'Verbal "since": -(y)AlI (geleli "since coming") and -DIğIndAn beri (geldiğinden beri) count elapsed time from an event. Distinct from nominal -DEn beri (A1), which attaches to nouns/time points.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Buraya geleli üç ay oldu. (It has been three months since I came here.)',
      'Onu gördüğümden beri çok düşündüm. (Since I saw him, I have thought a lot.)',
      "Türkiye'ye taşınalı Türkçe öğreniyorum. (Since moving to Turkey, I have been learning Turkish.)",
    ],
    examplesNegative: [
      '*Geldiden beri üç ay oldu. (wrong — needs the -DIK nominal + possessive: geldiğimden beri)',
      '*Gelmekten beri çok düşündüm. (wrong — not -mAk; use -(y)AlI or -DIğIndAn beri)',
    ],
    commonErrors: [
      'Using nominal -DEn beri directly on a bare verb.',
      'Wrong possessive agreement on -DIğIndAn beri.',
      'Confusing -(y)AlI with the optative.',
    ],
    prerequisiteKeys: ['tr-a1-beri-dir'],
  },
  // G&K Ch 25 (§25.1.1 participle suffixes, §25.4 tense/aspect in RCs).
  // Non-subject relatives; the subject relative -(y)An is at A2.
  {
    key: 'tr-b1-participles-dik-acak',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    coverageSpec: {
      axes: [
        // The possessive agreeing with the clause subject IS the point
        // (okuduğum kitap / gideceğimiz şehir); 1sg/3sg collapse expected
        // without floors.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    kind: 'grammar',
    name: 'Non-subject relative -DIK / -(y)AcAK + possessive',
    description:
      'Object/oblique relatives: -DIK (non-future) and -(y)AcAK (prospective) + a possessive agreeing with the clause subject: okuduğum kitap, gideceğimiz şehir. Contrast subject relative -(y)An (A2). Determiners and numerals follow the relative clause: Jale\'nin sevdiği iki yer ("the two places Jale likes"), not *iki Jale\'nin sevdiği yer.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Okuduğum kitap çok güzeldi. (The book I read was very good.)',
      "Yarın gideceğimiz şehir Bursa. (The city we will go to tomorrow is Bursa.)",
      'Annemin yaptığı yemek (the food my mother made)',
      'Oturduğun sandalye kırık. (The chair you are sitting on is broken.)',
      'Söylediğini duymadım. (I didn\'t hear what you said — headless: -DIK + possessive stands alone as the noun phrase, then takes case.)',
    ],
    examplesNegative: [
      '*Benim okuyan kitap (wrong — subject relative -(y)An cannot encode "the book I read"; needs -DIK + possessive: okuduğum kitap)',
      '*okuduk kitap (wrong — needs possessive agreement: okuduğum / okuduğun …)',
    ],
    commonErrors: [
      'Using -(y)An for a non-subject relative.',
      'Dropping the possessive suffix on -DIK / -(y)AcAK.',
      'Forgetting the genitive on the relative-clause subject (benim okuduğum).',
    ],
    prerequisiteKeys: ['tr-a2-relative-an'],
  },

  // ===========================================================================
  // B2 grammar (2026-07-07). Yedi İklim B2 (Units 1–8), grouped by function and
  // deduped vs A1–B1; plus two G&K reverse-audit additions (#18 -DIr, #19 "as
  // if"). Author-time grounding in Göksel & Kerslake — § anchors per point.
  // See docs/superpowers/specs/2026-07-07-tr-b2-curriculum-design.md.
  // ===========================================================================

  // G&K §7.2.1.1 (aorist / -mAz / -(y)AsI as derivational adjectives),
  // §25.4.1(iv) (aorist participle inside a relative clause).
  {
    key: 'tr-b2-participle-aorist',
    // clozeUnsuitable: the aorist -Ar/-mAz adjectival participle is a
    // semi-lexicalized set (akar su, çıkmaz sokak); a whole-word blank is
    // under-constrained (which verb yields an -Ar/-mAz adjective here?) and
    // risks testing the finite aorist tense instead (grammarPointMatch=false).
    // Translation ("running water" → akar su) carries it.
    // No coverageSpec: the -Ar vs -mAz contrast is word-internal derivation —
    // sentence polarity does NOT track it (çıkmaz sokak sits in an affirmative
    // sentence), so no coverage axis can express it (cf. the -lI/-sIz note).
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Aorist participle -Ar / -Ir / -mAz (adjectival)',
    description:
      'Aorist as a bare tenseless adjective before a noun: -Ar/-Ir (akar su, çalar saat), negative -mAz (çıkmaz sokak, inanılmaz). Also the receding -AsI "worthy of" (görülesi, frozen kahrolası) — recognition only. No tense/person/agreement.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'akar su (running water — ak- + fixed attributive -Ar)',
      'çıkmaz sokak (a dead-end street — çık- + negative -mAz)',
      'İnanılmaz bir manzara gördük. (We saw an unbelievable view — inan-ıl-maz.)',
      'görülesi yerler (places worth seeing — receding -AsI, recognition only)',
    ],
    examplesNegative: [
      '*çıkmıyor sokak (wrong — the attributive aorist is fixed and tenseless, not the finite negative: çıkmaz sokak)',
      '*akmaz su (wrong allomorph and sense — monosyllabic ak- takes positive -Ar: akar su)',
    ],
    commonErrors: [
      'Treating the attributive aorist as a finite verb (adding tense/person): çıkmıyor sokak for çıkmaz sokak.',
      'Wrong aorist allomorph on the stem (akmaz / aker for akar).',
      'Over-producing the receding -AsI "worthy of" as if productive (yenilesi yemek) — living uses are frozen (kahrolası) or the -AsIyA adverb.',
    ],
    prerequisiteKeys: ['tr-a2-aorist', 'tr-a2-relative-an'],
  },
  // G&K §25.4.1(i) and §25.4.1.1 (reduced -mIş olan participle), §7.2.1.1
  // (lexicalised -mIş: geçmiş, dolmuş).
  {
    key: 'tr-b2-participle-mis',
    kind: 'grammar',
    name: 'Resultative participle -mIş (adjectival)',
    description:
      '-mIş as a bare resultative/perfective adjective before a noun (a reduced "-mIş olan" relative): pişmiş yemek, okunmuş kitap, geçmiş yıllar, dondurulmuş (passive) gıda. No evidential force — contrast the finite evidential -mIş (A2).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'pişmiş yemek (cooked food — resultative -mIş, no hearsay)',
      'okunmuş bir kitap (an already-read book)',
      'geçmiş yıllar (past years — lexicalised geçmiş)',
      'Yemeğini yemiş bebek ağlamaz. (A baby that has eaten its food doesn\'t cry.)',
    ],
    examplesNegative: [
      '*dondurmuş gıda (for "frozen food" — the food is frozen, not freezing; needs the passive: dondurulmuş gıda)',
      '*pişiyor yemek (wrong — the reduced participle is -mIş, not the finite progressive: pişmiş yemek)',
    ],
    commonErrors: [
      'Reading the attributive -mIş as evidential/hearsay ("food that reportedly cooked") — as a participle it is purely resultative.',
      'Using active -mIş where a passive resultative is meant (dondurmuş vs dondurulmuş).',
      'Confusing it with the finite evidential -mIş predicate (gelmiş "s/he apparently came").',
    ],
    prerequisiteKeys: ['tr-a2-mis-evidential', 'tr-b1-participles-dik-acak'],
  },
  // G&K §26.3.16(vii) (-(y)IncAyA kadar / -AnA kadar "until / by the time"),
  // §26.3.8(iv) (-mAksIzIn "without", formal twin of -mAdAn).
  {
    key: 'tr-b2-converb-until',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Converbs "until" -(y)IncAyA kadar / -AnA kadar & "without" -mAksIzIn',
    description:
      '"Until" converbs -(y)IncAyA kadar / -AnA kadar (also "by the time": bitinceye kadar) — the converb takes dative -(y)A before kadar. Plus formal "without" -mAksIzIn (durmaksızın), the written twin of A2 -mAdAn.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Sen gelinceye kadar bekleyeceğim. (I will wait until you come.)',
      'Bu iş bitinceye kadar hepimiz yaşlanacağız. (We\'ll all grow old by the time this work is finished.)',
      'Ölene kadar burada kalmak istiyordu. (She wanted to stay here until she died — -AnA kadar.)',
      'Durmaksızın çalıştı. (He worked without stopping — formal -mAksIzIn.)',
    ],
    examplesNegative: [
      '*gelince kadar (wrong — the converb takes dative -(y)A before kadar: gelinceye kadar)',
      '*vurmaksızın girdi [in casual speech] (register mismatch — everyday Turkish uses -mAdAn: vurmadan girdi)',
    ],
    commonErrors: [
      'Dropping the dative -(y)A: "gelince kadar" instead of "gelinceye kadar".',
      'Using formal -mAksIzIn in casual register where -mAdAn is the neutral choice.',
      'Mis-segmenting -mAksIzIn as -mA + … (yapmasızın) — the form is fixed: yapmaksızın.',
    ],
    prerequisiteKeys: ['tr-a2-converbs', 'tr-a2-converb-temporal'],
  },
  // G&K §8.3.2 (past copula -(y)DI attaches to all position-3 TAM suffixes),
  // §8.2.3.3, §21.2.1 (-mIştI), §21.2.3 (-AcAktI), §21.4.2.2 (-mAlIydI).
  {
    key: 'tr-b2-compound-past-hikaye',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Compound past "hikâye" — copula -(y)DI on all tenses',
    description:
      'Past copula -(y)DI on any tense base (one rule): pluperfect -mIştI, past habitual/unreal aorist -ArdI, future-in-past -AcAktI, past necessitative -mAlIydI, past conditional -sAydI. Group-1 person endings; the -y- drops after a consonant. (B1 taught only -Iyordu.)',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Ben geldiğimde o çoktan gitmişti. (When I arrived he had already left — pluperfect -mIştI.)',
      'Çocukken her yaz denize giderdik. (As children we would go to the seaside every summer — past habitual -ArdI.)',
      'Tam çıkacaktım ki telefon çaldı. (I was just about to leave when the phone rang — future-in-past -AcAktI.)',
      'Daha erken kalkmalıydın. (You should have got up earlier — past necessitative -mAlIydI.)',
    ],
    examplesNegative: [
      '*gelmiştir [for "had come"] (wrong — the second element is the past copula -(y)DI, not the generalizing -DIr: gelmişti)',
      '*giderdimsin (wrong person set — -(y)DI takes group-1 endings: giderdin)',
    ],
    commonErrors: [
      'Stacking two tense markers instead of the copula (*gidiyorduyor for gidiyordu).',
      'Using group-2 (-sIn) endings after -(y)DI instead of group-1 (-n): gelmiştin, not gelmiştinsin.',
      'Keeping the -y- buffer after a consonant (*yemişyti for yemişti).',
    ],
    prerequisiteKeys: ['tr-b1-past-continuous-iyordu', 'tr-a2-aorist'],
  },
  // G&K §8.3.2 (evidential copula -(y)mIş on all position-3 suffixes except -DI),
  // §21.4.3 (reportative / inferential meaning; copula is tense-neutral).
  {
    key: 'tr-b2-compound-evidential-rivayet',
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
        { name: 'polarity', floors: { affirmative: 18, negative: 12 } },
      ],
    },
    kind: 'grammar',
    name: 'Compound evidential "rivayet" — copula -(y)mIş on all tenses',
    description:
      'Evidential copula -(y)mIş on any tense base except -DI: -Iyormuş (hearsay present), -ArmIş (habitual), -AcAkmIş (future), -mAlIymIş (necessity). Tense-neutral; adds report/inference. Group-2 person endings. (A2 had only the finite -mIş.)',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Ahmet çok iyi Almanca biliyormuş. (Apparently Ahmet knows German very well — -Iyormuş.)',
      'Eskiden burada otururlarmış. (They say they used to live here — habitual -ArmIş.)',
      'Yarın gelecekmiş. (Supposedly he will come tomorrow — future -AcAkmIş.)',
      'Ona göre daha çok çalışmalıymışız. (According to her we ought to work harder — -mAlIymIş.)',
    ],
    examplesNegative: [
      '*geldimiş (wrong — -(y)mIş does not attach to -DI; the reportative past is the finite -mIş: gelmiş)',
      '*geliyormuşdum (wrong person set — -(y)mIş takes group-2 endings: geliyormuşum)',
    ],
    commonErrors: [
      'Attaching -(y)mIş to -DI (*geldimiş) instead of using the finite -mIş (gelmiş).',
      'Double-marking evidentiality (*geliyormuşmuş).',
      'Using group-1 endings after -(y)mIş (geliyormuşdum) instead of group-2 (geliyormuşum).',
    ],
    prerequisiteKeys: ['tr-a2-mis-evidential', 'tr-b1-past-continuous-iyordu'],
  },
  // G&K §26.3.11 (-DIkçA proportionality), §26.3.16(iv) (-Ar…-mAz "as soon as"),
  // §26.3.16(viii) (-DIkçA "whenever").
  {
    key: 'tr-b2-proportion-assoon',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Proportion -DIkçA & "as soon as" -Ar…-mAz',
    description:
      '-DIkçA "as / the more … the more" (okudukça öğreniyorum; also "whenever"), and the fixed -Ar…-mAz "as soon as" frame — the positive aorist plus the negative aorist of the same verb (gelir gelmez), with no person marking.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Okudukça daha çok öğreniyorum. (The more I read, the more I learn.)',
      'Su kaynar kaynamaz altını kıs. (As soon as the water boils, lower the heat.)',
      'Onu gördükçe anneni hatırlıyorum. (Whenever I see him I remember your mother.)',
      'Beni görür görmez kaçtı. (He fled as soon as he saw me.)',
    ],
    examplesNegative: [
      '*gelir gelir (wrong — the "as soon as" frame is positive + NEGATIVE aorist: gelir gelmez)',
      '*gelirim gelmezim (wrong — the -Ar…-mAz frame takes no person marking: gelir gelmez)',
    ],
    commonErrors: [
      'Breaking the fixed positive + negative aorist pattern of -Ar…-mAz (gelir gelir / geldi gitmez).',
      'Adding person endings to -Ar…-mAz (gelirim gelmezim).',
      'Confusing scalar -DIkçA ("the more") with immediate-sequence -Ar…-mAz ("the moment").',
    ],
    prerequisiteKeys: ['tr-a2-aorist'],
  },
  // G&K §17.3.2 / §17.3.2.1 (süresince on a noun), §26.3.16(ix)
  // (-DIğI sürece "as long as", -DIK only). Re-scoped 2026-07-17: bare
  // boyunca is taught at B1 (tr-b1-abstract-postpositions, #587); this point
  // owns the formal süresince and the verbal -DIğI sürece converb.
  {
    key: 'tr-b2-duration-throughout',
    clozeUnsuitable: true,
    // No coverageSpec: person is form-relevant only for the -DIğI sürece half
    // (süresince takes a bare noun) — a person pin would be half-effective /
    // construction-forcing (same exclusion as tr-b1-since-converb).
    kind: 'grammar',
    name: 'Duration "throughout / as long as" (süresince, -DIğI sürece)',
    description:
      '"Throughout / as long as" beyond B1 boyunca: süresince is its formal twin on a bare noun (konferans süresince "throughout the lecture"); -DIğI sürece is the converb on a verb (yaşadığım sürece "as long as I live" — -DIK only, never -AcAK).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Konferans süresince fısıldaştılar. (They whispered throughout the lecture.)',
      'Yokluğum süresince komşum kediye baktı. (During my absence my neighbour looked after the cat.)',
      'Ben yaşadığım sürece bu evi satmayacağım. (As long as I live I won\'t sell this house.)',
    ],
    examplesNegative: [
      '*yıla süresince (wrong — süresince takes a bare noun, no case: yıl süresince)',
      '*yaşayacağım sürece (wrong — sürece takes the -DIK participle, not -AcAK: yaşadığım sürece)',
    ],
    commonErrors: [
      'Case-marking the complement of süresince (yıla süresince → yıl süresince).',
      'Using durational boyunca/süresince on a verb participle instead of -DIğI sürece (yaşadığım boyunca).',
      'Using -AcAK with sürece (yaşayacağım sürece → yaşadığım sürece).',
    ],
    prerequisiteKeys: ['tr-b1-abstract-postpositions', 'tr-b1-participles-dik-acak'],
  },
  // G&K §24.4.3 / §24.4.3.1 (indirect statements: -DIK/-AcAK + poss + acc),
  // §24.4.7 (copular predicates nominalised with ol-).
  {
    key: 'tr-b2-reported-statements',
    clozeUnsuitable: true,
    coverageSpec: {
      axes: [
        // The possessive agreeing with the REPORTED subject is the point
        // (geleceğimi vs geleceğini — the examplesNegative trap); unpinned
        // drafts collapse to 3sg "…-DIğInI söyledi". Same paradigm shape as
        // tr-b1-participles-dik-acak.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    kind: 'grammar',
    name: 'Indirect statements (-DIK/-AcAK olduğunu söylemek)',
    description:
      'Indirect statements: the quoted verb becomes a -DIK (non-future) / -AcAK (future) noun clause + possessive (agreeing with the reported subject) + accusative, under söylemek/belirtmek; nominal/copular predicates use "olduğunu". Person backshifts.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Yarın geleceğini söyledi. (He said he would come tomorrow — future -AcAK.)',
      'Onu tanıdığını söyledi. (She said she knew him — -DIK.)',
      'Hasta olduğunu söyledi. (He said he was ill — copular predicate via olduğunu.)',
    ],
    examplesNegative: [
      '*Geleceğimi söyledi [for "he said HE would come"] (wrong possessive — must agree with the reported 3sg subject: geleceğini)',
      '*Hasta olduğu söyledi (wrong — the possessive-marked object clause takes the accusative: hasta olduğunu)',
    ],
    commonErrors: [
      'Keeping the direct-quote possessive (geleceğimi) instead of switching to the reported subject (geleceğini).',
      'Dropping the accusative on the -DIK/-AcAK object clause (olduğunu → olduğu).',
      'Keeping a finite copula for nominal predicates (hastayım) instead of nominalising with ol- (hasta olduğunu).',
    ],
    prerequisiteKeys: ['tr-a2-reported-speech', 'tr-b1-participles-dik-acak'],
  },
  // G&K §24.4.3.2 (indirect questions: yes/no -Ip…-mADIğInI; wh + -DIK/-AcAK).
  {
    key: 'tr-b2-reported-questions',
    clozeUnsuitable: true,
    coverageSpec: {
      axes: [
        // Same possessive-agreement machinery as reported-statements
        // (gelip gelmeyeceğimi / -eceğini); person pins the reported subject
        // across the paradigm.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    kind: 'grammar',
    name: 'Indirect questions (-Ip …-mADIğInI / wh + -DIK)',
    description:
      'Indirect questions: yes/no → -Ip …-mADIğInI (gelip gelmediğini sordu) — the mI particle disappears; wh-questions keep the question word and nominalise the verb with -DIK/-AcAK + possessive + accusative (ne zaman geleceğini sordu, nerede olduğunu bilmiyorum).',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Gelip gelmeyeceğimi sordu. (He asked whether I would come or not — yes/no frame.)',
      'Ne zaman geleceğimi sordu. (He asked when I would come — wh + -AcAK.)',
      'Nerede olduğunu bilmiyorum. (I don\'t know where he is — wh + olduğunu.)',
    ],
    examplesNegative: [
      '*Gelecek mi olduğunu sordu (wrong — the mI particle is replaced by the -Ip…-mA frame: gelip gelmeyeceğimi sordu)',
      '*Ne zaman geleceksini sordu (wrong — the wh-clause must nominalise: geleceğimi)',
    ],
    commonErrors: [
      'Carrying the mI particle into a reported yes/no question instead of the -Ip…-mA frame.',
      'Leaving the wh-question finite (geleceksin) instead of nominalising (geleceğimi).',
      'Mis-ordering the -Ip frame (affirmative stem + -Ip, negative stem carries -DIK/-AcAK + poss + acc).',
    ],
    prerequisiteKeys: ['tr-b2-reported-statements', 'tr-a1-questions'],
  },
  // G&K §24.4.2.2 (directives use the -mA action nominal, not -DIK; addressee
  // ablative with iste-/rica et-, dative with söyle-).
  {
    key: 'tr-b2-reported-directives',
    clozeUnsuitable: true,
    coverageSpec: {
      axes: [
        // The -mA nominal's possessive marks the directive's addressee
        // (gitmemi / gitmeni / gitmenizi); unpinned drafts collapse onto
        // 1sg-told-me frames.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    kind: 'grammar',
    name: 'Reported commands, requests & wishes (-mAsInI istemek/söylemek)',
    description:
      'Reported commands/requests/wishes use the -mA action nominal (+ possessive + accusative), not -DIK: Gitmemi söyledi "he told me to go", Gelmenizi istiyorum. Reported necessity is a fact → -mAsI gerektiğini söyledi. iste-/rica et- take an ablative addressee, söyle- a dative.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Gitmemi söyledi. (He told me to go — imperative → -mA.)',
      'Gelmenizi istiyorum. (I want you to come — request → -mA.)',
      'Gitmem gerektiğini söyledi. (He said I had to go — reported necessity → -DIK.)',
    ],
    examplesNegative: [
      '*Gittiğimi söyledi [for "he told me to go"] (wrong — -DIK means "he said that I went"; a directive takes -mA: gitmemi söyledi)',
      '*Gelmeniz istiyorum (wrong — the -mA object clause takes the accusative: gelmenizi)',
    ],
    commonErrors: [
      'Using -DIK for a directive (gittiğimi söyledi) instead of -mA (gitmemi söyledi).',
      'Omitting the accusative on the -mA clause (gelmenizi → gelmeniz).',
      'Mismatching the addressee frame: benden rica etti (ablative) vs bana söyledi (dative).',
    ],
    prerequisiteKeys: ['tr-b2-reported-statements', 'tr-a2-nominalization'],
  },
  // G&K §13.2.4 (combinations of voice suffixes: fixed order + transitivity of
  // the last suffix), §13.2.1.1 (double causative), §8.2.1 (allomorphy).
  {
    key: 'tr-b2-double-voice',
    // No conjugation cell: combined voice is DERIVATIONAL suffix-stacking, not a
    // person/tense paradigm. A conjugation drill fixes one inflectional category
    // (§ renderConjugationSection) but can't pin WHICH voice combination
    // (causative-of-causative vs causative+passive vs reciprocal+causative), so
    // it is a category mismatch. The stacking rule is drilled by
    // sentence_construction + translation instead (mirrors B1 passive-voice).
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Combined voice (birleşik çatı)',
    description:
      'Stacking voice suffixes in the fixed order reflexive/reciprocal → causative(+causative) → passive: causative-of-causative (yaptır- → yaptırt-), causative+passive (yaptırıldı), reciprocal+causative (görüştür-). The last suffix sets transitivity; only a passive may follow a passive.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Bütün öğrencilere resim yaptırıldı. (All the students were made to draw — causative + passive.)',
      'Baba çocukları öpüştürdü. (The father made the children kiss each other — reciprocal + causative.)',
      'Onları görüştürdü. (She put them in touch / made them meet — reciprocal + causative.)',
      'Mektubu bana yazdırttı. (He had someone make me write the letter — double causative.)',
    ],
    examplesNegative: [
      '*yapıldırdı (wrong order — nothing but a passive may follow a passive; the causative must precede it: yaptırıldı)',
      '*yaptırdırdı (wrong allomorph — a stem in -tIr/-dIr takes -t for the next causative: yaptırt-)',
    ],
    commonErrors: [
      'Wrong stacking order (causative after passive, or reciprocal after causative).',
      'Adding a non-passive suffix onto a passive stem (only a second passive may follow).',
      'Wrong second-causative allomorph (yaptırdır- instead of yaptırt-).',
    ],
    prerequisiteKeys: ['tr-b1-causative-voice', 'tr-b1-passive-voice', 'tr-b1-reciprocal-voice'],
  },
  // G&K §26.3.3 (Concession: -DIK/-AcAK hâlde, -mAsInA rağmen/karşın),
  // §17.2.2(v) (-A rağmen / -A karşın dative postpositions).
  {
    key: 'tr-b2-concessive',
    clozeUnsuitable: true,
    // No coverageSpec: three frames (hâlde / -mAsInA rağmen / noun + rağmen)
    // — multi-construction; the claimed traps are the dative and possessive
    // morphology, not person agreement.
    kind: 'grammar',
    name: 'Concessive "although / despite" (-DIğI hâlde, -mAsInA rağmen)',
    description:
      '"Although / despite": -DIK/-AcAK + possessive + hâlde (gerektiği hâlde), -mA + possessive + dative + rağmen/karşın (olmasına rağmen), and -A rağmen on a bare noun (hastalığına rağmen). hâlde takes no case; rağmen governs the dative.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Yardım etmesi gerektiği hâlde hiçbir şey yapmadı. (Although he should have helped, he did nothing.)',
      'Kötü şeyler yapmış olmasına rağmen onu severim. (Despite her having done bad things, I like her.)',
      'Hastalığına rağmen çalışıyor. (She works in spite of her illness — -A rağmen on a noun.)',
    ],
    examplesNegative: [
      '*olması rağmen (wrong — rağmen governs the dative: olmasına rağmen)',
      '*gerek hâlde (wrong — hâlde takes -DIK + possessive: gerektiği hâlde)',
    ],
    commonErrors: [
      'Omitting the dative required by rağmen / karşın (olması rağmen → olmasına rağmen).',
      'Dropping the possessive on -DIK hâlde (gerek hâlde → gerektiği hâlde).',
      'Contaminating hâlde with için (gerektiği için hâlde).',
    ],
    prerequisiteKeys: ['tr-b1-participles-dik-acak', 'tr-a2-nominalization'],
  },
  // G&K §26.3.15 (Substitution: -AcAğInA / -AcAğI yerde), §26.3.10
  // (Preference: -mAktAnsA). Re-scoped 2026-07-17: the basic -mAk yerine frame
  // is taught at A2 (tr-a2-nominalization example since the G&K book-coverage
  // folds, #587); this point owns the two harder frames.
  {
    key: 'tr-b2-instead-of',
    clozeUnsuitable: true,
    // No coverageSpec: -mAktAnsA is person-less; only the -AcAğInA half
    // inflects — a person pin would force one construction (half-effective,
    // same exclusion as tr-b1-since-converb).
    kind: 'grammar',
    name: '"Rather than" (-mAktAnsA, -AcAğInA / -AcAğI yerde)',
    description:
      '"Rather than / instead of" beyond the A2 -mAk yerine frame: -mAktAnsA (ablative + ise: beklemektense "rather than waiting") and -AcAğInA / -AcAğI yerde (future participle + dative / yerde: ağlayacağına gül "laugh instead of crying"). Both attach to the rejected alternative.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Burada beklemektense yürüyelim. (Rather than waiting here, let\'s walk.)',
      'Ağlayacağına bir çözüm bul. (Instead of crying, find a solution — -AcAğInA.)',
      'Televizyon seyredeceğin yerde kitap oku. (Read a book instead of watching TV — -AcAğI yerde.)',
    ],
    examplesNegative: [
      '*ağladığına [for "instead of crying (expected)"] (wrong — a substituted future action takes -AcAK: ağlayacağına)',
      '*beklemekten yürüyelim (wrong — the "rather than" form needs the -sA/ise element: beklemektense)',
    ],
    commonErrors: [
      'Using -DIK where -AcAK is needed for the substituted action (ağladığına → ağlayacağına).',
      'Dropping the conditional element of -mAktAnsA (beklemekten → beklemektense).',
      'Mixing the frames (-AcAğInA yerine / -AcAğI yerine).',
    ],
    prerequisiteKeys: ['tr-a2-nominalization', 'tr-b1-participles-dik-acak'],
  },
  // G&K §27.6.1 (formal conditionals: -DIğI takdirde [-DIK only],
  // -mAsI hâlinde / durumunda), §26.3.4 (Condition).
  {
    key: 'tr-b2-conditional-formal',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Formal conditionals (-DIğI takdirde, -mAsI hâlinde / durumunda)',
    description:
      'Formal (written/official) conditionals: -DIğI takdirde (-DIK only, never -AcAK: başvurduğunuz takdirde), -mAsI hâlinde and -mAsI durumunda (-mA + possessive: gecikmesi hâlinde). Meaning ≈ aorist + -sA but register-marked.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Başvurunuz zamanında ulaştığı takdirde değerlendirilecektir. (If your application arrives on time it will be considered.)',
      'Ödeme gecikmesi hâlinde faiz uygulanır. (In case of late payment, interest is charged.)',
      'Kurallara uyulmaması durumunda üyelik iptal edilir. (If the rules are not followed, membership is cancelled.)',
    ],
    examplesNegative: [
      '*başvuracağınız takdirde (wrong — takdirde takes -DIK, never -AcAK: başvurduğunuz takdirde)',
      '*gecikme hâlinde (wrong — needs the possessive on -mA: gecikmesi hâlinde)',
    ],
    commonErrors: [
      'Using -AcAK with takdirde (başvuracağınız takdirde → başvurduğunuz takdirde).',
      'Dropping the possessive on the -mA noun (gecikme hâlinde → gecikmesi hâlinde).',
      'Using these formal forms in casual speech where -sA is expected.',
    ],
    prerequisiteKeys: ['tr-b1-real-conditional', 'tr-b1-participles-dik-acak'],
  },
  // G&K §13.3.1.1 (converb + auxiliary compound verbs), §8.2.3.2 (Position-2:
  // -(y)Iver, -(y)Ayaz düşeyazdı), §13.3 (bound vs free auxiliaries).
  {
    key: 'tr-b2-aspectual-verbs',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Aspectual compound verbs (-(y)Iver, -(y)Ip dur/kal, -(y)Akal)',
    description:
      'Aspectual compound verbs = converb + auxiliary. Bound: -(y)Iver (do quickly: gidiver), -(y)Akal (be frozen: donakaldı), -(y)Ayaz (almost: düşeyazdı), -(y)Agel (over time). Free: -(y)Ip dur- (keep on: bakıp durdu), -(y)Ip kal- (be left: uyuyup kaldı). Only -Iver is fully productive.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Şu pencereyi kapayıver. (Just close that window — -(y)Iver, quick/easy.)',
      'Söylediklerini duyunca donakaldık. (We were stunned when we heard — frozen -(y)Akal.)',
      'Çocuk bütün gün bakıp durdu. (The child kept staring all day — free -(y)Ip dur-.)',
      'Yorgunluktan uyuyup kaldık. (We were left fast asleep from exhaustion — -(y)Ip kal-.)',
    ],
    examplesNegative: [
      '*donukaldı (wrong converb vowel — -kal takes -(y)A: donakaldı)',
      '*gider durdu (wrong — the free auxiliary needs the -(y)Ip converb: gidip durdu)',
    ],
    commonErrors: [
      'Wrong converb vowel: -(y)I vs -(y)A per auxiliary (donukaldı / gideverdi).',
      'Omitting -(y)Ip with a free auxiliary (gider durdu → gidip durdu).',
      'Over-producing frozen auxiliaries (-(y)Ayaz, -(y)Agel, -(y)Akal) as if productive — only -(y)Iver is fully productive.',
    ],
    prerequisiteKeys: ['tr-a2-converbs', 'tr-a2-aorist'],
  },
  // Reverse-audit addition. G&K §8.3.3 (generalizing -DIr), §21.4.1.1
  // (assumption / probability modality).
  {
    key: 'tr-b2-dir-generalizing',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: 'Generalizing / assumption copula -DIr',
    description:
      'Copular -DIr: (a) assumption/probability in speech (O şimdi evdedir "she\'s probably home"), (b) neutral generalization / definition in formal register (Türkiye\'nin başkenti Ankara\'dır; …kaynamaktadır). Non-past; distinct from hearsay -mIş.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'O şu an evdedir. (She\'s probably home right now — assumption.)',
      'Türkiye\'nin başkenti Ankara\'dır. (The capital of Turkey is Ankara — formal statement of fact.)',
      'Bu su içilebilir niteliktedir. (This water is of drinkable quality — formal register.)',
    ],
    examplesNegative: [
      '*Ankara\'dır güzel (wrong placement — -DIr sits on the predicate: Ankara güzeldir)',
      '*Dün evdeydir (wrong — -DIr is non-past; past assumption is evde olmalıydı)',
    ],
    commonErrors: [
      'Confusing assumption -DIr (probability) with evidential -mIş (hearsay).',
      'Using -DIr in casual speech for a plain known fact where the bare predicate is natural (evdedir → evde).',
      'Attaching -DIr to a past predicate (evdeydir).',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes', 'tr-a2-mis-evidential'],
  },
  // Reverse-audit addition. G&K §26.1.5 / §26.3.8 (non-factual "as if":
  // (sanki) …-mIş gibi).
  {
    key: 'tr-b2-as-if-gibi',
    clozeUnsuitable: true,
    kind: 'grammar',
    name: '"As if" (sanki) …-mIş gibi',
    description:
      '"As if": (sanki) + -mIş gibi — a hypothetical/counterfactual manner clause on evidential -mIş + gibi (hayalet görmüş gibi bakıyor). Non-factual; sanki optionally flags it. An ongoing pretence uses -(I)yormuş gibi.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: [
      'Bana hayalet görmüş gibi baktı. (He looked at me as if he\'d seen a ghost.)',
      'Sanki hiçbir şey olmamış gibi konuşuyor. (He talks as if nothing had happened.)',
      'Beni duymuyormuş gibi yaptı. (She acted as if she couldn\'t hear me — -Iyormuş gibi.)',
    ],
    examplesNegative: [
      '*gördü gibi (wrong — "as if" builds on the participle -mIş, not the finite past: görmüş gibi)',
      '*görmüş kadar [for "as if he saw"] (wrong postposition — the "as if" frame uses gibi, not kadar)',
    ],
    commonErrors: [
      'Using a finite verb before gibi instead of -mIş (gördü gibi → görmüş gibi).',
      'Confusing "as if" -mIş gibi with real comparison gibi (aslan gibi güçlü).',
      'Forgetting -(I)yormuş gibi for an ongoing pretence (duymuyor gibi vs duymuyormuş gibi).',
    ],
    prerequisiteKeys: ['tr-a2-gibi-kadar', 'tr-a2-mis-evidential'],
  },

  // ---------------------------------------------------------------------------
  // B1 — G&K reverse-audit fills (2026-07-10).
  // ---------------------------------------------------------------------------

  // G&K §12.1.1.3 (ol- supplies the copula outside present/past), §13.3
  // (auxiliary verbs), §21.3.4.1 ("become" oldu vs stative -(y)DI).
  {
    key: 'tr-b1-copula-ol',
    clozeUnsuitable: true,
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Suppletive copula ol- (be / become)',
    description:
      'ol- supplies the copula for every tense the -(y)- copula lacks: future (öğretmen olacağım), necessity (evde olmalıyım), conditional (zengin olsam), aorist/habitual (olur/oluyor), non-finite (olan, olarak). Dynamic oldu/olmuş = "became/got" vs stative -(y)DI "was".',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Büyüyünce doktor olacağım. (When I grow up I will be a doctor — future.)',
      'Yarın sabah burada olmalıyım. (I must be here tomorrow morning — necessity.)',
      "Ahmet 1994'te başkan oldu. (Ahmet became president in 1994 — dynamic \"become\".)",
      'Bir arabamız olsa her yere giderdik. (If we had a car we\'d go everywhere — existential ol-.)',
      'Kapı açık, evde olmalılar. (The door is open — they must be at home; olmalı on a nominal also expresses deduction from evidence, not just obligation.)',
    ],
    examplesNegative: [
      '*öğretmeneceğim (wrong — a nominal predicate needs ol- to carry the future: öğretmen olacağım)',
      '*evdemeliyim (wrong — -mAlI attaches to ol-, not the noun: evde olmalıyım)',
    ],
    commonErrors: [
      'Attaching verbal tense/mood directly to a noun or locative (öğretmeneceğim → öğretmen olacağım).',
      'Stacking -mAlI on the predicate instead of on ol- (evdemeliyim → evde olmalıyım).',
      'Confusing stative "was" (-(y)DI: başkanıydı) with dynamic "became" (oldu: başkan oldu).',
    ],
    prerequisiteKeys: ['tr-a1-personal-suffixes', 'tr-a1-future', 'tr-a2-ability-necessity'],
  },
  // G&K §16.1.9 (olarak: role/capacity + adverbialiser of derived adjectives).
  {
    key: 'tr-b1-olarak',
    kind: 'grammar',
    name: 'olarak "as / in the capacity of"',
    description:
      'olarak (ol- + -ArAk) marks a role/capacity after a bare noun (avukat olarak çalışıyor "works as a lawyer"; aile olarak) and adverbialises derived adjectives that can\'t stand alone as adverbs (yazılı olarak "in writing", bilimsel olarak, geçici olarak). The complement takes no case.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Bunu sana arkadaş olarak söylüyorum. (I\'m telling you this as a friend.)',
      'Bu sandığı masa olarak kullanıyoruz. (We\'re using this chest as a table.)',
      'Raporu yazılı olarak sundular. (They submitted the report in writing.)',
      'Sonuç olarak herkes memnun kaldı. (As a result, everyone was satisfied.)',
    ],
    examplesNegative: [
      '*avukat gibi çalışıyor [for "works as a lawyer"] (wrong — gibi = "like/resembling"; a role/capacity is olarak: avukat olarak)',
      '*avukatı olarak (wrong — olarak takes a bare noun, no case: avukat olarak)',
    ],
    commonErrors: [
      'Using gibi/kadar (similarity) for a role/capacity that needs olarak.',
      'Case-marking the complement of olarak (avukatı olarak → avukat olarak).',
      'Dropping olarak where a derived adjective needs it to be an adverb (bilimsel anlattı → bilimsel olarak anlattı).',
    ],
    prerequisiteKeys: ['tr-a2-gibi-kadar', 'tr-a1-gore-bence'],
  },
  // G&K §17.3.2 (Group 2 possessive-marked postpositions: abstract relations).
  // Added by the 2026-07-16 book-coverage triage. Distinct from
  // tr-a2-spatial-postpositions (Group 1): the case on the postposition is
  // FIXED per item and the complement stays bare (except genitive-attracting
  // pronouns), vs Group 1's meaning-driven variable case.
  {
    key: 'tr-b1-abstract-postpositions',
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: 'Abstract postpositions (hakkında, yüzünden, sayesinde)',
    description:
      'Abstract Group-2 postpositions: bare noun + fixed possessive-marked form — hakkında "about", yüzünden "because of" (unwelcome cause), sayesinde "thanks to" (welcome cause), yerine "instead of", boyunca "along/throughout", konusunda "on the subject of". Complement stays caseless (bu film hakkında), but personal pronouns take genitive (benim hakkımda, onun yüzünden).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Bu film hakkında ne düşünüyorsun? (What do you think about this film?)',
      'Trafik yüzünden geç kaldık. (We were late because of the traffic — unwelcome cause.)',
      'Senin sayende işi buldum. (I found the job thanks to you — genitive on the pronoun.)',
      'Çay yerine kahve içelim. (Let\'s drink coffee instead of tea.)',
      'Yol boyunca hiç konuşmadık. (We didn\'t talk at all along the way.)',
      'Benim hakkımda ne dediler? (What did they say about me? — 1sg possessive on hak.)',
    ],
    examplesNegative: [
      '*Filmden hakkında konuştuk. (wrong — the complement stays caseless: "film hakkında")',
      '*Sınavı kazandım senin yüzünden. (wrong register — yüzünden is for unwelcome causes; a welcome cause is sayesinde: "senin sayende")',
    ],
    commonErrors: [
      'Case-marking the complement ("filmden hakkında") — Group-2 postpositions take a bare noun.',
      'Swapping yüzünden and sayesinde — yüzünden blames (bad outcome), sayesinde credits (good outcome).',
      'Using bare pronoun + postposition ("ben hakkında") — pronouns take the genitive and the possessive shifts person: benim hakkımda, senin hakkında.',
    ],
    prerequisiteKeys: ['tr-a2-spatial-postpositions', 'tr-a1-genitive-possessive'],
  },
  // G&K §26.3.14 (reason converbs). Added by the 2026-07-16 book-coverage
  // triage — tr-a2-causal-connectors' own commonErrors defer to "the B1
  // -DIğI için form", which did not exist until this point (the exact failure
  // mode the ledger was built to catch).
  {
    key: 'tr-b1-reason-digi-icin',
    sentenceConstructionSuitable: true,
    coverageSpec: {
      axes: [
        // The subordinate verb carries possessive agreement with its subject
        // (geldiğim için / geldiği için); the commonError is dropping it —
        // floors force the whole paradigm.
        {
          name: 'person',
          floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 },
        },
      ],
    },
    kind: 'grammar',
    name: 'Reason clauses -DIğI / -(y)AcAğI için ("because")',
    description:
      'Nominalised reason clause: personal participle + için — geldiğim için "because I came", yağdığı için "because it rained"; future cause takes -(y)AcAğI (para yetmeyeceği için "as the money won\'t be enough"). The subordinate verb carries the possessive agreement; no çünkü in the same clause. -DIğIndAn (dolayı) is a formal equivalent.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Bana kızdığın için öyle söylüyorsun. (You\'re saying that because you\'re angry with me.)',
      'Yağmur yağdığı için maç ertelendi. (The match was postponed because it rained.)',
      'Bu para yetmeyeceği için borç isteyeceğim. (As this money won\'t be enough, I\'ll ask for a loan.)',
      'Hasta olduğum için gelemedim. (I couldn\'t come because I was ill.)',
    ],
    examplesNegative: [
      '*Geç kaldım için özür dilerim. (wrong — için needs the nominalised participle, not a finite verb: "geç kaldığım için")',
      '*Çünkü hasta olduğum için gelemedim. (wrong — çünkü and -DIğI için double-mark the reason; use one.)',
    ],
    commonErrors: [
      'Attaching için to a finite verb ("geç kaldım için") — the clause must be nominalised: geç kaldığım için.',
      'Dropping the possessive agreement ("geldiği için" when the subject is "I") — the participle agrees: geldiğim için.',
      'Doubling the reason marker with çünkü ("çünkü … -DIğI için") — finite çünkü and nominalised -DIğI için are alternatives, not partners.',
    ],
    prerequisiteKeys: ['tr-b1-participles-dik-acak', 'tr-a2-causal-connectors'],
  },
  // G&K §26.3.16 (i)–(ii) (temporal 'when' converbs). Added by the 2026-07-16
  // book-coverage triage: -mAdAn önce/-DIktAn sonra, -(y)ken and -(y)AlI/
  // -DIğIndAn beri each had a point, but plain "when" had none. Two allied
  // forms fill one meaning slot (cf. tr-b1-since-converb), so SC stays viable.
  {
    key: 'tr-b1-when-converbs',
    sentenceConstructionSuitable: true,
    kind: 'grammar',
    name: '"When" clauses -(y)IncA / -DIğIndA',
    description:
      '"When" clauses: -(y)IncA for a sequential trigger — the main event follows (yağmur başlayınca içeri girdik "when it started to rain, we went inside"; invariant, no person marking); -DIğIndA / -DIğI zaman when the main situation is ongoing at that moment (uçaktan indiğimizde kar yağıyordu "when we got off the plane it was snowing"; participle + possessive agreement).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Yağmur yağmaya başlayınca içeri girdik. (When it began to rain, we went inside — sequential -(y)IncA.)',
      'Eve gelince beni ara. (Call me when you get home.)',
      'Uçaktan indiğimizde kar yağıyordu. (When we got off the plane, it was snowing — ongoing background.)',
      'Onu gördüğüm zaman çok mutlu oldum. (When I saw him, I was very happy.)',
      'Haberi duyunca hemen aradı. (When she heard the news, she called at once.)',
    ],
    examplesNegative: [
      '*Ben gelinceyim... (wrong — -(y)IncA never takes person marking: "ben gelince")',
      '*Eve geldiğinde zaman ara. (wrong — -DIğIndA and -DIğI zaman are alternatives, not stackable: "geldiğinde" or "geldiği zaman")',
    ],
    commonErrors: [
      'Adding person suffixes to -(y)IncA (*gelinceyim) — it is invariant; the person lives in the main clause (or use -DIğImdA).',
      'Stacking -DIğIndA with zaman ("geldiğinde zaman") — pick one: geldiğinde or geldiği zaman.',
      'Dropping the possessive agreement in -DIğIndA clauses ("uçaktan indiğinde" for "when WE landed" → indiğimizde).',
    ],
    prerequisiteKeys: ['tr-a2-converb-temporal', 'tr-b1-participles-dik-acak'],
  },

  // ---------------------------------------------------------------------------
  // Vocab umbrellas — kind: 'vocab'
  // ---------------------------------------------------------------------------
  // Themed A1/A2 umbrellas (2026-06-07). Replaced the single
  // tr-a1/a2-everyday-vocab cells, which exhausted their realistic distinct-word
  // surface fast (high dedup-give-up). Splitting one broad cell into ~5 narrow
  // topics per level gives the generator a fresh semantic slice per cell, so
  // each fills its (now low, 10) target with little dedup. A1 = concrete
  // beginner basics; A2 = broader everyday domains.
  {
    key: 'tr-a1-vocab-family-people',
    kind: 'vocab',
    name: 'Family & people vocabulary (A1)',
    description:
      'High-frequency A1 Turkish vocabulary for family members and people: parents, siblings, relatives, and friends.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['anne (mother)', 'kardeş (sibling)', 'arkadaş (friend)'],
    examplesNegative: ['*anne m'],
    commonErrors: [
      'Detaching possessive/case suffixes from the noun (annem, not *anne m).',
      'Confusing kardeş (sibling) with akraba (relative).',
    ],
  },
  {
    key: 'tr-a1-vocab-food-drink',
    coverageSpec: {
      // wordClass diversity: food/drink vocab is noun-dominant, with a few verbs
      // (eat/drink) and adjectives (tastes). Floors sum to the vocab target (10).
      axes: [
        { name: 'wordClass', floors: { noun: 6, verb: 2, adjective: 2 } },
      ],
    },
    kind: 'vocab',
    name: 'Food & drink vocabulary (A1)',
    description:
      'High-frequency A1 Turkish food and drink vocabulary: staple foods, fruit, vegetables, and everyday drinks.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['ekmek (bread)', 'su (water)', 'çay (tea)'],
    examplesNegative: ['*su yu'],
    commonErrors: [
      'Splitting suffixes from the noun (suyu, not *su yu).',
      'Forgetting the buffer -y- on vowel-final stems (suyu, not *suu).',
    ],
  },
  {
    key: 'tr-a1-vocab-home-objects',
    kind: 'vocab',
    name: 'Home & furniture vocabulary (A1)',
    description:
      'High-frequency A1 Turkish vocabulary for the home: rooms, furniture, and common household objects.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['ev (house)', 'masa (table)', 'kapı (door)'],
    examplesNegative: ['*masa da'],
    commonErrors: [
      'Detaching the locative suffix (masada, not *masa da).',
      'Vowel-harmony slips on suffixes (kapıda, not *kapide).',
    ],
  },
  {
    key: 'tr-a1-vocab-transport-places',
    kind: 'vocab',
    name: 'Transport & places vocabulary (A1)',
    description:
      'High-frequency A1 Turkish vocabulary for transport and everyday places: vehicles, stops, and common destinations.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['otobüs (bus)', 'okul (school)', 'durak (stop)'],
    examplesNegative: ['*okul a'],
    commonErrors: [
      'Detaching the dative suffix (okula, not *okul a).',
      'Confusing durak (stop) with durmak (to stop).',
    ],
  },
  {
    key: 'tr-a1-vocab-weather-clothing',
    kind: 'vocab',
    name: 'Weather & clothing vocabulary (A1)',
    description:
      'High-frequency A1 Turkish vocabulary for weather, seasons, and clothing items.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: ['yağmur (rain)', 'kar (snow)', 'şapka (hat)'],
    examplesNegative: ['*yağmur lu'],
    commonErrors: [
      'Detaching derivational suffixes (yağmurlu, not *yağmur lu).',
      'Confusing kar (snow) with kâr (profit).',
    ],
  },
  {
    key: 'tr-a2-vocab-work-school',
    kind: 'vocab',
    name: 'Work & school vocabulary (A2)',
    description:
      'A2 Turkish vocabulary for work, study, and professions: jobs, workplaces, school subjects, and study activities.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['iş (work)', 'öğretmen (teacher)', 'toplantı (meeting)'],
    examplesNegative: ['*iş çi'],
    commonErrors: [
      'Detaching the -CI agentive suffix (işçi, not *iş çi).',
      'Confusing iş (work/job) with meslek (profession).',
    ],
  },
  {
    key: 'tr-a2-vocab-city-shopping',
    kind: 'vocab',
    name: 'City & shopping vocabulary (A2)',
    description:
      'A2 Turkish vocabulary for the city and shopping: public buildings, services, money, and shopping activities.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['market (market)', 'banka (bank)', 'kütüphane (library)'],
    examplesNegative: ['*market ten'],
    commonErrors: [
      'Detaching the ablative suffix (marketten, not *market ten).',
      'Confusing fiyat (price) with ücret (fee).',
    ],
  },
  {
    key: 'tr-a2-vocab-health-body',
    kind: 'vocab',
    name: 'Health & body vocabulary (A2)',
    description:
      'A2 Turkish vocabulary for the body, health, and feelings: body parts, symptoms, and common physical states.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['sağlık (health)', 'hasta (sick)', 'yorgun (tired)'],
    examplesNegative: ['*hasta yım'],
    commonErrors: [
      'Detaching the copular suffix (hastayım, not *hasta yım).',
      'Forgetting the buffer -y- after vowel-final stems (hastayım, not *hastaım).',
    ],
  },
  {
    key: 'tr-a2-vocab-travel-nature',
    kind: 'vocab',
    name: 'Travel & nature vocabulary (A2)',
    description:
      'A2 Turkish vocabulary for travel, geography, and nature: landscapes, the outdoors, and journey words.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['deniz (sea)', 'dağ (mountain)', 'yolculuk (journey)'],
    examplesNegative: ['*deniz e'],
    commonErrors: [
      'Detaching the dative suffix (denize, not *deniz e).',
      'Confusing yol (road) with yolculuk (journey).',
    ],
  },
  {
    key: 'tr-a2-vocab-time-daily-routine',
    kind: 'vocab',
    name: 'Time & daily routine vocabulary (A2)',
    description:
      'A2 Turkish vocabulary for time and daily routine: parts of the day, days and weeks, and frequency words.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: ['sabah (morning)', 'hafta (week)', 'genellikle (usually)'],
    examplesNegative: ['*sabah ları'],
    commonErrors: [
      'Detaching plural/case suffixes (sabahları, not *sabah ları).',
      'Confusing saat (hour/clock) with zaman (time).',
    ],
  },
  {
    key: 'tr-b1-vocab-media-news',
    kind: 'vocab',
    name: 'Media & news vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for news and media: press, broadcasts, headlines, reporting, and current events.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['haber (news)', 'gazete (newspaper)', 'yayın (broadcast)'],
    examplesNegative: ['*haber ci'],
    commonErrors: [
      'Detaching the -CI agentive suffix (haberci, not *haber ci).',
      'Confusing haber (news item) with bilgi (information).',
    ],
  },
  {
    key: 'tr-b1-vocab-opinions-society',
    kind: 'vocab',
    name: 'Opinions & society vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for expressing opinions and discussing society: views, agreement/disagreement, social issues, and community.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['görüş (opinion)', 'toplum (society)', 'sorun (problem/issue)'],
    examplesNegative: ['*fikir ler im ce'],
    commonErrors: [
      'Confusing görüş (considered opinion) with fikir (idea).',
      'Mis-segmenting suffix chains (fikrimce, not *fikir im ce).',
    ],
  },
  {
    key: 'tr-b1-vocab-education-career',
    kind: 'vocab',
    name: 'Education & career vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for education and working life: studies, qualifications, careers, applications, and the workplace.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['eğitim (education)', 'kariyer (career)', 'başvuru (application)'],
    examplesNegative: ['*eğitim sel li k'],
    commonErrors: [
      'Confusing eğitim (education) with öğretim (instruction/teaching).',
      'Mis-segmenting derived forms (eğitimli, not *eğitim li).',
    ],
  },
  {
    key: 'tr-b1-vocab-emotions-relationships',
    kind: 'vocab',
    name: 'Emotions & relationships vocabulary (B1)',
    description:
      'B1 Turkish vocabulary for feelings and relationships: emotions, moods, friendship, family ties, and social interaction.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['duygu (emotion)', 'ilişki (relationship)', 'güven (trust)'],
    examplesNegative: ['*duygu sal lık'],
    commonErrors: [
      'Confusing duygu (emotion) with his (sense/feeling).',
      'Mis-segmenting derived forms (duygusal, not *duygu sal).',
    ],
  },
  {
    key: 'tr-b1-vocab-abstract-concepts',
    kind: 'vocab',
    name: 'Abstract concepts vocabulary (B1)',
    description:
      'B1 Turkish abstract nouns and concepts: ideas, values, qualities, and processes used in opinion and discussion (often -lIk / -lInIz derivations).',
    cefrLevel: B1,
    language: TR,
    examplesPositive: ['özgürlük (freedom)', 'gerçek (truth/reality)', 'amaç (aim/purpose)'],
    examplesNegative: ['*özgür lük'],
    commonErrors: [
      'Detaching the -lIk abstract-noun suffix (özgürlük, not *özgür lük).',
      'Confusing amaç (purpose) with neden (reason).',
    ],
  },

  // ---------------------------------------------------------------------------
  // Themed B2 umbrellas (2026-07-17 expansion), mirroring the ES/DE B-level
  // split; grounded in Yedi İklim B2 unit topics (work life, values, current
  // affairs). commonErrors favour suffix/vowel-harmony traps and
  // Arabic/French loanword confusions.
  // coverageSpec: intentionally none — open noun-dominant identity space
  // (matches the existing TR vocab-umbrella decision).
  // ---------------------------------------------------------------------------
  {
    key: 'tr-b2-vocab-work-professional',
    kind: 'vocab',
    name: 'Work & professional life vocabulary (B2)',
    description:
      'B2 Turkish vocabulary for professional life: career progress, workplace performance, and staff relations.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['terfi (promotion)', 'verimlilik (efficiency/productivity)'],
    examplesNegative: ['*verimli lik'],
    commonErrors: [
      'Mis-segmenting the -lIk suffix on a derived adjective (verimlilik, not *verimli lik).',
      'Confusing personel (staff/personnel, French loan) with kişisel (personal, from native "kişi" + the suffix "-sel") — similar sound, different meaning.',
    ],
  },
  {
    key: 'tr-b2-vocab-science-technology',
    kind: 'vocab',
    name: 'Science & technology vocabulary (B2)',
    description:
      'B2 Turkish vocabulary for science and technology: research, invention, and technological development.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['icat (invention)', 'gelişme (development)'],
    examplesNegative: ['*gelişme si'],
    commonErrors: [
      'Detaching the buffer -s- third-person possessive suffix (gelişmesi, not *gelişme si).',
      'Confusing icat (invention, Arabic loan — to create something new) with keşif (discovery, Arabic loan — to find something already existing).',
    ],
  },
  {
    key: 'tr-b2-vocab-society-politics',
    kind: 'vocab',
    name: 'Society & politics vocabulary (B2)',
    description:
      'B2 Turkish vocabulary for society and politics: government, citizenship, and civic debate.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['hükümet (government)', 'vatandaş (citizen)'],
    examplesNegative: ['*vatandaş lık'],
    commonErrors: [
      'Detaching the -lIk suffix that derives an abstract noun from an agent noun (vatandaşlık, not *vatandaş lık).',
      'Confusing hükümet (the government, an institution — Arabic loan) with devlet (the state — Arabic loan); both are used loosely by learners.',
    ],
  },
  {
    key: 'tr-b2-vocab-culture-arts',
    kind: 'vocab',
    name: 'Culture & arts vocabulary (B2)',
    description:
      'B2 Turkish vocabulary for culture and the arts: artistic works, exhibitions, and critical commentary.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['eser (work of art)', 'resim (painting/picture)'],
    examplesNegative: ['*resim i'],
    commonErrors: [
      'Missing the vowel-drop when suffixing resim (resmi "its picture", not *resim i or *resimi) — the second vowel elides before a vowel-initial suffix.',
      'Confusing resmi (its picture, from resim) with resmî (official, an unrelated Arabic loan) — a classic homograph trap in unmarked Turkish spelling.',
    ],
  },
  {
    key: 'tr-b2-vocab-global-issues',
    kind: 'vocab',
    name: 'Global issues vocabulary (B2)',
    description:
      'B2 Turkish vocabulary for global issues: climate, sustainability, and international migration.',
    cefrLevel: B2,
    language: TR,
    examplesPositive: ['iklim (climate)', 'sürdürülebilirlik (sustainability)'],
    examplesNegative: ['*sürdürülebilir lik'],
    commonErrors: [
      'Mis-segmenting the -lIk suffix on a long derived adjective (sürdürülebilirlik, not *sürdürülebilir lik).',
      'Confusing göç (migration, native Turkish, general sense) with hicret (migration, Arabic loan, narrow religious/historical register) — not interchangeable.',
    ],
  },

  // ---------------------------------------------------------------------------
  // Dictation umbrellas — kind: 'dictation' (Phase 2 generation pipeline)
  // ---------------------------------------------------------------------------
  {
    key: 'tr-a1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A1)',
    description:
      'Short, clearly-articulated A1 Turkish clips (one simple everyday sentence); tests vowel-harmony suffixes and word-final consonant softening by ear.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Bugün hava çok güzel.',
      'Benim adım Ali ve ben öğretmenim.',
    ],
    examplesNegative: ['*Tek kelime ya da bağlantısız bir kelime listesi (cümle değil).'],
    commonErrors: [
      'Mishearing vowel-harmony suffixes (evler vs. *evlar).',
      'Missing word-final consonant softening (kitabı heard/spelled as kitap).',
    ],
    // targetOverride: trial-raised 6→15 (2026-06-23) once the level-scope fix
    // stopped the validator mis-flagging in-scope A1 morphology (softening,
    // -iyor) as A2; the trial landed (pool 6→11 on the 2026-06-24 run), so raise
    // to 30 (2026-06-25) to build a deeper A1 dictation pool. Point-wide, but a
    // dictation umbrella only feeds the dictation cell, so TR-only and dictation-
    // only.
    targetOverride: 30,
  },
  {
    key: 'tr-a2-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (A2)',
    description:
      'Short A2 Turkish clips (1–2 everyday sentences, light connected speech); tests suffix-heavy word segmentation and tracking across joined clauses.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Hafta sonu arkadaşlarımla sinemaya gittik ve film çok güzeldi.',
      'Dün markete gidip biraz ekmek, peynir ve süt aldım.',
    ],
    examplesNegative: ['*Çok uzun ya da A2 seviyesinin çok üstünde kelimeler içeren metin.'],
    commonErrors: [
      "Losing track across two clauses joined by 've'.",
      'Mis-segmenting suffix-heavy words (arkadaşlarımla).',
    ],
    // targetOverride (2026-06-25): raise the A2 dictation pool from the level
    // default to 30, matching the A1 dictation bump. Point-wide is safe — a
    // dictation umbrella only feeds the dictation cell.
    targetOverride: 30,
  },
  {
    key: 'tr-b1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B1)',
    description:
      'Short B1 Turkish clips (2–3 sentences, natural connected speech with subordinate clauses); tests tracking across joined and embedded clauses.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Dün akşam haberleri izlerken telefonum çaldı ve bir arkadaşım beni davet etti.',
      'Bu konuda farklı görüşler var, ama bence en önemli sorun eğitim.',
    ],
    examplesNegative: ['*Çok uzun ya da B1 seviyesinin çok üstünde, ağır akademik bir metin.'],
    commonErrors: [
      'Losing track across an embedded -(y)ken / -DIK clause.',
      'Mis-segmenting suffix-heavy words (izlerken, görüşler).',
    ],
    // targetOverride (2026-06-25): raise the B1 dictation pool from the level
    // default to 30, matching the A1/A2 dictation bumps. Point-wide is safe — a
    // dictation umbrella only feeds the dictation cell.
    targetOverride: 30,
  },
  // Free-writing topic umbrellas — kind: 'free-writing' (Phase 2 generation).
  // Added 2026-06-17. Concrete, level-appropriate topics; the per-draft angle
  // rotation uses the A1/A2 concrete pool (free-writing-generation-prompts.ts).
  {
    key: 'tr-a1-fw-my-day',
    kind: 'free-writing',
    name: 'Bir günüm',
    description:
      'An informal prompt to describe a typical day using simple present-tense routine verbs and times of day.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks what they do in the morning, afternoon, and evening.',
      'Requires at least one time expression (e.g. saat yedide).',
    ],
    examplesNegative: ['*Write an essay about the meaning of daily life.'],
    commonErrors: [
      'Verbs with no time expressions (saat yedide, öğleden sonra).',
      'Drifting into past-tense storytelling instead of a typical day.',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a1-fw-my-family',
    kind: 'free-writing',
    name: 'Ailem',
    description:
      'An informal prompt to introduce family members, who they are, and one simple detail about each.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks for at least two family members and their jobs or ages.',
      'Requires one sentence about something a family member likes.',
    ],
    examplesNegative: ['*Discuss the role of family in society.'],
    commonErrors: [
      'Naming people with no detail at all.',
      'Possessive-suffix errors (annem vs. *anne benim).',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a1-fw-my-weekend',
    kind: 'free-writing',
    name: 'Hafta sonum',
    description:
      'An informal prompt to describe what the learner usually does on the weekend, with simple activities and places.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks for two or three weekend activities.',
      'Requires saying who they do one activity with.',
    ],
    examplesNegative: ['*Compare weekends and weekdays in detail.'],
    commonErrors: [
      'A single activity with no places or people.',
      'Mixing in complex past-tense narration.',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a2-fw-a-trip',
    kind: 'free-writing',
    name: 'Unutamadığım bir gezi',
    description:
      'A neutral prompt to narrate a memorable trip: where, when, and one thing that happened, using past tense.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks where and when the trip was, plus one memorable event.',
      'Requires a closing sentence on how they felt about it.',
    ],
    examplesNegative: ['*Describe travelling in general.'],
    commonErrors: [
      'Generic travel description with no specific trip.',
      'Staying in present tense instead of narrating the past.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-a2-fw-free-time',
    kind: 'free-writing',
    name: 'Boş zamanlarım',
    description:
      'A neutral prompt to describe free-time activities and hobbies, how often, and why the learner enjoys them.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks for two hobbies and how often they do them.',
      'Requires one reason why they like one of the hobbies.',
    ],
    examplesNegative: ['*List every hobby that exists.'],
    commonErrors: [
      'Frequency adverbs missing or misplaced.',
      'Listing hobbies with no reason or detail.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-a2-fw-my-city',
    kind: 'free-writing',
    name: 'Yaşadığım şehir',
    description:
      'A neutral prompt to describe the city the learner lives in: what it is like and one thing they like or would change.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks what the city is like and names one place in it.',
      'Requires one thing they like and one they would change.',
    ],
    examplesNegative: ['*Write a tourist guide to a famous city.'],
    commonErrors: [
      'Listing places with no description.',
      'Locative/ablative case errors with place names.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-b1-fw-an-opinion',
    kind: 'free-writing',
    name: 'Bir konudaki görüşüm',
    description:
      'A neutral prompt to state and justify an opinion on a familiar topic in a short paragraph, giving at least one reason.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks the learner to pick a familiar topic and state their opinion (Bence…).',
      'Requires at least one supporting reason (çünkü / bu yüzden).',
    ],
    examplesNegative: ['*Just list facts with no stated opinion.'],
    commonErrors: [
      'Listing facts without taking a position.',
      'Giving an opinion with no supporting reason.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-b1-fw-a-past-experience',
    kind: 'free-writing',
    name: 'Unutamadığım bir an',
    description:
      'A neutral prompt to narrate a memorable past experience, setting the scene with ongoing background (-(I)yordu) and recounting what happened.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks where/when it happened and to set the background scene.',
      'Requires recounting the key event and how it felt.',
    ],
    examplesNegative: ['*Describe daily routine in the present tense.'],
    commonErrors: [
      'Staying in the present instead of narrating the past.',
      'No background/scene-setting (no -(I)yordu).',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-b1-fw-a-plan-or-hope',
    kind: 'free-writing',
    name: 'Bir planım ya da hayalim',
    description:
      'A neutral prompt to describe a future plan or wish, using future/conditional forms (-(y)AcAK, -sA) and giving a reason.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Asks for one concrete plan or hope and why it matters.',
      'Requires a future or conditional form (keşke … olsa / yapacağım).',
    ],
    examplesNegative: ['*Describe what you did yesterday.'],
    commonErrors: [
      'Describing the past instead of a plan/hope.',
      'No future/conditional form.',
    ],
    freeWriting: { register: 'neutral' },
  },

  // ---------------------------------------------------------------------------
  // Paraphrase umbrellas — kind: 'paraphrase' (Phase 2 contextual-paraphrase generation)
  // ---------------------------------------------------------------------------
  {
    key: 'tr-b1-paraphrase',
    kind: 'paraphrase',
    name: 'Başka türlü söyle — paraphrase (B1)',
    description:
      'Rewrite a B1 Turkish sentence under one constraint: avoid a given word, shift register, or simplify for an audience — preserving meaning while reaching for synonyms and alternative structures.',
    cefrLevel: B1,
    language: TR,
    examplesPositive: [
      'Source "Bu filmi çok beğendim" → without «beğenmek»: "Bu film gerçekten hoşuma gitti."',
      'Source "Tuzu uzatır mısın?" → formal register: "Tuzu uzatabilir misiniz acaba?"',
    ],
    examplesNegative: ['*A rewrite that changes the meaning of the source.'],
    commonErrors: [
      'Using a banned word in a different suffixed form.',
      'Changing register but also changing what is said.',
    ],
    paraphrase: {
      seeds: [
        'bargaining with a vendor at a bazaar',
        'asking a neighbour for help moving furniture',
        'describing how a national holiday is celebrated at home',
        'complaining about a noisy neighbour upstairs',
        'asking a pharmacist for advice about a headache',
        'turning down a wedding invitation',
        'negotiating the price of a taxi ride',
        'explaining a family tradition to a foreign friend',
        'asking a shopkeeper to hold an item until payday',
        'describing a power outage that ruined an evening',
        'convincing a friend to try a new dish',
        'explaining why you missed a family gathering',
        'asking a landlord to fix a broken heater before winter',
        'describing the atmosphere of a crowded tea house',
      ],
    },
  },
];

export { trCurriculum };
export default trCurriculum;
