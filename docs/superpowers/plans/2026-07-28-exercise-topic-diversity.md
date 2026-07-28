# Exercise Topic Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the approved exercise pool collapsing onto a few scenarios — kill answer-clone accumulation in sentence_construction and give every cell a topic-diversity floor with zero per-point authoring.

**Architecture:** Three systemic changes plus a cleanup. (A) A global topic-domain vocabulary in `@language-drill/shared` drives a deficit-based per-draft `topicTargets` assignment, threaded scheduler → job-message → handler → run-one-cell → generate, replacing the always-`mixed` topic line — for **all** exercise types. (B) `canonicalSurface` keys sentence_construction dedup on the primary model answer instead of the prompt — SC only. (C) An explicit diversity rule in the SC prompt section + version bump. (D) A one-off `db` CLI that regroups SC rows on the new key, demotes duplicates, and backfills `_dedupKey`.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle ORM (Neon Postgres), AWS Lambda (SQS-driven generation), Anthropic Claude generation.

## Global Constraints

- **`packages/ai` MUST NOT import `@language-drill/db`** (build cycle → CI TS2307). `ai` may import `@language-drill/shared`. `db` importing `ai` is fine (existing).
- **After editing `packages/db` source, run `pnpm build`** before running vitest anywhere (vitest resolves stale `db/dist`).
- **Before the full `pnpm test`, `rm -rf infra/lambda/dist`** (stale compiled `*.test.js` cause phantom failures).
- **lambda tests importing real `../db` need `vi.mock('../db')`** or they break under turbo without `DATABASE_URL`.
- **Editing any `*_SYSTEM_PROMPT`/its template requires bumping the matching `*_PROMPT_VERSION`** to today's date in the same commit. This plan touches generation → bump `GENERATION_PROMPT_VERSION` to `generate@2026-07-28`.
- **Prompt body changes only reach prod after a Langfuse sync** (`push-prompts`), BUT edits confined to a computed `{{var}}` (e.g. `renderSentenceConstructionSection`) or the per-draft user prompt ship with the **code deploy** — verify with `push-prompts --check`.
- **Co-locate `*.test.ts` next to the module. No orphan test files.** Add to a module's existing test file when it has one.
- **Never commit on a random branch.** All work on `feat/exercise-topic-diversity` (already created off `main`; the design spec is committed there as `f7d080b`). Assert the branch before every commit.
- Language codes in the DB are **uppercase** (`ES`, `DE`, `TR`, `EN`); CEFR is `A1`/`A2`/`B1`/`B2`.

---

## File Structure

**Create:**
- `packages/shared/src/topic-domains.ts` — `TOPIC_DOMAINS` vocabulary + `TopicDomain` type + `TOPIC_HINT_VALUES`.
- `packages/shared/src/topic-domains.test.ts` — union↔list sync test.
- `infra/lambda/src/generation/topic-decision.ts` — pure `decideTopicTargets` water-fill.
- `infra/lambda/src/generation/topic-decision.test.ts` — deficit tests.
- `packages/db/src/generation/sc-dedup-cleanup.ts` — pure `groupSentenceConstructionDuplicates`.
- `packages/db/src/generation/sc-dedup-cleanup.test.ts` — grouping tests.
- `packages/db/scripts/dedup-sc-pool.ts` — cleanup CLI (imports the pure fn).

**Modify:**
- `packages/shared/src/index.ts` — re-export topic-domains.
- `packages/ai/src/generation-prompts.ts` — SC `canonicalSurface` (B); SC diversity rule (C); version bump (C).
- `packages/ai/src/generation-prompts.test.ts` — flip SC dedup test (B); assert diversity rule + version (C).
- `packages/ai/src/generate.ts` — `topicHint` enum in tool schemas (A4); `GenerationSpec.topicTargets` + `resolveTopicDomain` + call-site (A3).
- `packages/ai/src/generate.test.ts` — `resolveTopicDomain` + schema-enum tests (A3/A4). *(Create if it does not exist — it is this module's test file, not an orphan.)*
- `infra/lambda/src/generation/job-message.ts` — `topicTargets` field + parser.
- `infra/lambda/src/generation/job-message.test.ts` — parser tests.
- `infra/lambda/src/generation/scheduler.ts` — `loadApprovedTopicCountsPerCell` + attach `topicTargets` for all cells.
- `infra/lambda/src/generation/handler.ts` — pass `topicTargets` to `runOneCell`.
- `packages/db/src/generation/run-one-cell.ts` — `topicTargets` arg + into `GenerationSpec`.
- `packages/db/package.json` + root `package.json` — register `dedup:sc-pool`.

---

## Task 1: Topic-domain vocabulary in `@language-drill/shared`

**Files:**
- Create: `packages/shared/src/topic-domains.ts`
- Create: `packages/shared/src/topic-domains.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `TOPIC_DOMAINS: readonly TopicDomain[]` (the 16 assignable domains), `type TopicDomain`, `TOPIC_HINT_VALUES: readonly string[]` (= `[...TOPIC_DOMAINS, "other"]`), `isTopicDomain(x: string): x is TopicDomain`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/topic-domains.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TOPIC_DOMAINS, TOPIC_HINT_VALUES, isTopicDomain } from "./topic-domains";

describe("topic-domains", () => {
  it("exposes 16 unique neutral domains", () => {
    expect(TOPIC_DOMAINS.length).toBe(16);
    expect(new Set(TOPIC_DOMAINS).size).toBe(16);
  });

  it("TOPIC_HINT_VALUES is the domains plus 'other'", () => {
    expect(TOPIC_HINT_VALUES).toEqual([...TOPIC_DOMAINS, "other"]);
  });

  it("isTopicDomain accepts a domain and rejects 'other'/unknown", () => {
    expect(isTopicDomain("travel")).toBe(true);
    expect(isTopicDomain("other")).toBe(false);
    expect(isTopicDomain("nonsense")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- topic-domains`
Expected: FAIL — cannot find module `./topic-domains`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/topic-domains.ts`:

```ts
/**
 * Global, grammar-agnostic vocabulary of neutral everyday topic domains.
 * Domains (not scenarios) so any grammar point can be expressed in any domain.
 * Used to steer per-draft topic diversity during generation (deficit water-fill)
 * and to constrain the model's `topicHint` label so the deficit is measurable.
 */
export const TOPIC_DOMAINS = [
  "travel",
  "food",
  "home",
  "work",
  "health",
  "shopping",
  "weather",
  "education",
  "family",
  "money",
  "transport",
  "technology",
  "nature",
  "media",
  "sport",
  "holidays",
] as const;

export type TopicDomain = (typeof TOPIC_DOMAINS)[number];

/** Legal `content_json.topicHint` values: the domains plus an escape hatch. */
export const TOPIC_HINT_VALUES = [...TOPIC_DOMAINS, "other"] as const;

export function isTopicDomain(x: string): x is TopicDomain {
  return (TOPIC_DOMAINS as readonly string[]).includes(x);
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, add near the other `export * from "./..."` lines:

```ts
export * from "./topic-domains";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- topic-domains`
Expected: PASS (3 tests).

- [ ] **Step 6: Build shared (downstream packages resolve dist)**

Run: `pnpm --filter @language-drill/shared build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/shared/src/topic-domains.ts packages/shared/src/topic-domains.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add global topic-domain vocabulary"
```

---

## Task 2: Answer-aware sentence_construction dedup (Component B)

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts:829-830` (the `SENTENCE_CONSTRUCTION` case of `canonicalSurface`)
- Modify: `packages/ai/src/generation-prompts.test.ts:1071-1082`

**Interfaces:**
- Consumes: `canonicalSurface(content)` and `SentenceConstructionContent.modelAnswers: string[]` (always present, ≥2 entries).
- Produces: SC dedup now keys on `normaliseSurface(content.modelAnswers[0])`. No signature change; downstream (`validate-and-insert.ts:443`, `exercises_dedup_idx`) is unchanged.

- [ ] **Step 1: Update the existing SC canonicalSurface test to the new behavior**

Replace `packages/ai/src/generation-prompts.test.ts:1071-1082` with:

```ts
describe("canonicalSurface — sentence_construction", () => {
  it("keys on the normalised primary model answer, not the prompt", () => {
    const key = (prompt: string, primary: string) =>
      canonicalSurface({
        type: ExerciseType.SENTENCE_CONSTRUCTION,
        instructions: "x",
        promptMode: "grammar_target",
        prompt,
        modelAnswers: [primary, "otra frase"],
      });

    // Different prompt wording, identical elicited answer → SAME key (clones collide).
    expect(key("Usá el condicional.", "Iría a la playa.")).toBe(
      key("Escribe una frase en condicional.", "Iría a la playa."),
    );
    // Diacritics/whitespace normalised.
    expect(key("p1", "  Iría   a la playa. ")).toBe("iria a la playa.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — current SC branch returns the normalised prompt, so the two keys differ.

- [ ] **Step 3: Change the SC branch of `canonicalSurface`**

In `packages/ai/src/generation-prompts.ts`, change the `SENTENCE_CONSTRUCTION` case from:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return normaliseSurface(content.prompt);
```

to:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      // Key on the primary elicited sentence, not the instructional prompt:
      // reworded instructions that funnel to the same answer are redundant.
      return normaliseSurface(content.modelAnswers[0] ?? content.prompt);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "fix(generation): key SC dedup on primary model answer, not prompt"
```

---

## Task 3: `decideTopicTargets` deficit water-fill (Component A2)

**Files:**
- Create: `infra/lambda/src/generation/topic-decision.ts`
- Create: `infra/lambda/src/generation/topic-decision.test.ts`

**Interfaces:**
- Consumes: `TOPIC_DOMAINS` from `@language-drill/shared`.
- Produces: `decideTopicTargets(input: TopicDecisionInput): string[]` where `TopicDecisionInput = { domains: readonly string[]; need: number; approvedByDomain: Readonly<Record<string, number>> }`. Returns an array of length `max(0, need)`; each element is a domain from `domains`, greedily assigned to whichever domain is currently least-represented (pool seed + running assignments). `need <= 0` → `[]`.

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/generation/topic-decision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TOPIC_DOMAINS } from "@language-drill/shared";
import { decideTopicTargets } from "./topic-decision";

describe("decideTopicTargets", () => {
  it("returns [] when nothing is needed", () => {
    expect(decideTopicTargets({ domains: TOPIC_DOMAINS, need: 0, approvedByDomain: {} })).toEqual([]);
  });

  it("assigns one draft to each least-represented domain first (empty pool)", () => {
    const out = decideTopicTargets({ domains: TOPIC_DOMAINS, need: TOPIC_DOMAINS.length, approvedByDomain: {} });
    // Empty pool + one draft per domain → each domain exactly once.
    expect([...out].sort()).toEqual([...TOPIC_DOMAINS].sort());
  });

  it("fills the deficit against an existing skewed pool", () => {
    // Pool is all travel; 3 drafts must go to three different non-travel domains.
    const out = decideTopicTargets({
      domains: ["travel", "food", "home"],
      need: 3,
      approvedByDomain: { travel: 10 },
    });
    expect(out).toEqual(["food", "home", "food"]); // food(0)->home(0)->food(1); travel stays saturated
  });

  it("only ever emits domains from the supplied set", () => {
    const out = decideTopicTargets({ domains: TOPIC_DOMAINS, need: 5, approvedByDomain: { travel: 2 } });
    for (const d of out) expect(TOPIC_DOMAINS).toContain(d);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- topic-decision`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `infra/lambda/src/generation/topic-decision.ts`:

```ts
/**
 * Per-draft topic-domain assignment via deficit water-fill — the topic analogue
 * of `decideCoverageTargets`, but over a single global domain set with no floors
 * or give-up logic. Greedily assigns each draft to the domain currently lowest
 * in the approved pool (seed) plus running assignments, so the pool cannot
 * re-collapse onto one scenario. Applies to ALL exercise types.
 */
export type TopicDecisionInput = {
  domains: readonly string[];
  need: number;
  /** Approved-pool counts per domain (legacy/unknown hints bucketed as "other"). */
  approvedByDomain: Readonly<Record<string, number>>;
};

export function decideTopicTargets(input: TopicDecisionInput): string[] {
  const { domains, need, approvedByDomain } = input;
  if (need <= 0 || domains.length === 0) return [];

  const counts = new Map<string, number>();
  for (const d of domains) counts.set(d, approvedByDomain[d] ?? 0);

  const out: string[] = [];
  for (let i = 0; i < need; i++) {
    let best = domains[0];
    let bestCount = counts.get(best) ?? 0;
    for (const d of domains) {
      const c = counts.get(d) ?? 0;
      if (c < bestCount) {
        best = d;
        bestCount = c;
      }
    }
    out.push(best);
    counts.set(best, bestCount + 1);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- topic-decision`
Expected: PASS (4 tests). If the skewed-pool ordering assertion trips, confirm the greedy tie-break picks the first domain in `domains` order (it does — `<`, not `<=`).

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/topic-decision.ts infra/lambda/src/generation/topic-decision.test.ts
git commit -m "feat(generation): add decideTopicTargets deficit water-fill"
```

---

## Task 4: `topicTargets` on the job message (Component A)

**Files:**
- Modify: `infra/lambda/src/generation/job-message.ts` (type `:37-68`; parser `:134-188`; add optional-parser near `optionalCoverageTargets` `:329-368`)
- Modify: `infra/lambda/src/generation/job-message.test.ts`

**Interfaces:**
- Consumes: `TOPIC_DOMAINS` from `@language-drill/shared`; existing `count` field.
- Produces: `GenerationJobMessage.spec.topicTargets?: string[]` — when present, length MUST equal `count`, each value ∈ `TOPIC_DOMAINS`. Parsed by `parseGenerationJobMessage`; invalid → the message's existing validation-failure path.

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/generation/job-message.test.ts` (match the file's existing import of `parseGenerationJobMessage` and its valid-message fixture; construct `base` like the existing valid cases):

```ts
import { TOPIC_DOMAINS } from "@language-drill/shared";

describe("parseGenerationJobMessage — topicTargets", () => {
  it("accepts topicTargets of length === count with legal domains", () => {
    const msg = makeValidJob({ count: 2, topicTargets: ["travel", "food"] });
    const parsed = parseGenerationJobMessage(JSON.stringify(msg));
    expect(parsed.spec.topicTargets).toEqual(["travel", "food"]);
  });

  it("rejects topicTargets whose length !== count", () => {
    const msg = makeValidJob({ count: 2, topicTargets: ["travel"] });
    expect(() => parseGenerationJobMessage(JSON.stringify(msg))).toThrow();
  });

  it("rejects topicTargets with an unknown domain", () => {
    const msg = makeValidJob({ count: 1, topicTargets: ["nonsense"] });
    expect(() => parseGenerationJobMessage(JSON.stringify(msg))).toThrow();
  });

  it("omits topicTargets when absent", () => {
    const msg = makeValidJob({ count: 1 });
    delete (msg.spec as Record<string, unknown>).topicTargets;
    expect(parseGenerationJobMessage(JSON.stringify(msg)).spec.topicTargets).toBeUndefined();
  });
});
```

> If the test file has no `makeValidJob` helper, add one that returns a minimal valid `GenerationJobMessage` object (copy the shape from an existing passing test in this file) and merges `overrides` into `.spec`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- job-message`
Expected: FAIL — `topicTargets` not on the type / not parsed.

- [ ] **Step 3: Add the field to the type**

In `infra/lambda/src/generation/job-message.ts`, inside the `spec` object type (right after the `coverageTargets?: CoverageTarget[];` field), add:

```ts
    /**
     * Per-draft topic-domain assignment (deficit water-fill). When present,
     * length MUST === `count`; each value is a domain from TOPIC_DOMAINS.
     * Applies to all exercise types; orthogonal to the cell-wide `topicDomain`.
     */
    topicTargets?: string[];
```

- [ ] **Step 4: Add the optional-parser and thread it through**

At the top of `job-message.ts`, ensure the import includes the vocabulary:

```ts
import { TOPIC_DOMAINS } from "@language-drill/shared";
```

Add near `optionalCoverageTargets` (mirror its structure and error style):

```ts
const TOPIC_DOMAIN_SET: ReadonlySet<string> = new Set(TOPIC_DOMAINS);

function optionalTopicTargets(raw: unknown, count: number): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error("topicTargets must be an array");
  }
  if (raw.length !== count) {
    throw new Error(`topicTargets length ${raw.length} !== count ${count}`);
  }
  return raw.map((v) => {
    if (typeof v !== "string" || !TOPIC_DOMAIN_SET.has(v)) {
      throw new Error(`topicTargets contains an illegal domain: ${String(v)}`);
    }
    return v;
  });
}
```

In `parseGenerationJobMessage`, where the returned `spec` object is assembled (alongside the existing `coverageTargets: optionalCoverageTargets(...)` line, `:167`), add:

```ts
      topicTargets: optionalTopicTargets(
        (rawSpec as Record<string, unknown>).topicTargets,
        count,
      ),
```

(Use the same `count` local the coverage parser uses.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- job-message`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/job-message.ts infra/lambda/src/generation/job-message.test.ts
git commit -m "feat(generation): carry per-draft topicTargets on the job message"
```

---

## Task 5: `GenerationSpec.topicTargets`, `resolveTopicDomain`, tool-schema enum (Components A3, A4)

**Files:**
- Modify: `packages/ai/src/generate.ts` — `GenerationSpec` type (`:557-610`, `topicDomain` at `:564`); user-prompt call site (`:1389-1395`); tool-schema `topicHint` properties (SC `:367-370`, cloze `:145-149`, translation `:199`, vocab_recall `:254`, conjugation `:315`, contextual_paraphrase `:427`, free_writing `:532`).
- Modify/Create: `packages/ai/src/generate.test.ts`

**Interfaces:**
- Consumes: `TOPIC_HINT_VALUES` from `@language-drill/shared`; `GenerationSpec.topicDomain`.
- Produces: `GenerationSpec.topicTargets?: readonly string[]`; `resolveTopicDomain(spec, ordinal): string | null` = `spec.topicTargets?.[ordinal] ?? spec.topicDomain`. Every generation tool's `topicHint` property gains `enum: [...TOPIC_HINT_VALUES]`.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generate.test.ts` (create the file if absent, with header `import { describe, it, expect } from "vitest";` plus the imports below):

```ts
import { resolveTopicDomain, SENTENCE_CONSTRUCTION_GENERATION_TOOL } from "./generate.js";
import { TOPIC_HINT_VALUES } from "@language-drill/shared";

describe("resolveTopicDomain", () => {
  it("uses the per-draft topicTargets value when present", () => {
    const spec = { topicDomain: null, topicTargets: ["travel", "food"] } as never;
    expect(resolveTopicDomain(spec, 1)).toBe("food");
  });
  it("falls back to the cell-wide topicDomain when no target for the ordinal", () => {
    const spec = { topicDomain: "mixed", topicTargets: ["travel"] } as never;
    expect(resolveTopicDomain(spec, 5)).toBe("mixed");
  });
  it("returns null when neither is set", () => {
    const spec = { topicDomain: null } as never;
    expect(resolveTopicDomain(spec, 0)).toBeNull();
  });
});

describe("topicHint schema constraint", () => {
  it("constrains the SC tool's topicHint to the vocabulary", () => {
    const prop = (SENTENCE_CONSTRUCTION_GENERATION_TOOL as never as {
      input_schema: { properties: { topicHint: { enum?: string[] } } };
    }).input_schema.properties.topicHint;
    expect(prop.enum).toEqual([...TOPIC_HINT_VALUES]);
  });
});
```

> Confirm the exported tool constant's shape (`input_schema` vs `parameters`) against the file and adjust the accessor path in the test to match. If `SENTENCE_CONSTRUCTION_GENERATION_TOOL` is not exported, add `export` to it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate`
Expected: FAIL — `resolveTopicDomain` undefined; `topicHint.enum` undefined.

- [ ] **Step 3: Add `topicTargets` to `GenerationSpec` and the `resolveTopicDomain` helper**

In `packages/ai/src/generate.ts`, in the `GenerationSpec` type right after `topicDomain: string | null;` (`:564`), add:

```ts
  /**
   * Per-draft topic-domain assignment (deficit water-fill). Length === count
   * when present. Overrides the cell-wide `topicDomain` per ordinal.
   */
  topicTargets?: readonly string[];
```

Add an exported helper near the other small exported utilities in this file:

```ts
export function resolveTopicDomain(
  spec: Pick<GenerationSpec, "topicDomain" | "topicTargets">,
  ordinal: number,
): string | null {
  return spec.topicTargets?.[ordinal] ?? spec.topicDomain;
}
```

- [ ] **Step 4: Use the helper at the user-prompt call site**

At `packages/ai/src/generate.ts:1389-1395`, change the 3rd argument of `buildGenerationUserPrompt` from `spec.topicDomain` to `resolveTopicDomain(spec, ordinal)`:

```ts
    const userPrompt = buildGenerationUserPrompt(
      promptInputs,
      ordinal,
      resolveTopicDomain(spec, ordinal),
      spec.seedWords?.[ordinal] ?? null,
      spec.coverageTargets,
    );
```

(Preserve the exact existing argument list; only the 3rd argument changes.)

- [ ] **Step 5: Constrain `topicHint` in every generation tool schema**

Add the import at the top of `generate.ts`:

```ts
import { TOPIC_HINT_VALUES } from "@language-drill/shared";
```

For **each** tool's `topicHint` property, add an `enum`. E.g. the SC tool (`:367-370`) becomes:

```ts
      topicHint: {
        type: "string",
        description:
          "Topic theme for this exercise. Prefer the assigned 'Topic domain'; use 'other' only if no listed domain fits.",
        enum: [...TOPIC_HINT_VALUES],
      },
```

Apply the same `enum: [...TOPIC_HINT_VALUES]` addition to the `topicHint` property of the cloze, translation, vocab_recall, conjugation, contextual_paraphrase, and free_writing tools. Leave `required` arrays unchanged (`topicHint` stays optional).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generate`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(generation): per-draft topic resolution + topicHint vocabulary enum"
```

---

## Task 6: Thread `topicTargets` through `run-one-cell` (Component A)

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` — args type (`:233-240`); `GenerationSpec` construction (`:909-928`)

**Interfaces:**
- Consumes: `GenerationJobMessage.spec.topicTargets` (via handler, Task 8); `GenerationSpec.topicTargets` (Task 5).
- Produces: `runOneCell` args accept `topicTargets?: readonly string[]`, forwarded onto the `GenerationSpec` it builds.

- [ ] **Step 1: Add the arg to the `runOneCell` args type**

In `packages/db/src/generation/run-one-cell.ts`, in the `args` object type near `topicDomain: string | null;` (`:233`) and `coverageTargets?: readonly CoverageTarget[];` (`:240`), add:

```ts
    topicTargets?: readonly string[];
```

- [ ] **Step 2: Forward it into the `GenerationSpec`**

In the `spec = { ... }` construction (`:909-928`), after `coverageTargets: args.coverageTargets,`, add:

```ts
      topicTargets: args.topicTargets,
```

- [ ] **Step 3: Build db (downstream dist)**

Run: `pnpm --filter @language-drill/db build`
Expected: exit 0 (this is a pure type/threading change; no new test — it is covered end-to-end by the handler test in Task 8 and typecheck).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/db/src/generation/run-one-cell.ts
git commit -m "feat(generation): thread topicTargets through run-one-cell into GenerationSpec"
```

---

## Task 7: Scheduler computes and attaches `topicTargets` for every cell (Component A2)

**Files:**
- Modify: `infra/lambda/src/generation/scheduler.ts` — imports (`:45-51`); a new `loadApprovedTopicCountsPerCell` (model on `loadApprovedCoverageCountsPerCell` `:190-232`); invoke it alongside coverage loading (`~:298`); attach `topicTargets` in the message map (`:442-491`), **before** the `if (!spec) return base` coverage guard so it applies to all cells.

**Interfaces:**
- Consumes: `decideTopicTargets` (Task 3); `TOPIC_DOMAINS`, `isTopicDomain` (Task 1); `cellKey`.
- Produces: every enqueued `GenerationJobMessage.spec` carries `topicTargets` (length === `need`) whenever `need > 0`.

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/generation/scheduler.test.ts` (reuse its existing `vi.mock` scaffold for `@aws-sdk/client-sqs` and `@language-drill/db`; follow the existing pattern that captures enqueued messages). Assert that a selected cell's enqueued message has `topicTargets` of length `need` with every value in `TOPIC_DOMAINS`:

```ts
import { TOPIC_DOMAINS } from "@language-drill/shared";

it("attaches per-draft topicTargets to every enqueued cell", async () => {
  // ...drive runScheduler with the file's existing harness so ≥1 cell is enqueued...
  const enqueued = capturedMessages(); // however this file already reads sent SQS bodies
  expect(enqueued.length).toBeGreaterThan(0);
  for (const m of enqueued) {
    expect(m.spec.topicTargets).toHaveLength(m.spec.count);
    for (const d of m.spec.topicTargets) expect(TOPIC_DOMAINS).toContain(d);
  }
});
```

> Match the harness already used by neighbouring scheduler tests for building the DB mock and reading enqueued SQS payloads. Do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- scheduler`
Expected: FAIL — `topicTargets` absent from enqueued messages.

- [ ] **Step 3: Add the topic-count loader**

In `scheduler.ts`, add an import:

```ts
import { decideTopicTargets } from './topic-decision';
import { TOPIC_DOMAINS, isTopicDomain } from '@language-drill/shared';
```

Add `loadApprovedTopicCountsPerCell` modeled on `loadApprovedCoverageCountsPerCell` (`:190-232`). It runs one `db.execute(sql\`...\`)` that groups approved rows by cell and `content_json->>'topicHint'`, bucketing anything not in the vocabulary as `other`:

```ts
async function loadApprovedTopicCountsPerCell(
  db: Db,
): Promise<Map<string, Record<string, number>>> {
  const rows = await db.execute(sql`
    SELECT language, difficulty, type, grammar_point_key,
           COALESCE(content_json->>'topicHint', 'other') AS topic_hint,
           COUNT(*)::int AS n
    FROM exercises
    WHERE review_status IN ('auto-approved', 'manual-approved')
    GROUP BY language, difficulty, type, grammar_point_key, topic_hint
  `);
  const out = new Map<string, Record<string, number>>();
  for (const r of rows as unknown as Array<{
    language: string; difficulty: string; type: string;
    grammar_point_key: string; topic_hint: string; n: number;
  }>) {
    const key = buildCellKeyFromRow(r); // reuse the same helper the coverage loader uses
    const domain = isTopicDomain(r.topic_hint) ? r.topic_hint : 'other';
    const bucket = out.get(key) ?? {};
    bucket[domain] = (bucket[domain] ?? 0) + r.n;
    out.set(key, bucket);
  }
  return out;
}
```

> Use the exact `Db` type, `sql` import, and `buildCellKeyFromRow` helper already present in this file for the coverage loader. If `buildCellKeyFromRow` expects specific field names, match them.

- [ ] **Step 4: Invoke the loader alongside coverage loading**

Where `approvedCoverageByCell` is populated (`~:298`), add a parallel load:

```ts
  const approvedTopicByCell = await loadApprovedTopicCountsPerCell(db);
```

(Prefer running it in the same `Promise.all` if the coverage load is already awaited there.)

- [ ] **Step 5: Attach `topicTargets` for every cell before the coverage guard**

In the `selectedCells.map(({ cell, need }) => { ... })` body (`:442`), compute topic targets first and fold them into `base.spec` so both return paths keep them:

```ts
  const messages: GenerationJobMessage[] = selectedCells.map(({ cell, need }) => {
    const topicTargets = decideTopicTargets({
      domains: TOPIC_DOMAINS,
      need,
      approvedByDomain: approvedTopicByCell.get(cell.cellKey) ?? {},
    });
    const base = {
      jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
      trigger: 'scheduled' as const,
      spec: {
        language: cell.language,
        cefrLevel: cell.cefrLevel,
        exerciseType: cell.exerciseType,
        grammarPointKey: cell.grammarPoint.key,
        topicDomain: null,
        count: need,
        batchSeed,
        ...(topicTargets.length > 0 ? { topicTargets } : {}),
      },
      maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
    };

    const spec = cell.grammarPoint.coverageSpec;
    if (!spec) return base;
    // ...existing coverage-target block unchanged...
    if (coverageTargets.length === 0) return base;
    return { ...base, spec: { ...base.spec, coverageTargets } };
  });
```

(Keep the existing coverage block verbatim between the guard and the final return.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- scheduler`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/scheduler.ts infra/lambda/src/generation/scheduler.test.ts
git commit -m "feat(generation): scheduler assigns deficit-driven topicTargets to all cells"
```

---

## Task 8: Handler passes `topicTargets` to `runOneCell` (Component A)

**Files:**
- Modify: `infra/lambda/src/generation/handler.ts:299-315`

**Interfaces:**
- Consumes: `parsed.spec.topicTargets` (Task 4); `runOneCell` args `topicTargets` (Task 6).
- Produces: end-to-end per-draft topic steering is live.

- [ ] **Step 1: Add the passthrough**

In `handler.ts`, in the `runOneCell({ ..., args: { ... } })` call (`:303-309`), after `coverageTargets: parsed.spec.coverageTargets,`, add:

```ts
                topicTargets: parsed.spec.topicTargets,
```

- [ ] **Step 2: Write/extend the failing test**

In `infra/lambda/src/generation/handler.test.ts` (reuse its `vi.mock('../db')` / `vi.mock('./run-one-cell')` scaffold — required per Global Constraints), assert `runOneCell` receives `topicTargets` from the parsed message:

```ts
it("forwards topicTargets from the job message to runOneCell", async () => {
  const msg = makeValidJobBody({ count: 2, topicTargets: ["travel", "food"] });
  await handler(sqsEventWith(msg), lambdaCtx());
  expect(runOneCellMock).toHaveBeenCalledWith(
    expect.objectContaining({
      args: expect.objectContaining({ topicTargets: ["travel", "food"] }),
    }),
  );
});
```

> Match the file's existing helpers for building an SQS event and mocking `runOneCell`. If `runOneCell` is not already mocked in this file, add `vi.mock('./run-one-cell', () => ({ runOneCell: vi.fn().mockResolvedValue(<the shape other tests use>) }))`.

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @language-drill/lambda test -- handler`
Expected: PASS (add step-order: if you wrote the test before the passthrough, it FAILS first, then PASSES after Step 1 — keep TDD order).

- [ ] **Step 4: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add infra/lambda/src/generation/handler.ts infra/lambda/src/generation/handler.test.ts
git commit -m "feat(generation): forward topicTargets through the generation handler"
```

---

## Task 9: SC diversity prompt rule + version bump (Component C)

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` — `renderSentenceConstructionSection` (`:268-290`); `GENERATION_PROMPT_VERSION` (`:230`)
- Modify: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the SC system-prompt section instructs the model to honor the assigned `Topic domain`, vary the scenario, and not default to free-time/travel; version bumped to `generate@2026-07-28`.

**Note:** `renderSentenceConstructionSection` is a computed `{{sentenceConstructionSection}}` var, so this edit **ships with the code deploy**, not the Langfuse template body (verified at rollout with `push-prompts --check`). The version bump is still required (cohort tag).

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts`:

```ts
import { GENERATION_PROMPT_VERSION } from "./generation-prompts.js";

describe("SC section — scenario diversity", () => {
  it("instructs the model to vary the scenario and honor the assigned topic", () => {
    const section = renderSentenceConstructionSection(ExerciseType.SENTENCE_CONSTRUCTION);
    expect(section).toMatch(/vary the scenario/i);
    expect(section).toMatch(/topic domain/i);
    expect(section).toMatch(/do not default/i);
  });
  it("bumps the generation prompt version to 2026-07-28", () => {
    expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-07-28");
  });
});
```

> Confirm `renderSentenceConstructionSection`'s actual parameter (it takes the exercise type or the full inputs — match the real signature; call it the same way existing tests do). If it is not exported, export it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — strings absent; version still `2026-07-24`.

- [ ] **Step 3: Add the diversity rule**

In `renderSentenceConstructionSection` (`:268-290`), inside the returned `## Sentence-construction specifics` block, add a bullet (adjust to the block's existing markdown/bullet style):

```
- Scenario variety is REQUIRED. Honor the assigned "Topic domain" for this draft; build the situation from that domain. Vary the concrete scenario across drafts — do NOT default to "free time / more free time" or generic travel wish-lists, and do not reuse the same model answer across exercises.
```

- [ ] **Step 4: Bump the version constant**

Change `packages/ai/src/generation-prompts.ts:230`:

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-07-28";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(generation): SC scenario-diversity rule + bump GENERATION_PROMPT_VERSION"
```

---

## Task 10: SC dedup cleanup — pure grouping + CLI (Component D)

**Files:**
- Create: `packages/db/src/generation/sc-dedup-cleanup.ts`
- Create: `packages/db/src/generation/sc-dedup-cleanup.test.ts`
- Create: `packages/db/scripts/dedup-sc-pool.ts`
- Modify: `packages/db/package.json`, root `package.json`

**Interfaces:**
- Consumes: `canonicalSurface` from `@language-drill/ai` (new SC behavior from Task 2); `exercises` schema, `createDb`.
- Produces: `groupSentenceConstructionDuplicates(rows: ScRow[]): CleanupPlan` where
  `ScRow = { id: string; contentJson: SentenceConstructionContent & { _dedupKey?: string }; qualityScore: number | null; createdAt: Date; reviewStatus: string; language: string; difficulty: string; grammarPointKey: string }`
  and `CleanupPlan = { toDemote: string[]; toBackfill: Array<{ id: string; newKey: string }> }`.
  Survivor selection per collision group: approved (`auto-approved`/`manual-approved`) preferred over `flagged`, then highest `qualityScore` (null = -1), then oldest `createdAt`. Non-survivors → `toDemote`. Every surviving row whose stored `_dedupKey` !== recomputed key → `toBackfill`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/generation/sc-dedup-cleanup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import { groupSentenceConstructionDuplicates } from "./sc-dedup-cleanup";

function row(overrides: Partial<Parameters<typeof groupSentenceConstructionDuplicates>[0][number]>) {
  return {
    id: "id",
    language: "ES",
    difficulty: "B1",
    grammarPointKey: "es-b1-conditional",
    reviewStatus: "auto-approved",
    qualityScore: 0.9,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    contentJson: {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "x",
      promptMode: "grammar_target",
      prompt: "any",
      modelAnswers: ["Iría a la playa.", "b"],
    },
    ...overrides,
  };
}

describe("groupSentenceConstructionDuplicates", () => {
  it("keeps one per answer-collision group and demotes the rest", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "a", qualityScore: 0.8 }),
      row({ id: "b", qualityScore: 0.95 }), // highest quality → survivor
      row({ id: "c", qualityScore: 0.7 }),
    ]);
    expect(plan.toDemote.sort()).toEqual(["a", "c"]);
  });

  it("does not group across different cells or different primary answers", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "a", modelAnswersPrimary: undefined }), // see note below
      row({ id: "b", grammarPointKey: "es-b1-present-subjunctive" }),
      row({
        id: "c",
        contentJson: {
          type: ExerciseType.SENTENCE_CONSTRUCTION, instructions: "x",
          promptMode: "grammar_target", prompt: "p",
          modelAnswers: ["Comería fruta.", "b"],
        },
      }),
    ]);
    expect(plan.toDemote).toEqual([]);
  });

  it("prefers an approved row over a flagged one as survivor", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "flagged", reviewStatus: "flagged", qualityScore: 0.99 }),
      row({ id: "approved", reviewStatus: "auto-approved", qualityScore: 0.5 }),
    ]);
    expect(plan.toDemote).toEqual(["flagged"]);
  });

  it("backfills survivor _dedupKey to the recomputed answer key", () => {
    const plan = groupSentenceConstructionDuplicates([
      row({ id: "s", contentJson: { type: ExerciseType.SENTENCE_CONSTRUCTION, instructions: "x", promptMode: "grammar_target", prompt: "p", modelAnswers: ["Iría a la playa.", "b"], _dedupKey: "stale-prompt-key" } }),
    ]);
    expect(plan.toBackfill).toEqual([{ id: "s", newKey: "iria a la playa." }]);
  });
});
```

> Remove the stray `modelAnswersPrimary` helper key — it is illustrative; the second test's row `a` just uses the default `Iría a la playa.` which won't collide with rows `b` (different cell) or `c` (different answer). Adjust so each of the three rows lands in its own group.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- sc-dedup-cleanup`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure grouping function**

Create `packages/db/src/generation/sc-dedup-cleanup.ts`:

```ts
import { canonicalSurface } from "@language-drill/ai";
import type { SentenceConstructionContent } from "@language-drill/shared";

export type ScRow = {
  id: string;
  language: string;
  difficulty: string;
  grammarPointKey: string;
  reviewStatus: string;
  qualityScore: number | null;
  createdAt: Date;
  contentJson: SentenceConstructionContent & { _dedupKey?: string };
};

export type CleanupPlan = {
  toDemote: string[];
  toBackfill: Array<{ id: string; newKey: string }>;
};

const APPROVED = new Set(["auto-approved", "manual-approved"]);

/** Higher is a better survivor. */
function survivorRank(r: ScRow): [number, number, number] {
  return [
    APPROVED.has(r.reviewStatus) ? 1 : 0,
    r.qualityScore ?? -1,
    -r.createdAt.getTime(), // older wins
  ];
}
function better(a: ScRow, b: ScRow): ScRow {
  const [a1, a2, a3] = survivorRank(a);
  const [b1, b2, b3] = survivorRank(b);
  if (a1 !== b1) return a1 > b1 ? a : b;
  if (a2 !== b2) return a2 > b2 ? a : b;
  return a3 >= b3 ? a : b;
}

export function groupSentenceConstructionDuplicates(rows: ScRow[]): CleanupPlan {
  const groups = new Map<string, ScRow[]>();
  for (const r of rows) {
    const key = [
      r.language, r.difficulty, r.grammarPointKey,
      canonicalSurface(r.contentJson),
    ].join(" ");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  const toDemote: string[] = [];
  const toBackfill: Array<{ id: string; newKey: string }> = [];
  for (const group of groups.values()) {
    const survivor = group.reduce(better);
    const newKey = canonicalSurface(survivor.contentJson);
    if (survivor.contentJson._dedupKey !== newKey) {
      toBackfill.push({ id: survivor.id, newKey });
    }
    for (const r of group) if (r.id !== survivor.id) toDemote.push(r.id);
  }
  return { toDemote, toBackfill };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- sc-dedup-cleanup`
Expected: PASS. (Build first — `@language-drill/ai` dist must be current; if `canonicalSurface` changed in Task 2, also `pnpm --filter @language-drill/ai build`.)

- [ ] **Step 5: Write the CLI (scaffold copied from `revalidate-cloze-pool.ts`)**

Create `packages/db/scripts/dedup-sc-pool.ts`. Mirror `packages/db/scripts/revalidate-cloze-pool.ts`: arg parsing (`--apply` default dry-run, `--language`, `--cefr`, `--limit`), `createDb(databaseUrl)` from `../src/client`, `DATABASE_URL` env guard (drop the Anthropic guard — no LLM calls), and the `import.meta.url === \`file://${process.argv[1]}\`` direct-invocation guard. Core body:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../src/client";
import { exercises } from "../src/schema/exercises";
import { ExerciseType } from "@language-drill/shared";
import {
  groupSentenceConstructionDuplicates,
  type ScRow,
} from "../src/generation/sc-dedup-cleanup";

export async function main(argv: string[]): Promise<void> {
  const opts = parseArgs(argv); // { apply, language?, cefr?, limit? }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const db = createDb(databaseUrl);

  const filters = [
    eq(exercises.type, ExerciseType.SENTENCE_CONSTRUCTION),
    inArray(exercises.reviewStatus, ["auto-approved", "manual-approved", "flagged"]),
  ];
  if (opts.language) filters.push(eq(exercises.language, opts.language));
  if (opts.cefr) filters.push(eq(exercises.difficulty, opts.cefr));

  const q = db
    .select({
      id: exercises.id,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      reviewStatus: exercises.reviewStatus,
      qualityScore: exercises.qualityScore,
      createdAt: exercises.createdAt,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...filters));
  const rows = (opts.limit ? await q.limit(opts.limit) : await q) as unknown as ScRow[];

  const plan = groupSentenceConstructionDuplicates(rows);
  console.log(
    `SC dedup cleanup: ${rows.length} rows, ${plan.toDemote.length} to demote, ${plan.toBackfill.length} to backfill.` +
      (opts.apply ? "" : " (dry-run — pass --apply to write)"),
  );
  if (!opts.apply) return;

  for (const id of plan.toDemote) {
    await db.update(exercises).set({ reviewStatus: "rejected" }).where(eq(exercises.id, id));
  }
  for (const { id, newKey } of plan.toBackfill) {
    // Rewrite content_json._dedupKey to the recomputed answer-based key.
    const [existing] = await db
      .select({ contentJson: exercises.contentJson })
      .from(exercises)
      .where(eq(exercises.id, id));
    if (!existing) continue;
    await db
      .update(exercises)
      .set({ contentJson: { ...(existing.contentJson as object), _dedupKey: newKey } })
      .where(eq(exercises.id, id));
  }
  console.log("Applied.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

> Copy `parseArgs`, the language/CEFR validation sets, and `createDb` usage verbatim from `revalidate-cloze-pool.ts` so behavior/flags match the existing CLIs. Demotion value is `'rejected'` — the same convention as `demote:pool` (`demote-cell-pool.ts:126`).

- [ ] **Step 6: Register the script**

In `packages/db/package.json` scripts, add:

```json
"dedup:sc-pool": "npx tsx scripts/dedup-sc-pool.ts",
```

In root `package.json` scripts, add:

```json
"dedup:sc-pool": "dotenv -e .env -- pnpm --filter @language-drill/db dedup:sc-pool",
```

- [ ] **Step 7: Typecheck + dry-run smoke (no DB writes)**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: exit 0.
(Do NOT run against prod here; the real dry-run against prod happens at rollout with `--language ES` etc.)

- [ ] **Step 8: Commit**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git add packages/db/src/generation/sc-dedup-cleanup.ts packages/db/src/generation/sc-dedup-cleanup.test.ts packages/db/scripts/dedup-sc-pool.ts packages/db/package.json package.json
git commit -m "feat(db): SC dedup cleanup CLI (regroup on answer key, demote, backfill)"
```

---

## Task 11: Full-suite gate

**Files:** none (verification only).

- [ ] **Step 1: Clean stale dist and rebuild**

Run:
```bash
rm -rf infra/lambda/dist
pnpm build
```
Expected: exit 0. (Rebuild so vitest sees current `shared`/`ai`/`db` dist.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: exit 0. Fix any issues before proceeding.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Test**

Run: `pnpm test`
Expected: 0 failures. Report `X passed`. If any lambda test flakes on parallelism, re-run that package once (`pnpm --filter @language-drill/lambda test`); persistent failures are real — fix them.

- [ ] **Step 5: Prompt-body drift check (does the change need a Langfuse sync?)**

Run (dev creds per CLAUDE.md "Prompt Editing"):
```bash
pnpm --filter @language-drill/ai bootstrap-prompts --check
```
Expected: exit 0 (no drift — the Component C edit is a computed `{{var}}`, so it ships with the code deploy). If it reports drift on the generation prompt, follow `docs/runbooks/prompt-update-and-revalidate.md` to `push-prompts` **both** envs from fresh `main`.

- [ ] **Step 6: Push the branch and open a PR**

```bash
test "$(git branch --show-current)" = "feat/exercise-topic-diversity" || { echo WRONG BRANCH; exit 1; }
git push -u origin feat/exercise-topic-diversity
```
Open a squash-merge PR summarizing Components A–D. Do NOT resume generation in this PR (that is the rollout step, below).

---

## Rollout (post-merge; separate, sequenced — NOT part of the code PR)

Generation is paused in prod (PR #615). Execute in order:

1. **Deploy the merged code** (CDK deploy runs on merge to `main` per CI/CD). Confirm the generation Lambda picked up the new module-scope prompt within ~5 min.
2. **Dry-run the cleanup per language**, review counts:
   ```bash
   pnpm dedup:sc-pool --language ES
   pnpm dedup:sc-pool --language DE
   pnpm dedup:sc-pool --language TR
   ```
   (Uses local `.env` = dev branch by default; for prod, point `DATABASE_URL` at the prod branch per memory `local-env-db-is-dev-branch`.)
3. **Apply** once counts look right: `pnpm dedup:sc-pool --language ES --apply` (repeat per language).
4. **Resume generation:** delete `enableScheduledExerciseGeneration: false` in `infra/bin/app.ts`, CDK deploy (memory `exercise-generation-paused-prod`).
5. **Verify next nightly run:** SC produces no answer-clones; `topicHint` spreads across `TOPIC_DOMAINS` for SC/cloze/translation; watch cloze/translation approval-rate for regression from the soft topic nudge. If regression appears, scope topic steering back to SC (guard `decideTopicTargets` on `cell.exerciseType === SENTENCE_CONSTRUCTION` in the scheduler).

---

## Self-Review Notes

- **Spec coverage:** A1 vocabulary → T1; A2 water-fill → T3 + T7 (scheduler load/attach); A3 injection → T5 (+T6/T8 threading); A4 topicHint enum → T5; B answer-aware dedup → T2; C diversity rule + version → T9; D cleanup CLI → T10; sequencing/rollout → Rollout section. All spec components mapped.
- **Simplification vs spec:** the spec's "feed recent `topicHint`s into the avoid-list" is intentionally realized as the deficit water-fill (T3/T7) — a stronger feedback loop than a soft avoid-list — plus the explicit T9 rule, rather than threading a separate recent-topicHint list. No separate avoid-list plumbing (YAGNI).
- **Type consistency:** `topicTargets` is `string[]` on the wire (job-message) and `readonly string[]` on `GenerationSpec`/`runOneCell` args; `resolveTopicDomain`, `decideTopicTargets`, `groupSentenceConstructionDuplicates`/`CleanupPlan` names are used identically across tasks.
