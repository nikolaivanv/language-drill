import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 4 ships @aws-sdk/client-sqs in two consumers: the generation Lambda
// (`infra/lambda`) and the CLI's `--queue` mode (`packages/db`). They MUST pin
// the same major version — a silent drift would mean the CLI builds messages
// with one SDK version while the Lambda parses them with another, surfacing
// only at runtime. This test fails the next time `pnpm up @aws-sdk/client-sqs`
// bumps one without the other.

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAMBDA_PKG = join(__dirname, '../../package.json');
const DB_PKG = join(__dirname, '../../../../packages/db/package.json');

function readSqsClientMajor(pkgJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const raw = pkg.dependencies?.['@aws-sdk/client-sqs'];
  if (!raw) {
    throw new Error(`@aws-sdk/client-sqs missing from dependencies in ${pkgJsonPath}`);
  }
  // Strip caret/tilde then take the leading major.
  return raw.replace(/^[\^~]/, '').split('.')[0];
}

describe('@aws-sdk/client-sqs version parity (Req 3.9)', () => {
  it('pins the same major version in infra/lambda and packages/db', () => {
    const lambdaMajor = readSqsClientMajor(LAMBDA_PKG);
    const dbMajor = readSqsClientMajor(DB_PKG);
    expect(lambdaMajor).toBe(dbMajor);
  });
});
