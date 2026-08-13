# Gloss-Spoilage Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pnpm audit:gloss` — a read-only author-run CLI that finds cloze rows whose learner-visible `glossEn` gives the answer away, across the 1,568 already-approved glossed rows that PR #639's new validator rule cannot reach.

**Architecture:** Two signals keep this cheap. A per-point triage call asks whether English even marks the distinction a point's blanks test (`ser`/`estar` glossed "is" cannot leak, so those points are excluded wholesale). A row-level judge then runs over rows in surviving points **plus** all 125 rows whose gloss contains a parenthetical, since a parenthetical like `(a current condition)` leaks even inside an otherwise-safe point. Judgement lives in `packages/ai/src/gloss-spoilage.ts`, mirroring `collapse-triage.ts` exactly: in-repo prompt, forced tool call, pure parser. The CLI never writes to the pool — remedy is a reviewed follow-up.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Anthropic SDK (`claude-sonnet-4-6`), Neon Postgres via Drizzle, the `packages/ai` author-run CLI family.

**Spec:** `docs/superpowers/specs/2026-08-12-gloss-spoilage-audit-design.md` — its two example tables (legitimate vs spoiler parentheticals) are the prompt's few-shot anchors and the fixture's source data. Read them before Task 2.

## Global Constraints

- **Workspace:** the worktree `/Users/seal/dev/language-drill/.claude/worktrees/gloss-spoilage-audit` on branch `fix/gloss-spoilage-audit`. Assert before every commit: `test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1`. Never edit a `/Users/seal/dev/language-drill/<path>` outside the worktree — that writes to the MAIN checkout.
- **Never use `git stash`.** The stash stack is shared across worktrees and other sessions can pop it. Use `git show <ref>:<path>` or `git diff` to compare.
- **`pnpm <script> -- --flag` is broken for every `packages/ai` CLI.** Pass flags with no `--` separator.
- **This module is NOT a Langfuse prompt.** Like `collapse-triage.ts`, it is a dev-time aid: do **not** add it to the `PROMPTS` manifest in `bootstrap-prompts.ts`, and do not expect `bootstrap-prompts --check` to know about it. Its version constant is `GLOSS_SPOILAGE_PROMPT_VERSION = 'gloss-spoilage@2026-08-12'`, bumped on prompt edits.
- **The CLI is read-only against the database.** No `UPDATE`/`INSERT`/`DELETE`, no `demote:pool`, no `revalidate:cloze`. Detection and remedy are deliberately separate.
- **Prod DB:** project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. The worktree `.env` `DATABASE_URL` points at the **dev** branch, whose pool differs.
- **Credentials never inlined into a Bash command** (the classifier blocks it). Write them to a scratchpad env file, invoke via `pnpm exec dotenv -e <file> --`, delete after. Never `cat`/`echo`/`grep` the file.
- **Every live-API run is backgrounded** (`run_in_background: true`) and carries `--max-cost-usd`.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from the worktree root, zero failures. `packages/db` is already built in this worktree; if the CDK synth tests fail with exit 254, symlink `esbuild` into root `node_modules`; if `infra/lambda/dist/**/*.test.js` produces phantom failures, `rm -rf infra/lambda/dist`. `apps/web` occasionally shows 2-3 flaky failures under Turbo's parallel load — re-run before treating them as real, and check whether the same tests pass in isolation.
- **`gh` needs the personal account:** `export GH_CONFIG_DIR="$HOME/.config/gh-personal"` or PR creation fails with "must be a collaborator".

## File Structure

| File | Responsibility |
|---|---|
| `packages/ai/src/gloss-spoilage.ts` (create) | Prompts, tool schemas, pure parsers, and the two call functions. Mirrors `collapse-triage.ts` structure. |
| `packages/ai/src/gloss-spoilage.test.ts` (create) | Unit tests for both pure parsers, including cross-field rules. No API calls. |
| `packages/ai/src/index.ts` (modify) | Re-export the new module's public surface, beside the existing `triageCell` export at ~line 456. |
| `packages/ai/scripts/audit-gloss.ts` (create) | The CLI: arg parsing, row loading, `hasParenthetical` extractor, the two-signal orchestration, JSON + markdown report. |
| `packages/ai/scripts/audit-gloss.test.ts` (create) | Unit tests for arg parsing, the extractor, and the row-selection logic. No API calls. |
| `packages/ai/scripts/fixtures/gloss-spoilage-cases.json` (create) | 10 real prod rows — 6 known spoilers, 4 known-legitimate — as the precision/recall gate. |
| `packages/ai/package.json` (modify) | `"audit:gloss": "tsx scripts/audit-gloss.ts"` beside `audit:collapse`. |
| `package.json` (modify) | `"audit:gloss": "dotenv -e .env -- pnpm --filter @language-drill/ai audit:gloss"` beside `audit:collapse`. |
| `CLAUDE.md` (modify) | A row in the "Running Locally" command table after `audit:collapse`. |
| `docs/analysis/gloss-spoilage-audit-2026-08-12.md` (create, Task 6) | The prod run's findings and the fixture-gate evidence. |

---

### Task 1: The judgement module — types, tools, and pure parsers

Build the module with its parsers first and no network code, so the cross-field rules are locked by tests before any prompt work.

**Files:**
- Create: `packages/ai/src/gloss-spoilage.ts`
- Test: `packages/ai/src/gloss-spoilage.test.ts`

**Interfaces:**
- Consumes: `GrammarPoint` from `@language-drill/shared`; `Anthropic` types from `@anthropic-ai/sdk`.
- Produces, and later tasks depend on these exact names:
  - `GLOSS_SPOILAGE_PROMPT_VERSION`, `GLOSS_SPOILAGE_TOOL_NAME`, `GLOSS_ROW_TOOL_NAME`, `GLOSS_SPOILAGE_MODEL`, `GLOSS_SPOILAGE_MAX_TOKENS`, `GLOSS_SPOILAGE_TEMPERATURE`
  - `type PointTriageVerdict = { englishEncodesDistinction: boolean; reasoning: string; confidence: 'high' | 'medium' | 'low' }`
  - `type GlossVerdict = { verdict: 'spoiled' | 'legitimate' | 'borderline'; offendingSpan: string | null; proposedGloss: string | null; loadBearing: boolean; reasoning: string; confidence: 'high' | 'medium' | 'low' }`
  - `type PointTriageInput = { grammarPoint: GrammarPoint; language: string; cefrLevel: string; sampleGlosses: readonly string[] }`
  - `type GlossRowInput = { grammarPoint: GrammarPoint; language: string; cefrLevel: string; sentence: string; correctAnswer: string; acceptableAnswers: readonly string[] | null; instructions: string; glossEn: string }`
  - `parsePointTriageVerdict(input: unknown): PointTriageVerdict`
  - `parseGlossVerdict(input: unknown): GlossVerdict`

Note `loadBearing` — it is not in the spec's type sketch but the spec's remedy section requires distinguishing a gloss whose removal would make the blank ambiguous. Carrying it as a first-class field is what lets the report separate data edits from authoring work.

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/src/gloss-spoilage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  GLOSS_SPOILAGE_PROMPT_VERSION,
  parseGlossVerdict,
  parsePointTriageVerdict,
} from './gloss-spoilage.js';

describe('parsePointTriageVerdict', () => {
  it('accepts a well-formed verdict', () => {
    const v = parsePointTriageVerdict({
      englishEncodesDistinction: false,
      reasoning: 'English "is" covers both ser and estar.',
      confidence: 'high',
    });
    expect(v.englishEncodesDistinction).toBe(false);
    expect(v.confidence).toBe('high');
  });

  it('rejects a missing boolean rather than coercing it', () => {
    expect(() => parsePointTriageVerdict({ reasoning: 'x', confidence: 'high' })).toThrow(
      /englishEncodesDistinction/,
    );
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parsePointTriageVerdict({
        englishEncodesDistinction: true,
        reasoning: 'x',
        confidence: 'certain',
      }),
    ).toThrow(/confidence/);
  });

  it('rejects empty reasoning', () => {
    expect(() =>
      parsePointTriageVerdict({
        englishEncodesDistinction: true,
        reasoning: '   ',
        confidence: 'low',
      }),
    ).toThrow(/reasoning/);
  });
});

describe('parseGlossVerdict', () => {
  const spoiled = {
    verdict: 'spoiled',
    offendingSpan: '(a current condition)',
    proposedGloss: 'Today the weather is very bad.',
    loadBearing: false,
    reasoning: 'The parenthetical names estar’s trigger.',
    confidence: 'high',
  };

  it('accepts a well-formed spoiled verdict', () => {
    const v = parseGlossVerdict(spoiled);
    expect(v.verdict).toBe('spoiled');
    expect(v.offendingSpan).toBe('(a current condition)');
    expect(v.loadBearing).toBe(false);
  });

  it('requires an offendingSpan when the verdict is spoiled', () => {
    expect(() => parseGlossVerdict({ ...spoiled, offendingSpan: null })).toThrow(
      /offendingSpan/,
    );
  });

  it('forbids an offendingSpan when the verdict is legitimate', () => {
    expect(() =>
      parseGlossVerdict({
        verdict: 'legitimate',
        offendingSpan: '(female)',
        proposedGloss: null,
        loadBearing: false,
        reasoning: 'Gender is meaning, not the dative form.',
        confidence: 'high',
      }),
    ).toThrow(/legitimate/);
  });

  it('allows a null proposedGloss only when dropping is safe', () => {
    // loadBearing + no replacement is contradictory: removing a load-bearing
    // gloss makes the blank ambiguous, so the model must propose a replacement.
    expect(() =>
      parseGlossVerdict({ ...spoiled, loadBearing: true, proposedGloss: null }),
    ).toThrow(/loadBearing/);
  });

  it('normalises a legitimate verdict to null span and null proposal', () => {
    const v = parseGlossVerdict({
      verdict: 'legitimate',
      offendingSpan: null,
      proposedGloss: null,
      loadBearing: true,
      reasoning: 'The parenthetical forces the reading without naming the form.',
      confidence: 'medium',
    });
    expect(v.offendingSpan).toBeNull();
    expect(v.proposedGloss).toBeNull();
  });
});

describe('GLOSS_SPOILAGE_PROMPT_VERSION', () => {
  it('is dated and surface-tagged', () => {
    expect(GLOSS_SPOILAGE_PROMPT_VERSION).toBe('gloss-spoilage@2026-08-12');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-spoilage-audit
pnpm --filter @language-drill/ai test gloss-spoilage
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `packages/ai/src/gloss-spoilage.ts`. **Read `packages/ai/src/collapse-triage.ts` first and mirror its file shape**: the header comment explaining it is not a Langfuse prompt, the `as const` arrays feeding both the TS union and the tool enum, `isObject`, a pure parser that throws on illegality, and the call function returning `{ verdict, usage }`.

```ts
/**
 * Gloss-spoilage audit (2026-08-12 design). In-repo prompt + forced tool + pure
 * parser, mirroring `collapse-triage.ts`. NOT a runtime Lambda path and NOT
 * registered in Langfuse — a dev-time aid run by a human via the `audit:gloss`
 * CLI. Do NOT add it to the PROMPTS manifest in `bootstrap-prompts.ts`. Bump the
 * version constant on prompt edits.
 *
 * Two judgements, deliberately separate:
 *   - `triageGlossPoint` — does English even MARK the distinction this point's
 *     blanks test? "The coffee is on the table" cannot leak ser vs estar, so a
 *     whole point can be excluded on one call.
 *   - `judgeGlossRow` — does THIS row's gloss state the rule trigger/outcome?
 *     A parenthetical can leak inside an otherwise-safe point.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { GrammarPoint } from '@language-drill/shared';

export const GLOSS_SPOILAGE_PROMPT_VERSION = 'gloss-spoilage@2026-08-12';
export const GLOSS_SPOILAGE_TOOL_NAME = 'report_point_triage';
export const GLOSS_ROW_TOOL_NAME = 'report_gloss_verdict';
export const GLOSS_SPOILAGE_MODEL = 'claude-sonnet-4-6';
export const GLOSS_SPOILAGE_MAX_TOKENS = 1024;
export const GLOSS_SPOILAGE_TEMPERATURE = 0.2;

const VERDICTS = ['spoiled', 'legitimate', 'borderline'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

export type GlossVerdictName = (typeof VERDICTS)[number];
export type GlossConfidence = (typeof CONFIDENCES)[number];
```

Then the two types from the Interfaces block above, the two tool definitions, and the two parsers. The parser rules the tests pin, stated plainly so you implement them rather than infer them:

- `parsePointTriageVerdict`: `englishEncodesDistinction` must be an actual boolean (reject `undefined`, do not coerce); `reasoning` non-empty after trim; `confidence` in the enum.
- `parseGlossVerdict`: `verdict` in the enum; `reasoning` non-empty; `confidence` in the enum; **`spoiled` requires a non-empty `offendingSpan`**; **`legitimate` forbids an `offendingSpan`** (a legitimate gloss has nothing offending — a span here means the model contradicted itself); `loadBearing: true` with `proposedGloss: null` throws, because dropping a load-bearing gloss makes the blank ambiguous; a `legitimate` verdict normalises `offendingSpan` and `proposedGloss` to `null`. `borderline` is permissive on the span/proposal fields — it exists precisely for cases the model cannot resolve.

The system prompt must carry, verbatim, the distinction that is the whole judgement:

> A gloss may convey **meaning** that the learner must still convert into a form. It may NOT state the rule's **trigger or outcome**.

and the spec's two example tables as few-shot anchors — the four legitimate cases (`(female)`, `(formal)`, `(all)`, `(female)` agreement) and at least five spoilers (`(a current condition)`, `(right now)`, `(located)`, `(far away)`, `(tomatoes in general)`), each with its answer and a one-line reason. Also instruct: **`legitimate` is the default when unsure** (mirroring `collapse-triage`'s bias toward the non-defect verdict), because a false positive here causes a good disambiguating gloss to be trimmed, which silently makes an exercise ambiguous.

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
pnpm --filter @language-drill/ai test gloss-spoilage
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Re-export from the package index**

In `packages/ai/src/index.ts`, beside the existing `triageCell` export (~line 456), add the new module's public surface: the six constants, the four types, both parsers, and both call functions (`triageGlossPoint`, `judgeGlossRow`).

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm --filter @language-drill/ai typecheck
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add packages/ai/src/gloss-spoilage.ts packages/ai/src/gloss-spoilage.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): gloss-spoilage judgement module

In-repo prompt + forced tool + pure parsers for the audit:gloss CLI, mirroring
collapse-triage.ts. Two judgements: whether English marks a point's tested
distinction at all, and whether a given row's gloss states the rule trigger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The fixture and its parse test

**Files:**
- Create: `packages/ai/scripts/fixtures/gloss-spoilage-cases.json`
- Test: `packages/ai/scripts/audit-gloss.test.ts` (created here, extended in Task 3)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the fixture path and its shape, consumed by Task 5's `--check-fixture` mode.

**Where the data comes from.** All 10 rows are real production rows quoted in the spec's two tables. Do **not** invent rows or paraphrase glosses — copy them exactly, since the whole point is a precision/recall gate against known answers.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/audit-gloss.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

type FixtureCase = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  glossEn: string;
  expected: 'spoiled' | 'legitimate';
  note: string;
};

describe('fixtures/gloss-spoilage-cases.json', () => {
  const raw = JSON.parse(
    readFileSync(path.join(here, 'fixtures', 'gloss-spoilage-cases.json'), 'utf8'),
  ) as { cases: FixtureCase[] };

  it('carries 6 known spoilers and 4 known-legitimate rows', () => {
    const spoiled = raw.cases.filter((c) => c.expected === 'spoiled');
    const legit = raw.cases.filter((c) => c.expected === 'legitimate');
    expect(spoiled).toHaveLength(6);
    expect(legit).toHaveLength(4);
  });

  it('every case carries a gloss and a real exercise id', () => {
    for (const c of raw.cases) {
      expect(c.glossEn.length).toBeGreaterThan(0);
      expect(c.id).toMatch(/^[0-9a-f]{8}-/);
      expect(c.note.length).toBeGreaterThan(0);
    }
  });

  it('every spoiler gloss contains the parenthetical that leaks', () => {
    // The gate would be vacuous if a "spoiler" case had no leaking span to find.
    for (const c of raw.cases.filter((x) => x.expected === 'spoiled')) {
      expect(c.glossEn).toContain('(');
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm --filter @language-drill/ai test audit-gloss
```

Expected: FAIL — `ENOENT` on the fixture.

- [ ] **Step 3: Write the fixture**

Create `packages/ai/scripts/fixtures/gloss-spoilage-cases.json`. The 6 spoilers and 4 legitimate rows, with their glosses copied verbatim from the spec's tables:

```json
{
  "description": "Precision/recall gate for `audit:gloss --check-fixture`. Ten real production cloze rows: 6 whose glossEn states the rule trigger/outcome (spoilers) and 4 whose parenthetical supplies only meaning the learner must still convert into a form (legitimate). Sourced from docs/superpowers/specs/2026-08-12-gloss-spoilage-audit-design.md. A run that misses a spoiler or flags a legitimate row must not be trusted: a false positive here means trimming a gloss that was doing real disambiguation work.",
  "cases": [
    {
      "id": "<real id>", "grammarPointKey": "es-a1-ser-estar-basic",
      "language": "ES", "cefrLevel": "A1",
      "sentence": "Hoy el tiempo ___ muy malo.", "correctAnswer": "está",
      "glossEn": "Today the weather is very bad. (a current condition)",
      "expected": "spoiled",
      "note": "Names estar's trigger — a current condition."
    }
  ]
}
```

The nine remaining cases follow the same shape. Their content, from the spec:

| expected | point | gloss | answer |
|---|---|---|---|
| spoiled | es-a1-ser-estar-basic | "The soup has no flavor. It is without salt (right now)." | `Está` |
| spoiled | es-a1-ser-estar-basic | "She is very happy today. (temporary feeling)" | `Está` |
| spoiled | es-a1-present-irregular-core | "The paper is (located) on the table." | `está` |
| spoiled | es-a1-demonstratives | "Do you see that tree (far away) over there?" | `aquel` |
| spoiled | es-a1-articles | "I like tomatoes (tomatoes in general)." | `los` |
| legitimate | de-a1-dative | "The book belongs to the teacher (female)." | `der` |
| legitimate | de-a2-konjunktiv-ii-polite | "Could you (formal) please tell me where the train station is?" | `Könnten` |
| legitimate | de-a2-reflexive-verbs | "Do you (all) see each other every day at school?" | `euch` |
| legitimate | es-a1-gender-agreement | "I have two Spanish friends (female) in my class." | `españolas` |

**Get the real `id`, `sentence`, and `cefrLevel` for each from prod** before writing the file — the test asserts a uuid-shaped id, and a fabricated one would make the fixture unverifiable. Query with the Neon MCP tools (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`):

```sql
select id, grammar_point_key, language, difficulty,
       content_json->>'sentence' as sentence,
       content_json->>'correctAnswer' as correct,
       content_json->>'glossEn' as gloss
from exercises
where type='cloze' and review_status in ('auto-approved','manual-approved')
  and content_json->>'glossEn' in ( /* the 10 glosses above, verbatim */ );
```

If a gloss does not match exactly, find its row by `grammar_point_key` + a `like` on a distinctive fragment rather than guessing — and use whatever the database actually holds, not the spec's rendering, if they differ. Report any mismatch.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm --filter @language-drill/ai test audit-gloss
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add packages/ai/scripts/fixtures/gloss-spoilage-cases.json packages/ai/scripts/audit-gloss.test.ts
git commit -m "test(ai): gloss-spoilage fixture — 6 known spoilers, 4 legitimate

Ten real prod rows as the precision/recall gate for audit:gloss. A false
positive here would mean trimming a gloss doing real disambiguation work.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The CLI's pure logic — args, extractor, row selection

Build and test everything that does not need the network or the database, so the two-signal selection rule is locked before any spend.

**Files:**
- Create: `packages/ai/scripts/audit-gloss.ts`
- Modify: `packages/ai/scripts/audit-gloss.test.ts`

**Interfaces:**
- Consumes: the module from Task 1.
- Produces:
  - `type AuditGlossFilters = { language?: string; cefr?: string; grammarPoint?: string; limit?: number; maxCostUsd?: number; out?: string; dryRun: boolean; checkFixture: boolean }`
  - `parseAuditGlossArgs(argv: string[]): AuditGlossFilters`
  - `hasParenthetical(gloss: string): boolean`
  - `extractParentheticals(gloss: string): string[]`
  - `type GlossRow = { id: string; grammarPointKey: string; language: string; cefrLevel: string; sentence: string; correctAnswer: string; acceptableAnswers: string[] | null; instructions: string; glossEn: string }`
  - `selectRowsToJudge(rows: readonly GlossRow[], pointVerdicts: ReadonlyMap<string, boolean>): GlossRow[]`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai/scripts/audit-gloss.test.ts`:

```ts
import {
  extractParentheticals,
  hasParenthetical,
  parseAuditGlossArgs,
  selectRowsToJudge,
  type GlossRow,
} from './audit-gloss.js';

describe('parseAuditGlossArgs', () => {
  it('defaults to a live run with no filters', () => {
    const a = parseAuditGlossArgs([]);
    expect(a.dryRun).toBe(false);
    expect(a.checkFixture).toBe(false);
    expect(a.language).toBeUndefined();
  });

  it('uppercases language and cefr because the pool stores them uppercase', () => {
    const a = parseAuditGlossArgs(['--language', 'es', '--cefr', 'a1']);
    expect(a.language).toBe('ES');
    expect(a.cefr).toBe('A1');
  });

  it('parses numeric caps', () => {
    const a = parseAuditGlossArgs(['--limit', '25', '--max-cost-usd', '1.5']);
    expect(a.limit).toBe(25);
    expect(a.maxCostUsd).toBe(1.5);
  });

  it('rejects a non-numeric limit rather than silently yielding NaN', () => {
    expect(() => parseAuditGlossArgs(['--limit', 'lots'])).toThrow(/limit/);
  });
});

describe('hasParenthetical / extractParentheticals', () => {
  it('detects a parenthetical', () => {
    expect(hasParenthetical('Today the weather is very bad. (a current condition)')).toBe(true);
  });

  it('is false for a plain gloss', () => {
    expect(hasParenthetical('The coffee is on the table.')).toBe(false);
  });

  it('extracts every parenthetical span including the brackets', () => {
    expect(
      extractParentheticals('This lady (near me) is kind (really).'),
    ).toEqual(['(near me)', '(really)']);
  });

  it('ignores an unclosed bracket', () => {
    expect(extractParentheticals('Something (unclosed')).toEqual([]);
  });
});

describe('selectRowsToJudge', () => {
  const row = (id: string, point: string, gloss: string): GlossRow => ({
    id,
    grammarPointKey: point,
    language: 'ES',
    cefrLevel: 'A1',
    sentence: 'x ___ y',
    correctAnswer: 'a',
    acceptableAnswers: null,
    instructions: 'Fill in the blank.',
    glossEn: gloss,
  });

  it('keeps every row of a point where English encodes the distinction', () => {
    const rows = [row('1', 'es-a1-demonstratives', 'That tree over there.')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-demonstratives', true]]));
    expect(out.map((r) => r.id)).toEqual(['1']);
  });

  it('drops a plain-gloss row in an excluded point', () => {
    const rows = [row('1', 'es-a1-ser-estar-basic', 'The coffee is on the table.')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-ser-estar-basic', false]]));
    expect(out).toEqual([]);
  });

  it('KEEPS a parenthetical row even in an excluded point', () => {
    // This is the rule that catches "(a current condition)" on a ser/estar blank
    // — the case that proves point-level exclusion alone is not enough.
    const rows = [
      row('1', 'es-a1-ser-estar-basic', 'The coffee is on the table.'),
      row('2', 'es-a1-ser-estar-basic', 'Today the weather is bad. (a current condition)'),
    ];
    const out = selectRowsToJudge(rows, new Map([['es-a1-ser-estar-basic', false]]));
    expect(out.map((r) => r.id)).toEqual(['2']);
  });

  it('keeps a row whose point has no verdict, rather than silently dropping it', () => {
    const rows = [row('1', 'es-a1-unknown-point', 'Plain gloss.')];
    expect(selectRowsToJudge(rows, new Map()).map((r) => r.id)).toEqual(['1']);
  });

  it('does not duplicate a parenthetical row in an included point', () => {
    const rows = [row('1', 'es-a1-demonstratives', 'That tree (far away).')];
    const out = selectRowsToJudge(rows, new Map([['es-a1-demonstratives', true]]));
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @language-drill/ai test audit-gloss
```

Expected: FAIL — no exports from `audit-gloss.ts`.

- [ ] **Step 3: Implement the pure functions**

Create `packages/ai/scripts/audit-gloss.ts`. **Read `packages/ai/scripts/audit-collapse.ts` first** and follow its conventions: the file header comment, `parseArgs` from `node:util`, exported pure functions above `main()`, and `main()` guarded so importing the module for tests does not execute it.

Implementation notes that the tests pin:

- `parseAuditGlossArgs` uppercases `--language`/`--cefr` (the pool stores them uppercase — `audit-collapse.ts` and `qa-sample-run.ts` both do this), leaves `--grammar-point` as-is, and throws on a non-numeric `--limit`/`--max-cost-usd` rather than passing `NaN` downstream.
- `extractParentheticals` returns each `(...)` span **including** the brackets, in order, ignoring an unclosed bracket. A non-greedy match per span, not one greedy match across the string.
- `selectRowsToJudge` is the two-signal rule in one place: keep a row if its point's verdict is `true`, **or** if the row has a parenthetical, **or** if the point has no verdict at all (an unknown point is judged rather than silently skipped — a triage failure must not become a silent exclusion). Return each row at most once.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @language-drill/ai test audit-gloss
```

Expected: PASS — 3 fixture tests + 14 new ones.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add packages/ai/scripts/audit-gloss.ts packages/ai/scripts/audit-gloss.test.ts
git commit -m "feat(ai): audit:gloss pure logic — args, parentheticals, row selection

selectRowsToJudge encodes the two-signal rule: a point where English marks the
distinction, OR any row with a parenthetical (which can leak inside an otherwise
safe point), OR a point with no triage verdict (never a silent exclusion).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the CLI end to end — loading, orchestration, report

**Files:**
- Modify: `packages/ai/scripts/audit-gloss.ts`
- Modify: `packages/ai/package.json`, `package.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: `triageGlossPoint`, `judgeGlossRow` from Task 1; the pure functions from Task 3; `createDb`, `exercises`, `getGrammarPoint`, `requireEnv` from `@language-drill/db`; `createClaudeClient` from `../src/index.js`.
- Produces: the `audit:gloss` script name and the report shape Task 5 reads.

- [ ] **Step 1: Load the glossed rows**

Add a loader that selects approved cloze rows carrying a gloss, honouring the filters. Mirror `audit-collapse.ts`'s Drizzle usage:

```ts
const rows = await db
  .select({
    id: exercises.id,
    grammarPointKey: exercises.grammarPointKey,
    language: exercises.language,
    difficulty: exercises.difficulty,
    contentJson: exercises.contentJson,
  })
  .from(exercises)
  .where(
    and(
      eq(exercises.type, ExerciseType.CLOZE),
      inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
      sql`${exercises.contentJson} ? 'glossEn'`,
      ...(filters.language ? [eq(exercises.language, filters.language)] : []),
      ...(filters.cefr ? [eq(exercises.difficulty, filters.cefr)] : []),
      ...(filters.grammarPoint ? [eq(exercises.grammarPointKey, filters.grammarPoint)] : []),
    ),
  );
```

Map each into a `GlossRow`, skipping (and counting) any row whose `contentJson.glossEn` is not a non-empty string.

- [ ] **Step 2: Orchestrate the two signals**

Group rows by `grammarPointKey`. For each point, resolve its `GrammarPoint` via `getGrammarPoint` and call `triageGlossPoint` with up to 3 sample glosses from that point. A triage call that throws is recorded as a failure and the point gets **no** verdict — which `selectRowsToJudge` treats as "judge its rows", never as an exclusion. Then run `selectRowsToJudge` and call `judgeGlossRow` per surviving row.

Accumulate usage into a running cost with the same Sonnet per-MTok constants `audit-collapse.ts` uses, and stop starting new calls once `--max-cost-usd` is reached, recording `costCapped: true`. Under `--dry-run`, do no API calls at all: report how many points and rows *would* be judged, and the estimated cost.

- [ ] **Step 3: Write the report**

Write `./audit-runs/<name>.json` and `.md` (`mkdirSync(outDir, { recursive: true })`, as `audit-collapse.ts` does). The JSON carries `meta` (filters, model, prompt version, cost, `costCapped`, timestamp, counts), `pointTriage` (every point with its verdict, reasoning, confidence, row count, and whether it was excluded), `findings` (one entry per judged row: id, point, language/level, sentence, correctAnswer, glossEn, verdict, offendingSpan, proposedGloss, loadBearing, reasoning, confidence), and `errors`.

The markdown must lead with the numbers a reader needs — rows scanned, points excluded and why, spoiled / borderline / legitimate counts — then a table of spoiled rows with their proposed gloss, and **a separate section for `loadBearing: true` rows** flagged as authoring work rather than data edits. Include the per-row `id` so a repair can be scripted from the report.

- [ ] **Step 4: Register the script**

`packages/ai/package.json`, after the `audit:collapse` line:

```json
"audit:gloss": "tsx scripts/audit-gloss.ts",
```

Root `package.json`, after its `audit:collapse` line:

```json
"audit:gloss": "dotenv -e .env -- pnpm --filter @language-drill/ai audit:gloss",
```

- [ ] **Step 5: Document it in CLAUDE.md**

Add a row to the "Running Locally" table immediately after `pnpm audit:collapse`, matching the register of its neighbours: what it does, the two signals, that it is **read-only and never writes to the pool**, the flags, and that remedy is trimming the gloss as a separate reviewed step. State that it is a spotlight, not a gate.

- [ ] **Step 6: Verify the wiring without spending anything**

```bash
pnpm --filter @language-drill/ai typecheck
pnpm exec dotenv -e .env -- pnpm --filter @language-drill/ai audit:gloss --language ES --cefr A1 --limit 5 --dry-run
```

Expected: exits 0 against the **dev** database, prints the would-judge counts and estimated cost, makes no API calls, and writes no `audit-runs/` file (or writes one clearly marked dry-run — either is fine, state which you implemented).

- [ ] **Step 7: Run the unit tests and commit**

```bash
pnpm --filter @language-drill/ai test audit-gloss
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add packages/ai/scripts/audit-gloss.ts packages/ai/package.json package.json CLAUDE.md
git commit -m "feat(ai): audit:gloss CLI — two-signal sweep over glossed cloze rows

Read-only: loads approved glossed cloze rows, triages each point for whether
English marks its tested distinction, judges rows in surviving points plus every
parenthetical row, and writes JSON + markdown to audit-runs/. Never writes to the
pool — remedy is a separate reviewed step.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The fixture gate — prove the judge before trusting it

This is the task that decides whether any verdict from this tool can be believed.

**Files:**
- Modify: `packages/ai/scripts/audit-gloss.ts` (add `--check-fixture`)

**Interfaces:**
- Consumes: the fixture from Task 2; `judgeGlossRow` from Task 1.
- Produces: the precision/recall numbers Task 6 records.

- [ ] **Step 1: Implement `--check-fixture`**

When the flag is set, skip the database entirely: read `scripts/fixtures/gloss-spoilage-cases.json`, run `judgeGlossRow` over each case **3 times**, and report per case every draw's verdict, plus overall precision and recall against `expected`. Treat `borderline` as **not** a spoiler for scoring, and report it separately — a judge that hedges on a known spoiler has not caught it.

Three draws because the judge is a nondeterministic LLM call and a single draw near a decision boundary proves nothing; that lesson is recorded in `docs/analysis/qa-sample-findings-2026-08-11.md`, where a one-draw verdict was later reversed by an n=10 replay.

- [ ] **Step 2: Run the gate, backgrounded**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-spoilage-audit
pnpm exec dotenv -e .env -- pnpm --filter @language-drill/ai audit:gloss --check-fixture --max-cost-usd 1
```

30 calls, ~$0.30. `.env` supplies `ANTHROPIC_API_KEY`; no database is touched, so the dev/prod distinction does not matter here.

- [ ] **Step 3: Assess against the gate**

**Required: all 6 spoilers flagged `spoiled` on a majority of draws, and all 4 legitimate rows `legitimate` on a majority.** Report every draw, not a summary.

If a **legitimate** row is flagged spoiled, stop and report — that is the dangerous direction. Acting on it would trim a gloss doing real disambiguation work, silently turning a sound exercise into an ambiguous one. Do not tune the prompt to make the gate pass without saying so; if you change the prompt, bump `GLOSS_SPOILAGE_PROMPT_VERSION` and re-run the full gate.

If a **spoiler** is missed, report which and its reasoning — a recall gap is tolerable if known, since the sweep is a spotlight, but it must be recorded rather than discovered later.

- [ ] **Step 4: Commit**

```bash
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add packages/ai/scripts/audit-gloss.ts
git commit -m "feat(ai): audit:gloss --check-fixture precision/recall gate

Runs the row judge over 10 known-answer prod rows, 3 draws each, before any
verdict from this tool is trusted. A false positive is the dangerous direction:
trimming a legitimate gloss makes an exercise ambiguous.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Run the sweep against prod and record the findings

Runs only after Task 5's gate passes.

**Files:**
- Create: `docs/analysis/gloss-spoilage-audit-2026-08-12.md`
- Create (gitignored): `packages/ai/audit-runs/prod-gloss-2026-08-12.{json,md}`

- [ ] **Step 1: Fetch prod credentials into a scratchpad env file**

Use the Neon MCP `get_connection_string` tool (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`) and the `ANTHROPIC_API_KEY` from the worktree `.env`. Write both to a scratchpad env file with the Write tool — never echo a credential through Bash. Delete the file when the run is done.

- [ ] **Step 2: Dry-run against prod first**

```bash
pnpm exec dotenv -e <scratchpad>/prod-gloss.env -- pnpm --filter @language-drill/ai audit:gloss --dry-run
```

Expected: reports ~1,568 glossed rows and ~70 points, and an estimated cost. **Sanity-check that row count against the spec's table before spending anything** — a wildly different number means the filter is wrong.

- [ ] **Step 3: Run the sweep, backgrounded**

```bash
pnpm exec dotenv -e <scratchpad>/prod-gloss.env -- pnpm --filter @language-drill/ai audit:gloss --max-cost-usd 5 --out prod-gloss-2026-08-12
```

Background it and poll — several hundred sequential calls will exceed any foreground timeout. `--max-cost-usd 5` is a deliberate ceiling above the ~$2.50–3.50 estimate; if the run reports `costCapped: true`, say so and report how much was left unjudged rather than presenting partial coverage as complete.

- [ ] **Step 4: Write the findings record**

Create `docs/analysis/gloss-spoilage-audit-2026-08-12.md` covering: the fixture gate's per-draw results and precision/recall; the point-triage outcome (which points were excluded and the reasoning for the largest ones, since those exclusions are what makes the sweep cheap and are the thing a future reader will want to audit); the spoiled-row count with a table of the worst cases; the `loadBearing` rows called out as authoring work; anything the run could not judge; and the actual cost.

Be explicit about what the sweep does **not** cover: a spoiled row in an excluded point with no parenthetical is invisible to it.

- [ ] **Step 5: Delete the credential file and commit**

```bash
rm -f <scratchpad>/prod-gloss.env
test "$(git branch --show-current)" = "fix/gloss-spoilage-audit" || exit 1
git add docs/analysis/gloss-spoilage-audit-2026-08-12.md
git commit -m "docs(qa): gloss-spoilage sweep findings

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full gate, push, PR

- [ ] **Step 1: Clear the two known gate hazards**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/gloss-spoilage-audit
ls node_modules/esbuild >/dev/null 2>&1 || ln -s "$(pwd)/node_modules/.pnpm/$(ls node_modules/.pnpm | grep -m1 '^esbuild@')/node_modules/esbuild" node_modules/esbuild
rm -rf infra/lambda/dist
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures; report the counts. If `apps/web` reports 2–3 failures, re-run the suite — that package lacks the `fileParallelism: false` setting `infra` has and flakes under Turbo's parallel load. Confirm the same tests pass in isolation (`cd apps/web && pnpm vitest run`) before calling them flakes, and say so explicitly in your report.

- [ ] **Step 3: Rebase and push**

```bash
git fetch origin main && git rebase origin/main
git push -u origin fix/gloss-spoilage-audit
```

- [ ] **Step 4: Open the PR**

```bash
export GH_CONFIG_DIR="$HOME/.config/gh-personal"
gh pr create --title "feat(ai): audit:gloss — find cloze glosses that give the answer away" --body-file <a body file you write>
```

The body must state: what the defect is and that #639 made it detectable but only for new drafts; the two signals and why they make this ~$3 instead of ~$15–30; the fixture gate's precision/recall numbers; the sweep's findings; that the CLI is read-only and remedy is a separate reviewed step; and the acknowledged blind spot (a spoiled row in an excluded point with no parenthetical). Squash-merge, replacing the auto bullet list with the summary.

---

## Self-Review

**Spec coverage:** the two signals → Tasks 1, 3, 4. The `gloss-spoilage.ts` module → Task 1. The CLI + registration + docs → Task 4. Tests → Tasks 1, 2, 3. The fixture and its gate → Tasks 2, 5. Cost ceilings → Task 4 Step 2 and Task 6 Step 3. Read-only guarantee → Task 4 (asserted) and the Global Constraints. Remedy explicitly out of scope → stated in Task 4's commit message and Task 6's record.

**Deviations from the spec, deliberate:**
1. `GlossVerdict` gains a `loadBearing: boolean` the spec's type sketch omitted. The spec's remedy section requires distinguishing a gloss whose removal would make the blank ambiguous; without a first-class field the report cannot separate data edits from authoring work, and Task 1's parser enforces that `loadBearing: true` must come with a `proposedGloss`.
2. The spec named one tool; the plan uses two (`report_point_triage`, `report_gloss_verdict`) because the two judgements return different shapes and one schema covering both would make every field optional, defeating the parser's cross-field checks.
3. `selectRowsToJudge` treats a point with **no** triage verdict as "judge its rows". The spec did not say what happens when a triage call fails; silently excluding those rows would turn an API error into invisible missing coverage.

**Type consistency:** `GlossRow`, `GlossVerdict`, `PointTriageVerdict`, `PointTriageInput`, `GlossRowInput`, `parseGlossVerdict`, `parsePointTriageVerdict`, `triageGlossPoint`, `judgeGlossRow`, `selectRowsToJudge`, `hasParenthetical`, `extractParentheticals`, `parseAuditGlossArgs`, `AuditGlossFilters`, and `GLOSS_SPOILAGE_PROMPT_VERSION` are used identically in every task that references them. `GLOSS_SPOILAGE_TOOL_NAME` is the point-triage tool and `GLOSS_ROW_TOOL_NAME` the row judge — distinct constants, both declared in Task 1.
