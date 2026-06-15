/**
 * packages/ai — bootstrap-prompts CLI (Phase 2 Tasks 20 + 21).
 *
 * Idempotent one-shot registration of the registry prompts in a Langfuse
 * project. Bootstrap flow:
 *
 *   1. LIST every prompt that currently carries the `production` label
 *      (one paginated call, `langfuse.api.promptsList`). Build a set of
 *      names.
 *   2. For each manifest entry: skip if its name is in the set; otherwise
 *      CREATE from the in-repo fallback string/template, stamping
 *      `localVersion` / `surface` / `registeredAt` into the prompt's
 *      `config` so dashboards can pivot by the in-repo version constant.
 *   3. If the list call fails (network, auth, 500), abort with no writes —
 *      we won't blindly create when we can't tell what's already there.
 *
 * The list-first strategy avoids the per-prompt `getPrompt` probes the old
 * implementation used, which generated noisy SDK-level stderr stack traces
 * on first-run (the SDK logs every 404 before the throw reaches us).
 *
 * Run with:
 *   pnpm bootstrap-prompts            (default mode — write to Langfuse)
 *   pnpm bootstrap-prompts --dry-run  (no writes; print what it would do)
 *   pnpm bootstrap-prompts --check    (read-only drift detection vs. in-repo)
 *
 * `--check` is the operator's "is Langfuse out of sync with main?" command.
 * For each prompt, it fetches the live `production` body and compares it
 * byte-for-byte to the in-repo source. Any mismatch prints a unified diff
 * and exits 1; an all-match run exits 0. `--check` still uses `getPrompt`
 * per prompt because there a 404 IS a meaningful signal (drift), unlike
 * the bootstrap path where it just means "needs creating."
 *
 * Honors `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`
 * via the shared `getLangfuse()` helper from `./observability.ts`.
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  ANNOTATE_SYSTEM_PROMPT,
  ANNOTATE_SYSTEM_PROMPT_VERSION,
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  DICTATION_EVAL_PROMPT_VERSION,
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_GENERATION_PROMPT_VERSION,
  DICTATION_GENERATION_SYSTEM_PROMPT,
  DICTATION_VALIDATION_PROMPT_VERSION,
  DICTATION_VALIDATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  GENERATION_PROMPT_VERSION,
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  PROMPT_LABEL_PRODUCTION,
  READING_GENERATION_PROMPT_VERSION,
  READING_GENERATION_SYSTEM_PROMPT,
  READ_SPAN_PROMPT_VERSION,
  READ_SPAN_SYSTEM_PROMPT,
  THEORY_GENERATION_PROMPT_VERSION,
  THEORY_SYSTEM_PROMPT_TEMPLATE,
  THEORY_VALIDATION_PROMPT_VERSION,
  THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
  VALIDATION_PROMPT_VERSION,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
  getLangfuse,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Prompt manifest — single source of truth for "what gets registered"
// ---------------------------------------------------------------------------

/**
 * One row per Langfuse prompt the runtime fetches via the registry.
 * `surface` is stamped into the Langfuse `config` so operators can pivot
 * dashboards by application surface ("which prompt belongs to which
 * Claude call"). `version` is the in-repo `*_VERSION` constant — used as
 * both the `localVersion` config stamp and the `fallback:<v>` cohort tag
 * when the runtime fetch can't reach Langfuse.
 */
export type PromptManifestEntry = {
  /** Langfuse prompt name (registry key + fetch ID). */
  name: string;
  /** Body to register on first run — verbatim in-repo string/template. */
  text: string;
  /** In-repo `*_VERSION` constant (e.g. `evaluate@2026-05-12`). */
  version: string;
  /** Application surface — `evaluate` / `annotate` / `generate` / etc. */
  surface: string;
};

export const PROMPTS: readonly PromptManifestEntry[] = [
  {
    name: "evaluate-system-prompt",
    text: EVALUATION_SYSTEM_PROMPT,
    version: EVALUATION_SYSTEM_PROMPT_VERSION,
    surface: "evaluate",
  },
  {
    name: "free-writing-eval-system-prompt",
    text: FREE_WRITING_EVAL_SYSTEM_PROMPT,
    version: FREE_WRITING_EVAL_PROMPT_VERSION,
    surface: "free-writing-eval",
  },
  {
    name: "free-writing-brainstorm-system-prompt",
    text: BRAINSTORM_SYSTEM_PROMPT,
    version: BRAINSTORM_PROMPT_VERSION,
    surface: "free-writing-brainstorm",
  },
  {
    name: "free-writing-vocab-boost-system-prompt",
    text: VOCAB_BOOST_SYSTEM_PROMPT,
    version: VOCAB_BOOST_PROMPT_VERSION,
    surface: "free-writing-vocab-boost",
  },
  {
    name: "annotate-system-prompt",
    text: ANNOTATE_SYSTEM_PROMPT,
    version: ANNOTATE_SYSTEM_PROMPT_VERSION,
    surface: "annotate",
  },
  {
    name: "generate-system-prompt",
    text: GENERATION_SYSTEM_PROMPT_TEMPLATE,
    version: GENERATION_PROMPT_VERSION,
    surface: "generate",
  },
  {
    name: "validate-system-prompt",
    text: VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    version: VALIDATION_PROMPT_VERSION,
    surface: "validate",
  },
  {
    name: "theory-generate-system-prompt",
    text: THEORY_SYSTEM_PROMPT_TEMPLATE,
    version: THEORY_GENERATION_PROMPT_VERSION,
    surface: "theory-generate",
  },
  {
    name: "theory-validate-system-prompt",
    text: THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    version: THEORY_VALIDATION_PROMPT_VERSION,
    surface: "theory-validate",
  },
  {
    name: "read-span-system-prompt",
    text: READ_SPAN_SYSTEM_PROMPT,
    version: READ_SPAN_PROMPT_VERSION,
    surface: "read-span",
  },
  {
    name: "reading-generation-system-prompt",
    text: READING_GENERATION_SYSTEM_PROMPT,
    version: READING_GENERATION_PROMPT_VERSION,
    surface: "reading-generate",
  },
  {
    // Runtime fetches this via getPromptOrFallback("dictation-eval-system-prompt", …)
    // in dictation-eval.ts — the name MUST match that registry key.
    name: "dictation-eval-system-prompt",
    text: DICTATION_EVAL_SYSTEM_PROMPT,
    version: DICTATION_EVAL_PROMPT_VERSION,
    surface: "dictation-eval",
  },
  {
    // Runtime fetches this via getPromptWithVarsOrFallback("dictation-generate-system-prompt", …)
    // in dictation-generation-prompts.ts — the name MUST match that registry key.
    name: "dictation-generate-system-prompt",
    text: DICTATION_GENERATION_SYSTEM_PROMPT,
    version: DICTATION_GENERATION_PROMPT_VERSION,
    surface: "dictation-generate",
  },
  {
    // Runtime fetches this via getPromptWithVarsOrFallback("dictation-validate-system-prompt", …)
    // in dictation-validation-prompts.ts — the name MUST match that registry key.
    name: "dictation-validate-system-prompt",
    text: DICTATION_VALIDATION_SYSTEM_PROMPT,
    version: DICTATION_VALIDATION_PROMPT_VERSION,
    surface: "dictation-validate",
  },
];

// ---------------------------------------------------------------------------
// SDK port — minimal subset of the Langfuse client this script needs
// ---------------------------------------------------------------------------

/**
 * The narrow surface of the Langfuse client this script consumes.
 * Defining the port lets tests inject a stub without spinning up the full
 * SDK or mocking the `Langfuse` constructor. `api.promptsList` is used by
 * the bootstrap path; `getPrompt` is used by `--check` (where a 404 is a
 * drift signal, not a "create me" cue); `createPrompt` writes new prompts.
 */
export type LangfusePromptClient = {
  api: {
    promptsList: (query: {
      label?: string;
      limit?: number;
      page?: number;
    }) => Promise<{
      data: ReadonlyArray<{ name: string }>;
      meta: { totalPages: number; page: number };
    }>;
  };
  getPrompt: (
    name: string,
    version?: number,
    options?: { label?: string; cacheTtlSeconds?: number },
  ) => Promise<unknown>;
  createPrompt: (input: {
    name: string;
    prompt: string;
    labels?: string[];
    config?: unknown;
    type?: "text";
  }) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// fetchProductionPromptNames — one-shot list of existing prompts
// ---------------------------------------------------------------------------

/**
 * Cap on pagination loops. Six prompts at `limit: 100` finishes in one
 * call; the cap is a defense against an SDK that misreports `totalPages`
 * (loop-forever bug → silent quota drain). 50 pages × 100/page = 5000
 * prompts before we bail, which is far past any realistic project size.
 */
const PROMPTS_LIST_PAGE_CAP = 50;
const PROMPTS_LIST_PAGE_SIZE = 100;

async function fetchProductionPromptNames(
  langfuse: LangfusePromptClient,
): Promise<Set<string>> {
  const names = new Set<string>();
  let page = 1;
  for (let i = 0; i < PROMPTS_LIST_PAGE_CAP; i++) {
    const resp = await langfuse.api.promptsList({
      label: PROMPT_LABEL_PRODUCTION,
      limit: PROMPTS_LIST_PAGE_SIZE,
      page,
    });
    for (const meta of resp.data) names.add(meta.name);
    if (page >= resp.meta.totalPages) break;
    page++;
  }
  return names;
}

// ---------------------------------------------------------------------------
// bootstrapPrompts — the testable core
// ---------------------------------------------------------------------------

export type BootstrapPromptsOptions = {
  /** Langfuse client (or a test stub matching the port above). */
  langfuse: LangfusePromptClient;
  /** When true, no writes happen; the script prints what it would do. */
  dryRun: boolean;
  /** Override the manifest for tests; defaults to the production set. */
  prompts?: readonly PromptManifestEntry[];
  /** Override the timestamp generator so tests can pin `registeredAt`. */
  now?: () => Date;
  /** Logger injection point; defaults to `console.log`. */
  log?: (...args: unknown[]) => void;
};

export type BootstrapPromptsResult = {
  /** Names of prompts that were (or would have been) created. */
  created: string[];
  /** Names that already existed at the requested label. */
  skipped: string[];
  /** Names whose fetch failed for a reason other than 404. */
  errors: Array<{ name: string; error: unknown }>;
};

/**
 * Walk the prompt manifest, register what's missing. Pure-ish — only side
 * effects are the SDK calls and the logger. Returns a summary so the CLI
 * (and tests) can decide exit code without re-doing the work.
 */
export async function bootstrapPrompts(
  opts: BootstrapPromptsOptions,
): Promise<BootstrapPromptsResult> {
  const {
    langfuse,
    dryRun,
    prompts = PROMPTS,
    now = () => new Date(),
    log = (...args: unknown[]) => console.log(...args),
  } = opts;

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; error: unknown }> = [];

  // One list call up front replaces N per-prompt `getPrompt` probes. The
  // old approach generated a 404 stack trace on stderr from the Langfuse
  // SDK for every missing prompt on first-run, which looked alarming even
  // though our caller handled the throw correctly.
  let existingNames: Set<string>;
  try {
    existingNames = await fetchProductionPromptNames(langfuse);
  } catch (err) {
    // Can't tell what exists → refuse to create blind. Every manifest
    // entry is recorded as errored so the CLI exits non-zero and the
    // operator sees which surfaces were affected.
    log(
      `✗ promptsList failed; refusing to create blind. Run again after the API recovers.`,
      err,
    );
    return {
      created: [],
      skipped: [],
      errors: prompts.map((p) => ({ name: p.name, error: err })),
    };
  }

  for (const entry of prompts) {
    if (existingNames.has(entry.name)) {
      log(
        `✓ ${entry.name} already exists (label=${PROMPT_LABEL_PRODUCTION}), skipping`,
      );
      skipped.push(entry.name);
      continue;
    }

    // Missing → create (or dry-run log) the prompt.
    const config = {
      localVersion: entry.version,
      surface: entry.surface,
      registeredAt: now().toISOString(),
    };
    if (dryRun) {
      log(
        `[dry-run] would create ${entry.name} (localVersion=${entry.version}, surface=${entry.surface})`,
      );
      created.push(entry.name);
      continue;
    }
    try {
      await langfuse.createPrompt({
        name: entry.name,
        prompt: entry.text,
        labels: [PROMPT_LABEL_PRODUCTION],
        config,
        type: "text",
      });
      log(
        `＋ created ${entry.name} (localVersion=${entry.version}, surface=${entry.surface})`,
      );
      created.push(entry.name);
    } catch (err) {
      log(`✗ ${entry.name}: createPrompt failed`, err);
      errors.push({ name: entry.name, error: err });
    }
  }

  return { created, skipped, errors };
}

// ---------------------------------------------------------------------------
// unifiedDiff — minimal LCS-based line diff (no new deps)
// ---------------------------------------------------------------------------

/**
 * Tiny line-based diff returning unified-diff-style markers (`-`, `+`, `  `).
 * Uses a textbook LCS dynamic-programming backtrack. O(n × m) time and
 * space where n/m are line counts — fine for prompts (~150 lines = 22.5k
 * cells, instant).
 *
 * Exported so the test can call it directly without going through the
 * `--check` path's logging side effects.
 */
export function unifiedDiff(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const m = a.length;
  const n = b.length;

  // LCS length table.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack into a unified-diff line list. Same convention as `diff -u`:
  // `-` lines came from `expected`, `+` lines from `actual`, `  ` is
  // shared context. Order is restored by `unshift`.
  const out: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.unshift(`  ${a[i - 1]}`);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.unshift(`- ${a[i - 1]}`);
      i--;
    } else {
      out.unshift(`+ ${b[j - 1]}`);
      j--;
    }
  }
  while (i > 0) {
    i--;
    out.unshift(`- ${a[i]}`);
  }
  while (j > 0) {
    j--;
    out.unshift(`+ ${b[j]}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// checkPrompts — `--check` mode (Task 21)
// ---------------------------------------------------------------------------

export type CheckPromptsOptions = {
  /** Langfuse client (or a test stub). */
  langfuse: LangfusePromptClient;
  /** Override the manifest for tests; defaults to the production set. */
  prompts?: readonly PromptManifestEntry[];
  /** Logger injection point; defaults to `console.log`. */
  log?: (...args: unknown[]) => void;
};

export type CheckPromptsResult = {
  /** Names of prompts whose live body matched the in-repo source byte-for-byte. */
  matched: string[];
  /** Prompts whose live body diverged from the in-repo source. */
  mismatched: Array<{ name: string; diff: string }>;
  /** Prompts whose fetch failed (404, network, auth — any reason). */
  errors: Array<{ name: string; error: unknown }>;
};

/**
 * Read-only drift detection. For each prompt in the manifest, fetch the
 * live `production` body and compare it byte-for-byte against the in-repo
 * source (static `*_SYSTEM_PROMPT` constant for static prompts; the
 * `*_SYSTEM_PROMPT_TEMPLATE` for builder-composed prompts — both sides
 * are the un-substituted template; vars are runtime concerns).
 *
 * A 404 is treated as a hard error in this mode (not a "create me" cue
 * like the default-mode path): `--check` is what an operator runs to ask
 * "did my last edit ship?" and a missing prompt is itself a drift signal.
 */
export async function checkPrompts(
  opts: CheckPromptsOptions,
): Promise<CheckPromptsResult> {
  const {
    langfuse,
    prompts = PROMPTS,
    log = (...args: unknown[]) => console.log(...args),
  } = opts;

  const matched: string[] = [];
  const mismatched: Array<{ name: string; diff: string }> = [];
  const errors: Array<{ name: string; error: unknown }> = [];

  for (const entry of prompts) {
    let live: unknown;
    try {
      live = await langfuse.getPrompt(entry.name, undefined, {
        label: PROMPT_LABEL_PRODUCTION,
        cacheTtlSeconds: 0,
      });
    } catch (err) {
      log(`✗ ${entry.name}: fetch failed`, err);
      errors.push({ name: entry.name, error: err });
      continue;
    }

    // Pluck `.prompt` defensively — Langfuse's TextPromptClient surfaces
    // the body via that field. Anything missing it counts as an error.
    if (
      live === null ||
      typeof live !== "object" ||
      !("prompt" in live) ||
      typeof (live as { prompt: unknown }).prompt !== "string"
    ) {
      const err = new Error(
        `live prompt body unreadable (no \`prompt\` string field)`,
      );
      log(`✗ ${entry.name}: ${err.message}`);
      errors.push({ name: entry.name, error: err });
      continue;
    }
    const liveBody = (live as { prompt: string }).prompt;

    if (liveBody === entry.text) {
      log(`✓ ${entry.name} matches in-repo source`);
      matched.push(entry.name);
      continue;
    }

    const diff = unifiedDiff(entry.text, liveBody);
    log(`✗ ${entry.name} DRIFTED — Langfuse out of sync with in-repo source`);
    log(diff);
    mismatched.push({ name: entry.name, diff });
  }

  return { matched, mismatched, errors };
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/bootstrap-prompts.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.log(
      [
        "Usage: pnpm bootstrap-prompts [--dry-run | --check]",
        "",
        "Registers the registry system prompts in the Langfuse project",
        "selected by LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL.",
        "",
        "  --dry-run   Show what would be created; do not write to Langfuse.",
        "  --check     Read-only drift check — compare live `production` prompts",
        "              to the in-repo source. Exits 1 on any mismatch or fetch",
        "              failure. Does NOT create or update anything.",
        "  --help      Show this message.",
      ].join("\n"),
    );
    return;
  }

  const dryRun = parsed.values["dry-run"] ?? false;
  const check = parsed.values.check ?? false;
  if (dryRun && check) {
    console.error(
      "[bootstrap-prompts] --dry-run and --check are mutually exclusive",
    );
    process.exit(1);
  }

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[bootstrap-prompts] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  if (check) {
    const result = await checkPrompts({ langfuse: lf });
    console.log(
      `\nSummary: matched=${result.matched.length} mismatched=${result.mismatched.length} errors=${result.errors.length}`,
    );
    if (result.mismatched.length > 0 || result.errors.length > 0) {
      process.exit(1);
    }
    return;
  }

  const result = await bootstrapPrompts({
    langfuse: lf,
    dryRun,
  });

  console.log(
    `\nSummary: created=${result.created.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    process.exit(1);
  }
}

// Run main() only when this file is invoked as a script. Tests import the
// module and call `bootstrapPrompts` directly without triggering main.
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[bootstrap-prompts] unhandled failure:", err);
    process.exit(1);
  });
}
