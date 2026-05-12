import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 4 (theory) — pin the SQS client to the v3 major. The theory pipeline
// reads `@aws-sdk/client-sqs` from the same `infra/lambda/package.json` as
// the exercise pipeline; the exercise-side `aws-sdk-version.test.ts` already
// enforces cross-package major parity with `packages/db`. This mirror pins
// the major itself so an accidental downgrade or pre-v3 reintroduction
// fails at test time, not at deploy time.

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAMBDA_PKG = join(__dirname, '../../package.json');

describe('@aws-sdk/client-sqs major version pin (Req 8.3)', () => {
  it('infra/lambda pins @aws-sdk/client-sqs at ^3.x', () => {
    const pkg = JSON.parse(readFileSync(LAMBDA_PKG, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const range = pkg.dependencies?.['@aws-sdk/client-sqs'];
    expect(range).toBeDefined();
    expect(range).toMatch(/^\^3\./);
  });
});
