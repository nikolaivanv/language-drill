# Requirements Document

## Introduction

A long-lived **dev environment** that runs in parallel to production, so Vercel preview deployments and local-against-cloud development hit an isolated API, database, and authentication instance. Production data and the production Clerk instance stop being touched by anyone testing in-flight features.

The plan this spec implements is `docs/dev-environment-plan.md`. Final state:

- `api-dev.langdrill.app` — second Lambda + API Gateway behind a separate CDK stack
- Neon `dev` branch (already created) — isolated from `production`
- Existing Clerk dev instance — wired to the new API via JWT authorizer + webhook
- Vercel `Preview` env points at the dev API; Vercel `Production` env unchanged
- A separate AWS Secrets Manager namespace (`language-drill-dev/*`) and a separate Upstash Redis DB
- CI's ephemeral Neon branches re-parented to `dev`

Out of scope: ephemeral per-PR backend stacks, a third (staging) tier, mobile-app dev flavor.

## Alignment with Product Vision

`docs/architecture.md` and `CLAUDE.md` already commit to **Neon over DynamoDB** specifically because Neon supports per-PR database branches, and to **all infra via CDK** with no console click-ops. This spec extends both decisions:

- Activates the parallel-environments capability that motivated the Neon choice.
- Keeps the rule that infra is reproducible from code — the dev stack is a second instantiation of the same CDK class, not a hand-rolled environment.
- Reduces the risk surface for future AI-cost spikes during development by isolating the dev Anthropic key + Upstash rate-limit budget.

The product positioning ("portfolio-quality, shareable") makes preview-deploy auth working correctly a hard requirement before the app is shown to anyone outside the author.

## Requirements

### Requirement 1 — Isolated dev backend

**User Story:** As a developer reviewing a Vercel preview deploy, I want the preview to hit a non-production API backed by non-production data, so that I can sign up, complete exercises, and exercise destructive flows without affecting real production state.

#### Acceptance Criteria

1. WHEN a Vercel preview deploy makes a request to `NEXT_PUBLIC_API_URL` THEN the request SHALL be served by the dev Lambda at `api-dev.langdrill.app`.
2. WHEN the dev Lambda executes a database query THEN the query SHALL be issued against the Neon `dev` branch (host `ep-holy-union-anhivmbh-pooler.c-6.us-east-1.aws.neon.tech`), never against the `production` branch.
3. WHEN the dev Lambda reads a runtime secret THEN it SHALL read from the `language-drill-dev/*` namespace in AWS Secrets Manager, never from `language-drill/*`.
4. WHEN the dev Lambda enforces a rate limit THEN it SHALL increment counters in the dev-scoped Upstash Redis instance, not the production instance.

### Requirement 2 — Production environment unchanged during rollout

**User Story:** As the operator of the production app, I want the dev environment to be additive, so that introducing it cannot break or downgrade the production deployment.

#### Acceptance Criteria

1. WHEN the dev stack is deployed for the first time THEN the existing `LanguageDrillStack` SHALL retain its current name and not be replaced.
2. WHEN the prod CDK stack is synthesized after the refactor THEN its CloudFormation diff SHALL contain no resource replacements (only metadata-level changes such as added tags are acceptable).
3. WHEN a production-bound CI deploy runs THEN it SHALL deploy `LanguageDrillStack` (prod) before `LanguageDrillStack-dev`, and a failure of the dev deploy SHALL NOT roll back the prod deploy.
4. WHEN production traffic hits `api.langdrill.app` THEN it SHALL continue to be served by the original Lambda with no observable change to latency, response shape, or auth behavior.

### Requirement 3 — CDK parameterized by environment

**User Story:** As a developer maintaining infra, I want one CDK stack class instantiated twice with different props, so that prod and dev cannot drift apart in shape and any future bug fix lands on both at once.

#### Acceptance Criteria

1. WHEN `bin/app.ts` is read THEN it SHALL instantiate `LanguageDrillStack` exactly twice — once as `LanguageDrillStack` (prod) and once as `LanguageDrillStack-dev` — passing `envName`, `domainName`, `secretsPrefix`, and `clerkIssuerUrl` as props.
2. WHEN `LambdaConstruct` is constructed THEN it SHALL receive a `secretsPrefix` prop and use it to build secret names (`${secretsPrefix}/DATABASE_URL`, `${secretsPrefix}/CLERK_SECRET_KEY`, `${secretsPrefix}/CLERK_WEBHOOK_SECRET`, `${secretsPrefix}/ANTHROPIC_API_KEY`, `${secretsPrefix}/UPSTASH_REDIS_REST_URL`, `${secretsPrefix}/UPSTASH_REDIS_REST_TOKEN`) — no hardcoded `language-drill/...` strings remain in construct code.
3. WHEN `ApiGatewayConstruct` is constructed THEN it SHALL receive `domainName` and `clerkIssuerUrl` as props rather than reading `process.env` directly.
4. WHEN either stack is synthesized THEN every taggable resource SHALL carry an `env=prod` or `env=dev` tag for cost attribution.
5. IF `CLERK_ISSUER_URL_DEV` is unset at synth time THEN the dev stack SHALL fail synth with a clear error message rather than deploying a broken JWT authorizer.

### Requirement 4 — Authentication routed by environment

**User Story:** As a developer testing on a Vercel preview, I want my Clerk dev-instance JWT to be accepted by the dev API, so that protected endpoints work and I can complete the signed-in user flows.

#### Acceptance Criteria

1. WHEN the dev API Gateway receives a request with a JWT issued by the dev Clerk instance THEN the JWT authorizer SHALL validate the token against the dev Clerk JWKS endpoint and forward authorized requests to the dev Lambda.
2. WHEN a `user.created` event fires in the dev Clerk instance THEN the Clerk webhook SHALL deliver it to `https://api-dev.langdrill.app/webhooks/clerk` and the dev Lambda SHALL upsert the user row in the Neon `dev` branch.
3. WHEN the prod API Gateway receives a request with a dev-Clerk-issued JWT THEN the prod authorizer SHALL reject it (issuer mismatch) — dev tokens SHALL never grant access to prod data.
4. WHEN the local dev server (`pnpm dev:api`) is running THEN it SHALL continue to bypass JWT validation by injecting `userId = dev_user_001`, unchanged from current behavior.

### Requirement 5 — Database migrations and seed apply to both environments

**User Story:** As a developer shipping a schema change, I want migrations to land on `dev` and `production` together via CI, so that schemas never drift and previews are not surprised by missing tables or columns.

#### Acceptance Criteria

1. WHEN `deploy.yml` runs on merge to `main` THEN it SHALL run `pnpm db:migrate` against the dev `DATABASE_URL` before deploying the dev stack, and against the prod `DATABASE_URL` before deploying the prod stack.
2. WHEN the dev Neon branch is first created THEN `pnpm db:seed:exercises` SHALL be runnable against it without error and SHALL populate the standard 36-exercise pool.
3. WHEN the CI ephemeral Neon branch is created for a PR THEN it SHALL be branched from `dev`, not from `production`, so migration tests reflect the schema state previews will see.
4. WHEN migrations are forward-only THEN both envs SHALL apply them in the same order — there SHALL be no env-specific migration paths.

### Requirement 6 — DNS, certificates, and CORS

**User Story:** As a developer hitting the dev API from a Vercel preview, I want the new domain to resolve, present a valid TLS cert, and allow my origin, so that browser requests succeed without manual configuration.

#### Acceptance Criteria

1. WHEN a browser resolves `api-dev.langdrill.app` THEN the Cloudflare CNAME SHALL point to the dev API Gateway custom domain target with DNS-only mode (grey cloud).
2. WHEN a browser establishes a TLS connection to `api-dev.langdrill.app` THEN the certificate SHALL chain to a valid public CA via an ACM-issued certificate validated through Cloudflare DNS.
3. WHEN a browser at any `https://*.vercel.app` origin makes a CORS-preflighted request to the dev API THEN the dev Lambda's CORS middleware SHALL allow the origin.
4. WHEN a browser at `http://localhost:3000` makes a request to the dev API THEN the dev Lambda's CORS middleware SHALL allow the origin (so local-against-cloud dev works).
5. WHEN a browser at the production `langdrill.app` origin makes a request to the dev API THEN it SHALL NOT be allowed by CORS (cross-env probes are not supported and SHALL fail closed).

### Requirement 7 — Documented configuration

**User Story:** As a future contributor (or future me), I want the env layout, secrets, and DNS state documented in-repo, so that I can rebuild the dev environment from scratch without spelunking through commit history.

#### Acceptance Criteria

1. WHEN a contributor reads `CLAUDE.md` THEN it SHALL describe the prod-vs-dev environment split, including domains, Neon branches, Clerk instances, secrets prefixes, and Vercel env-var mapping.
2. WHEN a contributor reads `infra/README.md` THEN it SHALL list the secret names in `language-drill-dev/*` alongside the existing prod secrets, with the same source-of-value column.
3. WHEN a contributor reads the implementation plan (`docs/dev-environment-plan.md`) THEN it SHALL be marked as implemented (or moved to an `archived/` location) once the spec is delivered, so it is not mistaken for outstanding work.

## Non-Functional Requirements

### Performance
- Dev Lambda cold start SHALL NOT exceed 1.5x the prod Lambda's cold start (same memory, same code, same runtime — no functional reason for divergence).
- The dev environment is best-effort; SLOs do not apply.

### Security
- The dev Anthropic API key SHALL be a separate key from production, with a monthly budget cap of $10 (or lower) configured in the Anthropic console — preventing a runaway preview from burning the production AI budget.
- The dev Clerk webhook secret SHALL be distinct from the production Clerk webhook secret. Compromise of one SHALL NOT permit forgery against the other.
- Production secrets in `language-drill/*` SHALL NOT be readable by the dev Lambda's IAM role, and vice versa.
- The Neon `dev` branch SHALL be re-forked from `production` (via `neonctl branches reset`) before the first preview is shared with any external user, so that any lingering test data does not leak prod-shaped PII.

### Reliability
- Failure of the dev stack (any cause) SHALL NOT degrade prod stack availability. The two stacks SHALL share no runtime resources — separate Lambda, separate API Gateway, separate Upstash, separate Anthropic key.
- Cron jobs / EventBridge schedulers (Phase 1+ pre-generation Lambda) SHALL be deployed on prod only. The dev stack SHALL gate scheduled jobs behind `envName === "prod"` to avoid burning the dev Anthropic budget on background work.

### Usability
- A single command (`pnpm cdk deploy LanguageDrillStack-dev`) SHALL deploy the dev environment from a developer machine with appropriate AWS credentials.
- Switching local dev between `dev` and `production` Neon branches SHALL require only a `DATABASE_URL` change in `.env` (existing `.env.bak.production` already supports this).
