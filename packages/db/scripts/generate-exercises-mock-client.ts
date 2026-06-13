/**
 * Fixture-driven mock for `client.messages.create` used when `MOCK_CLAUDE=1`
 * is set. Lets the CLI run end-to-end without a Claude credential or network.
 *
 * Two dispatch paths share one mock client:
 *
 * 1. **Generator** (`tool_choice.name` is one of `submit_<type>_exercise`):
 *    Cycles `__fixtures__/claude-generation/<type>.json`, returning each
 *    entry by ordinal-mod-length. Used by Phase 2's CLI under `MOCK_CLAUDE=1`.
 * 2. **Validator** (`tool_choice.name === VALIDATION_TOOL_NAME`):
 *    Detects the exercise type from the user message body (the validator's
 *    user prompt header names it — see `buildValidationUserPrompt`) and
 *    returns one of `__fixtures__/claude-validation/<type>-<outcome>.json`
 *    where `<outcome>` is selected per-call by the optional
 *    `MOCK_VALIDATION_OUTCOMES` env var. The env var maps the validator-call
 *    ordinal (as a string key) to one of `'approved' | 'flagged' | 'rejected'`;
 *    missing entries default to `'approved'`. Phase 3.
 *
 * Token usage is modeled per-side: the generator and validator each get their
 * own `*TotalCalls` counter so cache-write fires on each side's first call
 * and cache-read on subsequent calls — matching real prompt caching, where
 * the two paths have different system prompts and so different cache entries.
 *
 * Usage token shape:
 *   - First call (per side): input_tokens=1500, cache_creation=0, cache_read=0, output=400
 *   - Subsequent (per side): input_tokens=100, cache_creation=0, cache_read=1400, output=400
 *
 * The fixture cache is *instance-scoped* (Map allocated inside the function)
 * so each call to createMockAnthropicClient reads its fixtures fresh — this
 * lets the failure-path tests point `MOCK_CLAUDE_FIXTURES_DIR` at a temp dir
 * with a malformed cloze.json without leaking the cache from a prior test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import {
  GENERATION_MODEL,
  TOOL_NAME_BY_TYPE,
  VALIDATION_TOOL_NAME,
} from '@language-drill/ai';
import { ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Reverse lookup: tool name → ExerciseType (generator branch)
// ---------------------------------------------------------------------------

const TYPE_BY_TOOL_NAME: ReadonlyMap<string, ExerciseType> = new Map(
  (Object.entries(TOOL_NAME_BY_TYPE) as [ExerciseType, string][]).map(
    ([type, name]) => [name, type] as const,
  ),
);

// ---------------------------------------------------------------------------
// Fixture loading (cache scoped to each client instance)
// ---------------------------------------------------------------------------

type FixtureInput = Record<string, unknown>;

const FIXTURE_FILENAME_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    [ExerciseType.CLOZE]: 'cloze.json',
    [ExerciseType.TRANSLATION]: 'translation.json',
    [ExerciseType.VOCAB_RECALL]: 'vocab_recall.json',
    [ExerciseType.SENTENCE_CONSTRUCTION]: 'sentence_construction.json',
  });

function defaultFixturesDir(): string {
  return fileURLToPath(new URL('./__fixtures__/claude-generation/', import.meta.url));
}

function defaultValidationFixturesDir(): string {
  return fileURLToPath(
    new URL('./__fixtures__/claude-validation/', import.meta.url),
  );
}

// ---------------------------------------------------------------------------
// Validator outcome handling
// ---------------------------------------------------------------------------

type ValidationOutcome = 'approved' | 'flagged' | 'rejected';

const VALID_OUTCOMES: ReadonlySet<ValidationOutcome> = new Set([
  'approved',
  'flagged',
  'rejected',
]);

/**
 * Optional `MOCK_VALIDATION_THROW_ORDINAL` env var. When set to an integer N,
 * the mock validator throws on the validator call with that ordinal (0-based).
 * Used by Task 25's validator-failure integration test to drive `runOneCell`
 * down its catch path. Off by default.
 */
function parseValidationThrowOrdinal(): number | null {
  const raw = process.env['MOCK_VALIDATION_THROW_ORDINAL'];
  if (raw === undefined || raw === '') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(
      `MOCK_VALIDATION_THROW_ORDINAL must be an integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

/**
 * Optional `MOCK_VALIDATION_MALFORM_ORDINAL` env var. When set to an integer N,
 * the mock validator RETURNS a tool call with a malformed input (missing the
 * load-bearing `qualityScore`) on the validator call with that ordinal. Unlike
 * `MOCK_VALIDATION_THROW_ORDINAL` (a transport-style throw), this drives
 * `parseValidationResult` to raise `ValidationParseError`, exercising the R8
 * validator-pool isolation path. Off by default.
 */
function parseValidationMalformOrdinal(): number | null {
  const raw = process.env['MOCK_VALIDATION_MALFORM_ORDINAL'];
  if (raw === undefined || raw === '') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(
      `MOCK_VALIDATION_MALFORM_ORDINAL must be an integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

/**
 * Optional `MOCK_VALIDATION_PERSONS` env var (Phase 1 coverage controller).
 * Maps a SUBSTRING of the validator's user prompt (e.g. the draft's
 * `correctAnswer`) to a `PersonCode`, injected as `coverage.person` into that
 * draft's returned validation fixture. Keyed on draft content — NOT call
 * ordinal — so the realized person is stable regardless of the parallel
 * validator pool's non-deterministic dispatch order (the same property that
 * makes ordinal-keyed coupling unreliable). Lets a test drive a distinct
 * realized person per draft so `run-one-cell`'s per-person `coverage_outcome`
 * tally can be exercised end-to-end. Coverage is non-load-bearing, so values
 * pass through verbatim — `coerceCoverage` (validate.ts) drops anything not in
 * the person enum.
 */
function parseValidationPersons(): Record<string, string> {
  const raw = process.env['MOCK_VALIDATION_PERSONS'];
  if (raw === undefined || raw === '') return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(
        `MOCK_VALIDATION_PERSONS['${key}']: must be a string PersonCode, got ${JSON.stringify(value)}`,
      );
    }
    out[key] = value;
  }
  return out;
}

function parseValidationOutcomes(): Record<string, ValidationOutcome> {
  const raw = process.env['MOCK_VALIDATION_OUTCOMES'];
  if (raw === undefined || raw === '') return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // Defensive: ensure every value is a known outcome string.
  const out: Record<string, ValidationOutcome> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !VALID_OUTCOMES.has(value as ValidationOutcome)) {
      throw new Error(
        `MOCK_VALIDATION_OUTCOMES['${key}']: must be 'approved' | 'flagged' | 'rejected', got ${JSON.stringify(value)}`,
      );
    }
    out[key] = value as ValidationOutcome;
  }
  return out;
}

const VALIDATION_HEADER_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    [ExerciseType.CLOZE]: '## Validate this Cloze exercise',
    [ExerciseType.TRANSLATION]: '## Validate this Translation exercise',
    [ExerciseType.VOCAB_RECALL]: '## Validate this Vocabulary Recall exercise',
    [ExerciseType.SENTENCE_CONSTRUCTION]: '## Validate this Sentence Construction exercise',
  });

function detectExerciseTypeFromUserMessage(content: string): ExerciseType {
  for (const type of Object.values(ExerciseType)) {
    if (content.includes(VALIDATION_HEADER_BY_TYPE[type])) return type;
  }
  throw new Error(
    `mock validator: cannot detect ExerciseType from user message header. First 200 chars: ${content.slice(0, 200)}`,
  );
}

// ---------------------------------------------------------------------------
// Usage shapes — extracted so generator and validator branches share one
// definition. Each side maintains its own first-call boolean.
// ---------------------------------------------------------------------------

const CACHE_WRITE_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 1500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 400,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

const CACHE_READ_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 1400,
  output_tokens: 400,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

function makeUsage(isFirstCall: boolean): Anthropic.Messages.Usage {
  return isFirstCall ? CACHE_WRITE_USAGE : CACHE_READ_USAGE;
}

// ---------------------------------------------------------------------------
// createMockAnthropicClient
// ---------------------------------------------------------------------------

export function createMockAnthropicClient(): Anthropic {
  const fixturesDir =
    process.env['MOCK_CLAUDE_FIXTURES_DIR'] ?? defaultFixturesDir();
  const validationFixturesDir =
    process.env['MOCK_CLAUDE_VALIDATION_FIXTURES_DIR'] ??
    defaultValidationFixturesDir();
  const fixtureCache = new Map<ExerciseType, FixtureInput[]>();
  const validationFixtureCache = new Map<string, FixtureInput>();

  const loadFixtures = (type: ExerciseType): FixtureInput[] => {
    const cached = fixtureCache.get(type);
    if (cached) return cached;
    const filename = FIXTURE_FILENAME_BY_TYPE[type];
    const path = `${fixturesDir.replace(/\/?$/, '/')}${filename}`;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureInput[];
    fixtureCache.set(type, parsed);
    return parsed;
  };

  const loadValidationFixture = (
    type: ExerciseType,
    outcome: ValidationOutcome,
  ): FixtureInput => {
    const filename = `${type}-${outcome}.json`;
    const cached = validationFixtureCache.get(filename);
    if (cached) return cached;
    const path = `${validationFixturesDir.replace(/\/?$/, '/')}${filename}`;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureInput;
    validationFixtureCache.set(filename, parsed);
    return parsed;
  };

  // Generator counters (per-type ordinal + global cache-state).
  const counters: Record<ExerciseType, number> = {
    [ExerciseType.CLOZE]: 0,
    [ExerciseType.TRANSLATION]: 0,
    [ExerciseType.VOCAB_RECALL]: 0,
    [ExerciseType.SENTENCE_CONSTRUCTION]: 0,
  };
  let generatorTotalCalls = 0;

  // Validator counters (independent of generator per task: "validator usage
  // should be its OWN counter — first validator call in a batch is its own
  // cache-write").
  let validatorCallOrdinal = 0;
  let validatorTotalCalls = 0;

  const create = async (
    args: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> => {
    const toolChoice = args.tool_choice;
    if (
      !toolChoice ||
      toolChoice.type !== 'tool' ||
      typeof toolChoice.name !== 'string'
    ) {
      throw new Error(
        "mock client requires args.tool_choice = { type: 'tool', name: <string> }",
      );
    }

    // -- Validator branch -------------------------------------------------
    if (toolChoice.name === VALIDATION_TOOL_NAME) {
      const userMessage = args.messages?.[0]?.content;
      if (typeof userMessage !== 'string') {
        throw new Error(
          'mock validator: args.messages[0].content must be a string',
        );
      }
      const exerciseType = detectExerciseTypeFromUserMessage(userMessage);

      const throwOrdinal = parseValidationThrowOrdinal();
      if (throwOrdinal !== null && throwOrdinal === validatorCallOrdinal) {
        // Bump the counter so a re-set of the env var in a follow-up test
        // doesn't re-fire on the same ordinal.
        const failingOrdinal = validatorCallOrdinal;
        validatorCallOrdinal += 1;
        throw new Error(
          `Mock validator: synthetic failure on ordinal ${failingOrdinal}`,
        );
      }

      const malformOrdinal = parseValidationMalformOrdinal();
      if (malformOrdinal !== null && malformOrdinal === validatorCallOrdinal) {
        // R8 — return a well-formed tool call whose INPUT omits the load-bearing
        // `qualityScore`, so `parseValidationResult` raises `ValidationParseError`.
        // `runValidatorPool` isolates this to the ordinal (→ rejected) instead of
        // failing the whole cell closed.
        const ord = validatorCallOrdinal;
        validatorCallOrdinal += 1;
        validatorTotalCalls += 1;
        const usage = makeUsage(validatorTotalCalls === 1);
        const malformed: Anthropic.Message = {
          id: `msg_mock_v_${validatorTotalCalls}`,
          type: 'message',
          role: 'assistant',
          model: GENERATION_MODEL,
          content: [
            {
              type: 'tool_use',
              id: `toolu_mock_v_${ord}`,
              name: VALIDATION_TOOL_NAME,
              input: {
                // qualityScore intentionally omitted (load-bearing field).
                ambiguous: false,
                contextSpoilsAnswer: false,
                levelMatch: true,
                grammarPointMatch: true,
                culturalIssues: [],
                flaggedReasons: [],
              },
              caller: { type: 'direct' },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          stop_details: null,
          usage,
          container: null,
        };
        return malformed;
      }

      const outcomes = parseValidationOutcomes();
      const outcome = outcomes[String(validatorCallOrdinal)] ?? 'approved';
      // Person is keyed on a substring of THIS draft's user prompt (content),
      // so it tracks the draft regardless of the pool's dispatch order.
      const persons = parseValidationPersons();
      const person = Object.entries(persons).find(([needle]) =>
        userMessage.includes(needle),
      )?.[1];
      const ordinal = validatorCallOrdinal;
      validatorCallOrdinal += 1;

      const baseFixture = loadValidationFixture(exerciseType, outcome);
      // Realized-person injection keyed on a substring of the draft's
      // correctAnswer (see parseValidationPersons), so it tracks the draft
      // regardless of the parallel validator pool's dispatch order. Copy so
      // the cached fixture object is never mutated; merge `coverage.person`
      // only when the env var supplies a person for this draft.
      const fixture =
        person !== undefined
          ? {
              ...baseFixture,
              coverage: {
                ...(baseFixture['coverage'] as
                  | Record<string, unknown>
                  | undefined),
                person,
              },
            }
          : baseFixture;

      validatorTotalCalls += 1;
      const usage = makeUsage(validatorTotalCalls === 1);

      const message: Anthropic.Message = {
        id: `msg_mock_v_${validatorTotalCalls}`,
        type: 'message',
        role: 'assistant',
        model: GENERATION_MODEL,
        content: [
          {
            type: 'tool_use',
            id: `toolu_mock_v_${ordinal}`,
            name: VALIDATION_TOOL_NAME,
            input: fixture,
            caller: { type: 'direct' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        stop_details: null,
        usage,
        container: null,
      };
      return message;
    }

    // -- Generator branch -------------------------------------------------
    const exerciseType = TYPE_BY_TOOL_NAME.get(toolChoice.name);
    if (!exerciseType) {
      throw new Error(
        `mock client: unknown tool name '${toolChoice.name}' (no matching ExerciseType)`,
      );
    }

    const fixtures = loadFixtures(exerciseType);
    const ordinal = counters[exerciseType];
    counters[exerciseType] = ordinal + 1;
    const fixture = fixtures[ordinal % fixtures.length];

    generatorTotalCalls += 1;
    const usage = makeUsage(generatorTotalCalls === 1);

    const message: Anthropic.Message = {
      id: `msg_mock_${generatorTotalCalls}`,
      type: 'message',
      role: 'assistant',
      model: GENERATION_MODEL,
      content: [
        {
          type: 'tool_use',
          id: `toolu_mock_${generatorTotalCalls}`,
          name: toolChoice.name,
          input: fixture,
          caller: { type: 'direct' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      stop_details: null,
      usage,
      container: null,
    };
    return message;
  };

  return {
    messages: { create },
  } as unknown as Anthropic;
}
