# GitHub Actions Secrets

All secrets below must be configured in the repository's **Settings → Secrets and variables → Actions** before CI/CD workflows will function.

| Secret | Used By | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `deploy.yml` | IAM access key for CDK deployments |
| `AWS_SECRET_ACCESS_KEY` | `deploy.yml` | IAM secret key for CDK deployments |
| `AWS_REGION` | `deploy.yml` | AWS region for CDK stack (e.g. `us-east-1`) |
| `NEON_API_KEY` | `ci.yml`, `cleanup.yml` | Neon API key for branch create/delete |
| `NEON_PROJECT_ID` | `ci.yml`, `cleanup.yml` | Neon project ID for branch operations |
| `VERCEL_TOKEN` | `ci.yml`, `deploy.yml` | Vercel personal access token for deployments |
| `VERCEL_ORG_ID` | `ci.yml`, `deploy.yml` | Vercel organization/team ID |
| `VERCEL_PROJECT_ID` | `ci.yml`, `deploy.yml` | Vercel project ID for `apps/web` |
| `TURBO_TOKEN` | All workflows | Turborepo remote cache token (Vercel) |
| `TURBO_TEAM` | All workflows | Turborepo team slug for remote caching |

## Additional secrets used at deploy time (via env vars)

These are passed as environment variables during CDK deploy and are used to configure the stack (not stored in Secrets Manager):

| Secret | Used By | Description |
|---|---|---|
| `CLERK_ISSUER_URL` | `deploy.yml` | Clerk JWT issuer URL (e.g. `https://<domain>.clerk.accounts.dev`) |
| `CLERK_AUDIENCE` | `deploy.yml` | Comma-separated JWT audience values for API Gateway authorizer |
| `PRODUCTION_ORIGIN` | `deploy.yml` | Production web app origin for CORS (e.g. `https://yourdomain.com`) |
