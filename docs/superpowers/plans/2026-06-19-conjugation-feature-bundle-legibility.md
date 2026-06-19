# Conjugation feature-bundle legibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the conjugation prompt's feature bundle parseable at a glance by carrying structured, English-glossed grammar data (`features[]` + `subject`) and rendering it as a prominent pronoun badge plus per-dimension chips (Layout A).

**Architecture:** Generation authors two new fields on `ConjugationContent` — `features` (ordered `{term, gloss}` for tense/mood/polarity) and `subject` (`{pronoun, gloss}` for person/number). The flat `featureBundle` string stays as the canonical cell name (used by validation + dedup) and as the UI fallback. A small presentational component renders the badge + chips when structured data is present and the flat string otherwise; the drill card and the debrief review line both use it. The existing conjugation pool is regenerated so every row carries the new data.

**Tech Stack:** TypeScript, React (Next.js App Router), Anthropic tool-use generation, Vitest, Testing Library.

## Global Constraints

- Package manager: `pnpm`. Run package-scoped scripts as `pnpm --filter <pkg> <script>`.
- Work entirely in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-conjugation-follow-ups` on branch `feat/conjugation-follow-ups`. Use absolute paths; assert the branch before each commit.
- Workspace dependency `dist` must be built before single-package typecheck/test: run `pnpm build` (turbo) after editing `packages/shared` or `packages/ai` source, else downstream packages fail with `Cannot find module '@language-drill/shared'`.
- `featureBundle` is NOT removed and NOT renamed — it remains required in the type, the tool, the parser, the validation prompt, and the `lemma+featureBundle` dedup key.
- No new `ExerciseType` member — do not touch exhaustive `switch`/`Record<ExerciseType,…>` maps.
- `GENERATION_PROMPT_VERSION` stays `generate@2026-06-19` (today's date already). Do NOT bump unless the calendar date changes. Do NOT bump `VALIDATION_PROMPT_VERSION`.
- The conjugation prompt guidance lives in `renderConjugationSection`; its output is a runtime-substituted flat template var, so prompt edits ship with the code deploy — NO `push-prompts`/Langfuse sync step.
- Pre-push gate (run from repo root, zero failures): `pnpm lint`, `pnpm typecheck`, `pnpm test`.

---

## File Structure

- `packages/shared/src/index.ts` — **Modify.** Add optional `features?` + `subject?` to `ConjugationContent`.
- `packages/ai/src/generate.ts` — **Modify.** Extend `CONJUGATION_GENERATION_TOOL` schema; add nested parse helpers; populate + validate `features`/`subject` in `parseGeneratedConjugationDraft`.
- `packages/ai/src/generation-prompts.ts` — **Modify.** Add `features`/`subject` authoring guidance to `renderConjugationSection`.
- `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.tsx` — **Create.** Presentational component: pronoun badge + chips (`variant='card'`) or compact dot-string (`variant='inline'`); flat-string fallback.
- `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx` — **Modify.** Render the new component in the prompt card.
- `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` — **Modify.** Use the inline variant in the conjugation review line.
- Tests: `packages/ai/src/generate.test.ts`, `packages/ai/src/generation-prompts.test.ts`, `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.test.tsx`, `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`.

---

## Task 1: Add `features` + `subject` to `ConjugationContent`

**Files:**
- Modify: `packages/shared/src/index.ts:212-239`

**Interfaces:**
- Produces: `ConjugationContent.features?: Array<{ term: string; gloss: string }>` and `ConjugationContent.subject?: { pronoun: string; gloss: string }`. Every later task depends on these names/types.

- [ ] **Step 1: Add the optional fields to the type**

In `packages/shared/src/index.ts`, inside `export type ConjugationContent = { … }`, immediately after the `featureBundle: string;` field (line 226), add:

```ts
  /**
   * Ordered grammar dimensions OTHER than person/number — tense/mood, and
   * polarity where the language marks it — each as a target-language term plus
   * a short English gloss. Optional: only new (regenerated) rows carry it; older
   * rows fall back to `featureBundle`.
   * e.g. [{ term: "geçmiş zaman", gloss: "past" }, { term: "olumlu", gloss: "affirmative" }]
   */
  features?: Array<{ term: string; gloss: string }>;
  /**
   * Person/number cue, surfaced prominently. `pronoun` is the representative
   * target-language subject pronoun; `gloss` is its English. Optional for the
   * same backward-compatibility reason as `features`.
   * e.g. { pronoun: "o", gloss: "he / she / it" }
   */
  subject?: { pronoun: string; gloss: string };
```

- [ ] **Step 2: Build shared and typecheck**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared typecheck`
Expected: both succeed, no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # must print feat/conjugation-follow-ups
git add packages/shared/src/index.ts
git commit -m "feat(shared): add optional features + subject to ConjugationContent"
```

---

## Task 2: Generation tool schema + parser for `features`/`subject`

**Files:**
- Modify: `packages/ai/src/generate.ts:260-287` (tool schema), `:776-818` (parser), and add helpers near `:622`
- Test: `packages/ai/src/generate.test.ts:1246-1297`

**Interfaces:**
- Consumes: `ConjugationContent.features` / `ConjugationContent.subject` (Task 1).
- Produces: `parseGeneratedConjugationDraft` now returns those fields populated and **requires** them (throws on missing/empty/malformed). New private helpers `requireConjugationFeatures(raw, ctx)` and `requireConjugationSubject(raw, ctx)`.

- [ ] **Step 1: Update existing parser tests to include the new fields, and add new cases (write failing tests)**

In `packages/ai/src/generate.test.ts`, replace the whole `describe("parseGeneratedConjugationDraft", …)` block (lines 1246-1297) with:

```ts
describe("parseGeneratedConjugationDraft", () => {
  const VALID = {
    instructions: "Write the correct form.",
    lemma: "ir",
    lemmaGloss: "to go",
    featureBundle: "condicional · 1ª pers. plural",
    features: [{ term: "condicional", gloss: "conditional" }],
    subject: { pronoun: "nosotros", gloss: "we" },
    targetForm: "iríamos",
    breakdown: "ir- + -íamos",
    exampleSentences: ["Iríamos al cine."],
  };

  it("parses a conjugation draft (trims targetForm)", () => {
    const out = parseGeneratedConjugationDraft(
      { ...VALID, targetForm: " iríamos ", acceptableForms: ["nos iríamos"] },
      {} as never,
    );
    expect(out.type).toBe(ExerciseType.CONJUGATION);
    expect(out.targetForm).toBe("iríamos");
    expect(out.lemma).toBe("ir");
    expect(out.acceptableForms).toEqual(["nos iríamos"]);
  });

  it("parses features and subject", () => {
    const out = parseGeneratedConjugationDraft(
      {
        ...VALID,
        features: [
          { term: "geçmiş zaman", gloss: "past" },
          { term: "olumlu", gloss: "affirmative" },
        ],
        subject: { pronoun: "o", gloss: "he / she / it" },
      },
      {} as never,
    );
    expect(out.features).toEqual([
      { term: "geçmiş zaman", gloss: "past" },
      { term: "olumlu", gloss: "affirmative" },
    ]);
    expect(out.subject).toEqual({ pronoun: "o", gloss: "he / she / it" });
  });

  it("rejects an empty target form", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, targetForm: "  " }, {} as never),
    ).toThrow(/targetForm/);
  });

  it("rejects a whitespace-only lemma", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, lemma: "   " }, {} as never),
    ).toThrow(/lemma/);
  });

  it("rejects empty exampleSentences", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, exampleSentences: [] }, {} as never),
    ).toThrow(/exampleSentences/);
  });

  it("rejects an empty features array", () => {
    expect(() =>
      parseGeneratedConjugationDraft({ ...VALID, features: [] }, {} as never),
    ).toThrow(/features/);
  });

  it("rejects a feature missing its gloss", () => {
    expect(() =>
      parseGeneratedConjugationDraft(
        { ...VALID, features: [{ term: "condicional" }] },
        {} as never,
      ),
    ).toThrow(/features/);
  });

  it("rejects a subject missing its pronoun", () => {
    expect(() =>
      parseGeneratedConjugationDraft(
        { ...VALID, subject: { gloss: "we" } },
        {} as never,
      ),
    ).toThrow(/subject/);
  });

  it("registers conjugation in the tool maps", () => {
    expect(TOOL_NAME_BY_TYPE[ExerciseType.CONJUGATION]).toBe("submit_conjugation_exercise");
    expect(GENERATION_TOOL_BY_TYPE[ExerciseType.CONJUGATION].name).toBe("submit_conjugation_exercise");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/ai test -- generate.test`
Expected: FAIL — `parses features and subject` (fields are `undefined`), and the `features`/`subject` rejection cases do not throw yet.

- [ ] **Step 3: Add the nested parse helpers**

In `packages/ai/src/generate.ts`, after `optionalStringArray` (ends line 622), add:

```ts
function requireConjugationFeatures(
  raw: Record<string, unknown>,
  ctx: string,
): Array<{ term: string; gloss: string }> {
  const v = raw["features"];
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(
      `${ctx}: invalid features: must be a non-empty array, got ${JSON.stringify(v)}`,
    );
  }
  return v.map((item, i) => {
    if (!isObject(item)) {
      throw new Error(`${ctx}: invalid features[${i}]: must be an object, got ${JSON.stringify(item)}`);
    }
    const term = requireString(item, "term", `${ctx} features[${i}]`).trim();
    const gloss = requireString(item, "gloss", `${ctx} features[${i}]`).trim();
    return { term, gloss };
  });
}

function requireConjugationSubject(
  raw: Record<string, unknown>,
  ctx: string,
): { pronoun: string; gloss: string } {
  const v = raw["subject"];
  if (!isObject(v)) {
    throw new Error(`${ctx}: invalid subject: must be an object, got ${JSON.stringify(v)}`);
  }
  const pronoun = requireString(v, "pronoun", `${ctx} subject`).trim();
  const gloss = requireString(v, "gloss", `${ctx} subject`).trim();
  return { pronoun, gloss };
}
```

- [ ] **Step 4: Populate the fields in the parser**

In `parseGeneratedConjugationDraft` (`packages/ai/src/generate.ts`), after the `const acceptableForms = …` line (line 794), add:

```ts
  const features = requireConjugationFeatures(input, ctx);
  const subject = requireConjugationSubject(input, ctx);
```

Then in the returned object (currently lines 806-817), add `features,` and `subject,` immediately after the `featureBundle,` line:

```ts
  return {
    type: ExerciseType.CONJUGATION,
    instructions,
    lemma,
    lemmaGloss,
    featureBundle,
    features,
    subject,
    targetForm,
    breakdown,
    exampleSentences,
    ...(acceptableForms && acceptableForms.length > 0 ? { acceptableForms } : {}),
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
```

- [ ] **Step 5: Extend the tool schema**

In `CONJUGATION_GENERATION_TOOL.input_schema.properties` (`packages/ai/src/generate.ts`), after the `featureBundle` property (ends line 274), add:

```ts
      features: {
        type: "array",
        description:
          "Ordered grammar dimensions OTHER than person/number — tense/mood, and polarity where the language marks it. Each item pairs the target-language term (conventional notation) with a 1–2 word English gloss. Do NOT include person/number here (that goes in `subject`).",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Target-language grammar term, e.g. 'geçmiş zaman', 'condicional', 'olumsuz'." },
            gloss: { type: "string", description: "Short English gloss, 1–2 words, e.g. 'past', 'conditional', 'negative'." },
          },
          required: ["term", "gloss"],
        },
      },
      subject: {
        type: "object",
        description: "The person/number cue, surfaced prominently to the learner.",
        properties: {
          pronoun: { type: "string", description: "Representative target-language subject pronoun for the cell, e.g. 'o', 'nosotros', 'ich'." },
          gloss: { type: "string", description: "English gloss of the pronoun, e.g. 'he / she / it', 'we', 'I'." },
        },
        required: ["pronoun", "gloss"],
      },
```

Then add `"features"` and `"subject"` to the tool's `required` array (line 285), so it reads:

```ts
    required: ["instructions", "lemma", "lemmaGloss", "featureBundle", "features", "subject", "targetForm", "breakdown", "exampleSentences"],
```

- [ ] **Step 6: Build ai and run the tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- generate.test`
Expected: PASS (all `parseGeneratedConjugationDraft` cases green).

- [ ] **Step 7: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # feat/conjugation-follow-ups
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): generate + validate structured conjugation features/subject"
```

---

## Task 3: Generation-prompt guidance for `features`/`subject`

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts:235-247` (`renderConjugationSection`)
- Test: `packages/ai/src/generation-prompts.test.ts` (existing conjugation describe block near `:286`)

**Interfaces:**
- Consumes: nothing new. Produces: no exported API change — only the prompt text the model reads.

- [ ] **Step 1: Add a guidance assertion (write failing test)**

In `packages/ai/src/generation-prompts.test.ts`, inside the existing block that tests conjugation guidance (the `describe` containing `"adds the conjugation section ONLY for conjugation, absent for other types"` near line 286), add a new test. Mirror the existing test's setup for building a conjugation system prompt — reuse the same helper/inputs that test uses to produce `conj`:

```ts
  it("conjugation guidance instructs the model to author features and subject", async () => {
    // Build the conjugation system prompt the same way the sibling test does.
    const conj = await buildConjugationSystemPromptForTest();
    expect(conj).toContain("`features`");
    expect(conj).toContain("`subject`");
    expect(conj).toContain("person/number");
  });
```

NOTE: `buildConjugationSystemPromptForTest()` is a stand-in name — use whatever the existing neighboring test already does to obtain the conjugation prompt string `conj` (copy that exact setup inline). Do not invent a new helper if one isn't already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/ai test -- generation-prompts.test`
Expected: FAIL — the prompt does not yet mention `` `features` ``/`` `subject` ``.

- [ ] **Step 3: Add the guidance bullets**

In `renderConjugationSection` (`packages/ai/src/generation-prompts.ts`), immediately after the `` - **\`featureBundle\` names the cell** … `` bullet (line 243), insert:

```ts
- **\`features\` decomposes the cell for display.** List the grammar dimensions OTHER than person/number — the tense/mood, and polarity where ${language} marks it — in order. Each entry pairs the ${language} term in conventional notation (\`term\`) with a 1–2 word English gloss (\`gloss\`), e.g. {term: "geçmiş zaman", gloss: "past"}, {term: "olumlu", gloss: "affirmative"}. Do NOT put person/number in \`features\`.
- **\`subject\` is the person/number cue.** Give the representative ${language} subject pronoun for the cell (\`pronoun\`, e.g. "o", "nosotros", "ich") and its English gloss (\`gloss\`, e.g. "he / she / it"). It is shown prominently so the learner immediately sees who to conjugate for.
- **\`features\` + \`subject\` describe the SAME cell as \`featureBundle\`** — they are its structured, glossed form, not extra constraints. They MUST NOT contain the answer.
```

- [ ] **Step 4: Run the conjugation prompt tests + the byte-parity suite**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/ai test -- generation-prompts.test`
Expected: PASS. In particular the `GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity > conjugation …` test stays green automatically — `renderConjugationSection` feeds the `{{conjugationSection}}` flat var on both sides, so editing the one function cannot break parity.

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # feat/conjugation-follow-ups
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): prompt the model to author conjugation features + subject"
```

---

## Task 4: `ConjugationFeatureBundle` presentational component

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.test.tsx`

**Interfaces:**
- Consumes: `ConjugationContent` (Task 1).
- Produces: `export function ConjugationFeatureBundle({ content, variant }: { content: ConjugationContent; variant?: 'card' | 'inline' }): JSX.Element`. `variant` defaults to `'card'`. Renders badge+chips (card) or a `·`-joined string (inline) when `subject` and a non-empty `features` are present; otherwise renders `content.featureBundle` (a `<p>` in card mode, a bare fragment in inline mode).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType, type ConjugationContent } from '@language-drill/shared';
import { ConjugationFeatureBundle } from './conjugation-feature-bundle';

const BASE: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'içmek',
  lemmaGloss: 'to drink',
  featureBundle: 'geçmiş zaman · olumlu · 3. tekil şahıs (o)',
  targetForm: 'içti',
  breakdown: 'iç- + -ti',
  exampleSentences: ['O su içti.'],
};

const STRUCTURED: ConjugationContent = {
  ...BASE,
  features: [
    { term: 'geçmiş zaman', gloss: 'past' },
    { term: 'olumlu', gloss: 'affirmative' },
  ],
  subject: { pronoun: 'o', gloss: 'he / she / it' },
};

describe('ConjugationFeatureBundle', () => {
  it('card variant renders the pronoun badge and a chip per feature with glosses', () => {
    render(<ConjugationFeatureBundle content={STRUCTURED} />);
    expect(screen.getByText('o')).toBeInTheDocument();
    expect(screen.getByText('he / she / it')).toBeInTheDocument();
    expect(screen.getByText('geçmiş zaman')).toBeInTheDocument();
    expect(screen.getByText('past')).toBeInTheDocument();
    expect(screen.getByText('olumlu')).toBeInTheDocument();
    expect(screen.getByText('affirmative')).toBeInTheDocument();
    // The flat string is NOT shown when structured data is present.
    expect(screen.queryByText(BASE.featureBundle)).not.toBeInTheDocument();
  });

  it('card variant falls back to the flat featureBundle when structured data is absent', () => {
    render(<ConjugationFeatureBundle content={BASE} />);
    expect(screen.getByText(BASE.featureBundle)).toBeInTheDocument();
  });

  it('inline variant renders a compact dot-joined string', () => {
    render(<ConjugationFeatureBundle content={STRUCTURED} variant="inline" />);
    expect(
      screen.getByText('o (he / she / it) · geçmiş zaman (past) · olumlu (affirmative)'),
    ).toBeInTheDocument();
  });

  it('inline variant falls back to the flat featureBundle when structured data is absent', () => {
    render(<ConjugationFeatureBundle content={BASE} variant="inline" />);
    expect(screen.getByText(BASE.featureBundle)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- conjugation-feature-bundle`
Expected: FAIL — module `./conjugation-feature-bundle` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.tsx`:

```tsx
'use client';

import type { ConjugationContent } from '@language-drill/shared';

export interface ConjugationFeatureBundleProps {
  content: ConjugationContent;
  /** 'card' = pronoun badge + chips (drill prompt); 'inline' = compact text (debrief). */
  variant?: 'card' | 'inline';
}

export function ConjugationFeatureBundle({
  content,
  variant = 'card',
}: ConjugationFeatureBundleProps) {
  const features = content.features ?? [];
  const subject = content.subject;
  const structured = subject !== undefined && features.length > 0;

  if (!structured) {
    if (variant === 'inline') return <>{content.featureBundle}</>;
    return <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>;
  }

  if (variant === 'inline') {
    const parts = [
      `${subject.pronoun} (${subject.gloss})`,
      ...features.map((f) => `${f.term} (${f.gloss})`),
    ];
    return <>{parts.join(' · ')}</>;
  }

  return (
    <div className="mt-s-3 flex flex-wrap items-stretch gap-s-2">
      <div
        className="flex flex-col justify-center rounded-lg px-s-3 py-s-2 text-center"
        style={{ background: 'var(--color-accent)' }}
      >
        <span className="t-display-s leading-none" style={{ color: 'var(--color-paper)' }}>
          {subject.pronoun}
        </span>
        <span className="t-micro mt-s-1" style={{ color: 'var(--color-accent-soft)' }}>
          {subject.gloss}
        </span>
      </div>
      {features.map((f) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className="flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-s-2"
        >
          <span className="t-body font-medium text-ink leading-tight">{f.term}</span>
          <span className="t-micro text-ink-mute mt-s-1">{f.gloss}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- conjugation-feature-bundle`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # feat/conjugation-follow-ups
git add "apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.tsx" "apps/web/app/(dashboard)/drill/_components/conjugation-feature-bundle.test.tsx"
git commit -m "feat(web): ConjugationFeatureBundle (pronoun badge + chips, with fallback)"
```

---

## Task 5: Wire the badge + chips into the drill prompt card

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx:4-8,67-71`
- Test: `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx:33-49,113-121`

**Interfaces:**
- Consumes: `ConjugationFeatureBundle` (Task 4).

- [ ] **Step 1: Extend the page test fixture + assert the badge renders (write failing test)**

In `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`, add the structured fields to the `CONJUGATION_EXERCISE.contentJson` fixture (lines 39-48), after `featureBundle`:

```ts
    featureBundle: 'condicional · 1ª persona del plural',
    features: [{ term: 'condicional', gloss: 'conditional' }],
    subject: { pronoun: 'nosotros', gloss: 'we' },
```

Then add a test in the `describe('ConjugationPage', …)` block (after the existing "renders the heading…" test, ~line 121):

```ts
  it('renders the pronoun badge and feature chips with glosses', () => {
    renderWithProviders(<ConjugationPage />);
    expect(screen.getByText('nosotros')).toBeInTheDocument();
    expect(screen.getByText('we')).toBeInTheDocument();
    expect(screen.getByText('condicional')).toBeInTheDocument();
    expect(screen.getByText('conditional')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- conjugation/page`
Expected: FAIL — `nosotros`/`we` chips are not rendered (the card still shows the flat `featureBundle`).

- [ ] **Step 3: Use the component in the prompt card**

In `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`:

Add the import after the existing `FeedbackShell` import (line 8):

```ts
import { ConjugationFeatureBundle } from './conjugation-feature-bundle';
```

Replace the feature-bundle paragraph in the prompt `Card` (line 70):

```tsx
        <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>
```

with:

```tsx
        <ConjugationFeatureBundle content={content} />
```

(Leave the `lemma` / `lemmaGloss` lines above it unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- conjugation/page`
Expected: PASS (existing tests + the new badge test).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # feat/conjugation-follow-ups
git add "apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx" "apps/web/app/(dashboard)/drill/conjugation/page.test.tsx"
git commit -m "feat(web): render conjugation prompt as pronoun badge + chips"
```

---

## Task 6: Use the inline variant in the debrief review line

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx:394` (and its import block)
- Test: locate the existing debrief review-item test (`grep -rl "review-item-card\|featureBundle" "apps/web/app/(dashboard)/drill/debrief"`); add to it, or create `review-item-card.test.tsx` beside the component if none exists.

**Interfaces:**
- Consumes: `ConjugationFeatureBundle` (Task 4).

- [ ] **Step 1: Inspect the current conjugation review line**

Run: `cd /Users/seal/dev/language-drill && sed -n '388,400p' "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx"`
Expected: shows the line rendering `{content.lemma} ({content.lemmaGloss}) — {content.featureBundle}`. Confirm the exact surrounding JSX before editing.

- [ ] **Step 2: Write the failing test**

Find the test file: `grep -rl "review-item-card" "apps/web/app/(dashboard)/drill/debrief"`. If a test renders a conjugation review item, extend it; otherwise create `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.test.tsx` following the conjugation/page.test.tsx provider pattern (QueryClientProvider + ActiveLanguageProvider as needed). Add a conjugation item whose `contentJson` includes `features`/`subject`, and assert:

```tsx
    // Inline variant: compact glossed string in the review header line.
    expect(
      screen.getByText(/o \(he \/ she \/ it\) · geçmiş zaman \(past\)/),
    ).toBeInTheDocument();
```

Use a conjugation content fixture matching the `STRUCTURED` shape from Task 4 (lemma `içmek`, the two features, subject `o`).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- review-item-card`
Expected: FAIL — the line still shows the flat `featureBundle`.

- [ ] **Step 4: Swap in the inline variant**

In `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx`, add an import (top of file, with the other component imports):

```ts
import { ConjugationFeatureBundle } from '../../_components/conjugation-feature-bundle';
```

Verify that relative path resolves from the debrief `_components` dir to the drill `_components` dir (debrief is `drill/debrief/_components`, target is `drill/_components`, so `../../_components/…` is correct). Then change the conjugation review line (line 394) from:

```tsx
        {content.lemma} ({content.lemmaGloss}) — {content.featureBundle}
```

to:

```tsx
        {content.lemma} ({content.lemmaGloss}) — <ConjugationFeatureBundle content={content} variant="inline" />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill && pnpm --filter @language-drill/web test -- review-item-card`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/seal/dev/language-drill && git branch --show-current   # feat/conjugation-follow-ups
git add "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.test.tsx"
git commit -m "feat(web): show structured conjugation bundle in debrief review line"
```

---

## Task 7: Full verification + manual check

**Files:** none (gate only).

- [ ] **Step 1: Build everything (refresh workspace dist)**

Run: `cd /Users/seal/dev/language-drill && pnpm build`
Expected: all packages build.

- [ ] **Step 2: Run the full pre-push gate**

Run: `cd /Users/seal/dev/language-drill && pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures across lint, typecheck, and the Vitest suites.

- [ ] **Step 3: Manual visual check (local dev)**

Run `pnpm dev`, open `/drill/conjugation` for Turkish A1, and confirm a fresh (regeneration not yet run) row still renders the flat string (fallback), then — after Task 8 regen, or by temporarily injecting a structured fixture — that the pronoun badge + chips render as in Layout A. Confirm the debrief review line shows the compact inline form.

- [ ] **Step 4: Open the PR**

```bash
cd /Users/seal/dev/language-drill && git push -u origin feat/conjugation-follow-ups
gh pr create --title "feat(conjugation): legible feature bundle (pronoun badge + glossed chips)" --body "<summary: problem, Layout A, structured features/subject, fallback, pool regen follow-up (Task 8)>"
```

NOTE: ensure `gh auth status` is the `nikolaivanv` account before PR ops.

---

## Task 8: Regenerate the conjugation pool (ops — after merge/deploy)

**Files:** none (data/ops). Do this only AFTER the code is merged and deployed, since regeneration runs against deployed generation code.

- [ ] **Step 1: Confirm the deployed generation emits the new fields**

Generate one conjugation exercise through the deployed pipeline (or a local `run-one-cell` against the dev DB) and inspect the stored `contentJson` — confirm `features` and `subject` are present and well-formed.

- [ ] **Step 2: Demote the existing approved conjugation rows**

Following the theory-pool regen pattern (`docs/runbooks/prompt-update-and-revalidate.md` and the "theory pool prod regen" approach): demote the currently-approved conjugation exercises for the target (language, level) so they stop serving, leaving the structured-data rows to be generated fresh.

- [ ] **Step 3: Trigger regeneration**

Re-run the conjugation generation for the affected cells (manual batch trigger / `--batch-seed` per the verb-seeded conjugation flow from PR #377). Verify new rows are auto-approved (not flagged) and carry `features` + `subject`.

- [ ] **Step 4: Spot-check in the app**

Open `/drill/conjugation` and confirm freshly served exercises render the badge + chips. Confirm no fallback-string rows remain for the regenerated cells.

NOTE: The exact demote/trigger commands depend on the current generation tooling; confirm them against the live scripts at execution time. The flat-string fallback means the app stays correct throughout this window.

---

## Self-Review

**Spec coverage:**
- Data model (`features?` + `subject?`, `featureBundle` retained) → Task 1. ✓
- Generation tool + parser → Task 2. ✓
- Generation prompt guidance + version/Langfuse note → Task 3 (+ Global Constraints). ✓
- Layout A rendering + reusable helper → Tasks 4, 5. ✓
- Debrief consistency → Task 6. ✓
- Testing (shared/ai/web) → Tasks 1-6 each carry tests; Task 7 runs the full gate. ✓
- Pool regeneration → Task 8. ✓

**Placeholder scan:** Two acknowledged unknowns are explicitly flagged, not silent: the neighboring conjugation-prompt test setup in Task 3 Step 1 (copy the existing sibling test's setup), and the debrief test file location in Task 6 (grep to locate/create). The PR body in Task 7 is a `<summary…>` to fill at creation. All code steps contain full code.

**Type consistency:** `features: Array<{ term: string; gloss: string }>` and `subject: { pronoun: string; gloss: string }` are used identically across shared (Task 1), ai parser/tool (Task 2), prompt examples (Task 3), and the web component + tests (Tasks 4-6). `ConjugationFeatureBundle({ content, variant })` signature matches between definition (Task 4) and call sites (Tasks 5, 6).
