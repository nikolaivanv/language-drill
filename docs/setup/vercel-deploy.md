# Vercel Deploy Strategy

## Approach: Remote Build via Vercel CLI

GitHub Actions triggers Vercel deploys via the CLI (`vercel deploy`). Vercel
receives the full monorepo source, installs dependencies with pnpm (detected
from `pnpm-lock.yaml` and `packageManager` field), and builds the Next.js app.

### Why not prebuilt?

We tried `vercel build` + `vercel deploy --prebuilt` but it doesn't work
reliably with pnpm monorepos — Next.js server-side dependency tracing produces
`node_modules/.pnpm/` paths from the build machine that don't exist on Vercel's
servers.

### Why CLI deploys instead of Vercel Git integration?

- **Ordering control** — production deploys wait for CDK (Lambda/infra) to
  finish first via `needs:`. Preview deploys wait for Neon branch + migration.
- **Single pipeline** — lint, typecheck, test, migrate, and deploy all live in
  GitHub Actions. No split between GH Actions and Vercel's build system.
- **Disable Vercel auto-deploys** to avoid double deploys (see below).

### Workflows

| Trigger | Workflow | Deploy type |
|---|---|---|
| PR opened/updated | `ci.yml` → `preview` job | Preview (after lint + test + Neon migrate) |
| Merge to main | `deploy.yml` → `vercel-prod` job | Production (after CDK deploy) |

### Vercel dashboard settings (one-time)

**Root Directory:** `apps/web`
This tells Vercel where the Next.js app lives. Vercel still installs from the
monorepo root (it detects pnpm workspaces automatically).

**Environment variables:**

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_API_URL` (set once API Gateway is deployed via CDK)

**Disable automatic Git deployments** to avoid double deploys:
Settings → Git → Ignored Build Step → set command to `exit 0`.

### Required GitHub secrets

- `VERCEL_TOKEN` — personal access token from vercel.com/account/tokens
- `VERCEL_ORG_ID` — from Vercel dashboard (Settings → General)
- `VERCEL_PROJECT_ID` — from Vercel dashboard (Settings → General)
