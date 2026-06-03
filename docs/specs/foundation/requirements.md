# Requirements Document

## Introduction

The Foundation phase establishes the complete project scaffold for Language Drill — a serverless, AI-powered language learning app. This phase creates the monorepo structure, infrastructure skeleton, database schema, authentication, CI/CD pipeline, and invite-only access gate. Nothing is user-facing yet; the outcome is a fully wired, deployable baseline that all subsequent phases build on.

## Alignment with Product Vision

Language Drill is designed for intermediate-plateau language learners who need active production practice (writing and speaking) evaluated by AI. The Foundation phase is a prerequisite for all product capabilities: it sets up the infrastructure layer (serverless Lambda API, Neon Postgres, Upstash Redis), the developer experience layer (Turborepo monorepo, Neon per-PR branches, Vercel preview deploys), and the access control layer (Clerk auth + invite codes). Every architectural decision in this phase is locked by the product strategy: separate Lambda backend (reachable by mobile from day one), Neon over DynamoDB (relational data model), Clerk over Auth.js (invite/waitlist + JWT that API Gateway verifies directly).

## Requirements

### Requirement 1 — Monorepo Scaffold

**User Story:** As a developer, I want a pnpm + Turborepo monorepo with the correct workspace layout, so that all apps and packages share dependencies, types, and build pipelines without duplicated configuration.

#### Acceptance Criteria

1. WHEN the repository is cloned and `pnpm install` is run THEN all workspace dependencies SHALL resolve without errors.
2. WHEN `pnpm turbo build` is run THEN Turborepo SHALL execute build tasks in dependency order across `apps/web`, `packages/db`, `packages/ai`, `packages/api-client`, and `packages/shared`.
3. WHEN `pnpm turbo lint` and `pnpm turbo typecheck` are run THEN all packages SHALL pass with zero errors on a clean checkout.
4. IF a package in `packages/` exports a type THEN that type SHALL be importable in `apps/web` without path hacks (resolved via workspace protocol).
5. WHEN `pnpm turbo build` is run THEN Turborepo's pipeline SHALL include every directory listed under `packages/` in `pnpm-workspace.yaml`, with no package requiring separate manual registration in `turbo.json` to participate in the default pipeline.

### Requirement 2 — AWS CDK Infrastructure Skeleton

**User Story:** As a developer, I want an AWS CDK stack in TypeScript that provisions the core Lambda, API Gateway, S3, and SQS resources, so that the backend infrastructure is reproducible, version-controlled, and deployable via `cdk deploy`.

#### Acceptance Criteria

1. WHEN `cdk synth` is run in `infra/` THEN a valid CloudFormation template SHALL be produced with no synthesis errors.
2. WHEN `cdk deploy` is run THEN the following resources SHALL be created: an HTTP API (API Gateway v2), at least one Lambda function (Hono handler), an S3 bucket (content storage), and an SQS queue (async jobs). CloudFront distribution and EventBridge Scheduler are explicitly deferred to Phase 2 (audio) and are out of scope for this phase.
3. WHEN a request is made to the deployed API Gateway endpoint THEN API Gateway SHALL route it to the Lambda and return a response.
4. IF an environment variable is required by the Lambda THEN it SHALL be injected via CDK from AWS Secrets Manager or SSM — not hardcoded.
5. WHEN `cdk diff` is run after no changes THEN it SHALL report zero changes (idempotent deploy).
6. WHEN the Lambda cold-starts THEN it SHALL initialize the Hono app and respond to a health-check route (`GET /health`) within 3 seconds.
7. Upstash Redis (used for rate limiting and caching) is explicitly deferred to Phase 1 when the first AI-facing routes are introduced. The CDK stack in this phase SHALL include a placeholder environment variable (`UPSTASH_REDIS_URL`) to document the future dependency without provisioning it.

### Requirement 3 — Neon Database + Drizzle Schema v1

**User Story:** As a developer, I want a Neon serverless Postgres database with a Drizzle ORM schema covering the core entities, so that the data layer is type-safe and migration-driven from day one.

#### Acceptance Criteria

1. WHEN `drizzle-kit generate` is run in `packages/db` THEN migration SQL files SHALL be produced that are valid for Postgres 15+.
2. WHEN `drizzle-kit migrate` is run against the Neon database THEN all v1 tables SHALL be created: `users`, `user_language_profiles`, `skills`, `skill_topics`, `exercises`, `exercise_tags`, `user_exercise_history`, `spaced_repetition_cards`, `playlists`, `playlist_items`, `invitations`, `usage_events`.
3. WHEN a TypeScript file imports from `packages/db` THEN it SHALL have full type inference for all table columns with no `any` casts.
4. IF two migration files conflict THEN the CI pipeline SHALL fail with a clear error message before the branch is merged.
5. WHEN a new Neon branch is created for a PR THEN `drizzle-kit migrate` SHALL apply all pending migrations to that branch automatically (handled in CI, not manually).

### Requirement 4 — Clerk Auth Integration (Web)

**User Story:** As a developer, I want Clerk integrated into the Next.js web app so that users can sign in via magic link or Google OAuth, and the resulting JWT is forwarded to the Lambda API for verification.

#### Acceptance Criteria

1. WHEN an unauthenticated user visits any protected route in `apps/web` THEN Clerk SHALL redirect them to the sign-in page.
2. WHEN a user completes sign-in (magic link or Google OAuth) THEN Clerk SHALL create a session and redirect the user to the post-login destination.
3. WHEN the web app makes an API call to the Lambda THEN the Clerk session JWT SHALL be included in the `Authorization: Bearer <token>` header automatically.
4. WHEN API Gateway receives a request with a valid Clerk JWT THEN it SHALL pass the request to the Lambda; WHEN the JWT is missing or invalid THEN API Gateway SHALL return `401 Unauthorized` without invoking the Lambda.
5. WHEN a new user signs up without a valid invite code (see Requirement 6) THEN Clerk SHALL block account creation and display an appropriate error.
6. WHEN the Lambda reads `event.requestContext.authorizer.jwt.claims` THEN it SHALL have access to the Clerk user ID (`sub` claim) to identify the user.
7. WHEN a Clerk session token expires THEN the web app SHALL automatically attempt a silent refresh; IF the refresh fails THEN it SHALL redirect the user to the sign-in page.

### Requirement 5 — CI/CD Pipeline

**User Story:** As a developer, I want a GitHub Actions pipeline that lints, typechecks, tests, creates ephemeral Neon branches, deploys previews on PRs, and deploys to production on merge to `main`, so that every change is validated automatically and reviewable before it reaches production.

#### Acceptance Criteria

1. WHEN a pull request is opened or updated THEN GitHub Actions SHALL run lint, typecheck, and unit tests across all packages in parallel. Integration tests are deferred to Phase 1 (when the first Lambda routes and database queries exist to test against).

2. WHEN a pull request is opened THEN the pipeline SHALL create a new Neon branch named after the PR, run Drizzle migrations on it, and store the connection string as a temporary secret.
3. WHEN the PR tests pass THEN the pipeline SHALL trigger a Vercel preview deploy for `apps/web` and post the preview URL as a PR comment.
4. WHEN a pull request is merged to `main` THEN the pipeline SHALL run `cdk deploy` for Lambda/infra and trigger a Vercel production deploy.
5. WHEN a pull request is closed or merged THEN the pipeline SHALL delete the ephemeral Neon branch to avoid resource accumulation.
6. IF any CI step fails THEN the PR SHALL be blocked from merging and the failing step SHALL be clearly identified in the GitHub UI.
7. WHEN secrets are needed by the pipeline (AWS credentials, Neon token, Clerk keys, Vercel token) THEN they SHALL be stored in GitHub Actions Secrets and never committed to the repository.

### Requirement 6 — Invite-Only Access Gate

**User Story:** As the app owner, I want sign-ups to require a valid invite code, so that I control who can access the app during the early stage without building a full waitlist UI.

#### Acceptance Criteria

1. WHEN a user attempts to sign up THEN Clerk SHALL require an invite code to be entered before account creation proceeds.
2. WHEN a valid unused invite code is submitted THEN the system SHALL mark it as used in the `invitations` table, recording `used_by` (Clerk user ID) and `used_at` timestamp.
3. WHEN an invalid or already-used invite code is submitted THEN sign-up SHALL be rejected with a clear error message.
4. WHEN an invite code expires (`expires_at` in the past) THEN it SHALL be treated as invalid.
5. WHEN the app owner wants to create new invite codes THEN they SHALL be insertable directly via a database seed script or SQL — no admin UI is required at this phase.
6. IF a user's Clerk account exists but has no associated valid invite record THEN the API SHALL return `403 Forbidden` on all protected routes.

## Non-Functional Requirements

### Performance
- Lambda cold start on the health-check route SHALL complete within 3 seconds (p99).
- Neon connection pooling SHALL be configured so that Lambda does not exhaust Postgres connection limits under concurrent invocations (use Neon's connection pooler or `pg` pool with low max).
- Turborepo remote caching SHOULD be enabled so that CI build times drop on cache hits.

### Security
- All AWS credentials, database URLs, and API keys SHALL be stored in GitHub Secrets (CI) or AWS Secrets Manager (Lambda runtime) — never in source code or `.env` files committed to the repo.
- S3 buckets SHALL have public access blocked; all object access SHALL use pre-signed URLs.
- CORS on API Gateway SHALL be restricted to known origins (`vercel.app` preview domains and the production domain).
- Clerk JWT verification SHALL be enforced at the API Gateway level — the Lambda SHALL never trust unauthenticated requests.

### Reliability
- The CDK stack SHALL be idempotent — running `cdk deploy` twice SHALL produce the same result.
- Database migrations SHALL be forward-only; no destructive DDL in migration files.
- The CI pipeline SHALL fail fast — a lint error SHALL not block waiting for a 5-minute Neon branch creation.

### Usability (Developer Experience)
- A developer SHALL be able to run `pnpm install && pnpm turbo dev` from the repo root to start the Next.js dev server locally.
- Environment variable requirements SHALL be documented in a `.env.example` file at each app/package level.
- The `infra/` README SHALL document the one-time bootstrap steps (CDK bootstrap, Secrets Manager entries) required before `cdk deploy` works.
