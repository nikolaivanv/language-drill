# Admin Langfuse Trace Deep-Links (Design)

**Status:** approved · **Date:** 2026-06-18 · **Scope:** Tier 3 item #13 (Langfuse half only)

A "View traces in Langfuse ↗" deep-link on the pool-cell view and flagged-exercise items, opening the Langfuse trace list filtered to that cell's `cellKey`. Frontend-only, config-gated, **off by default**. The `eval:gen` half of the roadmap item is out of scope (local-only artifacts, no stored run reference).

## Goal

From a flagged exercise or a pool cell, let the admin jump straight to that cell's generation/validation traces in Langfuse — instead of rebuilding trace/cost analysis in-app. One click, opens in Langfuse.

## Background (verified against current code)

- **Traces are tag-filterable by cell.** `packages/ai/src/observability.ts:buildTraceTags` tags every Claude trace with `feature:`, `env:`, `model:`, `promptVersion:`, and (when present) `language:`, `cefrLevel:`, `exerciseType:`, **`cellKey:`**, `submissionId:`. The generation consumer sets `cellKey` on both the generate and validate trace contexts (`infra/lambda/src/generation/handler.ts:246,292`), so a Langfuse trace list filtered by `cellKey:<key>` surfaces exactly that cell's generation + validation traces.
- **`cellKey` format** (`packages/db/src/lib/cell-key.ts:buildCellKey`): `` `${language.toLowerCase()}:${cefrLevel.toLowerCase()}:${exerciseType.toLowerCase()}:${grammarPointKey}` `` — e.g. `tr:a1:cloze:tr-a1-vowel-harmony`. (`grammarPointKey` is not lowercased.)
- **No per-item trace ID is stored** (no `trace_id` column anywhere). So a link can target a filtered trace *list*, not a single trace. A flagged exercise links to its **cell's** traces (cell-grained — the honest best available).
- **No frontend Langfuse config exists.** `LANGFUSE_BASE_URL` + keys are backend-only; there is no project ID anywhere. Building a trace URL in the browser needs config supplied as a `NEXT_PUBLIC_*` env.
- **Langfuse list-filter URL syntax is internal/undocumented.** The official docs only give the single-trace URL (`/project/{projectId}/traces/{traceId}`); the trace-*list* filter is an internal `filter` query encoding that varies across Langfuse versions. → We do not hardcode it; the operator supplies a URL template (below).
- **Field shapes** (`packages/api-client/src/schemas`): `FlaggedExercise` has `language`/`level`/`type`/`grammarPointKey` all `z.string().nullable()`; `FlaggedTheory` has no `type`; `PoolStatusItem` has non-null `language`/`level`/`type`/`grammarPointKey`. `flagged-exercise-card.tsx` already renders `type · language · level · grammarPointKey`.

## Architecture

Frontend-only. One config env, one small util, one presentational component, wired into two existing components. No backend, api-client, db, or CDK change.

```
apps/web/lib/admin/langfuse.ts                         — cellKeyFor() + buildLangfuseTracesUrl()
apps/web/components/admin/langfuse-traces-link.tsx     — <LangfuseTracesLink cellKey=… />
apps/web/.../generation/_components/pool-cell-detail.tsx        — render the link
apps/web/.../moderation/_components/flagged-exercise-card.tsx   — render the link
```

## Config — `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` (per Vercel environment)

A full Langfuse traces-list URL with a `{cellKey}` placeholder, captured by the operator from their own Langfuse UI (so the project ID and the exact filter encoding are correct for that environment). Example shape (illustrative — the operator pastes their real filtered URL):

```
https://cloud.langfuse.com/project/<projectId>/traces?filter=<url-encoded filter selecting tag cellKey={cellKey}>
```

- **Unset / no `{cellKey}` placeholder → the link is not rendered** (graceful, safe default off).
- Set independently for Production and Preview (prod vs dev Langfuse projects).
- Documented in `.env.example` (with a short "how to capture" note) and the CLAUDE.md Vercel env-vars table. **No CDK change** (it's a Vercel build-time `NEXT_PUBLIC_*` var).

Rationale for a template over `BASE_URL` + `PROJECT_ID` + a coded filter: Langfuse's list-filter encoding is undocumented and version-dependent; a template keeps link correctness operator-tunable with zero code change if Langfuse shifts.

## Util — `apps/web/lib/admin/langfuse.ts`

```ts
// Mirrors the canonical buildCellKey (@language-drill/db cell-key.ts) WITHOUT
// importing db into the web bundle. Pinned by a test against a known example.
// Returns null if any part is missing/empty (flagged fields are nullable).
export function cellKeyFor(parts: {
  language: string | null;
  level: string | null;
  type: string | null;
  grammarPoint: string | null;
}): string | null;

// Interpolates {cellKey} (URL-encoded) into the template. Returns null when the
// template is unset or lacks the placeholder. `template` defaults to the env var
// but is overridable for testing.
export function buildLangfuseTracesUrl(
  cellKey: string,
  template?: string | undefined,
): string | null;
```

- `cellKeyFor`: lowercases `language`/`level`/`type`, leaves `grammarPoint` as-is, joins with `:`; returns `null` if any input is null/empty.
- `buildLangfuseTracesUrl`: default `template = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` (referenced as the full literal so Next inlines it at build); if `!template || !template.includes('{cellKey}')` → `null`; else `template.replaceAll('{cellKey}', encodeURIComponent(cellKey))`.

## Component — `apps/web/components/admin/langfuse-traces-link.tsx`

```tsx
export function LangfuseTracesLink({ cellKey }: { cellKey: string | null }) {
  const href = cellKey ? buildLangfuseTracesUrl(cellKey) : null;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="<sibling link classes>">
      View traces in Langfuse ↗
    </a>
  );
}
```
Renders nothing when `cellKey` is null or the template is unset — so it's invisible until configured. Class names match the existing admin link idiom (e.g. the `text-[13px] text-ink underline` links in `pool-cell-detail.tsx`).

## Surfaces

- **`pool-cell-detail.tsx`** — render `<LangfuseTracesLink cellKey={cellKeyFor({ language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey })} />` near the existing "View … approved exercises →" link. (Pool items are non-null, so the key always builds.)
- **`flagged-exercise-card.tsx`** — same, from `item.language`/`item.level`/`item.type`/`item.grammarPointKey` (nullable → link hidden if any is missing).
- **`flagged-theory-card.tsx`** — NOT touched (theory has no exerciseType → no cell key).

## Testing

- **util** (`lib/admin/__tests__/langfuse.test.ts`): `cellKeyFor` builds `tr:a1:cloze:tr-a1-vowel-harmony` for a known input (the format-pin test — guards drift from `buildCellKey`); returns null when any part is null/empty; lowercases lang/level/type but not grammarPoint. `buildLangfuseTracesUrl` interpolates + URL-encodes `{cellKey}` (a cellKey's `:` → `%3A`); returns null when template undefined or missing the placeholder; `replaceAll` handles a template using `{cellKey}` twice.
- **component** (`components/admin/__tests__/langfuse-traces-link.test.tsx`): renders the anchor with the interpolated href + `target=_blank`/`rel` when a template is set (pass via the env or by stubbing); renders nothing when `cellKey` is null; renders nothing when the template env is unset.
- **surfaces**: extend `pool-cell-detail` test — link present (with expected href) when the template env is set, absent when unset. Extend `flagged-exercise-card` test — link present for a complete item; absent when (e.g.) `grammarPointKey` is null. Mock/stub `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` in these tests.
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope

- **`eval:gen` run links** — the JSON artifacts are local-only (`./eval-runs/`) and no run reference is stored to link to. (Per the brainstorm decision.)
- **Per-item trace isolation** — no stored trace ID; links are cell-grained.
- **Flagged theory items** — no exerciseType → no cell key.
- Any backend / api-client / db / CDK change.

## Risks / notes

- **Operator-supplied filter encoding**: link correctness depends on the operator capturing a valid filtered URL once and inserting `{cellKey}` where the encoded cell value sits. `.env.example` includes guidance. If the captured URL URL-encodes the cell value (e.g. `:` as `%3A`), our `encodeURIComponent(cellKey)` substitution matches that encoding.
- **Langfuse auth**: cloud links open the Langfuse app, which requires the admin to be signed into Langfuse — acceptable for a single-admin internal tool.
- **cellKey duplication**: the web `cellKeyFor` replicates the canonical `buildCellKey` format; the format-pin test fails loudly if they diverge. (Alternative — moving `buildCellKey` to `@language-drill/shared` — was rejected as out-of-proportion for this small feature.)
- **Next inlining**: `process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` is referenced as the full literal so Next statically inlines it; the `template` override param keeps the util unit-testable without a build.
