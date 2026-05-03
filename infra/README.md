# Infrastructure (AWS CDK)

## Prerequisites

- AWS CLI configured with credentials (`aws configure`)
- Node.js 20+
- pnpm installed

## One-Time Bootstrap

CDK requires a one-time bootstrap per AWS account/region:

```bash
cd infra
pnpm install
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

## Secrets Manager Entries

Create the following secrets in AWS Secrets Manager before deploying. The secret names must match exactly:

| Secret Name | Expected Value |
|---|---|
| `language-drill/DATABASE_URL` | Neon Postgres connection string for the `production` branch (e.g. `postgresql://user:pass@host/db?sslmode=require`) |
| `language-drill/CLERK_SECRET_KEY` | Clerk secret key from the **production** Clerk instance (Clerk dashboard → API Keys) |
| `language-drill/CLERK_WEBHOOK_SECRET` | Clerk webhook signing secret (Clerk dashboard → Webhooks) |
| `language-drill/ANTHROPIC_API_KEY` | Anthropic API key (production budget) |
| `language-drill/UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL (Upstash console → REST API tab) |
| `language-drill/UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token (Upstash console → REST API tab) |

Create each secret via CLI:

```bash
aws secretsmanager create-secret \
  --name "language-drill/UPSTASH_REDIS_REST_URL" \
  --secret-string "https://<your-db>.upstash.io"
```

## Dev Secrets Manager Entries

The dev Lambda's IAM role grants read access only to `language-drill-dev/*`, so prod secrets are not reachable from the dev environment (and vice versa). All six dev secrets must exist before `cdk deploy LanguageDrillStack-dev` will succeed; missing secrets surface as `ResourceNotFoundException` from CloudFormation.

| Secret Name | Expected Value | Source |
|---|---|---|
| `language-drill-dev/DATABASE_URL` | Neon Postgres connection string for the `dev` branch | `neonctl connection-string dev --project-id <project-id> --pooled` |
| `language-drill-dev/CLERK_SECRET_KEY` | Clerk secret key (`sk_test_...`) from the **dev** Clerk instance | Dev Clerk dashboard → API Keys |
| `language-drill-dev/CLERK_WEBHOOK_SECRET` | Webhook signing secret from the dev Clerk instance | Dev Clerk dashboard → Webhooks (signing secret for the webhook pointing at `api-dev.langdrill.app/webhooks/clerk`) |
| `language-drill-dev/ANTHROPIC_API_KEY` | Separate Anthropic API key with a $10/month budget cap | Anthropic console → API Keys (create a new key, set spend cap) |
| `language-drill-dev/UPSTASH_REDIS_REST_URL` | REST URL for a separate (free-tier) Upstash Redis DB | Upstash console → second DB → REST API tab |
| `language-drill-dev/UPSTASH_REDIS_REST_TOKEN` | REST token matching the dev Upstash DB above | Same as above |

## First-time dev environment setup

Bootstrap checklist for an operator wiring the dev environment from scratch. Prerequisites:

- AWS CLI configured with credentials that can read/write Secrets Manager and deploy CloudFormation stacks
- `neonctl` and `gh` available locally
- Cloudflare DNS dashboard access for `langdrill.app`
- Dev Clerk dashboard access (separate instance from prod)

1. **Provision the six dev secrets in AWS Secrets Manager.** Values and sources are listed in the dev secrets table above. All six follow the same shape:

   ```bash
   aws secretsmanager create-secret \
     --name "language-drill-dev/DATABASE_URL" \
     --secret-string "postgresql://..."
   ```

   Configure a $10/month spend cap on the dev Anthropic key in the Anthropic console before storing it (NFR Security — prevents a runaway preview from burning the prod AI budget).

2. **Trigger the first dev stack deploy.** From the repo root:

   ```bash
   pnpm --filter infra deploy:dev
   ```

   `bin/app.ts` always synthesizes both stacks, so the shell must export every required env var even when only deploying dev:

   ```bash
   export API_DOMAIN_NAME=api.langdrill.app
   export CLERK_ISSUER_URL=https://clerk.langdrill.app
   export CLERK_AUDIENCE=language-drill
   export API_DOMAIN_NAME_DEV=api-dev.langdrill.app
   export CLERK_ISSUER_URL_DEV=https://<dev-clerk-frontend-api>
   ```

   The deploy will pause at the `AWS::CertificateManager::Certificate` resource (`CREATE_IN_PROGRESS`) and stay there until step 3 completes. This is expected.

3. **Add the ACM validation CNAME to Cloudflare.** While the deploy is paused on cert validation, fetch the validation record:

   ```bash
   aws acm list-certificates --region us-east-1 \
     --query "CertificateSummaryList[?DomainName=='api-dev.langdrill.app'].CertificateArn" \
     --output text

   aws acm describe-certificate --certificate-arn <ARN> \
     --query "Certificate.DomainValidationOptions[0].ResourceRecord"
   ```

   Add the returned `Name` → `Value` as a CNAME in Cloudflare, **DNS-only (grey cloud)**. Leave it in place permanently — ACM uses it for auto-renewal. ACM polls every ~60s; the cert flips to `ISSUED` typically in 5–30 min, after which the paused deploy resumes automatically.

4. **Add the operational `api-dev` CNAME.** After the deploy completes, take the `ApiDomainTarget` value from the CDK output (looks like `d-abc123xyz.execute-api.us-east-1.amazonaws.com`) and add a Cloudflare CNAME `api-dev` → that target, **DNS-only (grey cloud)**.

5. **Configure dev Clerk.** In the dev Clerk instance dashboard:
   - Create a JWT template named `api` with claims:
     ```json
     { "aud": "language-drill", "sub": "{{user.id}}" }
     ```
     (Template name and audience must match production so the same frontend code works against either env.)
   - Create a webhook endpoint at `https://api-dev.langdrill.app/webhooks/clerk` subscribed to `user.created`. Copy the signing secret into `language-drill-dev/CLERK_WEBHOOK_SECRET` in AWS Secrets Manager (overwriting the placeholder from step 1).

6. **Update Vercel Preview environment.** In the Vercel project settings, change the `Preview`-scope value of `NEXT_PUBLIC_API_URL` from `https://api.langdrill.app` to `https://api-dev.langdrill.app`. Leave `Production` scope unchanged. The `Preview` Clerk publishable/secret keys should already be `pk_test_` / `sk_test_` from before this spec; no change needed there.

7. **Smoke-test before sharing.** Before sharing any preview URL externally:

   ```bash
   curl -I https://api-dev.langdrill.app/health   # expect 200

   neonctl branches reset dev --parent production
   ```

   The `branches reset` re-forks the dev branch from current prod state, dropping any stray test data. Recommended cadence afterward: quarterly, or whenever schema drift between dev and prod becomes hard to migrate forward.

### GitHub Actions secrets for the dev deploy

The dev side of `deploy.yml` needs four additional repository secrets (set via the GitHub UI or `gh secret set`):

| Secret | Purpose | Source |
|---|---|---|
| `DEV_DATABASE_URL` | Neon `dev` branch pooled connection string for Drizzle migrations | `neonctl connection-string dev --project-id <id> --pooled` |
| `CLERK_ISSUER_URL_DEV` | Frontend API URL of the dev Clerk instance (used by the dev API Gateway JWT authorizer) | Dev Clerk dashboard, e.g. `https://<adjective>-<noun>-NN.clerk.accounts.dev` |
| `API_DOMAIN_NAME_DEV` | FQDN for the dev API Gateway custom domain | Fixed: `api-dev.langdrill.app` |
| `CLERK_AUDIENCE_DEV` | Optional. JWT audience override; defaults to `language-drill` if unset | — |

Example:

```bash
gh secret set DEV_DATABASE_URL --body "$(neonctl connection-string dev --project-id <id> --pooled)"
```

## Environment Variables for Deploy

`bin/app.ts` instantiates **both** stacks unconditionally and uses `requireEnv()` to fail synth fast on missing values. Even when you deploy only one stack via `--exclusively`, CDK still synthesizes both — so all of the variables below are required for any deploy or synth.

| Variable | Description |
|---|---|
| `CDK_DEFAULT_ACCOUNT` | AWS account ID (auto-populated by `cdk` from your AWS creds) |
| `CDK_DEFAULT_REGION` | AWS region — must be `eu-central-1` (where prod lives) |
| `AWS_REGION` | Same as above; AWS CLI reads this one |
| `API_DOMAIN_NAME` | `api.langdrill.app` (prod API custom domain) |
| `CLERK_ISSUER_URL` | `https://clerk.langdrill.app` (prod Clerk frontend API) |
| `CLERK_AUDIENCE` | Optional, defaults to `language-drill` |
| `API_DOMAIN_NAME_DEV` | `api-dev.langdrill.app` (dev API custom domain) |
| `CLERK_ISSUER_URL_DEV` | Dev Clerk frontend API URL (e.g. `https://robust-goose-5.clerk.accounts.dev`) |
| `CLERK_AUDIENCE_DEV` | Optional, defaults to `language-drill` |

## Running deploys locally

The same `pnpm --filter infra deploy:prod` / `deploy:dev` scripts CI uses also work from your laptop, given AWS credentials with the right permissions and the env vars above.

### Quick fix when synth fails on missing env vars

If you see `Error: Missing required env var: API_DOMAIN_NAME` (or any of the four URL/domain vars), export them in your shell and re-run:

```bash
export AWS_REGION=eu-central-1
export CDK_DEFAULT_REGION=eu-central-1
export API_DOMAIN_NAME=api.langdrill.app
export CLERK_ISSUER_URL=https://clerk.langdrill.app
export API_DOMAIN_NAME_DEV=api-dev.langdrill.app
export CLERK_ISSUER_URL_DEV=https://robust-goose-5.clerk.accounts.dev

pnpm --filter infra deploy:dev
```

This is intentional behaviour — Requirement 3.5 in the `dev-neon-env` spec mandates fail-fast synth rather than silent skipping. Both prod and dev values are needed because synth runs against the whole CDK app even when `--exclusively` targets a single stack.

### Persist across shell sessions

To stop having to re-export every new terminal, append the same block to your shell rc file:

```bash
# zsh (default on macOS)
cat >> ~/.zshrc <<'EOF'

# language-drill CDK env
export AWS_REGION=eu-central-1
export CDK_DEFAULT_REGION=eu-central-1
export API_DOMAIN_NAME=api.langdrill.app
export CLERK_ISSUER_URL=https://clerk.langdrill.app
export API_DOMAIN_NAME_DEV=api-dev.langdrill.app
export CLERK_ISSUER_URL_DEV=https://robust-goose-5.clerk.accounts.dev
EOF

source ~/.zshrc
```

For bash users, swap `~/.zshrc` for `~/.bashrc` (or `~/.bash_profile` on macOS).

After that, `pnpm --filter infra deploy:dev` and `pnpm --filter infra deploy:prod` work from any new terminal without any per-session export dance.

### AWS credentials

Both deploys use whatever AWS credentials your shell already provides (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars, an `AWS_PROFILE` selection, or `~/.aws/credentials`). The IAM identity needs:

- Permission to assume the CDK bootstrap roles `cdk-hnb659fds-*-role-<account>-eu-central-1` (the same identity GitHub Actions uses works locally too)
- Or, if you can't assume those roles, direct CloudFormation / IAM / S3 / SSM permissions to do the equivalent

If `aws sts get-caller-identity` shows the wrong account, switch profiles before running `pnpm --filter infra deploy:dev`. CDK reports the account mismatch as `current credentials could not be used to assume ... but are for the right account` — that warning is non-fatal as long as the account is correct; if the account is wrong, deploy will fail.

## Commands

```bash
# Synthesize CloudFormation template (dry run)
pnpm synth

# Show diff between deployed and local
pnpm diff

# Deploy stack to AWS
pnpm deploy
```
