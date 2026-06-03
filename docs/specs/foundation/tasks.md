# Implementation Plan

## Task Overview

Build the Language Drill monorepo scaffold from scratch: workspace tooling, shared packages, Drizzle schema, Lambda/Hono skeleton, CDK infrastructure, Clerk auth integration in Next.js, CI/CD pipeline, and invite gate. Tasks are ordered so each builds on the previous with no circular dependencies.

## Steering Document Compliance

All file paths follow the monorepo layout defined in tech.md §4 and the design document. TypeScript is used throughout. No files outside the documented structure are created.

## Atomic Task Requirements
**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1-3 related files maximum
- **Time Boxing**: Completable in 15-30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Tasks

### Group 1 — Monorepo Root Scaffold

- [x] 1. Create root `package.json` with pnpm workspaces and Turborepo
  - File: `package.json`
  - Fields: `name: "language-drill"`, `private: true`, `packageManager: "pnpm@9"`, scripts for `build / dev / lint / typecheck / test` delegating to `turbo run`
  - No runtime dependencies at root; dev deps: `turbo`, `typescript`, `eslint`, `prettier`
  - _Requirements: 1.1, 1.2_

- [x] 2. Create `pnpm-workspace.yaml`
  - File: `pnpm-workspace.yaml`
  - Declare globs: `apps/*`, `packages/*`, `infra`
  - _Requirements: 1.1_

- [x] 3. Create `turbo.json` pipeline
  - File: `turbo.json`
  - Define tasks: `build` (dependsOn: `^build`, outputs: `dist/**`), `dev` (persistent: true), `lint` (no deps), `typecheck` (dependsOn: `^build`), `test` (dependsOn: `^build`)
  - Workspace glob-based package discovery — no package listed explicitly so any new `packages/*` entry in `pnpm-workspace.yaml` auto-participates
  - _Requirements: 1.2, 1.5_

- [x] 4. Create root TypeScript base config
  - File: `tsconfig.base.json`
  - Compiler options: `strict: true`, `moduleResolution: bundler`, `target: ES2022`, `lib: ["ES2022"]`, `declaration: true`, `declarationMap: true`
  - _Requirements: 1.3_

- [x] 5. Create root ESLint config
  - File: `.eslintrc.base.js`
  - Extend `@typescript-eslint/recommended`; rules: `no-explicit-any: error`, `no-unused-vars: error`
  - File: `.eslintignore` — exclude `dist/`, `node_modules/`, `.next/`, `cdk.out/`
  - _Requirements: 1.3_

- [x] 6. Create `.env.example` at repo root
  - File: `.env.example`
  - Document all required env vars across all packages with placeholder values and comments
  - Vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_URL` (placeholder — Phase 1), `AWS_REGION`, `NEXT_PUBLIC_API_URL`, `CLERK_WEBHOOK_SECRET`
  - _Requirements: 2.7, NFR-Usability_

---

### Group 2 — `packages/shared`

- [x] 7. Scaffold `packages/shared` package
  - Files: `packages/shared/package.json`, `packages/shared/tsconfig.json`
  - `package.json`: `name: "@language-drill/shared"`, `main: "./dist/index.js"`, `types: "./dist/index.d.ts"`, build script using `tsc`
  - `tsconfig.json`: extends `../../tsconfig.base.json`, `outDir: ./dist`, `rootDir: ./src`
  - _Requirements: 1.4_

- [x] 8. Create shared types and enums in `packages/shared`
  - File: `packages/shared/src/index.ts`
  - Export: `Language` enum (`EN | ES | DE | TR`), `CefrLevel` enum (`A1 | A2 | B1 | B2 | C1 | C2`), `ApiError` type (`{ error: string; code: string; status: number }`), `InviteCode` type (`{ code: string; expiresAt?: string }`)
  - _Requirements: 1.4, 6.3_

- [x] 9. Add unit tests for `packages/shared`
  - File: `packages/shared/src/index.test.ts`
  - Vitest config: `packages/shared/vitest.config.ts`
  - Tests: assert `Language` enum has 4 values, `CefrLevel` has 6, `ApiError` shape matches
  - _Requirements: 1.3_

---

### Group 3 — `packages/db`

- [x] 10. Scaffold `packages/db` package
  - Files: `packages/db/package.json`, `packages/db/tsconfig.json`
  - `package.json`: `name: "@language-drill/db"`, deps: `drizzle-orm`, `@neondatabase/serverless`; devDeps: `drizzle-kit`
  - Export: `src/index.ts` (re-exports schema + client)
  - _Requirements: 3.1_

- [x] 11. Create Drizzle database client factory
  - File: `packages/db/src/client.ts`
  - Import `neon` from `@neondatabase/serverless`, `drizzle` from `drizzle-orm/neon-http`
  - Export `createDb(connectionString: string)` → Drizzle instance; export `Db` type
  - _Requirements: 3.1, 3.3_

- [x] 12. Create Drizzle schema — `users` and `user_language_profiles` tables
  - File: `packages/db/src/schema/users.ts`
  - Define `users` table: `id text PK` (Clerk user ID), `email text NOT NULL UNIQUE`, `createdAt timestamp DEFAULT now()`, `updatedAt timestamp`
  - Define `user_language_profiles` table: `id uuid PK DEFAULT gen_random_uuid()`, `userId text FK→users.id`, `language text NOT NULL`, `proficiencyLevel text`, `assessedAt timestamp`
  - _Requirements: 3.2, 3.3_

- [x] 13. Create Drizzle schema — `skills` and `skill_topics` tables
  - File: `packages/db/src/schema/skills.ts`
  - Define `skills` table: `id uuid PK`, `name text NOT NULL` (listening|reading|writing|speaking), `language text NOT NULL` (language-scoped per design decision)
  - Define `skill_topics` table: `id uuid PK`, `skillId uuid FK→skills.id`, `name text NOT NULL`, `cefrLevel text`, `language text NOT NULL`
  - _Requirements: 3.2, 3.3_

- [x] 14. Create Drizzle schema — `exercises` and `exercise_tags` tables
  - File: `packages/db/src/schema/exercises.ts`
  - Define `exercises`: `id uuid PK`, `type text`, `language text`, `difficulty text`, `contentJson jsonb`, `audioS3Key text` (nullable), `createdAt timestamp`
  - Define `exercise_tags`: `exerciseId uuid FK→exercises.id`, `skillTopicId uuid FK→skill_topics.id`, composite PK
  - _Requirements: 3.2, 3.3_

- [x] 15. Create Drizzle schema — `user_exercise_history` and `spaced_repetition_cards` tables
  - File: `packages/db/src/schema/progress.ts`
  - Define `user_exercise_history`: `id uuid PK`, `userId text FK→users.id`, `exerciseId uuid FK→exercises.id`, `score real`, `responseJson jsonb`, `evaluatedAt timestamp`
  - Define `spaced_repetition_cards`: `id uuid PK`, `userId text FK→users.id`, `itemType text`, `itemId text`, `dueAt timestamp`, `interval integer DEFAULT 1`, `easeFactor real DEFAULT 2.5`, `repetitions integer DEFAULT 0`
  - _Requirements: 3.2, 3.3_

- [x] 16. Create Drizzle schema — `playlists` and `playlist_items` tables
  - File: `packages/db/src/schema/playlists.ts`
  - Define `playlists`: `id uuid PK`, `userId text FK→users.id` (nullable — null = system playlist), `name text`, `language text`, `createdAt timestamp`
  - Define `playlist_items`: `id uuid PK`, `playlistId uuid FK→playlists.id`, `exerciseId uuid FK→exercises.id`, `position integer`
  - _Requirements: 3.2, 3.3_

- [x] 17. Create Drizzle schema — `invitations` and `usage_events` tables
  - File: `packages/db/src/schema/access.ts`
  - Define `invitations`: `id uuid PK`, `code text UNIQUE NOT NULL`, `usedBy text` (nullable), `usedAt timestamp` (nullable), `expiresAt timestamp` (nullable), `createdAt timestamp DEFAULT now()`
  - Define `usage_events`: `id uuid PK`, `userId text FK→users.id`, `eventType text NOT NULL`, `metadata jsonb`, `createdAt timestamp DEFAULT now()`
  - _Requirements: 3.2, 3.3, 6.2_

- [x] 18. Create Drizzle schema index and database indexes
  - File: `packages/db/src/schema/index.ts`
  - Re-export all table definitions from tasks 12–17
  - Add indexes: `user_exercise_history(userId, evaluatedAt DESC)`, `spaced_repetition_cards(userId, dueAt)`, `invitations(code)`, `invitations(usedBy)`
  - _Requirements: 3.2, 3.3_

- [x] 19. Configure `drizzle.config.ts` for migrations
  - File: `packages/db/drizzle.config.ts`
  - Point at `src/schema/index.ts`, output migrations to `migrations/`, dialect `postgresql`
  - File: `packages/db/package.json` — add to the `scripts` section created in Task 10: `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), `db:studio` (`drizzle-kit studio`)
  - _Leverage: packages/db/package.json_
  - _Requirements: 3.1, 3.4_

- [x] 20. Create invite seed script
  - File: `packages/db/scripts/seed-invites.ts`
  - Accept `--count N` and `--expires-days D` CLI args; insert N rows into `invitations` with random 8-char codes and optional expiry; log generated codes to stdout
  - _Requirements: 6.5_

---

### Group 4 — `packages/ai` and `packages/api-client`

- [x] 21. Scaffold `packages/ai` stub
  - Files: `packages/ai/package.json`, `packages/ai/tsconfig.json`, `packages/ai/src/index.ts`
  - Export: `createClaudeClient(apiKey: string)` (stub returning `{ apiKey }` — implementation in Phase 1), `PromptTemplate` type (`{ name: string; system: string; user: string }`)
  - Dep: `@anthropic-ai/sdk`
  - _Requirements: 1.4_

- [x] 22a. Scaffold `packages/api-client` package files
  - Files: `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/index.ts`
  - `package.json`: `name: "@language-drill/api-client"`, deps: `@tanstack/react-query`, `zod`, `@language-drill/shared`
  - `src/index.ts`: empty barrel export (populated in 22b)
  - _Requirements: 1.4_

- [x] 22b. Create health schema and `useHealth` hook in `packages/api-client`
  - File: `packages/api-client/src/schemas/health.ts` — export `HealthResponseSchema = z.object({ status: z.literal('ok'), ts: z.number() })`
  - File: `packages/api-client/src/hooks/useHealth.ts` — `useQuery` hook: calls `GET /health`, validates response with `HealthResponseSchema`, reads base URL from env
  - Update `packages/api-client/src/index.ts` to re-export both
  - _Leverage: packages/api-client/src/index.ts_
  - _Requirements: 1.4_

---

### Group 5 — Lambda Handler

- [x] 23. Scaffold Lambda package
  - Files: `infra/lambda/package.json`, `infra/lambda/tsconfig.json`
  - Deps: `hono`, `@language-drill/db`, `@language-drill/shared`; devDeps: `@types/aws-lambda`
  - _Requirements: 2.3_

- [x] 24. Create Hono app entry point and Lambda adapter
  - File: `infra/lambda/src/index.ts`
  - Import `Hono` from `hono`, `handle` from `hono/aws-lambda`
  - Create `app` instance, register routes (imported in subsequent tasks), export `handler = handle(app)`
  - _Requirements: 2.3, 2.6_

- [x] 25. Create Lambda DB singleton
  - File: `infra/lambda/src/db.ts`
  - Import `createDb` from `@language-drill/db`; read `DATABASE_URL` from `process.env`; if undefined, throw `new Error('DATABASE_URL is not set')` at module load time (fail fast on cold start, not on first request)
  - Export singleton `db` instance (module-level — reused across warm invocations)
  - _Requirements: 2.4, NFR-Performance_

- [x] 26. Create Hono auth middleware
  - File: `infra/lambda/src/middleware/auth.ts`
  - Read `sub` claim from `c.env.event.requestContext.authorizer.jwt.claims`; set `c.set('userId', sub)`; call `next()`; if `sub` missing, return 401
  - _Requirements: 4.6, 2.4_

- [x] 27. Create Hono invite middleware
  - File: `infra/lambda/src/middleware/invite.ts`
  - Query `db.select().from(invitations).where(eq(invitations.usedBy, userId)).limit(1)`; if no row found, return `{ error: 'Forbidden', code: 'NO_INVITE' }` with status 403
  - _Requirements: 6.6_

- [x] 28. Create health-check route
  - File: `infra/lambda/src/routes/health.ts`
  - `app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }))`
  - This route is unauthenticated (no auth/invite middleware) — it is only used for CDK deploy verification
  - _Requirements: 2.6_

- [x] 29. Create Clerk webhook handler
  - File: `infra/lambda/src/routes/webhooks/clerk.ts`
  - Verify Clerk webhook signature using `svix` package and `CLERK_WEBHOOK_SECRET` env var
  - Handle `user.created` event: upsert row in `users` (id = `data.id`, email = `data.email_addresses[0].email_address`); find matching unused `invitations` row by Clerk invitation metadata; update `usedBy = userId`, `usedAt = now()`
  - Return 200 on success, 400 on signature failure
  - Dep: `svix`
  - _Requirements: 6.2, 4.1_

- [x] 30. Add unit tests for invite and auth middleware
  - File: `infra/lambda/src/middleware/invite.test.ts`
  - Vitest; mock `db` with `vi.mock`; test 200 path (valid invite row found) and 403 path (no row found)
  - File: `infra/lambda/src/middleware/auth.test.ts`
  - Test 401 when `sub` missing, `userId` set in context when present
  - _Requirements: 6.6, 4.6_

- [x] 30b. Add unit test for health-check route
  - File: `infra/lambda/src/routes/health.test.ts`
  - Vitest; use Hono's `app.request('/health')` test helper; assert `status === 200`, response body matches `{ status: 'ok', ts: expect.any(Number) }`
  - _Leverage: infra/lambda/src/routes/health.ts_
  - _Requirements: 2.6_

---

### Group 6 — `apps/web` (Next.js + Clerk)

- [x] 31. Scaffold `apps/web` Next.js app
  - Files: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
  - Deps: `next`, `react`, `react-dom`, `@clerk/nextjs`, `@language-drill/api-client`, `@language-drill/shared`; devDeps: `tailwindcss`, `@types/react`
  - `next.config.ts`: `transpilePackages: ['@language-drill/api-client', '@language-drill/shared']`
  - _Requirements: 4.1_

- [x] 32. Create Clerk middleware for Next.js
  - File: `apps/web/middleware.ts`
  - Use `clerkMiddleware()` from `@clerk/nextjs/server`; protect all routes except `/sign-in`, `/sign-up`, `/api/webhooks/*`; redirect unauthenticated users to `/sign-in`
  - Session token refresh on expiry is handled automatically by Clerk's middleware (R4.7) — no custom implementation needed
  - _Requirements: 4.1, 4.7_

- [x] 33. Create root layout with `ClerkProvider`
  - File: `apps/web/app/layout.tsx`
  - Wrap children in `<ClerkProvider>`; set `<html lang="en">`; import global Tailwind CSS
  - File: `apps/web/app/globals.css` — Tailwind `@tailwind base/components/utilities` directives
  - File: `apps/web/tailwind.config.ts` — scan `app/**`, `components/**`
  - _Requirements: 4.2_

- [x] 34. Create sign-in page
  - File: `apps/web/app/sign-in/[[...sign-in]]/page.tsx`
  - Render Clerk `<SignIn>` component; centered layout, no custom styling required in Phase 0
  - _Requirements: 4.2_

- [x] 35. Create authenticated dashboard placeholder
  - File: `apps/web/app/(dashboard)/page.tsx`
  - Server component; call `auth()` from `@clerk/nextjs/server` to get `userId`; render `<p>Welcome, {userId}</p>` — placeholder only
  - _Requirements: 4.1, 4.2_

- [x] 36. Create server-side API fetch helper with Clerk JWT
  - File: `apps/web/lib/api-server.ts`
  - Server-only helper (add `'use server'` or document it is for use in Server Components and Route Handlers only)
  - Export `apiFetch(path: string, init?: RequestInit)`: calls `await auth()` from `@clerk/nextjs/server`, then `await auth().getToken()` to retrieve JWT; sets `Authorization: Bearer <token>` header; prepends `NEXT_PUBLIC_API_URL`; throws if token is null (user not signed in)
  - Note: for client-side API calls (Phase 1 React components), a separate `lib/api-client.ts` using `useAuth().getToken()` will be added at that time
  - _Requirements: 4.3_

- [x] 37. Create `apps/web` `.env.example`
  - File: `apps/web/.env.example`
  - Document: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_API_URL`
  - _Requirements: NFR Usability_

---

### Group 7 — CDK Infrastructure

- [x] 38a. Scaffold CDK package boilerplate
  - Files: `infra/package.json`, `infra/tsconfig.json`, `infra/cdk.json`
  - `package.json`: deps `aws-cdk-lib`, `constructs`; devDeps `aws-cdk`, `ts-node`; scripts: `synth`, `deploy`, `diff`
  - `cdk.json`: `app: "npx ts-node bin/app.ts"`, `context: { "@aws-cdk/aws-apigateway:usagePlanKeyOrderInsensitiveId": true }`
  - `tsconfig.json`: extends `../tsconfig.base.json`, includes `bin/` and `lib/`
  - _Requirements: 2.1_

- [x] 38b. Create CDK entry point `infra/bin/app.ts`
  - File: `infra/bin/app.ts`
  - Import `App` from `aws-cdk-lib`, `LanguageDrillStack` from `../lib/stack`
  - Read `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` from env; instantiate `LanguageDrillStack` with env `{ account, region }`
  - _Leverage: infra/package.json_
  - _Requirements: 2.1_

- [x] 39. Create CDK Lambda construct
  - File: `infra/lib/constructs/lambda.ts`
  - Export `LambdaConstruct` extending `Construct`
  - Use `NodejsFunction` with `entry: infra/lambda/src/index.ts`, `bundling: { minify: true, sourceMap: true }`, `timeout: Duration.seconds(15)`, `memorySize: 256`
  - Read `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_URL` (placeholder for R2.7) from Secrets Manager (`secretsmanager.Secret.fromSecretNameV2`) and inject as `environment`
  - _Requirements: 2.2, 2.4, 2.5, 2.7_

- [x] 40. Create CDK API Gateway construct
  - File: `infra/lib/constructs/api-gateway.ts`
  - Export `ApiGatewayConstruct` extending `Construct`
  - Create `HttpApi` with `HttpJwtAuthorizer` (issuer: `https://<CLERK_DOMAIN>`, audience from env); set `corsPreflight: { allowOrigins: ['https://*.vercel.app', process.env.PRODUCTION_ORIGIN], allowMethods: [CorsHttpMethod.ANY], allowHeaders: ['Authorization', 'Content-Type'] }`
  - Add `HttpLambdaIntegration` connecting to the Lambda function
  - _Requirements: 2.2, 2.3, 4.4, NFR-Security_

- [x] 41. Create CDK S3 and SQS constructs
  - File: `infra/lib/constructs/storage.ts`
  - Export `StorageConstruct`: `Bucket` with `blockPublicAccess: BlockPublicAccess.BLOCK_ALL`, `versioned: true`, `removalPolicy: RemovalPolicy.RETAIN`
  - File: `infra/lib/constructs/queue.ts`
  - Export `QueueConstruct`: `Queue` (standard) with `deadLetterQueue: { queue: new Queue(...), maxReceiveCount: 3 }`, `visibilityTimeout: Duration.seconds(90)` (6× Lambda 15s timeout)
  - _Requirements: 2.2_

- [x] 42. Assemble main CDK stack
  - File: `infra/lib/stack.ts`
  - Export `LanguageDrillStack` extending `Stack`
  - Instantiate and wire: `LambdaConstruct`, `ApiGatewayConstruct`, `StorageConstruct`, `QueueConstruct`
  - Grant Lambda read access to S3 bucket; grant Lambda `sqs:SendMessage` on queue
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 43. Create CDK `infra/` README
  - File: `infra/README.md`
  - Document one-time bootstrap steps: `cdk bootstrap`, required Secrets Manager entries (names + expected values), required env vars for `cdk deploy`, and the `cdk deploy` command
  - _Requirements: NFR Usability_

---

### Group 8 — CI/CD Pipeline

- [x] 44. Create PR CI workflow
  - File: `.github/workflows/ci.yml`
  - Trigger: `pull_request` (opened, synchronize, reopened)
  - Jobs (parallel): `lint-typecheck` (`pnpm turbo lint typecheck`), `test` (`pnpm turbo test`), `neon-branch` (create branch `pr-${{ github.event.number }}` via `neonctl`, output `DATABASE_URL` as masked step output)
  - Sequential after all three: `migrate` (run `pnpm --filter @language-drill/db db:migrate` with `DATABASE_URL` from `neon-branch` output), `preview` (Vercel CLI deploy `apps/web`, post preview URL as PR comment)
  - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

- [x] 45. Create production deploy workflow
  - File: `.github/workflows/deploy.yml`
  - Trigger: `push` to `main`
  - Jobs: `cdk-deploy` (`cd infra && pnpm cdk deploy --require-approval never`), then `vercel-prod` (Vercel CLI `--prod`)
  - No Neon cleanup here — `github.event.number` is not available on `push` events. Neon branch cleanup is handled exclusively by Task 46's `cleanup.yml` which triggers on `pull_request: closed`
  - _Requirements: 5.4_

- [x] 46. Create PR cleanup workflow
  - File: `.github/workflows/cleanup.yml`
  - Trigger: `pull_request` (closed)
  - Job: delete Neon branch `pr-${{ github.event.number }}` via `neonctl`
  - _Requirements: 5.5_

- [x] 47. Add GitHub Actions secrets documentation
  - File: `.github/SECRETS.md`
  - Table documenting every required secret: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `TURBO_TOKEN`, `TURBO_TEAM`
  - _Requirements: 5.7, NFR-Usability_

- [x] 47b. Document Clerk dashboard invite configuration
  - File: `docs/setup/clerk-invites.md`
  - Document the required one-time Clerk dashboard steps to activate invite-only signup: navigate to User & Authentication → Invitations; enable "Require invitation"; disable open sign-ups
  - Document how to create invite codes via Clerk dashboard and via the Clerk Management API (`POST /v1/invitations`)
  - Note: this Clerk configuration is what enforces R4.5 (blocks account creation without valid invite) — it cannot be done in code
  - _Requirements: 4.5_

---

### Group 9 — Integration Verification

- [x] 48. Run `drizzle-kit generate` and commit initial migration
  - Run: `pnpm --filter @language-drill/db db:generate`
  - Commit the generated SQL file in `packages/db/migrations/`
  - Verify: migration file contains all 12 table `CREATE TABLE` statements
  - _Requirements: 3.1, 3.2_

- [x] 49. Verify `cdk synth` produces valid CloudFormation
  - Run: `cd infra && pnpm cdk synth`
  - Confirm: no synthesis errors; output template contains `AWS::Lambda::Function`, `AWS::ApiGatewayV2::Api`, `AWS::S3::Bucket`, `AWS::SQS::Queue`
  - _Requirements: 2.1_

- [x] 50. Add `pnpm turbo typecheck` smoke test to verify cross-package types
  - Run: `pnpm turbo typecheck` from repo root
  - Confirm: all packages pass with zero TypeScript errors; cross-package imports from `@language-drill/shared` and `@language-drill/db` resolve correctly in both `apps/web` and `infra/lambda`
  - _Requirements: 1.3, 1.4, 3.3_
