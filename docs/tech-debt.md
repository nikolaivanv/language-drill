# Tech Debt

A living log of known issues to address. Add new entries at the top; mark as resolved (don't delete) so we can grep history. Each entry: title, status, discovered date, scope, root cause, remediation, references.

---

## ESLint v9 incompatibility breaks `pnpm lint`

- **Status:** resolved 2026-05-03 (during exercise-ui task 33)
- **Discovered:** 2026-05-01 (during exercise-ui task 1)
- **Scope:** repo-wide — `pnpm lint` from the root fails on `main`
- **Severity:** high (the pre-push gate documented in `CLAUDE.md` cannot run cleanly until this is fixed)

**Root cause:**
Next.js 16 deprecated the `next lint` command. The wrapper still passes ESLint v8 options that ESLint v9 has removed:
- `useEslintrc`
- `extensions`
- `resolvePluginsRelativeTo`
- `rulePaths`
- `ignorePath`
- `reportUnusedDisableDirectives`

This causes `pnpm --filter @language-drill/web lint` to fail with an `Invalid Options` error before any rules actually run.

**Verified:** the failure exists on a clean `main` (reproduced by stashing the in-flight exercise-ui changes and re-running `pnpm lint`). It is not introduced by any current spec work.

**Remediation:**
Run the official Next.js codemod to migrate from `next lint` to direct ESLint CLI invocation:

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```

This will replace the `next lint` script in `apps/web/package.json` with an `eslint` invocation, generate a flat-config file (`eslint.config.mjs`) compatible with ESLint v9, and migrate any custom rules/plugins.

After running the codemod, verify:
- `pnpm --filter @language-drill/web lint` exits 0
- The flat config preserves the existing rule set (no rules silently dropped)
- `pnpm lint` from the repo root chains correctly through Turborepo

**Why we can't ignore it:**
- `CLAUDE.md` mandates `pnpm lint && pnpm typecheck && pnpm test` pass before every push
- Phase F (`exercise-ui`) and later phases add many new TSX files; without working lint, style/quality regressions will leak into PRs
- CI presumably has the same gate (verify in `.github/workflows/`)

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- Next.js migration docs: https://nextjs.org/docs/app/api-reference/cli/next#next-lint
- ESLint v9 flat config: https://eslint.org/docs/latest/use/configure/configuration-files

**Resolution (2026-05-03):**
The codemod was run but only added `eslint-config-next` to root `package.json` — it didn't update `apps/web/package.json` because it found the existing repo-root flat config (`eslint.config.js`, installed by the dependency-audit rollout) and bailed out of generating a new one. Manual fix:
- Changed `apps/web/package.json` `lint` script from `next lint` to `eslint .` so it uses the root flat config directly.
- Added `**/next-env.d.ts` to the root `eslint.config.js` ignores (auto-generated Next.js types use a triple-slash reference that the strict TS rules flag).
- Cleaned up two trivial unused-var lints surfaced by the now-working pipeline (`EvaluationResult` import in `cloze-exercise.test.tsx`; destructured but unused `_exerciseType`/`_vocabActiveCount` props in `coach-rail.tsx` — kept on the `CoachRailProps` interface for the future tracker slot per design.md).

`eslint-config-next` was installed but not yet wired into the flat config. The current `@typescript-eslint/recommended` set is sufficient; if Next.js-specific rules (e.g. `@next/next/no-img-element`) are wanted, that's a follow-up.

`pnpm lint && pnpm typecheck && pnpm test` from repo root all pass. Pre-push gate restored.

---
