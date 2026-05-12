/**
 * Fixture-driven mock for `client.messages.create` used by `pnpm
 * generate:theory` when `MOCK_CLAUDE=1` is set. Lets the CLI integration
 * test (Task 21) run end-to-end without a Claude credential or network.
 *
 * Single dispatch: theory generation has no validator pass (Req 7.4) — so
 * `tool_choice.name` is expected to equal `THEORY_TOOL_NAME` for every
 * call. The mock cycles `__fixtures__/claude-theory-generation/*.json`
 * by ordinal-mod-length and returns each fixture as the tool input.
 *
 * Token usage models prompt caching: the first call is a cache write
 * (input_tokens: 3000, cache_read: 0); every subsequent call is a cache
 * read (input_tokens: 100, cache_read: 2900) so cost-cap and summary
 * arithmetic can be exercised under realistic shapes.
 *
 * Structural mirror of `generate-exercises-mock-client.ts`, minus the
 * per-`ExerciseType` fixture map and validator branch.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Anthropic from '@anthropic-ai/sdk';
import { THEORY_TOOL_NAME } from '@language-drill/ai';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function defaultFixturesDir(): string {
  return fileURLToPath(
    new URL('./__fixtures__/claude-theory-generation/', import.meta.url),
  );
}

function loadFixtures(dir: string): unknown[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const out = files.map(
    (f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as unknown,
  );
  if (out.length === 0) {
    throw new Error(
      `createTheoryMockClient: no .json fixtures found in ${dir}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Usage shapes
// ---------------------------------------------------------------------------

const CACHE_WRITE_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 3000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 2500,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

const CACHE_READ_USAGE: Anthropic.Messages.Usage = {
  input_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 2900,
  output_tokens: 2500,
  cache_creation: null,
  inference_geo: null,
  server_tool_use: null,
  service_tier: null,
};

// ---------------------------------------------------------------------------
// createTheoryMockClient
// ---------------------------------------------------------------------------

export function createTheoryMockClient(): Anthropic {
  const dir =
    process.env['MOCK_THEORY_FIXTURES_DIR'] ?? defaultFixturesDir();

  // Lazy load so callers can set MOCK_THEORY_FIXTURES_DIR after construction
  // (the orchestrator test in Task 11 points the env var at a temp dir with
  // a deliberately malformed fixture).
  let fixtures: unknown[] | null = null;
  let callCount = 0;

  const create = async (
    request: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> => {
    if (fixtures === null) {
      fixtures = loadFixtures(dir);
    }

    const toolChoice = request.tool_choice as
      | { type: 'tool'; name: string }
      | undefined;
    const toolName = toolChoice?.name;
    if (toolName !== THEORY_TOOL_NAME) {
      throw new Error(
        `createTheoryMockClient: unexpected tool name ${toolName}`,
      );
    }

    const fixture = fixtures[callCount % fixtures.length];
    callCount += 1;

    const isFirst = callCount === 1;
    const usage = isFirst ? CACHE_WRITE_USAGE : CACHE_READ_USAGE;

    const message: Anthropic.Message = {
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_mock',
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
