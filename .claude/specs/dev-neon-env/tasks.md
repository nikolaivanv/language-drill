# Implementation Plan

## Task Overview

Land the dev environment by (a) parameterizing the existing `LanguageDrillStack` so it can be instantiated as both prod and dev, (b) wiring an env-driven CORS allowlist into the Hono Lambda, (c) extending `deploy.yml` with a dev-side chain that runs after the existing prod chain, and (d) updating documentation. Each task is sized so a single agent can complete it, run the relevant lint/typecheck/test, and verify against a single requirement before moving on.

## Steering Document Compliance

- All CDK changes stay in `infra/lib/constructs/` (per-resource files) and `infra/lib/stack.ts` (orchestrator) — matches `tech.md` structure.
- The existing `prod-migrate → cdk-deploy → vercel-prod` chain (added in commit `0ea72b7`) is preserved; we extend it rather than rewrite it.
- No new framework or runtime is introduced — all changes use Hono, Drizzle, AWS CDK v2, and the existing pnpm/Turborepo build, per `CLAUDE.md`.
- Tests use Vitest (already the project's test framework) and live alongside implementation per existing convention.

## Atomic Task Requirements

Each task touches 1–3 files, takes ~15–30 minutes, and produces one testable outcome. After every task: run `pnpm lint`, `pnpm typecheck`, and the relevant `pnpm test` filter. Do not proceed to the next task if any of those fail.

## Tasks

### Group A — CDK refactor (no behavior change for prod)

- [x] 1. Add `LambdaConstructProps` to `infra/lib/constructs/lambda.ts` and build secret names from a prefix
  - File: `infra/lib/constructs/lambda.ts`
  - Define `interface LambdaConstructProps { secretsPrefix: string; additionalEnv?: Record<string, string>; }`
  - Change constructor signature to `(scope, id, props: LambdaConstructProps)`
  - Replace each hardcoded `"language-drill/..."` literal with `` `${props.secretsPrefix}/...` ``; keep all six existing `Secret.fromSecretNameV2` construct IDs (`DatabaseUrl`, `ClerkSecretKey`, `ClerkWebhookSecret`, `AnthropicApiKey`, `UpstashRedisRestUrl`, `UpstashRedisRestToken`)
  - Spread `props.additionalEnv` into the Lambda's `environment` object after the secret values
  - Update `infra/lib/stack.ts` (the only caller) to pass `{ secretsPrefix: 'language-drill' }`
  - Purpose: enable per-env secret namespaces without changing prod's resolved secret names
  - _Leverage: infra/lib/constructs/lambda.ts (existing unsafeUnwrap pattern), infra/lib/stack.ts_
  - _Requirements: 3.2_

- [x] 2. Add `apiName` prop to `infra/lib/constructs/api-gateway.ts` and parameterize CfnOutput description
  - Files: `infra/lib/constructs/api-gateway.ts`, `infra/lib/stack.ts`
  - Add `apiName: string` to `ApiGatewayConstructProps`; replace the hardcoded `apiName: "language-drill-api"` with `props.apiName`
  - Replace the hardcoded `"api.langdrill.app"` in the `ApiDomainTarget` `CfnOutput` description with the prop value: `` `Add a CNAME in Cloudflare: ${props.apiDomainName} → this value` ``
  - Update `stack.ts` caller to pass `apiName: 'language-drill-api'` (unchanged from current value)
  - Purpose: let the dev stack name its API differently while keeping the prod resource shape identical
  - _Leverage: infra/lib/constructs/api-gateway.ts:37 (existing apiName literal), infra/lib/constructs/api-gateway.ts:88-90 (existing CfnOutput)_
  - _Requirements: 3.3, 6.1_

- [x] 3. Refactor `infra/lib/stack.ts` to props-required AND update `infra/bin/app.ts` to instantiate both stacks (must land together to avoid a build-broken intermediate state)
  - Files: `infra/lib/stack.ts`, `infra/bin/app.ts`
  - **In `stack.ts`:** define `interface LanguageDrillStackProps extends StackProps { envName: 'prod' | 'dev'; secretsPrefix: string; apiName: string; apiDomainName: string; clerkIssuerUrl: string; clerkAudience: string[]; allowedOrigins: string[]; enableScheduledJobs: boolean; }`
  - Change constructor signature to require `props: LanguageDrillStackProps`
  - Pass `secretsPrefix` and `additionalEnv: { ALLOWED_ORIGINS: props.allowedOrigins.join(','), ENV_NAME: props.envName }` to `LambdaConstruct`
  - Pass `apiName`, `apiDomainName`, `clerkIssuerUrl`, `clerkAudience` to `ApiGatewayConstruct` (replace the existing `process.env.X ??` reads — those reads move to `bin/app.ts` below)
  - Add `Tags.of(this).add('env', props.envName)` after construct wiring
  - **In `bin/app.ts`:** add a `requireEnv(key: string): string` helper that throws `Error: Missing required env var: ${key}` when unset
  - Instantiate `LanguageDrillStack` (prod) with: `envName: 'prod'`, `secretsPrefix: 'language-drill'`, `apiName: 'language-drill-api'`, `apiDomainName: requireEnv('API_DOMAIN_NAME')`, `clerkIssuerUrl: requireEnv('CLERK_ISSUER_URL')`, `clerkAudience` parsed from `CLERK_AUDIENCE` (defaulting to `language-drill`), `allowedOrigins: ['https://*.vercel.app', 'https://langdrill.app', 'https://www.langdrill.app']`, `enableScheduledJobs: true`
  - Instantiate `LanguageDrillStack-dev` with: `envName: 'dev'`, `secretsPrefix: 'language-drill-dev'`, `apiName: 'language-drill-api-dev'`, `apiDomainName: requireEnv('API_DOMAIN_NAME_DEV')`, `clerkIssuerUrl: requireEnv('CLERK_ISSUER_URL_DEV')`, `clerkAudience` parsed from `CLERK_AUDIENCE_DEV` (defaulting to `language-drill`), `allowedOrigins: ['https://*.vercel.app', 'http://localhost:3000']`, `enableScheduledJobs: false`
  - Preserve the existing `env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }` for both stacks
  - Purpose: complete the CDK refactor in one atomic change — `stack.ts` becomes a pure orchestrator with no env-var reads, and both stacks are wired up before anything else depends on them
  - _Leverage: infra/lib/stack.ts (existing wiring order), infra/bin/app.ts (current single-stack instantiation)_
  - _Requirements: 3.1, 3.4, 3.5, 4.1_

- [x] 4. Add per-stack pnpm scripts to `infra/package.json`
  - File: `infra/package.json`
  - Add scripts: `"synth:prod": "cdk synth LanguageDrillStack --exclusively"`, `"synth:dev": "cdk synth LanguageDrillStack-dev --exclusively"`, `"deploy:prod": "cdk deploy LanguageDrillStack --exclusively --require-approval never"`, `"deploy:dev": "cdk deploy LanguageDrillStack-dev --exclusively --require-approval never"`
  - Keep existing `synth`, `diff`, `deploy` scripts unchanged so backward compat is preserved
  - Purpose: give operators a single command per env without remembering CDK flag syntax
  - _Leverage: infra/package.json (existing scripts block)_
  - _Requirements: NFR Usability_

### Group B — Lambda runtime CORS

- [x] 5. Replace hardcoded CORS origins in `infra/lambda/src/index.ts` with env-driven allowlist
  - File: `infra/lambda/src/index.ts`
  - Parse `process.env.ALLOWED_ORIGINS` as comma-separated; if unset, fall back to `['https://*.vercel.app', 'https://langdrill.app', 'https://www.langdrill.app']` (preserves current local `pnpm dev:api` behavior)
  - Replace the existing `endsWith('.vercel.app')` check with a matcher that handles two patterns: exact equality, and wildcard suffix where a pattern starts with `*.` (so `https://*.vercel.app` matches `https://pr-123-foo.vercel.app`)
  - Keep `allowMethods` and `allowHeaders` unchanged
  - **Do not modify** `infra/lambda/src/dev.ts` — its `DEV_USER_ID` injection for the local dev server must remain unchanged (Requirement 4.4)
  - Purpose: let CDK control which origins the deployed Lambda accepts, per env
  - _Leverage: infra/lambda/src/index.ts:12-23 (existing cors middleware)_
  - _Requirements: 4.4, 6.3, 6.4, 6.5_

- [x] 6. Add CORS matcher unit tests in `infra/lambda/src/index.test.ts`
  - File: `infra/lambda/src/index.test.ts` (new)
  - Test that with `ALLOWED_ORIGINS='https://*.vercel.app,http://localhost:3000'`: `https://pr-1.vercel.app` is allowed, `http://localhost:3000` is allowed, `https://langdrill.app` is rejected
  - Test that with `ALLOWED_ORIGINS='https://langdrill.app'`: `https://langdrill.app` is allowed, `https://evil.com` is rejected
  - Test that with `ALLOWED_ORIGINS` unset: the fallback list applies (`*.vercel.app` and `langdrill.app` accepted)
  - Use Vitest's `vi.stubEnv` to scope env var changes; restore in `afterEach`
  - **Note:** `infra/lambda/vitest.config.ts` already exists — no config bootstrap needed
  - Purpose: lock in the allowlist behavior so future CORS regressions are caught at PR time
  - _Leverage: infra/lambda/vitest.config.ts (existing), infra/lambda/src/index.ts (after task 5)_
  - _Requirements: 6.3, 6.4, 6.5_

### Group C — CDK assertions

- [x] 7. Add Vitest config and prod-stack snapshot test in `infra/test/`
  - Files: `infra/vitest.config.ts` (new), `infra/test/stack.snapshot.test.ts` (new)
  - In `vitest.config.ts`, configure Vitest to discover tests under `test/**/*.test.ts` only (avoid picking up `cdk.out`, `node_modules`)
  - In `stack.snapshot.test.ts`: synth `LanguageDrillStack` (prod) with the same prop values `bin/app.ts` uses; capture the synthesized CFN template via `Template.fromStack(stack).toJSON()`; assert it matches a snapshot via `toMatchInlineSnapshot()` — first run uses `vitest run -u` to populate the snapshot
  - Use `process.env` stubs so the test doesn't require real GitHub-secrets-style env vars at run time (substitute placeholder strings; the test only cares about CFN shape, not deploy correctness)
  - Purpose: catch any future change that would force-replace prod resources before it merges
  - _Leverage: aws-cdk-lib/assertions Template helper, infra/lib/stack.ts_
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 8. Add dev-stack assertion test in `infra/test/stack.dev.test.ts`
  - File: `infra/test/stack.dev.test.ts` (new)
  - Synth `LanguageDrillStack-dev` with dev prop values
  - Assert via `Template.findResources('AWS::IAM::Policy')` that no policy statement references a secret ARN containing `language-drill/` (only `language-drill-dev/`)
  - Assert via `Template.hasResourceProperties('AWS::ApiGatewayV2::Api', { Name: 'language-drill-api-dev' })`
  - Assert the stack-level tag `env=dev` is present (query the stack object directly via `stack.tags.tagValues()`)
  - Assert the Lambda's `Environment.Variables` includes `ENV_NAME=dev` and `ALLOWED_ORIGINS=https://*.vercel.app,http://localhost:3000`
  - Purpose: lock the dev-vs-prod boundary in tests so future refactors can't accidentally cross it
  - _Leverage: aws-cdk-lib/assertions, infra/lib/stack.ts_
  - _Requirements: 1.3, 3.2, 3.4_

- [x] 9. Add cron-not-on-dev assertion in `infra/test/stack.dev.test.ts`
  - File: `infra/test/stack.dev.test.ts` (extend from task 8)
  - Add a test asserting `Template.fromStack(devStack).resourceCountIs('AWS::Events::Rule', 0)` (no scheduled-job rules on dev when `enableScheduledJobs: false`)
  - Add a parallel assertion that the prod stack also currently has zero rules (no behavior change yet — Phase 1 introduces them) but uses `enableScheduledJobs: true`, leaving room for the count to grow
  - Purpose: prevent the future Phase 1 cron Lambda from accidentally activating on dev
  - _Leverage: aws-cdk-lib/assertions resourceCountIs_
  - _Requirements: NFR Reliability (cron gating)_

### Group D — CI/CD workflows

- [x] 10. Extend `.github/workflows/deploy.yml` with the dev-side chain
  - File: `.github/workflows/deploy.yml`
  - **CRITICAL — keep these in sync:** rename the existing `cdk-deploy` job to `cdk-deploy-prod`, AND update the existing `vercel-prod` job's `needs:` from `[cdk-deploy]` to `[cdk-deploy-prod]`. Forgetting the second edit silently breaks the prod deploy by leaving `vercel-prod` referencing a non-existent job name.
  - Change the renamed `cdk-deploy-prod` job's run command from `pnpm cdk deploy --require-approval never` to `pnpm cdk deploy LanguageDrillStack --exclusively --require-approval never`
  - Add a `dev-migrate` job that mirrors `prod-migrate`'s steps but uses `DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}`; declares `needs: [cdk-deploy-prod]`
  - Add a `cdk-deploy-dev` job that depends on `dev-migrate`; runs `pnpm cdk deploy LanguageDrillStack-dev --exclusively --require-approval never` with env vars `CLERK_ISSUER_URL_DEV` and `API_DOMAIN_NAME_DEV` (and optional `CLERK_AUDIENCE_DEV`); no downstream job depends on it
  - Purpose: deploy the dev stack on every push to main, with prod taking strict priority
  - _Leverage: .github/workflows/deploy.yml (existing prod-migrate job as the template for dev-migrate)_
  - _Requirements: 1.1, 1.2, 1.4, 2.3, 4.1, 5.1_

- [x] 11. Re-parent CI ephemeral Neon branches in `.github/workflows/ci.yml`
  - File: `.github/workflows/ci.yml`
  - In the `Create or reuse Neon branch` step, add `--parent dev` to the `neonctl branches create` invocation (line ~70)
  - No other change
  - Purpose: PR migration tests reflect the schema state preview deploys see
  - _Leverage: .github/workflows/ci.yml:70 (existing neonctl create call)_
  - _Requirements: 5.3_

### Group E — Documentation

- [x] 12. Fix the secrets table and add the dev secrets table in `infra/README.md`
  - File: `infra/README.md`
  - Replace the existing 5-row "Secrets Manager Entries" table with a 6-row version that lists all secrets the code currently reads: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (the existing table is missing the URL/TOKEN split — `lambda.ts` already expects 6)
  - Add a parallel "Dev Secrets Manager Entries" table with the same 6 names but prefixed `language-drill-dev/`, with a "Source" column noting where each value comes from (Neon dev branch URL, dev Clerk dashboard, separate Anthropic key, separate Upstash DB)
  - Purpose: make secret provisioning a copy-paste operation for the operator, with no guesswork about which six names matter
  - _Leverage: infra/README.md (existing Secrets Manager Entries section)_
  - _Requirements: 1.2, 1.4, 7.2_

- [x] 13. Add first-time dev environment runbook section to `infra/README.md`
  - File: `infra/README.md`
  - Add a "First-time dev environment setup" section after the secrets tables, with numbered steps: (1) provision the 6 dev secrets via `aws secretsmanager create-secret`, (2) run `pnpm --filter infra deploy:dev`, (3) post-deploy: fetch ACM validation CNAMEs via `aws acm describe-certificate`, add them to Cloudflare DNS-only, wait for `ISSUED`, (4) add the `api-dev` operational CNAME in Cloudflare pointing at the `ApiDomainTarget` output value, (5) configure dev Clerk JWT template named `api` and the webhook to `https://api-dev.langdrill.app/webhooks/clerk`, (6) update Vercel `Preview` env var `NEXT_PUBLIC_API_URL=https://api-dev.langdrill.app`, (7) before sharing any preview externally, run `neonctl branches reset dev --parent production`
  - Document the new GitHub Actions secrets the deploy workflow expects: `DEV_DATABASE_URL`, `CLERK_ISSUER_URL_DEV`, `API_DOMAIN_NAME_DEV`, optional `CLERK_AUDIENCE_DEV`
  - Purpose: a single contributor can rebuild the dev environment from scratch following one document
  - _Leverage: infra/README.md, design.md Integration Points section_
  - _Requirements: 4.2, 6.2, 7.2, NFR Security (Neon dev re-fork before external preview)_

- [x] 14. Add an environment matrix subsection to `CLAUDE.md`
  - File: `CLAUDE.md`
  - Under the existing `## CI/CD` section, before the existing `### Production domain` subsection, add a new `### Environment matrix` subsection containing one table with columns `Service | Production | Dev`. Rows: API domain (`api.langdrill.app` / `api-dev.langdrill.app`), CDK stack name (`LanguageDrillStack` / `LanguageDrillStack-dev`), Neon branch (`production` / `dev`), Clerk instance (prod / dev), Secrets prefix (`language-drill/` / `language-drill-dev/`), Vercel env scope (Production / Preview)
  - Purpose: make the prod-vs-dev split discoverable from the file every contributor reads first
  - _Leverage: CLAUDE.md (existing CI/CD section structure)_
  - _Requirements: 7.1_

- [x] 15. Archive `docs/dev-environment-plan.md`
  - Files: `docs/archived/dev-environment-plan.md` (new), `docs/dev-environment-plan.md` (deleted)
  - Move `docs/dev-environment-plan.md` to `docs/archived/dev-environment-plan.md`
  - Add a one-line header at the top of the archived file: `> **Implemented:** see spec at .claude/specs/dev-neon-env/`
  - Purpose: the plan was the design draft; once the spec is delivered it should not be mistaken for outstanding work in future codebase scans
  - _Leverage: docs/dev-environment-plan.md (existing content), docs/ (existing top-level docs directory)_
  - _Requirements: 7.3_
