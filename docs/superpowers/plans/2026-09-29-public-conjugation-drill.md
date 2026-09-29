# Public Conjugation Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an anonymous visitor drill conjugation at `/try/conjugation` with no signup, no writes, and no LLM cost.

**Architecture:** One unauthenticated `GET /public/conjugation/set` endpoint on the Hono Lambda, fronted by a module-scope pool cache so request volume never reaches Neon. The web page fetches one set, then grades every answer locally with `gradeFluencyAnswer` from `@language-drill/shared` — the same pure function the authenticated submit path calls. Nothing is persisted anywhere.

**Tech Stack:** Hono + Zod + Drizzle (Lambda), AWS CDK (API Gateway v2 route without a JWT authorizer), TanStack Query + Zod (api-client), Next.js App Router + React (web), Vitest everywhere, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-09-29-public-conjugation-drill-design.md`

## Global Constraints

- **`type` is never a request parameter.** The public query hard-codes `type = 'conjugation'` as a server constant. `contentJson` is returned wholesale, so an overridable `type` would expose the entire ~30k-row pool with its answers.
- **No `grammarPoint` parameter.** Keeps the cache key space at exactly 3 languages x 4 levels = 12.
- **Languages:** `ES | DE | TR` only. EN is source-only (`packages/shared/src/onboarding.ts`).
- **Levels:** `A1 | A2 | B1 | B2` only. No approved C1/C2 content exists; a C1 request must 400, not return empty.
- **Public set size:** `PUBLIC_CONJUGATION_SET_DEFAULT = 10`, `PUBLIC_CONJUGATION_SET_MAX = 10`. Kept separate from `CONJUGATION_SET_MAX = 20` so raising the authenticated limit never widens the public one.
- **Cache TTL:** `PUBLIC_POOL_TTL_MS = 5 * 60_000`.
- **Stateless:** no `user_exercise_history`, no `user_grammar_mastery`, no `usage_events`, no anonymous session rows, no reclaim-at-signup.
- **No LLM calls** on any path this plan touches.
- **Deviation from the spec, deliberate:** the spec wrote `app/(public)/try/conjugation/page.tsx`. Repo convention puts public pages at the app root (`app/academic-rigour/`, `app/why-not-chatgpt/`), so this plan uses `app/try/conjugation/page.tsx` with no route group.
- **Do not use landing CSS.** The `.df` class aliases exist only under `.df` in `app/_landing/landing.css` and are not global. This is a product surface: use the app design system (`Card`, `Button`, `Input`, `t-display-m`, `gap-s-4`).
- Gate before any push: `pnpm lint`, `pnpm typecheck`, then tests **package-by-package** (a full `pnpm test` gets OOM-killed on this machine).

---

### Task 1: Pool cache primitive

A pure, injectable-clock TTL cache plus a non-mutating shuffle. Separated from the route so its expiry and aliasing behaviour are testable without a DB mock.

**Files:**
- Create: `infra/lambda/src/lib/public-pool-cache.ts`
- Test: `infra/lambda/src/lib/public-pool-cache.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PUBLIC_POOL_TTL_MS: number`
  - `createPoolCache<T>(opts?: { ttlMs?: number; now?: () => number }): { get(key: string, load: () => Promise<T[]>): Promise<T[]>; size(): number; clear(): void }`
  - `shuffled<T>(rows: readonly T[], rng?: () => number): T[]`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/public-pool-cache.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPoolCache, shuffled, PUBLIC_POOL_TTL_MS } from './public-pool-cache';

describe('createPoolCache', () => {
  it('loads once and serves the cached rows within the TTL', async () => {
    let clock = 1_000;
    const load = vi.fn(async () => [{ id: 'a' }]);
    const cache = createPoolCache<{ id: string }>({ now: () => clock });

    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);
    clock += PUBLIC_POOL_TTL_MS - 1;
    expect(await cache.get('ES|B1', load)).toEqual([{ id: 'a' }]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has elapsed', async () => {
    let clock = 1_000;
    const load = vi.fn(async () => [{ id: 'a' }]);
    const cache = createPoolCache<{ id: string }>({ now: () => clock });

    await cache.get('ES|B1', load);
    clock += PUBLIC_POOL_TTL_MS;
    await cache.get('ES|B1', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys distinct pools separately', async () => {
    const cache = createPoolCache<{ id: string }>({ now: () => 0 });
    const es = vi.fn(async () => [{ id: 'es' }]);
    const de = vi.fn(async () => [{ id: 'de' }]);

    expect(await cache.get('ES|B1', es)).toEqual([{ id: 'es' }]);
    expect(await cache.get('DE|B1', de)).toEqual([{ id: 'de' }]);
    expect(cache.size()).toBe(2);
  });
});

describe('shuffled', () => {
  // The cached array is shared across concurrent requests, so an in-place
  // shuffle would reorder rows another request is mid-iteration over.
  it('returns a new array and leaves the input untouched', () => {
    const input = Object.freeze([1, 2, 3, 4]) as readonly number[];
    const out = shuffled(input, () => 0);
    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4]);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
  });

  it('permutes deterministically for a given rng', () => {
    const rows = [1, 2, 3, 4, 5];
    const rng = () => 0.999999;
    expect(shuffled(rows, rng)).toEqual(shuffled(rows, rng));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/lib/public-pool-cache.test.ts`
Expected: FAIL — `Failed to resolve import "./public-pool-cache"`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/lib/public-pool-cache.ts`:

```ts
// Module-scope pool cache for the unauthenticated public endpoints.
//
// An unauthenticated GET that runs a window query per request lets anyone spin
// our Neon compute and degrade the database for real users; API Gateway's
// default throttling is orders of magnitude too permissive to prevent it. The
// public conjugation pools are tiny (<=~220 rows per language/level), so we
// hold the whole window in Lambda memory and re-query at most once per key per
// TTL. Cost ceiling: 12 queries per Lambda instance per 5 minutes.

export const PUBLIC_POOL_TTL_MS = 5 * 60_000;

type Entry<T> = { rows: T[]; fetchedAt: number };

export function createPoolCache<T>(opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? PUBLIC_POOL_TTL_MS;
  const now = opts.now ?? Date.now;
  const store = new Map<string, Entry<T>>();

  return {
    async get(key: string, load: () => Promise<T[]>): Promise<T[]> {
      const at = now();
      const hit = store.get(key);
      if (hit && at - hit.fetchedAt < ttlMs) return hit.rows;
      const rows = await load();
      store.set(key, { rows, fetchedAt: at });
      return rows;
    },
    size(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
  };
}

/**
 * Fisher-Yates over a COPY. Never shuffles in place: the array handed in is the
 * cached one, shared by every concurrent request, and two requests interleaving
 * around their awaits would otherwise reorder each other's rows mid-iteration.
 */
export function shuffled<T>(rows: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/lib/public-pool-cache.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/public-pool-cache.ts infra/lambda/src/lib/public-pool-cache.test.ts
git commit -m "feat(lambda): TTL pool cache + non-mutating shuffle for public endpoints"
```

---

### Task 2: The public set endpoint

**Files:**
- Create: `infra/lambda/src/routes/public.ts`
- Modify: `infra/lambda/src/lib/exercise-set.ts` (add the two public constants beside the existing ones, ~line 13)
- Modify: `infra/lambda/src/index.ts` (import + `app.route('/', publicRoutes)` in the mount block at lines 78-94)
- Test: `infra/lambda/src/routes/public.test.ts`

**Interfaces:**
- Consumes: `createPoolCache`, `shuffled`, `PUBLIC_POOL_TTL_MS` (Task 1); existing `approvedStatusFilter`, `audioReadyFilter` from `../lib/exercise-filters`; existing `conjugationSignature`, `dedupeBySignature`, `CONJUGATION_SET_FETCH_CAP` from `../lib/exercise-set`.
- Produces: `GET /public/conjugation/set?lang&level&count` returning
  `{ exercises: Array<{ id, type, language, difficulty, grammarPointKey, contentJson }>, available: number, difficulty: string }`.
  Default export is the Hono router. Also exports `PUBLIC_CONJUGATION_SET_DEFAULT = 10` and `PUBLIC_CONJUGATION_SET_MAX = 10` from `../lib/exercise-set`.

- [ ] **Step 1: Add the constants**

In `infra/lambda/src/lib/exercise-set.ts`, directly below `CONJUGATION_SET_FETCH_CAP`:

```ts
// Public (unauthenticated) sitting size. Deliberately a SEPARATE pair from the
// authenticated CONJUGATION_SET_* constants so raising the authenticated limit
// can never widen the public surface.
export const PUBLIC_CONJUGATION_SET_DEFAULT = 10;
export const PUBLIC_CONJUGATION_SET_MAX = 10;
```

- [ ] **Step 2: Write the failing test**

Create `infra/lambda/src/routes/public.test.ts`. The db mock mirrors `routes/email.test.ts`: both `../db` and `@language-drill/db` must be mocked, because under turbo the real `@language-drill/db` import would demand `DATABASE_URL`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: Record<string, any> = {};
// Captures the object handed to db.select({...}) and the predicates passed to
// .where(), so the test can assert the projection and the forced type filter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captured: Record<string, any> = {};

vi.mock('../db', () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.from = () => c;
    c.where = (...args: unknown[]) => {
      captured.where = args;
      return c;
    };
    c.limit = (n: number) => {
      captured.limit = n;
      return Promise.resolve(state.rows ?? []);
    };
    return c;
  };
  return {
    db: {
      select: (projection: unknown) => {
        captured.projection = projection;
        return chain();
      },
    },
  };
});

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    language: 'language',
    difficulty: 'difficulty',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    contentJson: 'content_json',
    audioS3Key: 'audio_s3_key',
  },
}));

// `eq` / `and` are replaced with plain data so the test can inspect the
// predicates structurally. Stringifying real Drizzle SQL objects is brittle —
// the bound values live in `queryChunks` and the shape is not part of its API.
// `inArray` and `sql` (used by approvedStatusFilter / audioReadyFilter) stay real.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ __and: preds }),
    eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  };
});

/** The `[column, value]` pairs the route passed to `eq()`. */
function eqPairs(): Array<[string, string]> {
  const preds = (captured.where[0] as { __and: Array<{ __eq?: [string, string] }> }).__and;
  return preds.filter((p) => p.__eq).map((p) => p.__eq!);
}

function row(id: string, lemma: string, targetForm: string) {
  return {
    id,
    type: 'conjugation',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: 'es-b1-conditional',
    contentJson: {
      type: 'conjugation',
      lemma,
      targetForm,
      subject: { pronoun: 'nosotros', gloss: 'we' },
    },
  };
}

describe('GET /public/conjugation/set', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(state)) delete state[k];
    for (const k of Object.keys(captured)) delete captured[k];
    const mod = await import('./public');
    // Each test gets a clean cache — the module-scope cache would otherwise
    // leak rows between cases.
    mod.__clearPoolCacheForTests();
    app = new Hono();
    app.route('/', mod.default);
  });

  it('serves a set with NO Authorization header', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(1);
    expect(body.exercises[0].id).toBe('a');
    expect(body.difficulty).toBe('B1');
  });

  it('ignores a caller-supplied type and always queries conjugation', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&type=free_writing',
    );
    expect(res.status).toBe(200);
    expect(eqPairs()).toContainEqual(['type', 'conjugation']);
    expect(eqPairs().map(([, value]) => value)).not.toContain('free_writing');
  });

  it('ignores a caller-supplied grammarPoint', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    const res = await app.request(
      '/public/conjugation/set?lang=ES&level=B1&grammarPoint=es-b1-subjunctive',
    );
    expect(res.status).toBe(200);
    // No grammar-point predicate at all: an unvalidated caller-supplied key
    // would make the cache key space unbounded (spec D3).
    expect(eqPairs().map(([column]) => column)).not.toContain('grammar_point_key');
  });

  it('projects only the public columns', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(Object.keys(captured.projection).sort()).toEqual(
      ['contentJson', 'difficulty', 'grammarPointKey', 'id', 'language', 'type'].sort(),
    );
  });

  it('clamps count to the public maximum of 10', async () => {
    state.rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`, `lemma${i}`, `form${i}`));
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1&count=50');
    expect(res.status).toBe(400);

    const ok = await app.request('/public/conjugation/set?lang=ES&level=B1&count=10');
    expect((await ok.json()).available).toBe(10);
  });

  it('rejects EN and C1', async () => {
    expect((await app.request('/public/conjugation/set?lang=EN&level=B1')).status).toBe(400);
    expect((await app.request('/public/conjugation/set?lang=ES&level=C1')).status).toBe(400);
  });

  it('returns 200 with an empty set for a valid but empty cell', async () => {
    state.rows = [];
    const res = await app.request('/public/conjugation/set?lang=DE&level=B2');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ exercises: [], available: 0 });
  });

  it('collapses duplicate-content rows to one item', async () => {
    state.rows = [
      row('a', 'ir', 'iríamos'),
      row('b', 'ir', 'iríamos'),
      row('c', 'ser', 'seríamos'),
    ];
    const res = await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect((await res.json()).available).toBe(2);
  });

  it('queries once per key within the TTL', async () => {
    state.rows = [row('a', 'ir', 'iríamos')];
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    captured.limit = undefined;
    await app.request('/public/conjugation/set?lang=ES&level=B1');
    expect(captured.limit).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/routes/public.test.ts`
Expected: FAIL — `Failed to resolve import "./public"`.

- [ ] **Step 4: Write the route**

Create `infra/lambda/src/routes/public.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { exercises as exercisesTable } from '@language-drill/db';
import { db } from '../db';
import { approvedStatusFilter, audioReadyFilter } from '../lib/exercise-filters';
import {
  conjugationSignature,
  dedupeBySignature,
  CONJUGATION_SET_FETCH_CAP,
  PUBLIC_CONJUGATION_SET_DEFAULT,
  PUBLIC_CONJUGATION_SET_MAX,
} from '../lib/exercise-set';
import { createPoolCache, shuffled } from '../lib/public-pool-cache';

// ---------------------------------------------------------------------------
// UNAUTHENTICATED ROUTER.
//
// This is the ONLY router in this app that does not apply `authMiddleware`.
// Every sibling does; the omission here is deliberate, and the corresponding
// API Gateway route is registered without a JWT authorizer in
// `infra/lib/constructs/api-gateway.ts`.
//
// Two constraints keep that safe and MUST NOT be relaxed:
//   1. `type` is a server constant, never a request parameter. `contentJson`
//      is returned wholesale (answers included), so an overridable type would
//      expose the whole ~30k-row pool.
//   2. There is no `grammarPoint` parameter, so the cache key space is exactly
//      3 languages x 4 levels = 12 and cannot be inflated by a caller.
// ---------------------------------------------------------------------------

const publicRoutes = new Hono();

const PUBLIC_TYPE = 'conjugation' as const;

const SetQuerySchema = z.object({
  lang: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  count: z.coerce.number().int().min(1).max(PUBLIC_CONJUGATION_SET_MAX).optional(),
});

type PoolRow = {
  id: string;
  type: string;
  language: string;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: unknown;
};

const poolCache = createPoolCache<PoolRow>();

/** Test seam: the module-scope cache would otherwise leak rows between cases. */
export function __clearPoolCacheForTests(): void {
  poolCache.clear();
}

publicRoutes.get('/public/conjugation/set', async (c) => {
  const parsed = SetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { lang, level, count } = parsed.data;
  const target = count ?? PUBLIC_CONJUGATION_SET_DEFAULT;

  const rows = await poolCache.get(`${lang}|${level}`, () =>
    db
      // Explicit projection, unlike the authenticated `.select()`: a column
      // added to `exercises` later (quality_score, flagged_reasons,
      // demotion_reason, model_id) must not start leaking to the open web.
      .select({
        id: exercisesTable.id,
        type: exercisesTable.type,
        language: exercisesTable.language,
        difficulty: exercisesTable.difficulty,
        grammarPointKey: exercisesTable.grammarPointKey,
        contentJson: exercisesTable.contentJson,
      })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.difficulty, level),
          eq(exercisesTable.type, PUBLIC_TYPE),
          approvedStatusFilter(exercisesTable),
          audioReadyFilter(exercisesTable),
        ),
      )
      .limit(CONJUGATION_SET_FETCH_CAP),
  );

  // Randomisation happens here rather than in SQL (`ORDER BY random()`): the
  // window is cached, so the DB is not re-queried per request.
  const chosen = dedupeBySignature(
    shuffled(rows),
    target,
    (r) => `${r.grammarPointKey ?? ''}|${conjugationSignature(r.contentJson)}`,
  );

  return c.json({ exercises: chosen, available: chosen.length, difficulty: level });
});

export default publicRoutes;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/routes/public.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Confirm the test does not secretly need a real database**

Run: `env -u DATABASE_URL pnpm --filter @language-drill/lambda test src/routes/public.test.ts`
Expected: PASS. A failure here means a `@language-drill/db` import escaped the mock.

- [ ] **Step 7: Mount the router**

In `infra/lambda/src/index.ts`, add the import beside its siblings:

```ts
import publicRoutes from './routes/public';
```

and add the mount inside the existing block (lines 78-94), directly after `app.route('/', health);`:

```ts
app.route('/', publicRoutes); // unauthenticated — see routes/public.ts
```

- [ ] **Step 8: Verify the whole lambda suite still passes**

Run: `pnpm --filter @language-drill/lambda test`
Expected: PASS. If phantom failures appear in unrelated files, `rm -rf infra/lambda/dist` and re-run — stale `dist` test files are a known false signal in this repo.

- [ ] **Step 9: Smoke-test it locally**

```bash
pnpm dev:api
# in another shell:
curl -s 'http://localhost:3001/public/conjugation/set?lang=TR&level=B1&count=3' | head -c 600
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/public/conjugation/set?lang=EN&level=B1'
```
Expected: the first prints 3 exercises with `contentJson.lemma` / `targetForm`; the second prints `400`.

- [ ] **Step 10: Commit**

```bash
git add infra/lambda/src/routes/public.ts infra/lambda/src/routes/public.test.ts \
        infra/lambda/src/lib/exercise-set.ts infra/lambda/src/index.ts
git commit -m "feat(lambda): unauthenticated GET /public/conjugation/set"
```

---

### Task 3: API Gateway route + observability doc amendment

**Files:**
- Modify: `infra/lib/constructs/api-gateway.ts` (add after the email routes, ~line 157)
- Modify: `CLAUDE.md` ("Requests that never reach the Lambda" note under *Observability boundaries*)
- Test: `infra/test/stack.dev.test.ts` (add beside the existing public-email route assertions, ~line 157-177)

**Interfaces:**
- Consumes: the `lambdaIntegration` local already in scope in `api-gateway.ts`.
- Produces: `GET /public/{proxy+}` and `OPTIONS /public/{proxy+}` with `AuthorizationType: NONE`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` in `infra/test/stack.dev.test.ts`, after the `POST /email/unsubscribe` case:

```ts
  // Regression: the public drill surface must have no JWT authorizer. A
  // `{proxy+}` path under /public keeps future public routes free, and a
  // more-specific path takes precedence over the catch-all /{proxy+}.
  it("GET /public/{proxy+} is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /public/{proxy+}",
      AuthorizationType: "NONE",
    });
  });

  it("OPTIONS /public/{proxy+} is a public API Gateway route (no JWT authorizer)", () => {
    prodTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "OPTIONS /public/{proxy+}",
      AuthorizationType: "NONE",
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/infra test test/stack.dev.test.ts`
Expected: FAIL — no matching `AWS::ApiGatewayV2::Route`.

If it instead fails with an esbuild resolution error, symlink esbuild into the root node_modules (a known requirement for the infra CDK tests) and re-run.

- [ ] **Step 3: Add the routes**

In `infra/lib/constructs/api-gateway.ts`, immediately after the `POST /email/unsubscribe` block and before `this.addAccessLogging();`:

```ts
    // Public drill surface — no JWT authorizer. `GET /public/*` serves the
    // unauthenticated conjugation set (see infra/lambda/src/routes/public.ts);
    // OPTIONS carries the CORS preflight, which never carries a token. As with
    // the email routes above, a more-specific path takes precedence over
    // /{proxy+}, so only /public/* is unauthenticated.
    this.httpApi.addRoutes({
      path: "/public/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.OPTIONS],
      integration: lambdaIntegration,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/infra test test/stack.dev.test.ts`
Expected: PASS.

- [ ] **Step 5: Refresh the CDK snapshot**

Run: `pnpm --filter @language-drill/infra test -u`
Then `git diff infra/test/__snapshots__` and confirm the only additions are the two new `AWS::ApiGatewayV2::Route` resources. Anything else means the change reached further than intended.

- [ ] **Step 6: Amend the CLAUDE.md observability note**

This is not optional bookkeeping — it is the deliverable that keeps the next incident triage correct. In `CLAUDE.md`, inside the blockquote beginning "**Requests that never reach the Lambda.**", append:

```markdown
> **Changed by the public drill surface.** `GET /public/*` (the unauthenticated
> conjugation drill) has no JWT authorizer, so anonymous traffic now reaches the
> Lambda and logs normally. `Invocations > 0` therefore no longer implies
> authenticated usage, and the "real usage has `Count ≈ Invocations` with
> `4xx ≈ 0`" heuristic above now describes authenticated *plus* public traffic.
> To separate them, filter the access log group by `path` — `/public/*` is the
> anonymous population. The prod `4xx >= 200/hour` alarm is unaffected:
> rejected scans still fail at the authorizer.
```

- [ ] **Step 7: Commit**

```bash
git add infra/lib/constructs/api-gateway.ts infra/test/stack.dev.test.ts \
        infra/test/__snapshots__ CLAUDE.md
git commit -m "feat(infra): authorizer-free GET /public/{proxy+} route

Amends the CLAUDE.md triage note in the same commit: this is the first route
that returns 200s to unauthenticated IPs, so Invocations > 0 no longer implies
authenticated usage."
```

---

### Task 4: api-client — public fetch + query hook

**Files:**
- Modify: `packages/api-client/src/fetchClient.ts` (add `ApiFetch` type + `createPublicFetch`)
- Create: `packages/api-client/src/hooks/usePublicConjugationSet.ts`
- Modify: `packages/api-client/src/index.ts` (export both)
- Test: `packages/api-client/src/hooks/usePublicConjugationSet.test.ts`

**Interfaces:**
- Consumes: existing `ExerciseSetResponseSchema` / `ExerciseSetResponse` from `../schemas/exercise`.
- Produces:
  - `export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>` (and `AuthenticatedFetch` becomes an alias of it, so every existing consumer keeps compiling)
  - `createPublicFetch(): ApiFetch`
  - `usePublicConjugationSet({ lang, level, count, fetchFn, enabled }): UseQueryResult<ExerciseSetResponse, Error>` where `lang: 'ES'|'DE'|'TR'`, `level: 'A1'|'A2'|'B1'|'B2'`, `count?: number`, `fetchFn: ApiFetch`, `enabled?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/src/hooks/usePublicConjugationSet.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePublicConjugationSet } from './usePublicConjugationSet';

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const payload = {
  exercises: [
    {
      id: 'a',
      type: 'conjugation',
      language: 'TR',
      difficulty: 'B1',
      grammarPointKey: 'tr-b1-evidential',
      contentJson: { type: 'conjugation', lemma: 'gitmek', targetForm: 'gitmiş' },
    },
  ],
  available: 1,
  difficulty: 'B1',
};

describe('usePublicConjugationSet', () => {
  it('requests the public path with lang/level/count and parses the response', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));

    const { result } = renderHook(
      () =>
        usePublicConjugationSet({ lang: 'TR', level: 'B1', count: 10, fetchFn }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith(
      '/public/conjugation/set?lang=TR&level=B1&count=10',
    );
    expect(result.current.data?.available).toBe(1);
  });

  it('does not fetch while disabled', () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload)));
    renderHook(
      () => usePublicConjugationSet({ lang: 'ES', level: 'A2', fetchFn, enabled: false }),
      { wrapper: wrapper() },
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('surfaces a schema violation as an error', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ exercises: 'nope', available: -1 })),
    );
    const { result } = renderHook(
      () => usePublicConjugationSet({ lang: 'DE', level: 'A1', fetchFn }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test src/hooks/usePublicConjugationSet.test.ts`
Expected: FAIL — cannot resolve `./usePublicConjugationSet`.

- [ ] **Step 3: Add `ApiFetch` + `createPublicFetch`**

In `packages/api-client/src/fetchClient.ts`, replace the `AuthenticatedFetch` type declaration with:

```ts
/** Any API fetch wrapper — authenticated or public. */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Historical name, kept so existing call sites compile unchanged. Identical to
 * {@link ApiFetch}: the distinction is which factory produced it, not its shape.
 */
export type AuthenticatedFetch = ApiFetch;
```

and add at the end of the file:

```ts
/**
 * Fetch wrapper for the unauthenticated `/public/*` endpoints. Sends no
 * Authorization header and never calls Clerk, so it works for a signed-out
 * visitor. Error handling mirrors `createAuthenticatedFetch` so callers can
 * treat failures identically.
 */
export function createPublicFetch(): ApiFetch {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string>),
      },
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }
      const message =
        errorBody && typeof errorBody === 'object' && 'error' in errorBody
          ? (errorBody as { error: string }).error
          : `Request failed: ${response.status}`;
      throw new Error(message);
    }

    return response;
  };
}
```

- [ ] **Step 4: Write the hook**

Create `packages/api-client/src/hooks/usePublicConjugationSet.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import {
  ExerciseSetResponseSchema,
  type ExerciseSetResponse,
} from '../schemas/exercise';
import type { ApiFetch } from '../fetchClient';

export type PublicLanguage = 'ES' | 'DE' | 'TR';
export type PublicLevel = 'A1' | 'A2' | 'B1' | 'B2';

export type UsePublicConjugationSetParams = {
  lang: PublicLanguage;
  level: PublicLevel;
  count?: number;
  fetchFn: ApiFetch;
  enabled?: boolean;
};

/**
 * The anonymous conjugation sitting. No token, no writes: the set is fetched
 * once and graded client-side, so there is no submit mutation to pair with it.
 */
export function usePublicConjugationSet({
  lang,
  level,
  count,
  fetchFn,
  enabled = true,
}: UsePublicConjugationSetParams) {
  return useQuery<ExerciseSetResponse, Error>({
    queryKey: ['public-conjugation-set', lang, level, count],
    queryFn: async () => {
      const params = new URLSearchParams({ lang, level });
      if (count) params.set('count', String(count));
      const response = await fetchFn(`/public/conjugation/set?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseSetResponseSchema.parse(json);
    },
    enabled,
    // The sitting must not change under the visitor. A fresh set ("try again")
    // is an explicit refetch().
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
```

- [ ] **Step 5: Export from the package index**

In `packages/api-client/src/index.ts`, add:

```ts
export { createPublicFetch, type ApiFetch } from './fetchClient';
export {
  usePublicConjugationSet,
  type UsePublicConjugationSetParams,
  type PublicLanguage,
  type PublicLevel,
} from './hooks/usePublicConjugationSet';
```

(If `./fetchClient` already has an export block in this file, add `createPublicFetch` and `ApiFetch` to it rather than writing a second block.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/api-client test`
Expected: PASS, including the 3 new cases and every pre-existing one (the `AuthenticatedFetch` alias must not have broken anything).

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/fetchClient.ts \
        packages/api-client/src/hooks/usePublicConjugationSet.ts \
        packages/api-client/src/hooks/usePublicConjugationSet.test.ts \
        packages/api-client/src/index.ts
git commit -m "feat(api-client): public fetch wrapper + usePublicConjugationSet"
```

---

### Task 5: The public conjugation item component

A self-contained item view: prompt, input, accent picker, verdict. It deliberately does **not** reuse `(dashboard)/fluency/_components/fluency-item.tsx` or `FeedbackShell` — both live inside the authenticated route group, and the public surface must not depend on the dashboard shell. It *does* reuse the genuinely shared pieces: `ConjugationPromptCard`, `components/ui`, and `conjugationVerdict`.

**Files:**
- Create: `apps/web/components/drill/public-conjugation-item.tsx`
- Test: `apps/web/components/drill/__tests__/public-conjugation-item.test.tsx`

**Interfaces:**
- Consumes: `ConjugationPromptCard` from `./conjugation-prompt`; `AccentPicker`, `Button`, `Card`, `Input` from `../ui`; `conjugationVerdict` from `../../lib/drill/verdict-tier`; `ConjugationContent` type from `@language-drill/shared`.
- Produces:
  ```ts
  export type PublicVerdict = { correct: boolean } | null;
  export interface PublicConjugationItemProps {
    content: ConjugationContent;
    language: 'ES' | 'DE' | 'TR';
    verdict: PublicVerdict;
    onSubmit: (answer: string) => void;
    onNext: () => void;
    isLast: boolean;
  }
  export function PublicConjugationItem(props: PublicConjugationItemProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/drill/__tests__/public-conjugation-item.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseType, type ConjugationContent } from '@language-drill/shared';
import { PublicConjugationItem } from '../public-conjugation-item';

const content: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'gitmek',
  lemmaGloss: 'to go',
  featureBundle: 'geçmiş zaman · 3. tekil',
  targetForm: 'gitti',
  breakdown: 'git- + -ti',
  exampleSentences: ['Dün okula gitti.'],
};

function setup(overrides: Partial<React.ComponentProps<typeof PublicConjugationItem>> = {}) {
  const onSubmit = vi.fn();
  const onNext = vi.fn();
  render(
    <PublicConjugationItem
      content={content}
      language="TR"
      verdict={null}
      onSubmit={onSubmit}
      onNext={onNext}
      isLast={false}
      {...overrides}
    />,
  );
  return { onSubmit, onNext };
}

describe('PublicConjugationItem', () => {
  it('shows the lemma and its gloss', () => {
    setup();
    expect(screen.getByText('gitmek')).toBeInTheDocument();
    expect(screen.getByText('to go')).toBeInTheDocument();
  });

  it('does not reveal the target form before an answer', () => {
    setup();
    expect(screen.queryByText('gitti')).not.toBeInTheDocument();
  });

  it('submits the typed answer', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('gitti');
  });

  it('will not submit an empty answer', async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reveals the form, breakdown and examples once graded', () => {
    setup({ verdict: { correct: false } });
    expect(screen.getByText('gitti')).toBeInTheDocument();
    expect(screen.getByText('git- + -ti')).toBeInTheDocument();
    expect(screen.getByText('Dün okula gitti.')).toBeInTheDocument();
  });

  it('offers "see results" on the last item and "next" otherwise', () => {
    setup({ verdict: { correct: true }, isLast: true });
    expect(screen.getByRole('button', { name: /see results/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test components/drill/__tests__/public-conjugation-item.test.tsx`
Expected: FAIL — cannot resolve `../public-conjugation-item`.

- [ ] **Step 3: Write the component**

Create `apps/web/components/drill/public-conjugation-item.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { ConjugationContent } from '@language-drill/shared';
import { AccentPicker, Button, Card, Input } from '../ui';
import { ConjugationPromptCard } from './conjugation-prompt';
import { conjugationVerdict } from '../../lib/drill/verdict-tier';

export type PublicVerdict = { correct: boolean } | null;

export interface PublicConjugationItemProps {
  content: ConjugationContent;
  language: 'ES' | 'DE' | 'TR';
  verdict: PublicVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

/**
 * One item of the anonymous conjugation sitting.
 *
 * Deliberately independent of the dashboard: `FeedbackShell` and `FluencyItem`
 * live under `app/(dashboard)/`, and a public page that imported them would
 * couple the signed-out surface to the authenticated shell's evolution. The
 * shared pieces (prompt card, ui primitives, verdict tiers) are reused.
 */
export function PublicConjugationItem({
  content,
  language,
  verdict,
  onSubmit,
  onNext,
  isLast,
}: PublicConjugationItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locked = verdict !== null;

  // Clear and refocus for each new item; this component is reused across items.
  React.useEffect(() => {
    setAnswer('');
  }, [content]);

  React.useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [content, locked]);

  const submit = React.useCallback(() => {
    if (locked || !answer.trim()) return;
    onSubmit(answer);
  }, [answer, locked, onSubmit]);

  const tier = verdict ? conjugationVerdict(verdict.correct ? 1 : 0) : null;
  const alsoAccepted = (content.acceptableForms ?? []).filter(
    (f) => f.trim().toLowerCase() !== content.targetForm.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-s-4">
      <ConjugationPromptCard content={content} />

      <div className="flex flex-col gap-s-3">
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          readOnly={locked}
          disabled={locked}
          className="font-display"
          style={{ fontSize: 22, paddingTop: 14, paddingBottom: 14 }}
        />
        <AccentPicker language={language} targetRef={inputRef} disabled={locked} />
      </div>

      {!locked && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} disabled={!answer.trim()}>
            submit
          </Button>
        </div>
      )}

      {verdict && tier && (
        <Card padding="lg">
          <div className="flex flex-col gap-s-4">
            <p className="t-small text-ink-mute">{tier.label}</p>
            <p className="t-display-m">{content.targetForm}</p>
            {alsoAccepted.length > 0 && (
              <p className="t-small text-ink-mute">
                also accepted: {alsoAccepted.join(', ')}
              </p>
            )}
            <p className="t-body-l text-ink-mute">{content.breakdown}</p>
            {content.exampleSentences.length > 0 && (
              <ul className="flex flex-col gap-s-2">
                {content.exampleSentences.map((sentence) => (
                  <li key={sentence} className="t-body">
                    {sentence}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={onNext}>
                {isLast ? 'see results' : 'next'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test components/drill/__tests__/public-conjugation-item.test.tsx`
Expected: PASS — 6 tests.

If `Button` ignores `variant="primary"` styling, note that `cn()` in this repo has no tailwind-merge, so a className override may need `!important` — but do not add styling not asserted by a test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/drill/public-conjugation-item.tsx \
        apps/web/components/drill/__tests__/public-conjugation-item.test.tsx
git commit -m "feat(web): item view for the anonymous conjugation drill"
```

---

### Task 6: The `/try/conjugation` page

Runner, debrief, page, and the middleware entry the page cannot work without.

**Files:**
- Create: `apps/web/app/try/conjugation/_components/public-conjugation-runner.tsx`
- Create: `apps/web/app/try/conjugation/page.tsx`
- Modify: `apps/web/proxy.ts` (export the matcher, add `/try(.*)`)
- Test: `apps/web/app/try/conjugation/__tests__/public-conjugation-runner.test.tsx`
- Test: `apps/web/__tests__/proxy.test.ts`

**Interfaces:**
- Consumes: `PublicConjugationItem`, `PublicVerdict` (Task 5); `usePublicConjugationSet`, `createPublicFetch` (Task 4); `gradeFluencyAnswer`, `isConjugationContent` from `@language-drill/shared`.
- Produces: `PublicConjugationRunner({ lang, level })` — a client component owning fetch, index, verdicts and the debrief.

- [ ] **Step 1: Write the failing runner test**

Create `apps/web/app/try/conjugation/__tests__/public-conjugation-runner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicConjugationRunner } from '../_components/public-conjugation-runner';

const fetchMock = vi.fn();
vi.mock('@language-drill/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/api-client')>()),
  createPublicFetch: () => fetchMock,
}));

function item(id: string, lemma: string, targetForm: string) {
  return {
    id,
    type: 'conjugation',
    language: 'TR',
    difficulty: 'B1',
    grammarPointKey: 'tr-b1-past',
    contentJson: {
      type: 'conjugation',
      instructions: 'Write the correct form.',
      lemma,
      lemmaGloss: 'to go',
      featureBundle: 'geçmiş zaman',
      targetForm,
      breakdown: `${lemma} breakdown`,
      exampleSentences: [`${lemma} example`],
    },
  };
}

function renderRunner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PublicConjugationRunner lang="TR" level="B1" />
    </QueryClientProvider>,
  );
}

describe('PublicConjugationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grades a correct answer locally, with no network call per answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ exercises: [item('a', 'gitmek', 'gitti')], available: 1 }),
      ),
    );
    renderRunner();

    await userEvent.type(await screen.findByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(screen.getByText('gitti')).toBeInTheDocument();
    // One fetch for the set, and only one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a Turkish answer typed with a non-Turkish keyboard capital', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ exercises: [item('a', 'içmek', 'içti')], available: 1 }),
      ),
    );
    renderRunner();

    // "Içti" — capital I from a non-TR keyboard. gradeFluencyAnswer folds both ways.
    await userEvent.type(await screen.findByRole('textbox'), 'Içti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(screen.getByText(/exact/i)).toBeInTheDocument();
  });

  it('ends on a debrief that reports the score and says nothing was saved', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          exercises: [item('a', 'gitmek', 'gitti'), item('b', 'gelmek', 'geldi')],
          available: 2,
        }),
      ),
    );
    renderRunner();

    await userEvent.type(await screen.findByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.type(screen.getByRole('textbox'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    await userEvent.click(screen.getByRole('button', { name: /see results/i }));

    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/wasn't saved/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });

  it('renders an honest empty state for a cell with no content', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ exercises: [], available: 0 })),
    );
    renderRunner();
    expect(await screen.findByText(/nothing to practise here yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test app/try/conjugation`
Expected: FAIL — cannot resolve `../_components/public-conjugation-runner`.

- [ ] **Step 3: Write the runner**

Create `apps/web/app/try/conjugation/_components/public-conjugation-runner.tsx`:

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  gradeFluencyAnswer,
  isConjugationContent,
  type ConjugationContent,
} from '@language-drill/shared';
import {
  createPublicFetch,
  usePublicConjugationSet,
  type PublicLanguage,
  type PublicLevel,
} from '@language-drill/api-client';
import { Button, Card } from '../../../../components/ui';
import {
  PublicConjugationItem,
  type PublicVerdict,
} from '../../../../components/drill/public-conjugation-item';

export interface PublicConjugationRunnerProps {
  lang: PublicLanguage;
  level: PublicLevel;
}

type Answered = { lemma: string; targetForm: string; userAnswer: string; correct: boolean };

/**
 * The anonymous sitting. Fetches one set, then grades every answer in the
 * browser with `gradeFluencyAnswer` — the same pure function the authenticated
 * submit path calls, so the Turkish İ/I dual case-fold and the
 * diacritics-are-significant rule come along unchanged.
 *
 * Nothing is persisted: no history row, no mastery update, no anonymous session.
 * The debrief says so rather than implying saved progress.
 */
export function PublicConjugationRunner({ lang, level }: PublicConjugationRunnerProps) {
  const fetchFn = React.useMemo(() => createPublicFetch(), []);
  const { data, isLoading, isError, refetch } = usePublicConjugationSet({
    lang,
    level,
    fetchFn,
  });

  const [index, setIndex] = React.useState(0);
  const [verdict, setVerdict] = React.useState<PublicVerdict>(null);
  const [done, setDone] = React.useState(false);
  const answersRef = React.useRef<Answered[]>([]);

  const items = React.useMemo(
    () =>
      (data?.exercises ?? []).filter((e) => isConjugationContent(e.contentJson as never)),
    [data],
  );

  function restart() {
    answersRef.current = [];
    setIndex(0);
    setVerdict(null);
    setDone(false);
    void refetch();
  }

  if (isLoading) return <p className="t-body text-ink-mute">loading…</p>;

  if (isError) {
    return (
      <Card padding="lg">
        <p className="t-body">Couldn&apos;t load the drill just now.</p>
        <Button variant="primary" onClick={() => void refetch()}>
          try again
        </Button>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card padding="lg">
        <p className="t-body">
          There&apos;s nothing to practise here yet for {lang} {level}. Try another
          level.
        </p>
      </Card>
    );
  }

  if (done) {
    const correct = answersRef.current.filter((a) => a.correct).length;
    const missed = answersRef.current.filter((a) => !a.correct);
    return (
      <Card padding="lg">
        <div className="flex flex-col gap-s-4">
          <p className="t-display-m">
            {correct} / {answersRef.current.length}
          </p>
          {missed.length > 0 && (
            <ul className="flex flex-col gap-s-2">
              {missed.map((a) => (
                <li key={`${a.lemma}-${a.userAnswer}`} className="t-body">
                  {a.lemma}: you wrote <em>{a.userAnswer}</em> — {a.targetForm}
                </li>
              ))}
            </ul>
          )}
          <p className="t-small text-ink-mute">
            This practice wasn&apos;t saved. Sign up to track which forms you
            actually know.
          </p>
          <div className="flex gap-s-3">
            <Link href="/sign-up" className="t-body">
              sign up
            </Link>
            <Button variant="secondary" onClick={restart}>
              practise more
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const current = items[index]!;
  const content = current.contentJson as ConjugationContent;

  function handleSubmit(answer: string) {
    const correct = gradeFluencyAnswer(content, answer);
    answersRef.current.push({
      lemma: content.lemma,
      targetForm: content.targetForm,
      userAnswer: answer,
      correct,
    });
    setVerdict({ correct });
  }

  function handleNext() {
    if (index + 1 >= items.length) {
      setDone(true);
      return;
    }
    setIndex((i) => i + 1);
    setVerdict(null);
  }

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-small text-ink-mute">
        {index + 1} of {items.length}
      </p>
      <PublicConjugationItem
        content={content}
        language={lang}
        verdict={verdict}
        onSubmit={handleSubmit}
        onNext={handleNext}
        isLast={index + 1 >= items.length}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the runner tests to verify they pass**

Run: `pnpm --filter @language-drill/web test app/try/conjugation`
Expected: PASS — 4 tests.

- [ ] **Step 5: Write the page**

Create `apps/web/app/try/conjugation/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicConjugationRunner } from './_components/public-conjugation-runner';
import type { PublicLanguage, PublicLevel } from '@language-drill/api-client';

export const metadata: Metadata = {
  title: 'drill — try a conjugation set',
  description:
    'Ten conjugation prompts in Spanish, German or Turkish, graded instantly. No signup.',
};

const LANGS: PublicLanguage[] = ['ES', 'DE', 'TR'];
const LEVELS: PublicLevel[] = ['A1', 'A2', 'B1', 'B2'];

function parseLang(raw: string | undefined): PublicLanguage {
  const upper = (raw ?? '').toUpperCase();
  return (LANGS as string[]).includes(upper) ? (upper as PublicLanguage) : 'ES';
}

function parseLevel(raw: string | undefined): PublicLevel {
  const upper = (raw ?? '').toUpperCase();
  return (LEVELS as string[]).includes(upper) ? (upper as PublicLevel) : 'B1';
}

/**
 * Public, unauthenticated conjugation drill. `?lang=` / `?level=` make a posted
 * link pre-targeted (a Turkish link for a Turkish community, not a picker), and
 * anything unrecognised falls back to ES/B1 rather than erroring.
 */
export default async function TryConjugationPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; level?: string }>;
}) {
  const { lang: rawLang, level: rawLevel } = await searchParams;
  const lang = parseLang(rawLang);
  const level = parseLevel(rawLevel);

  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-s-6 px-s-4 py-s-8">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="t-body">
          drill
        </Link>
        <nav className="flex gap-s-4">
          {LEVELS.map((l) => (
            <Link
              key={l}
              href={`/try/conjugation?lang=${lang}&level=${l}`}
              className={l === level ? 't-small' : 't-small text-ink-mute'}
            >
              {l}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex gap-s-4">
        {LANGS.map((l) => (
          <Link
            key={l}
            href={`/try/conjugation?lang=${l}&level=${level}`}
            className={l === lang ? 't-body' : 't-body text-ink-mute'}
          >
            {l}
          </Link>
        ))}
      </div>

      <PublicConjugationRunner lang={lang} level={level} />
    </main>
  );
}
```

- [ ] **Step 6: Write the failing middleware test**

Create `apps/web/__tests__/proxy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { isPublicRoute } from '../proxy';

function req(path: string) {
  return new NextRequest(new URL(path, 'https://langdrill.app'));
}

describe('isPublicRoute', () => {
  it('treats the public try surface as public', () => {
    expect(isPublicRoute(req('/try/conjugation'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation?lang=TR&level=B1'))).toBe(true);
  });

  it('keeps the existing public pages public', () => {
    expect(isPublicRoute(req('/'))).toBe(true);
    expect(isPublicRoute(req('/privacy'))).toBe(true);
  });

  it('still protects the dashboard', () => {
    expect(isPublicRoute(req('/home'))).toBe(false);
    expect(isPublicRoute(req('/drill'))).toBe(false);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test __tests__/proxy.test.ts`
Expected: FAIL — `isPublicRoute` is not exported from `proxy.ts`.

- [ ] **Step 8: Export the matcher and add the route**

In `apps/web/proxy.ts`, change `const isPublicRoute = createRouteMatcher([` to `export const isPublicRoute = createRouteMatcher([` and add inside the array, after the `'/academic-rigour'` entry:

```ts
  '/try(.*)', // public, unauthenticated drill surface — no signup required
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm --filter @language-drill/web test __tests__/proxy.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 10: Verify the page builds and renders signed out**

```bash
pnpm --filter @language-drill/web build
```
Expected: build succeeds and lists `/try/conjugation` among the routes. A web unit-test pass does not cover the root layout and providers — only `next build` does.

Then, with `pnpm dev:api` and `pnpm dev:web` running, open `http://localhost:3000/try/conjugation?lang=TR&level=B1` in a **signed-out** browser (or a private window) and confirm: no redirect to sign-in, a prompt renders, a correct answer shows the verdict, and ten items end on the debrief.

If `localhost:3000` gets stuck in a Clerk dev-browser handshake loop, kill the `next` processes and `rm -rf apps/web/.next`, then restart.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/try apps/web/proxy.ts apps/web/__tests__/proxy.test.ts
git commit -m "feat(web): /try/conjugation — anonymous, stateless conjugation drill"
```

---

### Task 7: End-to-end coverage in the unauthenticated project

**Files:**
- Create: `apps/web/e2e/tests/unauthenticated/try-conjugation.spec.ts`

**Interfaces:**
- Consumes: the deployed `/try/conjugation` page (Task 6) and the live `GET /public/conjugation/set`.
- Produces: nothing other consumers rely on.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/tests/unauthenticated/try-conjugation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// The public drill is the one product surface that must work with no session
// at all, so it belongs in the `unauthenticated` project: the `authenticated`
// project's storageState would hide a regression that redirects it to sign-in.
test.describe('public conjugation drill', () => {
  test('a signed-out visitor can answer an item', async ({ page }) => {
    await page.goto('/try/conjugation?lang=ES&level=B1');

    // Must NOT be bounced to Clerk.
    await expect(page).toHaveURL(/\/try\/conjugation/);

    const input = page.getByRole('textbox');
    await expect(input).toBeVisible();

    await input.fill('definitely-not-the-form');
    await page.getByRole('button', { name: /submit/i }).click();

    // A graded item reveals the correct form and offers the next step.
    await expect(page.getByRole('button', { name: /next|see results/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @language-drill/web test:e2e --project=unauthenticated try-conjugation`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/tests/unauthenticated/try-conjugation.spec.ts
git commit -m "test(web): e2e for the signed-out conjugation drill"
```

---

### Task 8: Full gate and PR

- [ ] **Step 1: Lint and typecheck the whole repo**

```bash
pnpm lint
pnpm typecheck
```
Expected: zero errors. `pnpm typecheck` per package excludes test files, so a type error inside a test only surfaces in the test run.

- [ ] **Step 2: Run the test suites package by package**

```bash
pnpm --filter @language-drill/shared test
pnpm --filter @language-drill/api-client test
pnpm --filter @language-drill/lambda test
pnpm --filter @language-drill/infra test
pnpm --filter @language-drill/web test
```
Expected: all PASS. Run them separately — a single root `pnpm test` gets OOM-killed on this machine. If the lambda suite shows failures in files you did not touch, `rm -rf infra/lambda/dist` and re-run.

- [ ] **Step 3: Report the result**

State the totals as "X passed, Y failed" per package, with any failure and a proposed fix. Do not open the PR with a red suite.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/public-conjugation-drill
gh pr create --title "A conjugation drill a stranger can use without signing up" --body "$(cat <<'BODY'
Opens `/try/conjugation` to anonymous visitors: ten conjugation prompts in
ES/DE/TR, graded instantly, nothing saved. The point is a link we can post in a
learner community that lands on something that works instead of a signup wall.

Spec: `docs/superpowers/specs/2026-09-29-public-conjugation-drill-design.md`
Plan: `docs/superpowers/plans/2026-09-29-public-conjugation-drill.md`

**Costs nothing to serve.** Conjugation grading is already deterministic
(`routes/exercises.ts:428`), and the public page reuses `gradeFluencyAnswer`
from `@language-drill/shared` in the browser — the same pure function the
authenticated submit path calls, so the Turkish İ/I dual case-fold comes along
unchanged. No Claude call, no DB write, no `usage_events` row.

**Two constraints hold the security line.** `type` is a server constant, never
a request parameter — `contentJson` is returned wholesale, so an overridable
type would expose the whole ~30k-row pool with its answers. And the query is
projected explicitly rather than `select()`-ing every column, so a future
`exercises` column cannot start leaking to the open web.

**The abuse brake is a cache, not a rate limiter.** Upstash is named in the
stack table but is not actually wired into the Lambda, and the real exposure of
an unauthenticated GET is Neon compute rather than scraping. A module-scope
5-minute pool cache puts the ceiling at 12 queries per Lambda instance per TTL
regardless of traffic.

**Reviewer's attention, please:** this is the first route that returns 200s to
unauthenticated IPs, so `Invocations > 0` no longer implies authenticated
usage. The CLAUDE.md triage note from #738/#739 is amended in the same commit.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: Squash-merge once CI is green**

Edit the squash commit message to the PR summary rather than accepting the
concatenated commit list.

---

## Post-merge follow-ups (not part of this plan)

- Set `AI_GLOBAL_DAILY_CAP` in the prod deploy environment before promoting the
  link widely. It is unset today, so the per-user 50/day free cap is the only
  brake on the *authenticated* AI paths this feature funnels into.
- Feature 2: anonymous cloze/translation demo with real Claude feedback. Needs
  an actual abuse limiter, which this plan deliberately does not build.
- Feature 3: public + search-indexed theory library (312 approved pages). Needs
  unauthenticated read endpoints, server rendering, and a sampled human review
  pass before crawlers see 311 `auto-approved` grammar explanations.
