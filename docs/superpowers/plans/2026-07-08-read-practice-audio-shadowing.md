# Read Practice — Listen & Shadow (Audio Playback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Listen" control to a read-practice passage that plays the whole passage as one AWS Polly–synthesized MP3, synthesized lazily on first play and cached in S3, reusing the existing `<AudioPlayer>`.

**Architecture:** A new `POST /read/:entryId/audio` endpoint on the main API Lambda loads the caller's passage, resolves a neural voice, computes a content-addressed S3 key (`reading/<sha256(lang|voice|text)>.mp3`), synthesizes with Polly only if the object doesn't already exist (cross-user dedup), persists the key on `read_entries`, and returns a presigned URL. All non-trivial logic lives in a pure, dependency-injected service (`resolveReadAudio`) so the route stays thin and the logic is unit-tested without DB-chain mocking.

**Tech Stack:** Hono (Lambda), Drizzle ORM (Neon Postgres), AWS Polly + S3 (`@aws-sdk/client-polly`, `@aws-sdk/client-s3`), TanStack Query (api-client), Next.js/React (web), AWS CDK (infra), Vitest.

## Global Constraints

- Read practice supports **ES/DE/TR only** (`LearningLanguage = Exclude<Language, Language.EN>`; generate schema `z.enum(["ES","DE","TR"])`). No English. The reading voice map covers exactly these three.
- Content-addressed S3 key: `reading/<sha256(language + '|' + voiceId + '|' + normalizedText)>.mp3`. `normalizedText` = `text.trim().replace(/\s+/g, ' ')`.
- Polly neural char cap: **3000 chars**. Passages over the cap return a typed `too_long` result (no synth); UI disables the control.
- Metering: new `read_tts` bucket, base **50/day** (boosted 500 via the existing `BOOST_MULTIPLIER = 10`). **Only actual synths are metered** — cache hits (HeadObject found or `audioS3Key` already set) and replays are free.
- TTS is **outside** the global Claude-cost brake (`checkGlobalCapacity` is NOT called from the audio route).
- Ownership/anti-leak: unknown / cross-user / malformed-UUID entry all collapse to `404 ENTRY_NOT_FOUND` with `Cache-Control: no-store`, matching `GET /read/entries/:id`.
- After editing `packages/db` source, rebuild before running dependent tests: `pnpm --filter @language-drill/db build`.
- Pre-push gate (must be clean): `pnpm lint && pnpm typecheck && pnpm test`.
- All paths are relative to the worktree root `/Users/seal/dev/language-drill/.claude/worktrees/feat+read-practice-audio-shadowing`. Run all commands from there.

---

### Task 1: DB — `audioS3Key` column on `read_entries` + migration

**Files:**
- Modify: `packages/db/src/schema/read.ts` (the `readEntries` pgTable, near the `prompt` column ~line 52)
- Create (generated): `packages/db/migrations/00XX_*.sql` (next slot after `0034_es_comparatives_relevel.sql`)

**Interfaces:**
- Produces: `readEntries.audioS3Key` (nullable `text` column, DB column name `audio_s3_key`).

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/read.ts`, inside the `readEntries` `pgTable(...)` column object, add next to the other nullable text columns (mirrors `packages/db/src/schema/exercises.ts:21`):

```ts
  audioS3Key: text('audio_s3_key'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/00XX_*.sql` containing `ALTER TABLE "read_entries" ADD COLUMN "audio_s3_key" text;` and an updated `migrations/meta/` snapshot.

- [ ] **Step 3: Verify the generated SQL**

Run: `git status --short packages/db/migrations`
Expected: one new `.sql` file + modified `meta/_journal.json` and a new `meta/00XX_snapshot.json`. Open the `.sql` and confirm it is exactly the single ADD COLUMN above (no unrelated drops).

- [ ] **Step 4: Rebuild db + typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/read.ts packages/db/migrations
git commit -m "feat(db): add read_entries.audio_s3_key for read-practice audio"
```

---

### Task 2: DB — reading-audio pure helpers

**Files:**
- Create: `packages/db/src/lib/reading-audio.ts`
- Create: `packages/db/src/lib/reading-audio.test.ts`
- Modify: `packages/db/src/index.ts` (re-export the new module)

**Interfaces:**
- Produces:
  - `type ReadingAudioLanguage = 'ES' | 'DE' | 'TR'`
  - `READING_VOICE_BY_LANGUAGE: Record<ReadingAudioLanguage, { voiceId: string; languageCode: string }>`
  - `POLLY_NEURAL_MAX_CHARS = 3000`
  - `normalizePassageText(text: string): string`
  - `readingAudioKey(language: string, voiceId: string, normalizedText: string): string`
  - `estimateDurationSec(normalizedText: string): number`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/lib/reading-audio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  READING_VOICE_BY_LANGUAGE,
  POLLY_NEURAL_MAX_CHARS,
  normalizePassageText,
  readingAudioKey,
  estimateDurationSec,
} from './reading-audio';

describe('reading-audio helpers', () => {
  it('has one neural voice per read-supported language', () => {
    expect(Object.keys(READING_VOICE_BY_LANGUAGE).sort()).toEqual(['DE', 'ES', 'TR']);
    expect(READING_VOICE_BY_LANGUAGE.ES.languageCode).toBe('es-ES');
    expect(READING_VOICE_BY_LANGUAGE.DE.languageCode).toBe('de-DE');
    expect(READING_VOICE_BY_LANGUAGE.TR.languageCode).toBe('tr-TR');
  });

  it('caps at 3000 chars', () => {
    expect(POLLY_NEURAL_MAX_CHARS).toBe(3000);
  });

  it('normalizes whitespace and trims', () => {
    expect(normalizePassageText('  hola\n  mundo\t x ')).toBe('hola mundo x');
  });

  it('derives a deterministic content-addressed key', () => {
    const norm = normalizePassageText('Hola mundo');
    const a = readingAudioKey('ES', 'Lucia', norm);
    const b = readingAudioKey('ES', 'Lucia', norm);
    expect(a).toBe(b);
    expect(a).toMatch(/^reading\/[0-9a-f]{64}\.mp3$/);
  });

  it('key varies by voice and by text', () => {
    const norm = normalizePassageText('Hola mundo');
    expect(readingAudioKey('ES', 'Lucia', norm)).not.toBe(readingAudioKey('ES', 'Sergio', norm));
    expect(readingAudioKey('ES', 'Lucia', norm)).not.toBe(
      readingAudioKey('ES', 'Lucia', normalizePassageText('Adios mundo')),
    );
  });

  it('estimates duration from word count (>=1s)', () => {
    expect(estimateDurationSec('')).toBe(1);
    expect(estimateDurationSec(normalizePassageText('uno dos tres cuatro cinco'))).toBe(2); // ceil(5/2.5)
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/lib/reading-audio.test.ts`
Expected: FAIL — cannot find module `./reading-audio`.

- [ ] **Step 3: Implement the module**

Create `packages/db/src/lib/reading-audio.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * Read practice supports ES/DE/TR only (LearningLanguage excludes EN). One
 * deterministic neural Polly voice per language keeps the content-addressed
 * S3 key stable, so the same passage synthesizes exactly once across users.
 */
export type ReadingAudioLanguage = 'ES' | 'DE' | 'TR';

export const READING_VOICE_BY_LANGUAGE: Record<
  ReadingAudioLanguage,
  { voiceId: string; languageCode: string }
> = {
  ES: { voiceId: 'Lucia', languageCode: 'es-ES' },
  DE: { voiceId: 'Vicki', languageCode: 'de-DE' },
  TR: { voiceId: 'Burcu', languageCode: 'tr-TR' },
};

/** Polly SynthesizeSpeech neural billed-char cap. */
export const POLLY_NEURAL_MAX_CHARS = 3000;

/** Trim + collapse all whitespace so trivially different copies share a key. */
export function normalizePassageText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Content-addressed S3 key: identical (language, voice, text) → identical key. */
export function readingAudioKey(language: string, voiceId: string, normalizedText: string): string {
  const hash = createHash('sha256')
    .update(`${language}|${voiceId}|${normalizedText}`)
    .digest('hex');
  return `reading/${hash}.mp3`;
}

/**
 * Rough duration estimate (~2.5 words/sec neural pace). The client's <audio>
 * element self-corrects to the real duration on load, so this only needs to be
 * a sane initial label.
 */
export function estimateDurationSec(normalizedText: string): number {
  const words = normalizedText.length === 0 ? 0 : normalizedText.split(' ').length;
  return Math.max(1, Math.ceil(words / 2.5));
}
```

- [ ] **Step 4: Re-export from the package barrel**

In `packages/db/src/index.ts`, add near the other `lib` re-exports (e.g. next to the `polly-synth` export at ~line 70):

```ts
export * from './lib/reading-audio';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/lib/reading-audio.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Rebuild db (dist consumed by lambda tests)**

Run: `pnpm --filter @language-drill/db build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/lib/reading-audio.ts packages/db/src/lib/reading-audio.test.ts packages/db/src/index.ts
git commit -m "feat(db): reading-audio voice map + content-addressed key helpers"
```

---

### Task 3: Usage — register the `read_tts` bucket

**Files:**
- Modify: `infra/lambda/src/usage/limits.ts`
- Modify/Create test: `infra/lambda/src/usage/limits.test.ts` (add cases; create the file if absent)

**Interfaces:**
- Produces: `'read_tts'` as a member of `MeteredEventType`; `limitFor('read_tts', 'free') === 50`, `limitFor('read_tts', 'boosted') === 500`.

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/usage/limits.test.ts` (create it if it does not exist):

```ts
import { describe, it, expect } from 'vitest';
import { limitFor, BASE_DAILY_LIMITS } from './limits';

describe('read_tts limits', () => {
  it('meters read_tts at 50 free / 500 boosted', () => {
    expect(BASE_DAILY_LIMITS.read_tts).toBe(50);
    expect(limitFor('read_tts', 'free')).toBe(50);
    expect(limitFor('read_tts', 'boosted')).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/usage/limits.test.ts`
Expected: FAIL — `read_tts` not assignable / `BASE_DAILY_LIMITS.read_tts` is undefined.

- [ ] **Step 3: Add the bucket**

In `infra/lambda/src/usage/limits.ts`:

```ts
export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation'
  | 'read_tts'
  | 'text_generation'
  | 'writing_helper';
```

and in `BASE_DAILY_LIMITS`:

```ts
export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
  read_tts: 50,
  text_generation: 20,
  writing_helper: 50,
};
```

- [ ] **Step 4: Check for other exhaustive maps over the union**

Run: `grep -rn "MeteredEventType" infra/lambda/src packages`
Expected: only `limits.ts` declares a `Record<MeteredEventType, …>`. If any other exhaustive `Record`/switch appears, add a `read_tts` arm there too. (The `usage_events.event_type` column is free-text, so no DB enum to change.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/usage/limits.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/usage/limits.ts infra/lambda/src/usage/limits.test.ts
git commit -m "feat(usage): add read_tts metered bucket (50/500)"
```

---

### Task 4: Lambda — Polly/S3 synth + head-object helpers

**Files:**
- Create: `infra/lambda/src/lib/reading-audio-synth.ts`
- Create: `infra/lambda/src/lib/reading-audio-synth.test.ts`

**Interfaces:**
- Consumes: `synthesizeToS3` from `@language-drill/db`; `CONTENT_BUCKET_NAME` env.
- Produces:
  - `headObjectExists(key: string): Promise<boolean>` — true if the S3 object exists, false on 404/NotFound, throws on other errors or missing bucket.
  - `synthesizeReadingAudio(args: { text: string; key: string; voiceId: string; languageCode: string }): Promise<void>` — synthesize + upload to `CONTENT_BUCKET_NAME`.

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/lib/reading-audio-synth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  HeadObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock('@aws-sdk/client-polly', () => ({
  PollyClient: class {},
}));
const synthesizeToS3 = vi.fn();
vi.mock('@language-drill/db', () => ({ synthesizeToS3 }));

import { headObjectExists, synthesizeReadingAudio } from './reading-audio-synth';

beforeEach(() => {
  send.mockReset();
  synthesizeToS3.mockReset();
  process.env.CONTENT_BUCKET_NAME = 'test-bucket';
});
afterEach(() => {
  delete process.env.CONTENT_BUCKET_NAME;
});

describe('headObjectExists', () => {
  it('returns true when the object is present', async () => {
    send.mockResolvedValueOnce({});
    expect(await headObjectExists('reading/abc.mp3')).toBe(true);
  });

  it('returns false on a 404 NotFound', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NotFound' }));
    expect(await headObjectExists('reading/abc.mp3')).toBe(false);
  });

  it('rethrows non-404 errors', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'AccessDenied' }));
    await expect(headObjectExists('reading/abc.mp3')).rejects.toThrow('boom');
  });
});

describe('synthesizeReadingAudio', () => {
  it('delegates to synthesizeToS3 with the resolved bucket/voice', async () => {
    synthesizeToS3.mockResolvedValueOnce(undefined);
    await synthesizeReadingAudio({
      text: 'Hola mundo',
      key: 'reading/abc.mp3',
      voiceId: 'Lucia',
      languageCode: 'es-ES',
    });
    expect(synthesizeToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-bucket',
        key: 'reading/abc.mp3',
        text: 'Hola mundo',
        voiceId: 'Lucia',
        languageCode: 'es-ES',
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/lib/reading-audio-synth.test.ts`
Expected: FAIL — cannot find module `./reading-audio-synth`.

- [ ] **Step 3: Implement the helper**

Create `infra/lambda/src/lib/reading-audio-synth.ts`:

```ts
import { PollyClient } from '@aws-sdk/client-polly';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { synthesizeToS3 } from '@language-drill/db';

// Cold-start singletons — reused across warm invocations.
let s3Client: S3Client | null = null;
function s3(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}
let pollyClient: PollyClient | null = null;
function polly(): PollyClient {
  if (!pollyClient) pollyClient = new PollyClient({});
  return pollyClient;
}

function bucket(): string {
  const b = process.env.CONTENT_BUCKET_NAME;
  if (!b) throw new Error('CONTENT_BUCKET_NAME is not set');
  return b;
}

/** True if the key already exists in the content bucket (cross-user cache hit). */
export async function headObjectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (name.name === 'NotFound' || name.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Synthesize the passage with Polly (neural) and upload the MP3 to S3. */
export async function synthesizeReadingAudio(args: {
  text: string;
  key: string;
  voiceId: string;
  languageCode: string;
}): Promise<void> {
  await synthesizeToS3({
    polly: polly(),
    s3: s3(),
    bucket: bucket(),
    key: args.key,
    text: args.text,
    voiceId: args.voiceId,
    languageCode: args.languageCode,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/lib/reading-audio-synth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/reading-audio-synth.ts infra/lambda/src/lib/reading-audio-synth.test.ts
git commit -m "feat(lambda): Polly synth + head-object helpers for reading audio"
```

---

### Task 5: Lambda — `resolveReadAudio` orchestration service (pure, injected deps)

**Files:**
- Create: `infra/lambda/src/lib/read-audio-service.ts`
- Create: `infra/lambda/src/lib/read-audio-service.test.ts`

**Interfaces:**
- Consumes: `normalizePassageText`, `estimateDurationSec`, `readingAudioKey`, `READING_VOICE_BY_LANGUAGE`, `POLLY_NEURAL_MAX_CHARS` from `@language-drill/db`.
- Produces:
  - `interface ReadAudioEntry { id: string; language: string; text: string; audioS3Key: string | null }`
  - `interface ReadAudioDeps { loadEntry; countRecentTts; limit; headObjectExists; synthesize; recordTtsUsage; persistKey; presign }` (exact signatures in the code below)
  - `type ReadAudioResult = { kind: 'ok'; audioUrl: string | null; durationSec: number } | { kind: 'not_found' } | { kind: 'too_long' } | { kind: 'rate_limited' }`
  - `resolveReadAudio(entryId: string, userId: string, deps: ReadAudioDeps): Promise<ReadAudioResult>`

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/lib/read-audio-service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveReadAudio, type ReadAudioDeps, type ReadAudioEntry } from './read-audio-service';

function makeDeps(overrides: Partial<ReadAudioDeps> & { entry?: ReadAudioEntry | null }): ReadAudioDeps {
  const entry =
    overrides.entry === undefined
      ? { id: 'e1', language: 'ES', text: 'Hola mundo', audioS3Key: null }
      : overrides.entry;
  return {
    loadEntry: vi.fn(async () => entry),
    countRecentTts: vi.fn(async () => 0),
    limit: vi.fn(() => 50),
    headObjectExists: vi.fn(async () => false),
    synthesize: vi.fn(async () => {}),
    recordTtsUsage: vi.fn(async () => {}),
    persistKey: vi.fn(async () => {}),
    presign: vi.fn(async () => 'https://signed/url'),
    ...overrides,
  };
}

describe('resolveReadAudio', () => {
  it('404s when the entry is missing / not owned', async () => {
    const deps = makeDeps({ entry: null });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'not_found' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('synthesizes + meters on a cold cache, then persists the key', async () => {
    const deps = makeDeps({});
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'Lucia', languageCode: 'es-ES', key: expect.stringMatching(/^reading\//) }),
    );
    expect(deps.recordTtsUsage).toHaveBeenCalledWith('u1', 'e1');
    expect(deps.persistKey).toHaveBeenCalledWith('e1', expect.stringMatching(/^reading\//));
    expect(res).toEqual({ kind: 'ok', audioUrl: 'https://signed/url', durationSec: expect.any(Number) });
  });

  it('skips synth + metering on a cross-user cache hit (HeadObject found)', async () => {
    const deps = makeDeps({ headObjectExists: vi.fn(async () => true) });
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.recordTtsUsage).not.toHaveBeenCalled();
    expect(deps.persistKey).toHaveBeenCalled(); // still records the key on this user's row
    expect(res.kind).toBe('ok');
  });

  it('skips head-object + synth entirely when the row already has a key', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'ES', text: 'Hola mundo', audioS3Key: 'reading/x.mp3' } });
    const res = await resolveReadAudio('e1', 'u1', deps);
    expect(deps.headObjectExists).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
    expect(deps.presign).toHaveBeenCalledWith('reading/x.mp3');
    expect(res.kind).toBe('ok');
  });

  it('returns too_long past the char cap without synthesizing', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'ES', text: 'x'.repeat(3001), audioS3Key: null } });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'too_long' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('rate_limits before synth when the daily cap is reached', async () => {
    const deps = makeDeps({ countRecentTts: vi.fn(async () => 50), limit: vi.fn(() => 50) });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'rate_limited' });
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it('404s an unsupported language defensively', async () => {
    const deps = makeDeps({ entry: { id: 'e1', language: 'EN', text: 'hello', audioS3Key: null } });
    expect(await resolveReadAudio('e1', 'u1', deps)).toEqual({ kind: 'not_found' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/lib/read-audio-service.test.ts`
Expected: FAIL — cannot find module `./read-audio-service`.

- [ ] **Step 3: Implement the service**

Create `infra/lambda/src/lib/read-audio-service.ts`:

```ts
import {
  READING_VOICE_BY_LANGUAGE,
  POLLY_NEURAL_MAX_CHARS,
  normalizePassageText,
  readingAudioKey,
  estimateDurationSec,
  type ReadingAudioLanguage,
} from '@language-drill/db';

export interface ReadAudioEntry {
  id: string;
  language: string;
  text: string;
  audioS3Key: string | null;
}

export interface ReadAudioDeps {
  loadEntry(entryId: string, userId: string): Promise<ReadAudioEntry | null>;
  countRecentTts(userId: string): Promise<number>;
  limit(): number;
  headObjectExists(key: string): Promise<boolean>;
  synthesize(args: { text: string; key: string; voiceId: string; languageCode: string }): Promise<void>;
  recordTtsUsage(userId: string, entryId: string): Promise<void>;
  persistKey(entryId: string, key: string): Promise<void>;
  presign(key: string): Promise<string | null>;
}

export type ReadAudioResult =
  | { kind: 'ok'; audioUrl: string | null; durationSec: number }
  | { kind: 'not_found' }
  | { kind: 'too_long' }
  | { kind: 'rate_limited' };

/**
 * Lazy, content-addressed reading-audio resolution. Ownership is enforced by
 * loadEntry (unknown/cross-user → null → 404). Metering + Polly only happen on
 * a true cache miss; HeadObject hits and already-keyed rows are free.
 */
export async function resolveReadAudio(
  entryId: string,
  userId: string,
  deps: ReadAudioDeps,
): Promise<ReadAudioResult> {
  const entry = await deps.loadEntry(entryId, userId);
  if (!entry) return { kind: 'not_found' };

  const voice = READING_VOICE_BY_LANGUAGE[entry.language as ReadingAudioLanguage];
  if (!voice) return { kind: 'not_found' }; // read practice is ES/DE/TR only

  const normalized = normalizePassageText(entry.text);
  if (normalized.length > POLLY_NEURAL_MAX_CHARS) return { kind: 'too_long' };

  const durationSec = estimateDurationSec(normalized);
  const key = entry.audioS3Key ?? readingAudioKey(entry.language, voice.voiceId, normalized);

  if (!entry.audioS3Key) {
    const exists = await deps.headObjectExists(key);
    if (!exists) {
      const used = await deps.countRecentTts(userId);
      if (used >= deps.limit()) return { kind: 'rate_limited' };
      await deps.synthesize({
        text: normalized,
        key,
        voiceId: voice.voiceId,
        languageCode: voice.languageCode,
      });
      await deps.recordTtsUsage(userId, entryId);
    }
    await deps.persistKey(entryId, key);
  }

  const audioUrl = await deps.presign(key);
  return { kind: 'ok', audioUrl, durationSec };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/lib/read-audio-service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/read-audio-service.ts infra/lambda/src/lib/read-audio-service.test.ts
git commit -m "feat(lambda): resolveReadAudio orchestration service (lazy, metered, dedup)"
```

---

### Task 6: Lambda — `POST /read/:entryId/audio` route

**Files:**
- Modify: `infra/lambda/src/routes/read.ts` (add the handler; imports)
- Modify: `infra/lambda/src/routes/read.test.ts` (add one happy-path route test using the file's existing db-mock harness)

**Interfaces:**
- Consumes: `resolveReadAudio` + deps types (Task 5); `headObjectExists`, `synthesizeReadingAudio` (Task 4); `presignAudioUrl` (`../lib/audio-url`); `limitFor` (`../usage/limits`); `getEffectivePlan` (`../usage/plan`); `db`, `readEntries`, `usageEvents` from `@language-drill/db`.
- Produces: HTTP `POST /read/:entryId/audio` → `200 { audioUrl: string | null; durationSec: number; reason: 'ok' | 'too_long' }`, `404 { error, code: 'ENTRY_NOT_FOUND' }`, `429 { error, code: 'RATE_LIMIT_EXCEEDED' }`.

- [ ] **Step 1: Add the handler**

In `infra/lambda/src/routes/read.ts`, add imports (top-of-file, alongside existing imports):

```ts
import { and, eq, gte } from 'drizzle-orm'; // ensure `and`, `eq`, `gte` are imported (some already are)
import { readEntries, usageEvents } from '@language-drill/db';
import { resolveReadAudio, type ReadAudioDeps } from '../lib/read-audio-service';
import { headObjectExists, synthesizeReadingAudio } from '../lib/reading-audio-synth';
import { presignAudioUrl } from '../lib/audio-url';
```

(If any of these symbols are already imported in the file, extend the existing import rather than duplicating it.)

Add the route (place it near the other `/read/*` handlers, after `GET /read/entries/:id`):

```ts
read.post('/read/:entryId/audio', async (c) => {
  const userId = c.get('userId');
  const entryId = c.req.param('entryId');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(entryId)) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Reading not found', code: 'ENTRY_NOT_FOUND' }, 404);
  }

  const plan = await getEffectivePlan(userId);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const deps: ReadAudioDeps = {
    loadEntry: async (id, uid) => {
      const [row] = await db
        .select({
          id: readEntries.id,
          language: readEntries.language,
          text: readEntries.text,
          audioS3Key: readEntries.audioS3Key,
        })
        .from(readEntries)
        .where(and(eq(readEntries.id, id), eq(readEntries.userId, uid)))
        .limit(1);
      return row ?? null;
    },
    countRecentTts: async (uid) => {
      const rows = await db
        .select({ id: usageEvents.id })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.userId, uid),
            eq(usageEvents.eventType, 'read_tts'),
            gte(usageEvents.createdAt, dayAgo),
          ),
        );
      return rows.length;
    },
    limit: () => limitFor('read_tts', plan),
    headObjectExists,
    synthesize: synthesizeReadingAudio,
    recordTtsUsage: async (uid, id) => {
      await db.insert(usageEvents).values({ userId: uid, eventType: 'read_tts', metadata: { entryId: id } });
    },
    persistKey: async (id, key) => {
      await db.update(readEntries).set({ audioS3Key: key }).where(eq(readEntries.id, id));
    },
    presign: presignAudioUrl,
  };

  const result = await resolveReadAudio(entryId, userId, deps);

  switch (result.kind) {
    case 'not_found':
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'Reading not found', code: 'ENTRY_NOT_FOUND' }, 404);
    case 'rate_limited':
      return c.json({ error: 'Daily audio limit reached', code: 'RATE_LIMIT_EXCEEDED' }, 429);
    case 'too_long':
      return c.json({ audioUrl: null, durationSec: 0, reason: 'too_long' as const }, 200);
    case 'ok':
      return c.json({ audioUrl: result.audioUrl, durationSec: result.durationSec, reason: 'ok' as const }, 200);
  }
});
```

> Note: `countRecentTts` matches the `read/generate` cap pattern (`read.ts:826-836`). If that block uses `db.$count`/`sql count` instead of `rows.length`, mirror whichever the file already uses for consistency.

- [ ] **Step 2: Write the failing route test**

Add to `infra/lambda/src/routes/read.test.ts`, reusing the file's existing app/db-mock harness (the same `mockDb`/`app.request` helpers the other `/read` tests use). Model the assertions on the existing `POST /read/generate` tests in that file:

```ts
describe('POST /read/:entryId/audio', () => {
  it('404s for an unknown entry', async () => {
    // Arrange the file's db mock so the entry select returns [] (see existing helpers).
    const res = await appRequest('POST', '/read/22222222-2222-2222-2222-222222222222/audio');
    expect(res.status).toBe(404);
  });

  it('returns a presigned url for an already-synthesized entry', async () => {
    // Arrange: entry select returns a row with audioS3Key = 'reading/x.mp3';
    // mock presignAudioUrl → 'https://signed'.
    const res = await appRequest('POST', '/read/11111111-1111-1111-1111-111111111111/audio');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reason: 'ok', audioUrl: expect.any(String) });
  });
});
```

> Use the existing file's helper names (`appRequest`/`app.request`, the shared db mock). If the file mocks `../lib/audio-url` or the synth libs, add `vi.mock('../lib/audio-url', ...)` and `vi.mock('../lib/reading-audio-synth', ...)` at the top following the file's mocking style. Because `resolveReadAudio` is separately unit-tested (Task 5), keep these route tests to the wiring/HTTP-mapping happy path + 404 — do not re-test the branch matrix here.

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/read.test.ts`
Expected first: FAIL (route not found / 404-vs-200 mismatch). After Step 1 is in place and the mock is arranged: PASS.

- [ ] **Step 4: Typecheck the package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/read.ts infra/lambda/src/routes/read.test.ts
git commit -m "feat(lambda): POST /read/:entryId/audio endpoint"
```

---

### Task 7: api-client — response schema + `useReadAudio` hook

**Files:**
- Modify: `packages/api-client/src/schemas/read.ts` (add `ReadAudioResponseSchema` + type)
- Create: `packages/api-client/src/hooks/useReadAudio.ts`
- Modify: `packages/api-client/src/index.ts` (re-export the hook + schema/type)
- Create: `packages/api-client/src/hooks/useReadAudio.test.ts`

**Interfaces:**
- Consumes: `AuthenticatedFetch` from `../fetchClient`.
- Produces:
  - `ReadAudioResponseSchema` / `ReadAudioResponse = { audioUrl: string | null; durationSec: number; reason: 'ok' | 'too_long' }`
  - `useReadAudio({ fetchFn }): UseMutationResult<ReadAudioResponse, Error, { entryId: string }>`

- [ ] **Step 1: Add the response schema**

In `packages/api-client/src/schemas/read.ts`:

```ts
export const ReadAudioResponseSchema = z.object({
  audioUrl: z.string().url().nullable(),
  durationSec: z.number(),
  reason: z.enum(['ok', 'too_long']),
});
export type ReadAudioResponse = z.infer<typeof ReadAudioResponseSchema>;
```

- [ ] **Step 2: Write the failing hook test**

Create `packages/api-client/src/hooks/useReadAudio.test.ts` (mirror the harness of an existing hook test in this folder — QueryClientProvider + renderHook):

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReadAudio } from './useReadAudio';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useReadAudio', () => {
  it('POSTs to /read/:entryId/audio and parses the response', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' }),
    })) as unknown as Parameters<typeof useReadAudio>[0]['fetchFn'];

    const { result } = renderHook(() => useReadAudio({ fetchFn }), { wrapper });
    result.current.mutate({ entryId: 'e1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/read/e1/audio', { method: 'POST' });
    expect(result.current.data).toEqual({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/hooks/useReadAudio.test.ts`
Expected: FAIL — cannot find module `./useReadAudio`.

- [ ] **Step 4: Implement the hook**

Create `packages/api-client/src/hooks/useReadAudio.ts` (model on `useGenerateReadingText.ts`):

```ts
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ReadAudioResponseSchema, type ReadAudioResponse } from '../schemas/read';

export function useReadAudio({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<ReadAudioResponse, Error, { entryId: string }>({
    mutationFn: async ({ entryId }) => {
      const response = await fetchFn(`/read/${entryId}/audio`, { method: 'POST' });
      const json: unknown = await response.json();
      return ReadAudioResponseSchema.parse(json);
    },
  });
}
```

- [ ] **Step 5: Re-export**

In `packages/api-client/src/index.ts`, add:

```ts
export { useReadAudio } from './hooks/useReadAudio';
export { ReadAudioResponseSchema, type ReadAudioResponse } from './schemas/read';
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/hooks/useReadAudio.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/schemas/read.ts packages/api-client/src/hooks/useReadAudio.ts packages/api-client/src/hooks/useReadAudio.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): useReadAudio mutation hook + response schema"
```

---

### Task 8: web — `<AudioPlayer>` empty-waveform fallback

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/audio-player.tsx` (the `role="slider"` track, ~lines 227-244)
- Modify: `apps/web/app/(dashboard)/drill/_components/audio-player.test.tsx` (add empty-waveform cases; create if absent)

**Interfaces:**
- Produces: `<AudioPlayer waveform={[]} … />` renders a continuous progress-bar track (with `data-testid="progress-track"` and a `data-testid="progress-fill"` sized by `progress`) instead of amplitude bars. Non-empty waveform behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/(dashboard)/drill/_components/audio-player.test.tsx`:

```tsx
it('renders a continuous progress track when waveform is empty', () => {
  render(<AudioPlayer src="blob:x" waveform={[]} durationSec={10} />);
  expect(screen.getByTestId('progress-track')).toBeInTheDocument();
  expect(screen.queryByTestId('progress-fill')).toBeInTheDocument();
  // Amplitude bars should not be rendered in the empty case.
});

it('still renders amplitude bars for a non-empty waveform', () => {
  render(<AudioPlayer src="blob:x" waveform={[0.2, 0.8, 0.5]} durationSec={10} />);
  expect(screen.queryByTestId('progress-track')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/_components/audio-player.test.tsx"`
Expected: FAIL — no `progress-track` testid.

- [ ] **Step 3: Implement the fallback**

In `apps/web/app/(dashboard)/drill/_components/audio-player.tsx`, replace the `{waveform.map((h, i) => { … })}` block (inside the `role="slider"` div) with:

```tsx
          {waveform.length === 0 ? (
            <div
              data-testid="progress-track"
              aria-hidden
              className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-rule-strong"
            >
              <div
                data-testid="progress-fill"
                className="h-full rounded-full bg-accent"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          ) : (
            waveform.map((h, i) => {
              const played = (i + 0.5) / waveform.length <= progress;
              return (
                <span
                  key={i}
                  aria-hidden
                  className={`pointer-events-none rounded-[2px] ${played ? 'bg-accent' : 'bg-rule-strong'}`}
                  style={{ flex: 1, minWidth: 2, height: `${Math.max(10, h * 100)}%` }}
                />
              );
            })
          )}
```

(The surrounding hover-tick `{!disabled && hoverFrac !== null …}` block stays as-is, immediately after.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/_components/audio-player.test.tsx"`
Expected: PASS (new + existing dictation tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/audio-player.tsx" "apps/web/app/(dashboard)/drill/_components/audio-player.test.tsx"
git commit -m "feat(web): AudioPlayer continuous-track fallback for empty waveform"
```

---

### Task 9: web — `PassageAudio` component + wire into read page

**Files:**
- Create: `apps/web/app/(dashboard)/read/_components/passage-audio.tsx`
- Create: `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx`
- Modify: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx` (accept `entryId`/`fetchFn`, render `<PassageAudio>` in the reader header ~lines 477-488)
- Modify: `apps/web/app/(dashboard)/read/page.tsx` (pass `entryId={state.activeEntryId}` + `fetchFn` to `<AnnotatedView>` ~lines 1167-1211)

**Interfaces:**
- Consumes: `useReadAudio` (Task 7), `AudioPlayer` (Task 8), `AuthenticatedFetch`.
- Produces: `<PassageAudio entryId={string} fetchFn={AuthenticatedFetch} />` — a "Listen" button that on click fetches audio, shows a "preparing audio…" state, then mounts `<AudioPlayer>`; shows a disabled "audio unavailable" state for `reason: 'too_long'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { PassageAudio } from './passage-audio';

function renderWith(fetchFn: unknown) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PassageAudio entryId="e1" fetchFn={fetchFn as never} />
    </QueryClientProvider>,
  );
}

describe('PassageAudio', () => {
  it('fetches and mounts the player on click', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: 'https://signed/x.mp3', durationSec: 12, reason: 'ok' }),
    }));
    renderWith(fetchFn);
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledWith('/read/e1/audio', { method: 'POST' });
  });

  it('shows an unavailable state when the passage is too long', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({ audioUrl: null, durationSec: 0, reason: 'too_long' }),
    }));
    renderWith(fetchFn);
    await userEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(screen.getByText(/too long/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/passage-audio.test.tsx"`
Expected: FAIL — cannot find module `./passage-audio`.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/read/_components/passage-audio.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useReadAudio, type AuthenticatedFetch } from '@language-drill/api-client';
import { AudioPlayer } from '../../drill/_components/audio-player';

export function PassageAudio({ entryId, fetchFn }: { entryId: string; fetchFn: AuthenticatedFetch }) {
  const { mutate, data, isPending, isError, reset } = useReadAudio({ fetchFn });
  const [opened, setOpened] = React.useState(false);

  // Reset when switching passages.
  React.useEffect(() => {
    setOpened(false);
    reset();
  }, [entryId, reset]);

  const buttonClass =
    't-small inline-flex min-h-[44px] flex-none items-center gap-[6px] rounded-pill border border-rule bg-card px-[14px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-40';

  if (!opened) {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setOpened(true);
          mutate({ entryId });
        }}
      >
        Listen
      </button>
    );
  }

  if (isPending) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        preparing audio…
      </span>
    );
  }

  if (isError) {
    return (
      <button type="button" className={buttonClass} onClick={() => mutate({ entryId })}>
        retry audio
      </button>
    );
  }

  if (data?.reason === 'too_long' || !data?.audioUrl) {
    return (
      <span className="t-small inline-flex min-h-[44px] items-center gap-[6px] text-ink-mute">
        audio unavailable — passage too long to narrate
      </span>
    );
  }

  return <AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} />;
}
```

> If `AuthenticatedFetch` is not re-exported from `@language-drill/api-client`, import it from its module path used elsewhere in the app (grep `AuthenticatedFetch` under `apps/web`) and add the re-export to `packages/api-client/src/index.ts`.

- [ ] **Step 4: Wire `AnnotatedView`**

In `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`:
- Add to the component's props type: `entryId?: string | null;` and `fetchFn?: import('@language-drill/api-client').AuthenticatedFetch;`
- Import: `import { PassageAudio } from './passage-audio';`
- In the desktop reader header (~lines 477-488), inside the right-side flex group next to `<IntensityToggle …/>`, render:

```tsx
{entryId && fetchFn ? <PassageAudio entryId={entryId} fetchFn={fetchFn} /> : null}
```

(Also add it to the mobile header ~lines 373-389 if you want parity; optional for this task.)

- [ ] **Step 5: Wire `page.tsx`**

In `apps/web/app/(dashboard)/read/page.tsx`, at the `<AnnotatedView … />` render site (~lines 1167-1211), pass:

```tsx
  entryId={state.activeEntryId}
  fetchFn={fetchFn}
```

(`fetchFn` already exists at `page.tsx:124-126`; `state.activeEntryId` is `string | null` — audio only shows for a persisted entry, matching `canSaveToLibrary`.)

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/read/_components/passage-audio.test.tsx"`
Expected: PASS.

- [ ] **Step 7: Typecheck + build web (catches prerender/Suspense issues the unit tests miss)**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/read/_components/passage-audio.tsx" "apps/web/app/(dashboard)/read/_components/passage-audio.test.tsx" "apps/web/app/(dashboard)/read/_components/annotated-view.tsx" "apps/web/app/(dashboard)/read/page.tsx"
git commit -m "feat(web): Listen control on read passages (PassageAudio)"
```

---

### Task 10: infra — grant Polly + S3 Put to the API Lambda

**Files:**
- Modify: `infra/lib/stack.ts` (after `storage.bucket.grantRead(lambda.handler);` ~line 99; add `iam` import if missing)
- Update: `infra/test/__snapshots__/*` via the test runner's update flag

**Interfaces:**
- Produces: the API Lambda role has `polly:SynthesizeSpeech` (resource `*`) and `s3:PutObject`/`s3:HeadObject` on the content bucket.

- [ ] **Step 1: Add the grants**

In `infra/lib/stack.ts`, ensure the IAM import is present at the top:

```ts
import * as iam from 'aws-cdk-lib/aws-iam';
```

Immediately after `storage.bucket.grantRead(lambda.handler);`:

```ts
    // On-demand reading-audio synthesis: Polly + write/head into the content bucket.
    storage.bucket.grantPut(lambda.handler);
    lambda.handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*'], // Polly has no resource-level ARN
      }),
    );
```

(`grantPut` covers `s3:PutObject`; `grantRead` already granted earlier covers `s3:GetObject`. `HeadObject` is authorized by the `s3:GetObject`/bucket read grant — if the synth path 403s on HeadObject in an integration test, add `grantRead` is sufficient since HeadObject is a read action.)

- [ ] **Step 2: Typecheck infra**

Run: `pnpm --filter @language-drill/infra typecheck`
Expected: PASS.

- [ ] **Step 3: Update + run the CFN snapshot tests**

Run: `pnpm --filter @language-drill/infra exec vitest run -u`
Expected: snapshots updated (new IAM statement + S3 Put action on the Lambda role in both prod and dev stacks); tests PASS. Review the snapshot diff to confirm only the Polly statement + `s3:PutObject` were added.

> If infra synth tests fail locally with `FailedToBundleAsset` (esbuild exit 254), that is the known environmental issue — symlink esbuild into the repo-root `node_modules` (see project memory) and re-run. It is not a regression.

- [ ] **Step 4: Commit**

```bash
git add infra/lib/stack.ts infra/test/__snapshots__
git commit -m "feat(infra): grant API Lambda Polly + S3 Put for reading audio"
```

---

### Task 11: Final gate + spec reconciliation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-08-read-practice-audio-shadowing-design.md` (resolve the open questions inline)

- [ ] **Step 1: Resolve the spec's open questions**

Edit the "Open questions" section to record the decisions: `read_tts` = 50 free / 500 boosted; TTS stays outside the global AI kill-switch/daily cap; **English voice N/A — read practice is ES/DE/TR only** (no EN target). Note the reading voice map: ES→Lucia, DE→Vicki, TR→Burcu (all neural).

- [ ] **Step 2: Run the full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures across all packages.

> If the full suite surfaces phantom failures from stale compiled tests, clear `infra/lambda/dist` (`rm -rf infra/lambda/dist`) and re-run — see project memory on stale `dist` test files.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-08-read-practice-audio-shadowing-design.md
git commit -m "docs: resolve read-practice audio spec open questions"
```

---

## Self-Review

**Spec coverage:**
- Storage / content-addressed key + `audio_s3_key` column → Tasks 1, 2, 5. ✔
- Lazy on-first-play synth + HeadObject dedup → Tasks 4, 5. ✔
- New `POST /read/:entryId/audio` on the main API Lambda → Task 6. ✔
- Voice map (ES/DE/TR; no EN) → Task 2. ✔
- Long-passage guard (`too_long`) → Tasks 2, 5, 6, 9. ✔
- `read_tts` metered bucket, only actual synths counted → Tasks 3, 5, 6. ✔
- `<AudioPlayer>` empty-waveform fallback → Task 8. ✔
- Frontend Listen control + wiring → Tasks 7, 9. ✔
- Polly IAM + S3 Put on API Lambda → Task 10. ✔
- Testing across units → each task's TDD steps. ✔
- Spec open-question reconciliation → Task 11. ✔

**Placeholder scan:** No `TBD`/`TODO`/"add validation"; all code steps show full code. The only soft references ("mirror the file's existing db-mock harness" in Task 6, "grep AuthenticatedFetch" in Task 9) point at concrete existing patterns the implementer reads in-file, with exact assertions provided.

**Type consistency:** `ReadAudioResponse` shape (`audioUrl: string | null; durationSec: number; reason: 'ok' | 'too_long'`) is identical across Task 6 (route JSON), Task 7 (schema/hook), and Task 9 (component). `ReadAudioDeps`/`resolveReadAudio` signatures match between Task 5 (definition) and Task 6 (wiring). `headObjectExists`/`synthesizeReadingAudio` signatures match between Task 4 (definition) and Tasks 5-6 (consumption). `READING_VOICE_BY_LANGUAGE` keys (`ES`/`DE`/`TR`) are consistent between Task 2 and Task 5.
