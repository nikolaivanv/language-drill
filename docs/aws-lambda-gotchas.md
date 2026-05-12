# AWS Lambda Gotchas

A reference for AWS-specific behaviors we hit while building serverless features. These aren't bugs in our code — they're platform quirks worth knowing before they bite the next feature. Each entry has the symptom you'd actually see and the workaround.

Open tech-debt items that touch the same areas are tracked in [`tech-debt.md`](./tech-debt.md); this doc captures the lessons that should outlive any single workaround.

---

## 1. Function URL CORS ≠ API Gateway CORS

Different services, different schemas. **Don't copy CORS config between them.**

### Function URL CORS (`AWS::Lambda::Url` → `Cors` property)

- `AllowMethods` accepts only `GET`, `PUT`, `HEAD`, `POST`, `PATCH`, `DELETE`, `*`. **Does NOT accept `OPTIONS`** — preflight is handled implicitly by the platform once any method is listed.
- `AllowOrigins` accepts only full URLs (`https://www.example.com`), `https://*` (any HTTPS origin), or `*` (any origin). **Does NOT accept subdomain wildcards** like `https://*.vercel.app`.

### API Gateway HTTP API CORS

- Accepts `OPTIONS` in `AllowMethods`.
- Accepts subdomain wildcards in `AllowOrigins`.

### If you need subdomain-wildcard origins on a Function URL

Do CORS matching in the handler instead. The Function URL's CORS config sets response headers wholesale; in-handler matching lets you inspect the request's `Origin` header, validate it against a pattern list, and echo it back conditionally. Mirror the pattern in `infra/lambda/src/index.ts:25` (`matchOrigin`).

### How it fails

`cdk synth` succeeds. Asset publish succeeds. CloudFormation rejects on resource creation — at a stage local synth doesn't replicate. The two error messages we've seen:

```
OPTIONS is not a valid enum value. Supported values:
[GET, PUT, HEAD, POST, PATCH, DELETE, *]
```

```
https://*.vercel.app isn't a valid origin. An origin must be in a valid
URL format. For example: https://www.example.com, https://*, or the
wildcard character (*).
```

Both surfaced for the first time on production-deploy attempts (PRs #95 and #97), after `cdk synth` had run clean locally many times.

---

## 2. Response streaming: await the stream's `'finish'` event before returning

Lambda response streaming (`InvokeMode: RESPONSE_STREAM`) closes the underlying socket the moment the handler's promise resolves. Any bytes still queued in userspace are silently dropped.

This bites worst on the **final write** — `done`, `error`, or any closing message. Earlier writes drain incidentally during whatever async work follows them (a slow upstream API call gives the kernel time to flush). The last write has no such grace window: handler returns, runtime closes the socket, the byte that was about to leave userspace goes nowhere.

### Wrong (what we shipped first)

```ts
export const handler = awslambda.streamifyResponse(async (event, stream) => {
  // ... earlier work, partial writes ...
  stream.write(buildSseFrame("done", { flaggedCount }));
  // implicit return — socket closes before the write hits the wire
});
```

### Right

```ts
import type { Writable } from "node:stream";

function endStream(stream: Writable): Promise<void> {
  return new Promise((resolve) => stream.end(resolve));
}

export const handler = awslambda.streamifyResponse(async (event, stream) => {
  // ... earlier work, partial writes ...
  stream.write(buildSseFrame("done", { flaggedCount }));
  await endStream(stream); // resolves on the underlying stream's 'finish' event
});
```

`Writable.end(callback)` invokes the callback when the stream has fully drained and `'finish'` has been emitted. Awaiting that before returning is the canonical pattern — it's what every robust Lambda response-streaming example does.

### How it fails

Handler completes cleanly. CloudWatch shows **no errors**. The browser receives whatever partial output made it through (the first few events) and then sees the body close with no terminal event. The client-side SSE consumer interprets the orphan close as "Stream ended unexpectedly."

Without prior knowledge this is one of the more confusing failure modes you can hit, because nothing in the logs hints at the problem. We hit it on PR #98.

### Pair this with structured checkpoints in the handler

When you do hit a streaming bug, silence in CloudWatch should never be ambiguous between "ran cleanly but bytes dropped" and "iterator hung mid-call." Log at every meaningful state transition (after meta, after each upstream-API completion, before every terminal write). Three or four `console.log` lines per request, costs nothing, makes the next bug 10× easier to diagnose.

---

## 3. `cdk synth` runs ts-node against the live workspace

`infra/cdk.json` defines `"app": "npx ts-node bin/app.ts"`. At every `cdk synth` or `cdk deploy`, ts-node compiles `bin/app.ts` and every TypeScript file it imports — using **Node's standard module-resolution rules**, through `node_modules` and each package's `main`/`types` fields.

This has two practical consequences worth internalising before the next CDK construct lands.

### a) Workspace packages must have their `dist/` built first

`pnpm install --frozen-lockfile` installs `node_modules` symlinks and external deps. It does **not** build workspace packages. If `infra/lib/...` imports from `@language-drill/foo`, that package's `dist/` must already exist on disk before `cdk synth` runs — otherwise ts-node's resolver follows the package.json's `main` to a path that isn't there and throws TS2307.

The CI fix is one line in the deploy job:

```yaml
- name: Build @language-drill/foo
  run: pnpm --filter @language-drill/foo build
```

Add it before any `cdk` command. We did this on PR #93 once the streaming-annotate construct started importing from `@language-drill/shared`.

### b) ts-node loads compiled ESM through Node's strict ESM resolver

If a workspace package compiles to ESM and its `dist/index.js` re-exports siblings with extensionless specifiers (`export * from "./foo"`), it'll work fine in Next.js/esbuild/tsx — all of which are lenient — but **fail** when ts-node `require(esm)`s it during `cdk synth`. Strict ESM requires `.js` extensions on relative imports.

Symptom: `ERR_MODULE_NOT_FOUND: Cannot find module '/path/to/packages/foo/dist/bar' imported from '/path/to/packages/foo/dist/index.js'`.

Three workarounds, in increasing order of correctness:

1. **Import via relative source path** in the CDK code: `import { x } from "../../../packages/foo/src/x"`. ts-node compiles the `.ts` directly, never touches `dist/`. Requires loosening `rootDir` in the consumer's tsconfig. Fast, surgical, ugly. (PR #94.)
2. **Add `.js` extensions throughout the package's source** and rely on TypeScript preserving them in the emitted JS. Fixes the package for every consumer, not just CDK. (See `tech-debt.md` "shared package ESM" entry.)
3. **Switch the package to CJS output**. Heaviest. Probably worth it only if you have many consumers and they're all OK with CJS.

We went with option 1 to unblock production and filed option 2 as tech debt.

### How it fails

`cd infra && pnpm cdk synth` fails immediately with either TS2307 (no dist) or ERR_MODULE_NOT_FOUND (dist exists, extensionless imports). Local dev never trips this because `pnpm dev` / `pnpm test` keep dist warm or use bundler-lenient resolution.

---

## Quick diagnostic table

| Symptom | Likely cause |
| --- | --- |
| `TS2307: Cannot find module '@language-drill/foo'` during `cdk deploy` | Workspace package's `dist/` not built. Add `pnpm --filter @language-drill/foo build` step. |
| `ERR_MODULE_NOT_FOUND: Cannot find module 'X' imported from 'dist/index.js'` | Package's compiled output has extensionless ESM imports. Rebuild with `.js` extensions, or import via relative source path. |
| CloudFormation early validation rejects `OPTIONS is not a valid enum value` | Function URL CORS — drop `OPTIONS` from `AllowMethods`. |
| CloudFormation resource handler rejects `isn't a valid origin` | Function URL CORS — subdomain wildcards aren't supported. Use `*` or do origin-matching in the handler. |
| Browser receives partial SSE/streaming response, no terminal event, **no CloudWatch errors** | Handler returned before `responseStream.end(cb)` drained. Await stream `'finish'` before returning. |

---

## What's not in this doc

- **Monorepo / tooling-specific gotchas** (vitest `hookTimeout` for heavy imports, `"use client"` directive on hooks that import React primitives directly into a barrel-re-export chain). Those are project-specific and already documented inline near the code that addresses them.
- **Performance budgets** for the streaming endpoint. Those live in the spec at `.claude/specs/more-responsive-reading/requirements.md` §NFR Performance.
- **Open tech-debt items** that have remediation plans pending. Those live in [`tech-debt.md`](./tech-debt.md).

This doc is the *permanent reference* for AWS quirks. When a tech-debt item lands a real fix, the corresponding workaround note in `tech-debt.md` goes away, but the AWS quirk stays here.
