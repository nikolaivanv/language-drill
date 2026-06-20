# Curriculum Map — Phase 2 (on-demand from the map) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of the Curriculum Map (design:
`docs/superpowers/specs/2026-06-20-curriculum-map-and-adaptive-plan-design.md`) —
make the map a **launcher**: tapping a grammar-point cell opens a detail panel
(mastery readout, recurring-error sample, "read the theory" link, a **mixed
drill** + per-**mode** chips), with the conjugation drill and a single-mode drill
targetable to that point.

**Architecture:** The `GET /progress/curriculum` endpoint gains three per-point
fields — `compatibleTypes` (which modes the point supports, via the now-exported
`compatibleTypes()`), `hasTheory` (an approved `theory_topics` row exists), and
`errorSample` (a representative recent wrong→correction for error-prone points).
On the web, map cells become tappable and open a **PointDetailSheet**; its mixed
button links to `/drill?start=quick&grammarPoint=<key>`, its mode chips add
`&exerciseType=<mode>` (the drill entry gains an `?exerciseType` param; the
combined `{point+mode}` POST-session filter already exists), and the conjugation
chip links to `/drill/conjugation?grammarPoint=<key>` (the `/exercises` endpoint
+ `useExercise` gain a `grammarPointKey` param). The theory link uses the
existing `topicIdForGrammarPointKey` → `/theory/<lang>/<topicId>` route.

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, TanStack Query,
Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- The web/api-client must NOT import `@language-drill/db`/curriculum — the new
  per-point facts (`compatibleTypes`, `hasTheory`, `errorSample`) are resolved
  server-side in the endpoint and delivered in the response.
- **`compatibleTypes` is the single source** of which modes a point supports
  (`packages/db/src/generation/cells.ts`): grammar → `[cloze?, translation]`
  (cloze dropped when `clozeUnsuitable`), `+ sentence_construction` when
  `sentenceConstructionSuitable`, `+ conjugation` when `conjugationSuitable`;
  vocab → `[vocab_recall]`; dictation/free-writing → their own. Mode chips render
  exactly `compatibleTypes` (no hard-coding).
- **`hasTheory`** ⇔ the point's `kind === 'grammar'` **and** an approved
  `theory_topics` row exists for `(language, topicId)` where `topicId` = the key
  minus the `<lang>-` prefix (same transform as `topicIdForGrammarPointKey`).
- **`errorSample`** is `{ wrongText, correction } | null` — the most-recent
  attributed error for the point (effective point = `COALESCE(errorGrammarPointKey,
  hostGrammarPointKey)`) in the trailing 30-day window; null when none.
- **Mode-chip routing:** mixed → `/drill?start=quick&grammarPoint=<key>`;
  cloze/translation/sentence_construction/vocab_recall → same + `&exerciseType=<v>`;
  **conjugation → `/drill/conjugation?grammarPoint=<key>`** (a different page).
  The drill entry already supports `?grammarPoint`; this plan adds `?exerciseType`.
- **The combined `{grammarPointKey + exerciseType}` POST-session filter already
  works** (`sessions.ts` `baseWhere` + `mergeSessionRows`) — do NOT re-implement it.
- Cells were display-only in Phase 1; Phase 2 makes them interactive (open the
  sheet). Keep the spine visuals (incl. the #414 subdued styling) unchanged
  except for the affordance.
- **Languages uppercase** (TR/ES/DE). EN is source-only.
- **Build/test ordering:** after editing `packages/*` run `pnpm build` (turbo)
  before dependent typecheck/tests. Before the Lambda suite, `rm -rf
  infra/lambda/dist`. FULL gate: `pnpm lint && pnpm typecheck && pnpm test` from
  repo root with real exit codes (no `tail`/`head` masking).
- **No DB migration** — all tables/columns exist.
- **Visual reference:** the Claude Design prototype `cmap/detail.jsx`
  (`PointSheet`) is the visual spec for the detail sheet; remap its bare tokens
  to the app's `--color-*` tokens + shared `Card`/`Button`/`Chip` + `t-*`
  classes (same idiom as `map-tab.tsx`).
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Modify** `packages/db/src/generation/cells.ts` — `export` `compatibleTypes`.
- **Modify** `packages/db/src/index.ts` — re-export `compatibleTypes`.
- **Modify** `infra/lambda/src/lib/curriculum-map.ts` — add `compatibleTypes`,
  `hasTheory`, `errorSample` to `CurriculumFact`/`MapPoint` (pass-through).
- **Modify** `infra/lambda/src/lib/curriculum-map.test.ts` — cover pass-through.
- **Modify** `infra/lambda/src/routes/progress.ts` — resolve the three fields in
  the `/progress/curriculum` handler (compatibleTypes; theory-topic existence
  query; error-sample in the grouped error query).
- **Modify** `infra/lambda/src/routes/progress.test.ts` — assert the new fields.
- **Modify** `infra/lambda/src/routes/exercises.ts` — `grammarPointKey` on
  `ExerciseQuerySchema` + the `/exercises` filter.
- **Modify** `infra/lambda/src/routes/exercises.test.ts` — targeted-exercise test.
- **Modify** `packages/api-client/src/schemas/curriculum.ts` — schema fields.
- **Modify** `packages/api-client/src/schemas/curriculum.test.ts` — parse tests.
- **Modify** `packages/api-client/src/hooks/useExercise.ts` — `grammarPointKey` param.
- **Modify** `apps/web/app/(dashboard)/drill/page.tsx` — parse `?exerciseType`.
- **Modify** `apps/web/app/(dashboard)/drill/conjugation/page.tsx` — parse
  `?grammarPoint`, pass to `useExercise`.
- **Create** `apps/web/app/(dashboard)/progress/_components/point-detail-sheet.tsx`.
- **Create** `apps/web/app/(dashboard)/progress/_components/__tests__/point-detail-sheet.test.tsx`.
- **Modify** `apps/web/app/(dashboard)/progress/_components/map-tab.tsx` — tappable
  cells + sheet state.
- **Modify** `apps/web/app/(dashboard)/progress/_components/__tests__/map-tab.test.tsx`.

---

### Task 1: Export `compatibleTypes` from `@language-drill/db`

**Files:**
- Modify: `packages/db/src/generation/cells.ts:62`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/generation/cells.test.ts` (add a case)

**Interfaces:**
- Produces: `compatibleTypes(entry: GrammarPoint): ReadonlyArray<ExerciseType>` re-exported from `@language-drill/db`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/generation/cells.test.ts` (import `compatibleTypes` from `./cells`):

```typescript
import { compatibleTypes } from './cells';
import { ExerciseType } from '@language-drill/shared';

describe('compatibleTypes (exported)', () => {
  const gp = (over: Partial<GrammarPoint> = {}): GrammarPoint => ({
    key: 'tr-a1-x', kind: 'grammar', name: 'X', description: 'd', cefrLevel: 'A1', language: 'TR',
    examplesPositive: ['a', 'b'], examplesNegative: ['*c'], commonErrors: ['e'], ...over,
  } as GrammarPoint);

  it('grammar → cloze + translation by default', () => {
    expect(compatibleTypes(gp())).toEqual([ExerciseType.CLOZE, ExerciseType.TRANSLATION]);
  });
  it('drops cloze when clozeUnsuitable; appends SC/conjugation on flags', () => {
    expect(compatibleTypes(gp({ clozeUnsuitable: true }))).toEqual([ExerciseType.TRANSLATION]);
    expect(compatibleTypes(gp({ sentenceConstructionSuitable: true, conjugationSuitable: true })))
      .toEqual([ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.SENTENCE_CONSTRUCTION, ExerciseType.CONJUGATION]);
  });
  it('vocab → vocab_recall', () => {
    expect(compatibleTypes(gp({ kind: 'vocab' }))).toEqual([ExerciseType.VOCAB_RECALL]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/db test -- cells.test.ts` → FAIL (`compatibleTypes` not exported).

- [ ] **Step 3: Export it** — in `cells.ts:62` change `function compatibleTypes(` to `export function compatibleTypes(`. In `packages/db/src/index.ts` add (beside the other curriculum/generation exports):

```typescript
export { compatibleTypes } from './generation/cells';
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cells.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/cells.ts packages/db/src/index.ts packages/db/src/generation/cells.test.ts
git commit -m "feat(db): export compatibleTypes for the curriculum map"
```

---

### Task 2: Endpoint — add `compatibleTypes`, `hasTheory`, `errorSample`

**Files:**
- Modify: `infra/lambda/src/lib/curriculum-map.ts`
- Modify: `infra/lambda/src/lib/curriculum-map.test.ts`
- Modify: `infra/lambda/src/routes/progress.ts`
- Modify: `infra/lambda/src/routes/progress.test.ts`

**Interfaces:**
- Produces: `CurriculumFact` + `MapPoint` gain `compatibleTypes: string[]`,
  `hasTheory: boolean`, `errorSample: { wrongText: string; correction: string } | null`;
  the route resolves them.

- [ ] **Step 1: Extend the classifier (pass-through) + tests**

In `curriculum-map.ts`: add the three fields to `CurriculumFact` and `MapPoint`,
and copy them through in `toPoint`. `errorSample` is supplied per-point by the
route (a new map), like `errorCountByKey`:

```typescript
// in CurriculumFact:
  compatibleTypes: string[];
  hasTheory: boolean;
// in MapPoint (add all three):
  compatibleTypes: string[];
  hasTheory: boolean;
  errorSample: { wrongText: string; correction: string } | null;
// BuildInput: add `errorSampleByKey: ReadonlyMap<string, { wrongText: string; correction: string }>`
// in toPoint(...): set
//   compatibleTypes: f.compatibleTypes,
//   hasTheory: f.hasTheory,
//   errorSample: errorSampleByKey.get(f.key) ?? null,
```

Add a classifier test asserting `compatibleTypes`/`hasTheory` flow from the fact
and `errorSample` flows from the sample map (null when absent). Update existing
fact/build fixtures to include `compatibleTypes: []`, `hasTheory: false` and pass
an empty `errorSampleByKey` where needed.

- [ ] **Step 2: Run classifier tests** — RED then implement then GREEN: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- curriculum-map.test.ts`.

- [ ] **Step 3: Resolve the fields in the route**

In `progress.ts` `/progress/curriculum`:
- import `compatibleTypes` from `@language-drill/db` and `theoryTopics` (schema)
  + the curriculum `GrammarPoint` lookup already in use (`getGrammarPoint`).
- in `toFact`, add `compatibleTypes: [...compatibleTypes(getGrammarPoint(p.key)!)]`
  (the point object `p` from `grammarPointsAtOrBelow` is already a `GrammarPoint`,
  so pass `p` directly to `compatibleTypes(p)`), and `hasTheory` computed from a
  theory-topic existence set (built below).
- **theory existence:** one query before mapping —
  `select distinct topicId from theory_topics where language = <lang> and reviewStatus in (approved)`;
  build `const theorySet = new Set(rows.map(r => r.topicId))`; `hasTheory` for a
  point = `theorySet.has(<key without "<lang>-" prefix>)`. (Mirror the
  `topicIdForGrammarPointKey` transform: `key.slice(`${language.toLowerCase()}-`.length)`.)
- **error sample:** extend the existing grouped error query to also select a
  representative recent sample per effective point:
  `(array_agg(${errorObservations.wrongText} order by ${errorObservations.occurredAt} desc))[1]` as wrongText,
  and the same for `correction`. Build `errorSampleByKey` from rows where both are
  non-null. Pass it into `buildCurriculumMap`.

- [ ] **Step 4: Endpoint test** — extend the `/progress/curriculum` test: the
  seeded solid point asserts a non-empty `compatibleTypes` and `hasTheory`
  (seed/stub a theory topic for it); the error-prone point asserts
  `errorSample: { wrongText, correction }`. (Extend the harness's
  `compatibleTypes`/`theoryTopics`/error-sample stubs as the Phase-1 test did for
  the curriculum helpers — the db mock + `@language-drill/db` mock need the new
  `compatibleTypes` export + `theoryTopics` table stub.)

- [ ] **Step 5: Run** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda build && pnpm --filter @language-drill/lambda test -- curriculum-map.test.ts progress.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/lib/curriculum-map.ts infra/lambda/src/lib/curriculum-map.test.ts infra/lambda/src/routes/progress.ts infra/lambda/src/routes/progress.test.ts
git commit -m "feat(lambda): curriculum map exposes compatibleTypes, hasTheory, errorSample"
```

---

### Task 3: api-client schema — the three new fields

**Files:**
- Modify: `packages/api-client/src/schemas/curriculum.ts`
- Modify: `packages/api-client/src/schemas/curriculum.test.ts`

- [ ] **Step 1: Write the failing test** — add to `curriculum.test.ts` a case
  parsing a point with `compatibleTypes: ['cloze','translation']`, `hasTheory: true`,
  `errorSample: { wrongText: 'x', correction: 'y' }`, and a case with
  `errorSample: null` + `compatibleTypes: []` + `hasTheory: false`.

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/api-client test -- curriculum.test.ts`.

- [ ] **Step 3: Add the fields** to `CurriculumMapPointSchema`:

```typescript
  compatibleTypes: z.array(z.string()),
  hasTheory: z.boolean(),
  errorSample: z.object({ wrongText: z.string(), correction: z.string() }).nullable(),
```

- [ ] **Step 4: Build + run, verify pass** — `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client test -- curriculum.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/curriculum.ts packages/api-client/src/schemas/curriculum.test.ts
git commit -m "feat(api-client): curriculum map point gains compatibleTypes/hasTheory/errorSample"
```

---

### Task 4: Conjugation/single-exercise point targeting (`/exercises`)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts:60-65,157-211`
- Modify: `infra/lambda/src/routes/exercises.test.ts`
- Modify: `packages/api-client/src/hooks/useExercise.ts`

**Interfaces:**
- Produces: `GET /exercises?...&grammarPoint=<key>` filters to that point;
  `useExercise({ ..., grammarPointKey? })`.

- [ ] **Step 1: Write the failing tests** — (a) lambda: a `/exercises` test
  seeding two CONJUGATION exercises (one for `tr-a1-dili-past`, one for another
  point) and asserting `?grammarPoint=tr-a1-dili-past` returns the targeted one;
  (b) api-client: a `useExercise` test asserting `grammarPointKey` is appended to
  the request URL (mirror the existing `type`-param test).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Backend** — `ExerciseQuerySchema` add `grammarPoint: z.string().min(1).optional()`
  (URL param name `grammarPoint` to match the web; destructure as `grammarPointKey`).
  In the handler add to `conditions`: `...(grammarPointKey ? [eq(exercisesTable.grammarPointKey, grammarPointKey)] : [])`.

- [ ] **Step 4: Hook** — `useExercise`: add `grammarPointKey?: string` to params + the queryKey; in `queryFn` `if (grammarPointKey) params.set('grammarPoint', grammarPointKey)`.

- [ ] **Step 5: Run, verify pass** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- exercises.test.ts` + `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client test -- useExercise`.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts packages/api-client/src/hooks/useExercise.ts
git commit -m "feat: target a single exercise (e.g. conjugation) to a grammar point"
```

---

### Task 5: Drill entry — `?exerciseType` + conjugation `?grammarPoint`

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx:75-92,158-171`
- Modify: `apps/web/app/(dashboard)/drill/conjugation/page.tsx:33-66`
- Test: the existing drill page test + conjugation page test (update/add).

**Interfaces:**
- Consumes: `useExercise({ grammarPointKey })` (Task 4).

- [ ] **Step 1: Write/adjust failing tests** — (a) drill page: assert
  `?grammarPoint=tr-a1-locative&start=quick&exerciseType=cloze` produces a
  `createSession` config carrying both `grammarPointKey: 'tr-a1-locative'` and
  `exerciseType: 'cloze'`; (b) conjugation page: assert `?grammarPoint=tr-a1-dili-past`
  reaches `useExercise` as `grammarPointKey`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Drill page** — parse `?exerciseType`:

```typescript
const [exerciseType] = useState<ExerciseType | null>(() => {
  const t = searchParams.get('exerciseType');
  return t && (Object.values(ExerciseType) as string[]).includes(t) ? (t as ExerciseType) : null;
});
```

and merge into the non-dictation config: `...(exerciseType ? { exerciseType } : {})` (alongside the existing `grammarPointKey` spread).

- [ ] **Step 4: Conjugation page** — parse `?grammarPoint` (mirror the drill page's parse) and pass `grammarPointKey` into `useExercise({ language, difficulty, type: CONJUGATION, fetchFn, grammarPointKey })`. (Needs `useSearchParams`.)

- [ ] **Step 5: Run, verify pass** — `pnpm --filter @language-drill/web test -- drill/page drill/conjugation`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/drill"
git commit -m "feat(web): drill entry honors exerciseType + conjugation grammarPoint target"
```

---

### Task 6: PointDetailSheet + tappable map cells

**Files:**
- Create: `apps/web/app/(dashboard)/progress/_components/point-detail-sheet.tsx`
- Create: `apps/web/app/(dashboard)/progress/_components/__tests__/point-detail-sheet.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/_components/map-tab.tsx`
- Modify: `apps/web/app/(dashboard)/progress/_components/__tests__/map-tab.test.tsx`

**Interfaces:**
- Consumes: `CurriculumMapPoint` (now with `compatibleTypes`/`hasTheory`/`errorSample`);
  the prototype `cmap/detail.jsx` `PointSheet` as the visual reference; `typeLabel`
  from `apps/web/app/(dashboard)/_lib/timeline-labels.ts`; `topicIdForGrammarPointKey`
  from `apps/web/lib/theory-topic-map.ts`; the active language.

- [ ] **Step 1: Build `point-detail-sheet.tsx`** — a right-side sheet (port the
  prototype's `PointSheet`), props `{ point: CurriculumMapPoint; language: LearningLanguage; onClose: () => void }`:
  - header: state tag + `⚠ error-prone` when `errorProne`; name; `<level> · point <order> · last practiced …`.
  - mastery readout (mastery%/confidence%/evidence) when not `not-started`.
  - prereq cue ("builds on … — not solid yet, but you can still drill this") when `prereqUnmet`.
  - recurring error block when `errorSample`: `{wrongText} → {correction}` + `recentErrorCount`× in 30 days.
  - **theory link** when `hasTheory`: a `Link`/`Button` to
    `/theory/${topicIdForGrammarPointKey(point.key, language)}` (use the app's
    theory route — confirm the route path the theory page uses, e.g.
    `/theory/[topicId]`; pass the resolved topicId). If `topicIdForGrammarPointKey`
    returns null, omit the link.
  - **drill options:** a primary **"drill this point"** → `/drill?start=quick&grammarPoint=<key>`;
    then a **mode chip per `point.compatibleTypes`** using `typeLabel(type)`:
    conjugation → `/drill/conjugation?grammarPoint=<key>`; every other mode →
    `/drill?start=quick&grammarPoint=<key>&exerciseType=<type>`.
  - Esc + overlay-click close; accessible (`role="dialog"`/labelled).
  - Tokens/components per the app idiom (`--color-*`, `Card`/`Button`/`Chip`, `t-*`).

- [ ] **Step 2: Make cells tappable in `map-tab.tsx`** — `MapTab` gets local
  `const [selected, setSelected] = useState<CurriculumMapPoint | null>(null)`;
  `SpineRow` gains an `onSelect(point)` prop and its body becomes a focusable
  control (button/`role=button` + keyboard) calling `onSelect(point)` — **without
  changing the spine visuals** (keep the #414 subdued layout; just add the
  affordance + hover). Render `<PointDetailSheet point={selected} … onClose={() => setSelected(null)} />`
  when `selected`. (Collapsed-run rows stay display-only / expand-only.)

- [ ] **Step 3: Tests** — `point-detail-sheet.test.tsx`: render a fixture point with
  `compatibleTypes: ['cloze','translation','conjugation']`, `hasTheory: true`,
  `errorSample: {wrongText:'kitaplar',correction:'kitapları'}`; assert: the mastery
  readout renders; the error sample renders; a theory link with the right href;
  a "drill this point" link to `/drill?start=quick&grammarPoint=<key>`; a cloze
  chip to `…&exerciseType=cloze`; a conjugation chip to
  `/drill/conjugation?grammarPoint=<key>`. Update `map-tab.test.tsx`: a tap on a
  point row opens the sheet (the point's name appears in a dialog).

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/web test -- point-detail-sheet map-tab`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/progress"
git commit -m "feat(web): curriculum map point-detail sheet + on-demand mode chips"
```

---

### Task 7: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm test` → exit 0. Watch: the curriculum endpoint test harness now needs `compatibleTypes`/`theoryTopics` stubs; the map-tab test now renders an interactive cell; api-client schema consumers (Phase 1 fixtures) now need the three new required fields — update any fixture that builds a `CurriculumMapPoint` (grep the web for `compatibleTypes`-less fixtures).
- [ ] **Step 3:** No separate commit (gate only).

---

## Self-Review

- **Spec coverage (Phase 2):**
  - Tap → point-detail panel (mastery readout, error sample, theory link) → Task 6. ✓
  - Mode chips from `compatibleTypes` → Tasks 1/2/3 (data) + 6 (UI). ✓
  - Mixed + single-mode targeted drill (combined `{point+mode}` filter already exists) → Tasks 5/6. ✓
  - Conjugation targeted to a point → Task 4 (`/exercises` grammarPoint) + Task 5 (conjugation page) + Task 6 (chip). ✓
  - `hasTheory` / `errorSample` server-side → Task 2. ✓
  - Explicitly NOT here: plan/ranker changes (Phase 3), readiness advance action (Phase 4).
- **Placeholder scan:** backend tasks carry concrete code/SQL; Task 6 is a
  prototype port (the prototype `cmap/detail.jsx` is the visual spec) with the
  exact routing/href rules + tests given in full. The two harness-extension
  notes (Task 2/Task 7) point at the Phase-1 pattern already in `progress.test.ts`.
- **Type consistency:** `compatibleTypes: string[]` (db `ExerciseType[]` →
  serialized strings on the wire → `z.array(z.string())` → `typeLabel`-compatible
  values), `hasTheory: boolean`, `errorSample: {wrongText,correction}|null`
  identical across classifier, endpoint, schema, and the sheet. The `?exerciseType`
  param value is an `ExerciseType` string, consumed by the existing POST-session
  `exerciseType` filter.
