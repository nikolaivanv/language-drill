/**
 * Phase 4 break-the-cycle: the `GrammarPoint` and `CurriculumCefrLevel` types
 * live here in `@language-drill/shared` (rather than in `@language-drill/db`)
 * so `@language-drill/ai` can reference them without depending on `db`. The
 * curriculum DATA (`esCurriculum`, `getGrammarPoint`, etc.) still lives in
 * `db`, where it's read alongside the Drizzle schema.
 *
 * Pre-Phase-4 these types lived in `packages/db/src/curriculum/types.ts`;
 * that file now re-exports from this module for back-compat.
 */

import type { CefrLevel } from './index';
import type { LearningLanguage } from './onboarding';
import type { CoverageSpec } from './coverage';

/**
 * The CEFR levels covered by the round-1 curriculum. C1/C2 are intentionally
 * out of scope per Requirement 1.4 — extend this when higher levels ship.
 */
export type CurriculumCefrLevel = Extract<CefrLevel, 'A1' | 'A2' | 'B1' | 'B2'>;

/**
 * One entry in the per-language curriculum: the typed contract every
 * `curriculum/{es,de,tr}.ts` module compiles against and the Phase 2 generator
 * imports as plain data.
 *
 * Frozen-shape `Readonly<...>` so consumers cannot mutate cross-module state at
 * runtime. The `kind` discriminator branches the generator's prompt strategy:
 *
 *   - `'grammar'` — a real grammar point. Phase 2 prompt builders inject
 *     `description`, `examplesPositive`, `examplesNegative`, and `commonErrors`
 *     verbatim into the system prompt.
 *   - `'vocab'`   — a frequency-band umbrella entry that covers vocab-recall
 *     cells for a given (language, level). Phase 1 needs these so every non-EN
 *     seed exercise can be tagged with a non-null `grammar_point_key`
 *     (Requirement 5.3). Phase 2's vocab path will eventually replace the
 *     umbrellas with finer-grained frequency-band rows; until then, the
 *     discriminator — *not* a string-suffix sniff against the `key` — is what
 *     downstream code branches on.
 *   - `'dictation'` — a synthetic per-(language, level) umbrella that owns the
 *     dictation generation cell. Carries no real grammar-point semantics; its
 *     description / examples feed the dictation generation prompt as theme +
 *     style guidance. Paired only with `ExerciseType.DICTATION` by
 *     `compatibleTypes()`. No `coverageSpec` (count-only).
 *   - `'free-writing'` — a curated `(language, level, topic)` umbrella that owns
 *     ONE free-writing generation cell. Carries no grammar-point semantics; its
 *     name/description/examples frame the topic for the generation prompt, and its
 *     `freeWriting.register` sets the target register. Paired only with
 *     `ExerciseType.FREE_WRITING` by `compatibleTypes()`. No `coverageSpec`.
 */
export type GrammarPoint = Readonly<{
  /** Stable identifier; format: `<lang>-<level>-<slug>`, e.g. `'es-b1-present-subjunctive'`. */
  key: string;
  kind: 'grammar' | 'vocab' | 'dictation' | 'free-writing';
  name: string;
  /** ≤ 300 chars; English; injected verbatim into Phase 2 prompts. */
  description: string;
  cefrLevel: CurriculumCefrLevel;
  language: LearningLanguage;
  /** ≥ 2 items; canonical correct production examples. */
  examplesPositive: readonly string[];
  /** ≥ 1 item; incorrect production marked with leading `*`. */
  examplesNegative: readonly string[];
  /** ≥ 1 item; common L2 errors learners make on this point. */
  commonErrors: readonly string[];
  /** Same-language curriculum keys this point depends on. Empty array permitted. */
  prerequisiteKeys?: readonly string[];
  /**
   * Optional per-cell distinct-exercise ceiling. Overrides the
   * `(exerciseType, cefrLevel)` default in the scheduler's target resolver
   * (`resolveCellTarget`). Set this for narrow points whose realistic supply
   * of distinct exercises is well below the global default — so the scheduler
   * stops topping up at a reachable number instead of grinding unreachable
   * targets into dedup waste.
   */
  targetOverride?: number;
  /**
   * Optional opt-in that suppresses the `cloze` cell for this point in
   * `enumerateCurriculumCells` (the point still gets its `translation` cell).
   * Set this for clause-linking / bipartite constructions where cloze is
   * structurally unsuited: the blank's answer is leaked by the other half of
   * the construction, or near-synonym alternants both fit the blank (e.g.
   * `koşa koşa`/`koşarak`, `gezmek`/`gezme`). Data-driven and
   * language-agnostic — only valid on `kind: 'grammar'` entries (a `vocab`
   * umbrella has no cloze cell to suppress; enforced by curriculum invariant).
   * Absent/`false` ⇒ today's behavior (grammar → `cloze` + `translation`).
   */
  clozeUnsuitable?: boolean;
  /**
   * Optional opt-in that ADDS a `sentence_construction` cell for this grammar
   * point in `enumerateCurriculumCells`. Absent/`false` ⇒ no sentence-
   * construction cell (today's behaviour). Set this for points where free
   * production of the structure is pedagogically apt. Only valid on
   * `kind: 'grammar'` entries (enforced by the curriculum invariant).
   */
  sentenceConstructionSuitable?: boolean;
  /**
   * Optional opt-in that ADDS a `conjugation` cell for this grammar point in
   * `enumerateCurriculumCells`. Absent/`false` ⇒ no conjugation cell (today's
   * behaviour). Set this for morphology-heavy points whose forms are worth
   * drilling in isolation (irregular paradigms, agglutinative suffix stacks).
   * Pair with a `coverageSpec` person axis so the drill varies person/number.
   * Only valid on `kind: 'grammar'` entries (enforced by the curriculum
   * invariant in `assertCurriculumInvariants`).
   */
  conjugationSuitable?: boolean;
  /**
   * Word class the CONJUGATION cell's seed picker draws from. Defaults to
   * `'verb'` (verb-morphology points: tense/mood/voice). Set `'noun'` on
   * NOMINAL-inflection points whose "conjugation" cell declines a noun rather
   * than conjugating a verb (possessive, case, possessive+case stacking): they
   * draw from the noun band and get the "noun to inflect" directive, so each
   * ordinal varies the lexical head and the pool no longer collapses onto a
   * handful of unseeded nouns. Set `'predicate-nominal'` on the COPULAR
   * personal-suffix point: it makes a copular sentence ("X is a <word>"), so a
   * generic object noun from the band yields a semantically odd predicate
   * ("you are a cat / a wave"). It instead draws from the curated
   * `conjugationSeedWords` pool (professions/roles/nationalities/adjectives) and
   * gets a "predicate to use" directive. `'none'` disables seeding entirely
   * (legacy escape hatch — currently unused). Only meaningful with
   * `conjugationSuitable`.
   */
  conjugationSeedKind?: 'verb' | 'noun' | 'predicate-nominal' | 'none';
  /**
   * Curated predicate pool for a `conjugationSeedKind: 'predicate-nominal'`
   * cell: professions, roles, nationalities, and predicate adjectives that form
   * natural copular sentences ("Ben doktorum", "Sen yorgunsun"). Replaces the
   * generic DB noun band, whose concrete object nouns make nonsensical copular
   * predicates. REQUIRED (non-empty) iff
   * `conjugationSeedKind === 'predicate-nominal'`; meaningless on any other kind
   * (enforced by a curriculum invariant). Each ordinal varies the predicate
   * (the lexical diversity axis); the grammatical person stays driven by
   * `coverageSpec`/`coverageTargets`.
   */
  conjugationSeedWords?: readonly string[];
  /**
   * Declarative coverage spec (Pool Coverage Controller, Phase 2) — which
   * categorical axes a diverse approved set should vary along, and an absolute
   * min approved-count floor per value. Replaces the old `personRotation` flag:
   * a person axis here is exactly the old `personRotation: true`. Drives
   * (a) which axes get tagged (`coverageAxesFor`), (b) the cell's generation
   * target (`resolveCellTarget` raises it to cover the floor sums), and (c) the
   * scheduler's per-draft coverage targeting. Authored by `propose:coverage-spec`
   * and human-reviewed. Only valid on the relevant `kind`/exercise types
   * (enforced by curriculum invariants): `wordClass` on vocab points;
   * `person`/`polarity`/`sentenceType` on grammar points.
   */
  coverageSpec?: CoverageSpec;
  /**
   * Free-writing topic config (Phase 2). REQUIRED in practice on every
   * `kind: 'free-writing'` umbrella and meaningless on any other kind: it carries
   * the author-declared register the generated prompt must target. The word band
   * + suggested minutes are NOT stored here — they are derived from the cell's
   * CEFR level via `FREE_WRITING_LENGTH_BY_CEFR` in
   * `packages/ai/src/free-writing-generation-prompts.ts`. Enforced by a curriculum
   * invariant (Task 7): present iff `kind === 'free-writing'`.
   */
  freeWriting?: { register: 'informal' | 'neutral' | 'formal' };
}>;
