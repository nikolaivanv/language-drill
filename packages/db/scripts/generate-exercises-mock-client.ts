/**
 * Fixture-driven mock for `client.messages.create` used when `MOCK_CLAUDE=1`
 * is set. Lets the CLI run end-to-end without a Claude credential or network.
 *
 * Returns a per-call canned `tool_use` block by reverse-looking-up the
 * exercise type from `args.tool_choice.name`, then cycling the matching
 * fixture file (3 entries per type, see `__fixtures__/claude-generation/`).
 *
 * Usage token shape models real Anthropic billing:
 *   - Call 1: input_tokens=1500, cache_creation=0, cache_read=0, output=400
 *     (system prompt is the cache-write on the first call)
 *   - Call 2+: input_tokens=100, cache_creation=0, cache_read=1400, output=400
 *     (subsequent calls hit the cache)
 *
 * The cache-write/read split mirrors what real prompt caching produces, so
 * Task 20's integration tests can assert the cost arithmetic plumbs through
 * `cost-model.ts` without contacting Anthropic.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import { GENERATION_MODEL, TOOL_NAME_BY_TYPE } from '@language-drill/ai';
import { ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Reverse lookup: tool name → ExerciseType
// ---------------------------------------------------------------------------

const TYPE_BY_TOOL_NAME: ReadonlyMap<string, ExerciseType> = new Map(
  (Object.entries(TOOL_NAME_BY_TYPE) as [ExerciseType, string][]).map(
    ([type, name]) => [name, type] as const,
  ),
);

// ---------------------------------------------------------------------------
// Fixture loading (cache scoped to each client instance — see below)
// ---------------------------------------------------------------------------

type FixtureInput = Record<string, unknown>;

const FIXTURE_FILENAME_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    [ExerciseType.CLOZE]: 'cloze.json',
    [ExerciseType.TRANSLATION]: 'translation.json',
    [ExerciseType.VOCAB_RECALL]: 'vocab_recall.json',
  });

function defaultFixturesDir(): string {
  return fileURLToPath(new URL('./__fixtures__/claude-generation/', import.meta.url));
}

// ---------------------------------------------------------------------------
// createMockAnthropicClient
//
// The fixture cache is *instance-scoped* (Map allocated inside the function)
// so each call to createMockAnthropicClient reads its fixtures fresh — this is
// what lets Task 20's failure-path test point MOCK_CLAUDE_FIXTURES_DIR at a
// temp dir with a malformed cloze.json without leaking the cache from a prior
// test that used the default fixtures.
// ---------------------------------------------------------------------------

export function createMockAnthropicClient(): Anthropic {
  const fixturesDir =
    process.env['MOCK_CLAUDE_FIXTURES_DIR'] ?? defaultFixturesDir();
  const fixtureCache = new Map<ExerciseType, FixtureInput[]>();

  const loadFixtures = (type: ExerciseType): FixtureInput[] => {
    const cached = fixtureCache.get(type);
    if (cached) return cached;
    const filename = FIXTURE_FILENAME_BY_TYPE[type];
    const path = `${fixturesDir.replace(/\/?$/, '/')}${filename}`;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FixtureInput[];
    fixtureCache.set(type, parsed);
    return parsed;
  };

  const counters: Record<ExerciseType, number> = {
    [ExerciseType.CLOZE]: 0,
    [ExerciseType.TRANSLATION]: 0,
    [ExerciseType.VOCAB_RECALL]: 0,
  };
  let totalCalls = 0;

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

    totalCalls += 1;
    const isFirstCall = totalCalls === 1;

    const usage: Anthropic.Messages.Usage = isFirstCall
      ? {
          input_tokens: 1500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 400,
          cache_creation: null,
          inference_geo: null,
          server_tool_use: null,
          service_tier: null,
        }
      : {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1400,
          output_tokens: 400,
          cache_creation: null,
          inference_geo: null,
          server_tool_use: null,
          service_tier: null,
        };

    const message: Anthropic.Message = {
      id: `msg_mock_${totalCalls}`,
      type: 'message',
      role: 'assistant',
      model: GENERATION_MODEL,
      content: [
        {
          type: 'tool_use',
          id: `toolu_mock_${totalCalls}`,
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
