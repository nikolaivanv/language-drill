/**
 * Fixture-driven mock for `client.messages.create` used by `pnpm
 * generate:theory` when `MOCK_CLAUDE=1` is set. Lets the CLI integration
 * test (Task 21) and the orchestrator integration tests (Task 12) run
 * end-to-end without a Claude credential or network.
 *
 * Phase 3 dispatch: theory has two Claude call types per cell (generator
 * + validator). The mock branches on `tool_choice.name`:
 *
 *   - `THEORY_TOOL_NAME` → next fixture from
 *     `__fixtures__/claude-theory-generation/`
 *   - `THEORY_VALIDATION_TOOL_NAME` → next fixture from
 *     `__fixtures__/claude-theory-validation/`
 *
 * Each stream owns its own ordinal counter so the generator's and the
 * validator's fixture lists don't interleave surprisingly. Fixture lists
 * are loaded lazily on first use, so tests can override either directory
 * via `MOCK_THEORY_FIXTURES_DIR` / `MOCK_THEORY_VALIDATION_FIXTURES_DIR`
 * after constructing the client.
 *
 * Token usage:
 *
 *   - Generator: first call is a cache write (input_tokens: 3000,
 *     cache_read: 0); subsequent calls are cache reads (input_tokens: 100,
 *     cache_read: 2900). Preserves the Phase 2 shape so cost-cap and
 *     summary arithmetic see realistic numbers.
 *   - Validator: every call is a cache write
 *     (input_tokens: 4000, cache_creation_input_tokens: 0,
 *     cache_read_input_tokens: 0, output_tokens: 200). The validator's
 *     system prompt is `cache_control`-tagged in production but Phase 3
 *     generates one draft per cell, so the prompt cache is effectively
 *     cold on every validator call (design Non-Functional § Performance).
 *     Modelling that here keeps cost estimates honest in the mock.
 *
 * Structural mirror of `generate-exercises-mock-client.ts`'s
 * generator-vs-validator dispatch, simplified — theory has one generator
 * tool name (no per-`ExerciseType` fan-out) and one validator tool name.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import {
  THEORY_TOOL_NAME,
  THEORY_VALIDATION_TOOL_NAME,
} from '@language-drill/ai';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function defaultGenerationFixturesDir(): string {
  return fileURLToPath(
    new URL('./__fixtures__/claude-theory-generation/', import.meta.url),
  );
}

function defaultValidationFixturesDir(): string {
  return fileURLToPath(
    new URL('./__fixtures__/claude-theory-validation/', import.meta.url),
  );
}

function loadFixtures(dir: string, kind: 'generation' | 'validation'): unknown[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out = files.map(
    (f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as unknown,
  );
  if (out.length === 0) {
    throw new Error(
      `createTheoryMockClient: no .json ${kind} fixtures found in ${dir}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Usage shapes
// ---------------------------------------------------------------------------

const GENERATION_CACHE_WRITE_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 3000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 2500,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

const GENERATION_CACHE_READ_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 2900,
  output_tokens: 2500,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

/**
 * Validator usage: small, cache-cold every call. The validator's system
 * prompt is cache-keyed but theory generates one draft per cell, so the
 * cache hit rate is effectively zero in Phase 3 (design Non-Functional §
 * Performance). The mock reflects that rather than pretending caching is
 * helping.
 */
const VALIDATION_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 4000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 200,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

// ---------------------------------------------------------------------------
// createTheoryMockClient
// ---------------------------------------------------------------------------

export function createTheoryMockClient(): Anthropic {
  const generationDir =
    process.env['MOCK_THEORY_FIXTURES_DIR'] ?? defaultGenerationFixturesDir();
  const validationDir =
    process.env['MOCK_THEORY_VALIDATION_FIXTURES_DIR'] ??
    defaultValidationFixturesDir();

  // Lazy load so callers can set the env vars after construction (the
  // orchestrator tests in Task 12 point them at temp dirs with
  // deliberately malformed or out-of-order fixtures).
  let generationFixtures: unknown[] | null = null;
  let validationFixtures: unknown[] | null = null;
  let generationCallCount = 0;
  let validationCallCount = 0;

  const create = async (
    request: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> => {
    const toolChoice = request.tool_choice as
      | { type: 'tool'; name: string }
      | undefined;
    const toolName = toolChoice?.name;

    // -- Validator branch ----------------------------------------------------
    if (toolName === THEORY_VALIDATION_TOOL_NAME) {
      if (validationFixtures === null) {
        validationFixtures = loadFixtures(validationDir, 'validation');
      }
      const fixture =
        validationFixtures[validationCallCount % validationFixtures.length];
      validationCallCount += 1;

      const message: Anthropic.Message = {
        id: `msg_mock_v_${validationCallCount}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [
          {
            type: 'tool_use',
            id: `toolu_mock_v_${validationCallCount}`,
            name: THEORY_VALIDATION_TOOL_NAME,
            input: fixture as Record<string, unknown>,
            caller: { type: 'direct' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        stop_details: null,
        usage: VALIDATION_USAGE,
        container: null,
      };
      return message;
    }

    // -- Generator branch ----------------------------------------------------
    if (toolName !== THEORY_TOOL_NAME) {
      throw new Error(
        `createTheoryMockClient: unexpected tool name ${toolName}`,
      );
    }
    if (generationFixtures === null) {
      generationFixtures = loadFixtures(generationDir, 'generation');
    }
    const fixture =
      generationFixtures[generationCallCount % generationFixtures.length];
    generationCallCount += 1;

    const isFirst = generationCallCount === 1;
    const usage = isFirst
      ? GENERATION_CACHE_WRITE_USAGE
      : GENERATION_CACHE_READ_USAGE;

    const message: Anthropic.Message = {
      id: `msg_mock_g_${generationCallCount}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [
        {
          type: 'tool_use',
          id: `toolu_mock_g_${generationCallCount}`,
          name: THEORY_TOOL_NAME,
          input: fixture as Record<string, unknown>,
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

  return { messages: { create } } as unknown as Anthropic;
}
