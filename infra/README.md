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
| `language-drill/DATABASE_URL` | Neon Postgres connection string (e.g. `postgresql://user:pass@host/db?sslmode=require`) |
| `language-drill/CLERK_SECRET_KEY` | Clerk secret key (from Clerk dashboard → API Keys) |
| `language-drill/CLERK_WEBHOOK_SECRET` | Clerk webhook signing secret (from Clerk dashboard → Webhooks) |
| `language-drill/ANTHROPIC_API_KEY` | Anthropic API key (placeholder — required in Phase 1) |
| `language-drill/UPSTASH_REDIS_URL` | Upstash Redis URL (placeholder — required in Phase 1) |

Create each secret via CLI:

```bash
aws secretsmanager create-secret \
  --name "language-drill/DATABASE_URL" \
  --secret-string "postgresql://user:pass@host/db"
```

## Environment Variables for Deploy

Set these env vars before running `cdk deploy` or `cdk synth`:

| Variable | Description |
|---|---|
| `CDK_DEFAULT_ACCOUNT` | AWS account ID |
| `CDK_DEFAULT_REGION` | AWS region (e.g. `us-east-1`) |
| `CLERK_ISSUER_URL` | Clerk JWT issuer URL (e.g. `https://<your-domain>.clerk.accounts.dev`) |
| `CLERK_AUDIENCE` | Comma-separated JWT audience values |
| `PRODUCTION_ORIGIN` | Production web app origin (e.g. `https://yourdomain.com`) — optional |

## Commands

```bash
# Synthesize CloudFormation template (dry run)
pnpm synth

# Show diff between deployed and local
pnpm diff

# Deploy stack to AWS
pnpm deploy
```
