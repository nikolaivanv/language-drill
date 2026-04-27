# Vercel Deploy Strategy

## Approach: Remote Build via Vercel CLI

GitHub Actions triggers Vercel deploys via the CLI (`vercel deploy`). Vercel
receives the full monorepo source, installs dependencies with pnpm (auto-detected
from `pnpm-lock.yaml` and the `packageManager` field in root `package.json`),
and builds the Next.js app from the configured Root Directory.

No local build step, no `--prebuilt`, no `--cwd`. Just `vercel deploy` from
the repo root.

### Why CLI deploys instead of Vercel Git integration?

- **Ordering control** — production deploys wait for CDK (Lambda/infra) to
  finish first via `needs:`. Preview deploys wait for Neon branch + migration.
- **Single pipeline** — lint, typecheck, test, migrate, and deploy all live in
  GitHub Actions with full visibility in one place.

### Why not prebuilt (`vercel build` + `vercel deploy --prebuilt`)?

We tried this but it doesn't work reliably with pnpm monorepos. Next.js
server-side dependency tracing produces `node_modules/.pnpm/` paths from the
CI build machine that don't exist on Vercel's servers, causing runtime errors.

### Workflows

| Trigger | Workflow | Deploy type |
|---|---|---|
| PR opened/updated | `ci.yml` → `preview` job | Preview (after lint + test + Neon migrate) |
| Merge to main | `deploy.yml` → `vercel-prod` job | Production (after CDK deploy) |

The deploy jobs are lightweight — just `actions/checkout` + `vercel deploy`.
No pnpm or Node setup needed since Vercel handles its own install and build.

### Vercel dashboard settings (one-time)

**Root Directory:** `apps/web`

Tells Vercel where the Next.js app lives. Vercel still installs dependencies
from the monorepo root — it detects pnpm workspaces automatically.

**Environment variables:**

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` | Prod vs dev Clerk instance |
| `CLERK_SECRET_KEY` | `sk_live_...` | `sk_test_...` | Prod vs dev Clerk instance |
| `NEXT_PUBLIC_API_URL` | `https://api.langdrill.app` | `https://api.langdrill.app` | Custom domain for Lambda API |

Preview deploys use dev Clerk keys so PR previews don't create real users in production.
Development environment is not used — local dev runs via `pnpm dev`.

**Git integration:** Do NOT connect the GitHub repo in Vercel's Git settings.
Deploys are triggered exclusively via CLI from GitHub Actions. If the repo is
connected, either disconnect it or set Ignored Build Step to `exit 0` to
prevent double deploys.

### Required GitHub secrets

See `.github/SECRETS.md` for the full list. Vercel-specific:

- `VERCEL_TOKEN` — personal access token from vercel.com/account/tokens
- `VERCEL_ORG_ID` — from Vercel dashboard (Settings → General)
- `VERCEL_PROJECT_ID` — from Vercel dashboard (Settings → General)
