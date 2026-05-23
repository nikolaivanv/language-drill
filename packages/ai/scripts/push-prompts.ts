/**
 * packages/ai — push-prompts CLI (operational tool).
 *
 * `bootstrap-prompts` is create-only: it lists prompts already at the
 * `production` label and skips every one that exists, so re-running it never
 * pushes edits. When the in-repo prompt bodies move ahead of what Langfuse
 * serves at `production` — e.g. a prompt-edit PR merges but nobody mirrors
 * the body into Langfuse — the runtime keeps serving the *stale* body, and
 * `bootstrap-prompts --check` reports drift it cannot fix. This script closes
 * that gap programmatically.
 *
 * Flow:
 *   1. Detect drift with the SAME byte-for-byte comparison `--check` uses
 *      (reuses the tested `checkPrompts`). A 404/auth/network error on any
 *      prompt aborts the whole run — we never push blind.
 *   2. For each CURRENTLY-DRIFTED prompt, read and log the live `production`
 *      version number (the revert target), then create a new version from
 *      the in-repo body carrying the `production` label. Langfuse moves the
 *      label off the prior version automatically, so the new body goes live
 *      within the runtime's 5-minute cache TTL.
 *
 * In-sync prompts are left untouched, so it is safe to run against an env
 * that is only partially behind. Fully reversible: re-point the `production`
 * label at the logged prior version in the Langfuse dashboard.
 *
 * Target project is whatever LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY /
 * LANGFUSE_BASE_URL select — run once per environment.
 *
 *   pnpm --filter @language-drill/ai push-prompts --dry-run   # preview
 *   pnpm --filter @language-drill/ai push-prompts             # write
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { PROMPT_LABEL_PRODUCTION, getLangfuse } from "../src/index.js";
import {
  PROMPTS,
  checkPrompts,
  type LangfusePromptClient,
  type PromptManifestEntry,
} from "./bootstrap-prompts.js";

// ---------------------------------------------------------------------------
// pushDriftedPrompts — the testable core
// ---------------------------------------------------------------------------

export type PushPromptsOptions = {
  /** Langfuse client (or a test stub matching the port). */
  langfuse: LangfusePromptClient;
  /** When true, no writes happen; the script prints what it would push. */
  dryRun: boolean;
  /** Override the manifest for tests; defaults to the production set. */
  prompts?: readonly PromptManifestEntry[];
  /** Override the timestamp generator so tests can pin `registeredAt`. */
  now?: () => Date;
  /** Logger injection point; defaults to `console.log`. */
  log?: (...args: unknown[]) => void;
};

export type PushPromptsResult = {
  /** Names of prompts that were (or would have been) pushed. */
  pushed: string[];
  /** Names already in sync — left untouched. */
  skipped: string[];
  /** True when drift detection failed; the run wrote nothing. */
  aborted: boolean;
  /** Per-prompt write failures (drift was confirmed but createPrompt threw). */
  errors: Array<{ name: string; error: unknown }>;
};

/**
 * Detect drift via the tested `checkPrompts`, then mint a new
 * `production`-labeled version for each drifted prompt. Pure-ish — the only
 * side effects are the SDK calls and the logger.
 *
 * Refuses to write anything if drift detection itself errored (a 404, auth,
 * or network failure means we can't trust the "which are drifted" set), so
 * a transient Langfuse problem can never cause a partial, half-understood
 * push.
 */
export async function pushDriftedPrompts(
  opts: PushPromptsOptions,
): Promise<PushPromptsResult> {
  const {
    langfuse,
    dryRun,
    prompts = PROMPTS,
    now = () => new Date(),
    log = (...args: unknown[]) => console.log(...args),
  } = opts;

  // 1. Classify with the same comparison `--check` uses. Suppress its
  //    per-line diff output; we only need the matched/mismatched split.
  const check = await checkPrompts({ langfuse, prompts, log: () => {} });
  if (check.errors.length > 0) {
    log(
      `✗ drift check failed for ${check.errors.length} prompt(s); refusing to push (won't write blind).`,
    );
    for (const e of check.errors) log(`  ✗ ${e.name}: ${String(e.error)}`);
    return { pushed: [], skipped: check.matched, aborted: true, errors: check.errors };
  }

  const driftedNames = new Set(check.mismatched.map((m) => m.name));
  if (driftedNames.size === 0) {
    log("Nothing to push — all prompts already match the in-repo source.");
    return { pushed: [], skipped: check.matched, aborted: false, errors: [] };
  }

  const toPush = prompts.filter((p) => driftedNames.has(p.name));
  log(
    `Drifted prompts to push (label=${PROMPT_LABEL_PRODUCTION}): ${toPush
      .map((p) => p.name)
      .join(", ")}`,
  );

  const pushed: string[] = [];
  const errors: Array<{ name: string; error: unknown }> = [];

  for (const entry of toPush) {
    // Record the live production version — the revert target if the new
    // version turns out wrong. Best-effort: drift is already confirmed, so a
    // failure here only costs us the log line.
    let priorVersion: number | string = "unknown";
    try {
      const live = await langfuse.getPrompt(entry.name, undefined, {
        label: PROMPT_LABEL_PRODUCTION,
        cacheTtlSeconds: 0,
      });
      if (live && typeof live === "object" && "version" in live) {
        priorVersion = (live as { version: number | string }).version;
      }
    } catch {
      /* non-fatal */
    }

    const config = {
      localVersion: entry.version,
      surface: entry.surface,
      registeredAt: now().toISOString(),
    };

    if (dryRun) {
      log(
        `[dry-run] would push ${entry.name} ` +
          `(prior production=v${priorVersion} → new version; ` +
          `localVersion=${entry.version}, surface=${entry.surface})`,
      );
      pushed.push(entry.name);
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
        `＋ pushed ${entry.name} ` +
          `(prior production=v${priorVersion}; localVersion=${entry.version}, surface=${entry.surface})`,
      );
      pushed.push(entry.name);
    } catch (err) {
      log(`✗ ${entry.name}: createPrompt failed`, err);
      errors.push({ name: entry.name, error: err });
    }
  }

  return { pushed, skipped: check.matched, aborted: false, errors };
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/push-prompts.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    console.log(
      [
        "Usage: pnpm --filter @language-drill/ai push-prompts [--dry-run]",
        "",
        "Pushes a new `production`-labeled version of every prompt that is",
        "currently DRIFTED (live production body != in-repo source) in the",
        "Langfuse project selected by LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY",
        "/ LANGFUSE_BASE_URL. In-sync prompts are skipped. Aborts without",
        "writing if drift detection errors. Run once per environment.",
        "",
        "  --dry-run   Show what would be pushed; do not write.",
        "  --help      Show this message.",
      ].join("\n"),
    );
    return;
  }

  const dryRun = parsed.values["dry-run"] ?? false;

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[push-prompts] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  const result = await pushDriftedPrompts({ langfuse: lf, dryRun });

  // Flush buffered SDK events before the process exits.
  await lf.flushAsync?.();

  console.log(
    `\nSummary: ${dryRun ? "would push" : "pushed"}=${result.pushed.length} ` +
      `skipped=${result.skipped.length} errors=${result.errors.length}` +
      `${result.aborted ? " (ABORTED — no writes)" : ""}`,
  );
  if (result.aborted || result.errors.length > 0) {
    process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[push-prompts] unhandled failure:", err);
    process.exit(1);
  });
}
