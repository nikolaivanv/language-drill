> **Implemented:** see spec at `.claude/specs/dev-neon-env/`

# Dev Environment Plan

A long-lived `dev` environment so Vercel preview deploys (and local-against-cloud dev) hit a non-production API + database. Production data stops being touched by anyone testing PRs.

## Goal

Give every Vercel preview a backend that is **identical in shape** to production but operates on isolated data, so feature work is testable end-to-end without risk to real users.

## Current state (the problem)

```
                                     ┌──────────────────────────────┐
PR preview (pr-123.vercel.app)  ─┐   │ api.langdrill.app            │
Production    (langdrill.app)   ─┼─► │ Lambda (single)              │
Local        (localhost:3000)   ─┘   │   └─► Neon `production` br.  │
                                     │   └─► Clerk prod instance    │
                                     └──────────────────────────────┘
```

- One CDK stack, one Lambda, one API Gateway, one custom domain.
- Vercel `Preview` env points `NEXT_PUBLIC_API_URL` at production API.
- Vercel `Preview` Clerk keys are `pk_test_` (dev Clerk instance), but the production API authorizer validates against the **prod** Clerk JWKS — so preview auth either fails or is silently broken.
- CI's per-PR Neon branch only validates that migrations apply; it isn't wired to any running service.

## Target state

```
Production         ──► api.langdrill.app      ──► Neon `production`,  Clerk prod
Vercel Preview     ──► api-dev.langdrill.app  ──► Neon `dev`,         Clerk dev
Local dev          ──► localhost:3001         ──► Neon `dev`,         (auth bypassed)
```

Two parallel CDK stacks (`LanguageDrillStack-prod`, `LanguageDrillStack-dev`), each with its own Lambda, API Gateway, S3 bucket, SQS queue, and secrets namespace. Same code; different config.

---

## Components to add or change

### 1. CDK — parameterize the stack by environment

Single stack class, instantiated twice from `bin/app.ts` with different props:

```ts
// infra/bin/app.ts
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new LanguageDrillStack(app, "LanguageDrillStack-prod", {
  env,
  envName: "prod",
  domainName: "api.langdrill.app",
  secretsPrefix: "language-drill",
  clerkIssuerUrl: process.env.CLERK_ISSUER_URL_PROD,
});

new LanguageDrillStack(app, "LanguageDrillStack-dev", {
  env,
  envName: "dev",
  domainName: "api-dev.langdrill.app",
  secretsPrefix: "language-drill-dev",
  clerkIssuerUrl: process.env.CLERK_ISSUER_URL_DEV,
});
```

Changes inside the stack:
- `LambdaConstruct` takes a `secretsPrefix` and reads `${prefix}/DATABASE_URL`, `${prefix}/CLERK_*`, etc. instead of hardcoding `language-drill/...`.
- `ApiGatewayConstruct` takes `domainName` and `clerkIssuerUrl` instead of reading them from `process.env` directly.
- All construct IDs that today are unscoped (`Lambda`, `ApiGateway`, `Storage`, `Queue`) keep their existing IDs — CloudFormation scopes them under the stack name automatically. No refactor of construct IDs needed.
- Add an `envName` tag (`Tags.of(this).add("env", envName)`) for cost attribution.

**Risk:** the existing prod stack is named `LanguageDrillStack`. Renaming it to `LanguageDrillStack-prod` would force CloudFormation to delete and re-create everything. Two safe options:
- Keep prod's name as `LanguageDrillStack` and only add `LanguageDrillStack-dev` (asymmetric naming, but zero-risk).
- Or `cloudformation:stack-rename` after taking a snapshot — riskier; only worth it if we want clean naming.

**Recommendation:** keep prod stack name; only add dev stack.

### 2. AWS Secrets Manager — populate `language-drill-dev/*`

Create six secrets mirroring the prod set:

| Secret | Value |
|---|---|
| `language-drill-dev/DATABASE_URL` | Neon `dev` branch pooled connection string |
| `language-drill-dev/CLERK_SECRET_KEY` | `sk_test_...` from dev Clerk instance |
| `language-drill-dev/CLERK_WEBHOOK_SECRET` | dev Clerk webhook signing secret |
| `language-drill-dev/ANTHROPIC_API_KEY` | same key, or a separate budget-capped key |
| `language-drill-dev/UPSTASH_REDIS_REST_URL` | separate Upstash DB (free tier) for rate-limit isolation |
| `language-drill-dev/UPSTASH_REDIS_REST_TOKEN` | matching token |

Anthropic key: a separate dev key with a low monthly budget cap is cheap insurance against a runaway preview burning prod's budget.

Upstash: keep prod Redis untouched. A second free-tier Upstash DB takes ~2 minutes to provision.

### 3. ACM certificate + DNS

- Request an ACM cert for `api-dev.langdrill.app` (us-east-1 if API Gateway is regional, us-east-1 anyway for HTTP API custom domain).
- Add a Cloudflare CNAME `api-dev` → API Gateway custom domain target (DNS-only / grey cloud, per CLAUDE.md convention).
- CDK can manage the cert via `aws-cdk-lib/aws-certificatemanager` if we use Route53 for DNS validation; since we use Cloudflare, the simpler path is **manual cert request + DNS validation in Cloudflare**, then pass the cert ARN into the stack via context. Same pattern used for the prod cert.

### 4. Clerk — wire dev instance to dev API

Dev Clerk instance already exists (Vercel Preview already uses `pk_test_` / `sk_test_`). Two pieces of config to add:

- **JWT template named `api`** in the dev Clerk instance, with the same claims as prod (`{ "aud": "language-drill", "sub": "{{user.id}}" }`).
- **Webhook** in dev Clerk → `https://api-dev.langdrill.app/webhooks/clerk` (subscribe to `user.created`). Webhook secret goes into `language-drill-dev/CLERK_WEBHOOK_SECRET`.

`CLERK_ISSUER_URL_DEV` is the dev instance's frontend API URL (e.g. `https://romantic-bird-42.clerk.accounts.dev`). Use that in the JWT authorizer for `LanguageDrillStack-dev`.

### 5. Vercel — switch Preview env vars

Update **Preview** environment only (Production stays as-is):

| Variable | New Preview value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api-dev.langdrill.app` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | already `pk_test_` (no change) |
| `CLERK_SECRET_KEY` | already `sk_test_` (no change) |

CORS: dev Lambda's Hono CORS middleware needs to allow `https://*.vercel.app` (it already does for prod) and potentially `https://langdrill.app` if cross-env probes are needed. Audit `infra/lambda/src/middleware/cors.ts` to confirm the allowlist isn't pinned to prod.

### 6. CI/CD — deploy dev stack on PR or main

Two options:

**Option A (cheap, recommended for now):** dev stack is deployed only on merge to `main`, same as prod. PR previews share the dev backend. Anyone with multiple open PRs sees their changes interleaved on dev — fine for solo dev or small team, breaks down at scale.

**Option B (heavier):** dev stack is also deployed on every PR. Means every PR pushes Lambda code to a single `dev` Lambda. This is what Option A already gives you. True isolation per PR would need ephemeral stacks — not worth the cost yet.

Update `.github/workflows/deploy.yml`:
```yaml
- name: Deploy prod stack
  run: cd infra && pnpm cdk deploy LanguageDrillStack --require-approval never
- name: Deploy dev stack
  env:
    CLERK_ISSUER_URL_DEV: ${{ secrets.CLERK_ISSUER_URL_DEV }}
  run: cd infra && pnpm cdk deploy LanguageDrillStack-dev --require-approval never
```

CI's existing per-PR Neon branch (`.github/workflows/ci.yml`) keeps doing what it does — validate migrations. Re-parent it to `dev` so CI tests migrations against the same schema state preview deploys see.

### 7. Database lifecycle

- **Schema changes:** Drizzle migrations apply to **both** branches. Add a step to `deploy.yml` that runs `pnpm db:migrate` against the dev `DATABASE_URL` before the dev stack deploy, and against prod `DATABASE_URL` before the prod stack deploy.
- **Data drift:** dev branch will accumulate test data. Recommended cadence: re-fork `dev` from `production` quarterly (or whenever schema diverges hard) via `neonctl branches reset dev --parent production`.
- **Seed:** dev should have the standard exercise pool. Run `pnpm db:seed:exercises` against `dev` once, post-migration. It's idempotent so re-running is safe.

---

## Implementation tasks

In recommended order. Each item is a discrete, mergeable change.

1. **Refactor CDK constructs to take `secretsPrefix`, `domainName`, `clerkIssuerUrl` as props** — no behavioral change yet (prod stack still works). [~1h]
2. **Add `envName` prop to `LanguageDrillStack`; tag resources** — still single stack. [~30m]
3. **Provision `language-drill-dev/*` secrets in AWS Secrets Manager** — manual one-off via CLI, document values in `infra/README.md`. [~30m]
4. **Provision second Upstash DB and dev-scoped Anthropic key** — manual, fill into secrets above. [~15m]
5. **Request ACM cert for `api-dev.langdrill.app`; add Cloudflare CNAME** — manual; certificate validation can take 5–30min. [~1h elapsed]
6. **Configure dev Clerk: JWT template `api`, webhook to api-dev** — manual via Clerk dashboard. [~20m]
7. **Add `LanguageDrillStack-dev` instantiation in `bin/app.ts`** — wire all the props from env vars. [~30m]
8. **First dev stack deploy from a local machine** — `pnpm cdk deploy LanguageDrillStack-dev`. Verify `https://api-dev.langdrill.app/health` returns 200. [~30m]
9. **Run migrations + seed against Neon `dev` branch** — `DATABASE_URL=<dev> pnpm db:migrate && pnpm db:seed:exercises`. [~10m]
10. **Update Vercel Preview `NEXT_PUBLIC_API_URL` → `api-dev.langdrill.app`** — Vercel dashboard. [~5m]
11. **Smoke-test a Vercel preview deploy** — open a no-op PR, sign up via dev Clerk, complete an exercise, verify writes land in `dev` branch and not `production`. [~30m]
12. **Add dev stack deploy step to `deploy.yml`** — only after manual verification. [~20m]
13. **Re-parent CI ephemeral PR Neon branches from `production` to `dev`** — one-line change in `ci.yml`. [~5m]
14. **Document the env layout in `CLAUDE.md`** — add a short section under `CI/CD` describing prod vs. dev. [~15m]

**Total estimate:** ~6–8h of focused work + ~2h elapsed on cert/DNS validation.

---

## Open questions

- **Should webhooks fan out to both envs?** Probably not — dev Clerk webhook → dev API, prod Clerk webhook → prod API. Already implied by the plan; flagging for explicit confirmation.
- **Cron jobs / EventBridge schedulers** (Phase 1+ pre-generation Lambda) — should they run on dev too, or only prod? Recommend disabling scheduled jobs on dev to avoid burning the Anthropic budget; gate them behind `envName === "prod"` in CDK.
- **Cost ceiling on dev:** roughly +$0–5/month at current Lambda + API Gateway scale (free tier covers it). The Anthropic dev budget cap is the real cost lever — set it conservatively (e.g. $10/month).
- **Mobile app (Phase 4):** when Expo arrives, it will also need a `dev` build flavor pointing at `api-dev`. Out of scope here but the same pattern.

## What this plan does NOT cover

- **Per-PR isolation.** All previews share one dev backend. If two PRs both rename a column, the second PR's preview will be broken until the first migrates back. Acceptable trade-off at current team size.
- **Staging environment.** This is a two-tier setup (dev + prod), not three-tier (dev + staging + prod). If we later want a UAT step before prod, replicate the same pattern with a third stack.
- **Data scrubbing.** Dev's initial fork from prod includes any real user data that exists at branch time. If/when prod has real users, scrub PII from `dev` before the first preview goes live.
