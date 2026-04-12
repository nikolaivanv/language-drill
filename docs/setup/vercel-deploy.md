# Vercel Deploy Strategy

## Approach: Prebuilt via GitHub Actions

We build the Next.js app **in GitHub Actions** and upload pre-built artifacts
to Vercel using `vercel deploy --prebuilt`. Vercel never runs `npm install` or
`next build` itself — it only serves the output.

### Why prebuilt?

- **Monorepo compatibility** — pnpm workspaces, Turborepo caching, and
  `workspace:*` dependencies all work natively in GH Actions. Vercel's builder
  has historically struggled with non-standard monorepo setups (wrong root dir,
  npm vs pnpm detection, etc.).
- **Single build environment** — the same pnpm + Node 20 setup is used for
  lint, typecheck, test, and the Vercel build. No divergence between CI checks
  and production.
- **Ordering control** — production deploys wait for CDK (Lambda/infra) to
  finish first. Preview deploys wait for Neon branch + migration. This is
  trivial with GH Actions `needs:` but impossible with Vercel's built-in Git
  integration.
- **No Vercel dashboard build config** — we don't need to set Root Directory,
  Build Command, Install Command, or Framework Preset in Vercel. The only
  dashboard config is environment variables.

### How it works

Each deploy job runs three steps:

1. `vercel pull` — downloads project settings and env vars from Vercel
2. `vercel build [--prod]` — builds locally using those env vars, outputs to
   `.vercel/output/`
3. `vercel deploy --prebuilt [--prod]` — uploads the `.vercel/output/` directory

### Workflows

| Trigger | Workflow | Deploy type |
|---|---|---|
| PR opened/updated | `ci.yml` → `preview` job | Preview (after lint + test + Neon migrate) |
| Merge to main | `deploy.yml` → `vercel-prod` job | Production (after CDK deploy) |

### Vercel dashboard settings

**Required environment variables:**

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_API_URL`

**Build settings — leave all at defaults / empty.** Vercel does not build
anything; it receives pre-built artifacts. Specifically:

- Root Directory: (empty)
- Build Command: (default / ignored)
- Install Command: (default / ignored)
- Output Directory: (default / ignored)

**Disable automatic Git deployments** to avoid double deploys:
Settings > Git > Ignored Build Step > set command to `exit 0`.

### Required GitHub secrets

- `VERCEL_TOKEN` — personal access token from vercel.com/account/tokens
- `VERCEL_ORG_ID` — from `.vercel/project.json` or Vercel dashboard
- `VERCEL_PROJECT_ID` — from `.vercel/project.json` or Vercel dashboard
