/**
 * Streaming-annotate Lambda handler — entry point for the Function URL.
 *
 * Wire-protocol invariant (Req 3.3): the SSE writer holds a `terminated`
 * flag that is the single source of truth for "have we already emitted a
 * terminal event?" — only `writeTerminal('done' | 'error', ...)` flips it,
 * and a second terminal-write throws synchronously. Every `error`/`done`
 * decision below routes through it; never call `writeEvent('done' | 'error',
 * ...)` directly.
 *
 * Cold-start positioning (Req 4.7): the three frequency JSON dictionaries
 * are imported transitively at the very top of the module — `loadFrequency`
 * (via `@language-drill/ai`) eagerly reads them into memory at module init
 * so the per-language `FrequencyLookup` is ready before the first invocation
 * touches `buildCandidateList`.
 */

// `loadFrequency` is imported *first* so the JSON dictionaries land in the
// Node module cache during cold start (Req 4.7), well before any request
// handling logic runs.
import { loadFrequency } from "@language-drill/ai";

import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { LambdaFunctionURLEvent } from "aws-lambda";

import {
  Language,
  READ_TEXT_MAX_CHARS,
} from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { usageEvents } from "@language-drill/db";
import {
  ANNOTATE_SYSTEM_PROMPT_VERSION,
  AnnotateStreamMaxTokensError,
  createObservedClaudeClient,
  flushObservability,
  streamAnnotation,
  withLlmTrace,
} from "@language-drill/ai";

import { db } from "../db";
import { limitFor } from "../usage/limits";
import { getEffectivePlan, isAdmin } from "../usage/plan";
import { checkGlobalCapacity } from "../usage/global-capacity";
import { verifyClerkJwt } from "./jwt";
import { buildCandidateList } from "./pipeline";
import { createSseWriter } from "./sse";
import type { SseWriter } from "./sse";
import { handleDeepSpan } from "./deep-flow";

// Touch `loadFrequency` so esbuild can't tree-shake the side-effecting
// import above. Reading any language is fine — `loadFrequency` is memoized
// and the first call populates all three module-init caches transitively
// via the `FREQUENCY_BY_LANGUAGE` table in `@language-drill/ai/frequency`.
void loadFrequency;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// `language` is parsed as the full `Language` enum (incl. EN) so the handler
// can distinguish "shape error" from "EN is source-only" — the latter has
// its own 400 UNSUPPORTED_LANGUAGE response. Mirrors the same defense in
// the (now-deleted) `infra/lambda/src/routes/read.ts:34-44`.
const AnnotateRequestSchema = z.object({
  text: z.string().trim().min(1).max(READ_TEXT_MAX_CHARS),
  language: z.nativeEnum(Language),
});

// Deep-span (single-card) streaming request. Like `AnnotateRequestSchema`,
// `language` is the full `Language` enum so EN gets a dedicated 400
// UNSUPPORTED_LANGUAGE rather than a generic shape error. Unlike the skim
// schema, `text` is NOT trimmed — `start`/`end` are character offsets into the
// exact text, so trimming would shift them out of alignment. The cross-field
// invariant `start < end <= text.length` can't be expressed inline; the deep
// flow (task 13a) validates it after `safeParse` and returns VALIDATION_ERROR.
// `entryId` is present only for SAVED entries (drives the cache-hit lookup and
// best-effort write-back); its absence means an unsaved passage. Mirrors the
// (now-removed) `read.ts` `AnnotateSpanBodySchema`.
export const AnnotateSpanStreamRequest = z.object({
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  language: z.nativeEnum(Language),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  entryId: z.string().uuid().optional(),
});

export type AnnotateSpanStreamRequest = z.infer<typeof AnnotateSpanStreamRequest>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = awslambda.streamifyResponse<
  LambdaFunctionURLEvent,
  unknown
>(async (event, responseStream) => {
  const writer = createSseWriter(responseStream);

  // `withObservabilityFlush` guarantees one `flushObservability()` per
  // invocation on every path — success, error, abort, and the validation
  // gates that short-circuit before any Claude call (Req 6 AC 2).
  //
  // Every exit path below MUST `await` whichever writer method emits the
  // final bytes (`cors200`, `errorJson`, or `close`). AWS's response-streaming
  // runtime closes the socket as soon as this handler's promise resolves —
  // without an explicit wait for the underlying `Writable` to emit `'finish'`,
  // the last write can stay queued in userspace and never reach the client.
  // The symptom is "browser receives `meta` but never `flag`/`done`" because
  // `meta` is followed by a slow Claude call that gives the kernel time to
  // drain, while `done`/`error` aren't.
  await withObservabilityFlush(async () => {
    // ---- Path dispatch ----
    // Both flows live on the same Function URL; the deep-span endpoint is
    // reached at `…/read/annotate-span` while the skim pass answers at the
    // bare base URL (and `…/read/annotate`). The two flows validate different
    // body shapes, so the schema is chosen here before the shared gates parse
    // the body. OPTIONS preflight carries no body, so gate 1 short-circuits
    // identically on either branch.
    if (isDeepSpanPath(event)) {
      const gate = await runRequestGates(event, writer, AnnotateSpanStreamRequest);
      if (!gate.proceed) return;
      await handleDeepSpan({
        event,
        responseStream,
        writer,
        userId: gate.userId,
        learningLanguage: gate.learningLanguage,
        request: gate.data,
      });
      return;
    }

    // ---- Gates 1–5: OPTIONS / method / body / EN / JWT (shared) ----
    const gate = await runRequestGates(event, writer, AnnotateRequestSchema);
    if (!gate.proceed) return;
    const { learningLanguage, userId } = gate;
    const { text } = gate.data;

    // ---- Gate 6: tier + global brake + per-user skim cap (own bucket) ----
    const plan = await getEffectivePlan(userId);
    const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
    if (capacity !== "ok") {
      await writer.errorJson(503, {
        code: "GLOBAL_CAPACITY",
        message: "AI temporarily at capacity",
      });
      return;
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usageRows = await db
      .select({ count: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          eq(usageEvents.eventType, "read_annotation"),
          gte(usageEvents.createdAt, oneDayAgo),
        ),
      );
    if (Number(usageRows[0]?.count ?? 0) >= limitFor("read_annotation", plan)) {
      await writer.errorJson(429, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Daily annotation limit exceeded",
      });
      return;
    }

    // -------------------------------------------------------------------
    // Gates passed — open the SSE stream and begin the candidate pipeline.
    // -------------------------------------------------------------------
    writer.openSse();

    // Step 7: pre-filter + post-filter → candidate list + calibration.
    const { candidates, calibration } = await buildCandidateList({
      userId,
      language: learningLanguage,
      text,
    });

    writer.writeEvent("meta", {
      calibration,
      candidateCount: candidates.length,
    });
    console.log("[annotate-stream] meta emitted", {
      userId,
      language: learningLanguage,
      textLength: text.length,
      candidateCount: candidates.length,
      proficiencyLevel: calibration.cefr,
    });

    // Step 8: empty candidate list short-circuit (Req 1.6 / 2.5).
    // No Claude call, no usage_events row — the user paid nothing for an
    // in-level passage.
    if (candidates.length === 0) {
      writer.writeTerminal("done", { flaggedCount: 0 });
      console.log("[annotate-stream] done (empty candidate list)");
      await writer.close();
      return;
    }

    // Step 9: client-disconnect → abort upstream Claude stream (Req 4.9).
    // ALSO: soft-deadline at 25 s. The Lambda timeout is 29 s, but if Claude
    // streaming runs past 25 s we want to abort it ourselves AND write a
    // useful `error` frame before the runtime SIGKILLs us — otherwise the
    // client sees the body close with no terminal event and surfaces the
    // unhelpful "Stream ended unexpectedly" message.
    const abort = new AbortController();
    let deadlineFired = false;
    responseStream.on("close", () => abort.abort());
    const SOFT_DEADLINE_MS = 25_000;
    const deadlineTimer = setTimeout(() => {
      deadlineFired = true;
      console.warn("[annotate-stream] soft-deadline fired", {
        thresholdMs: SOFT_DEADLINE_MS,
      });
      abort.abort();
    }, SOFT_DEADLINE_MS);

    // Step 10: stream Claude's enrichment events, one flag at a time —
    // wrapped in `withLlmTrace` so the Anthropic Proxy can emit one
    // Langfuse generation tagged with the call-site metadata (Req 2 AC 2).
    // The trace context lives in AsyncLocalStorage; the Proxy reads it
    // at the start of `messages.stream` (design.md §Tracing model).
    const requestId = event.requestContext?.requestId ?? "local";
    let flaggedCount = 0;
    try {
      await withLlmTrace(
        {
          feature: "annotate",
          env: (process.env.LANGFUSE_ENV ?? "dev") as "prod" | "dev",
          promptVersion: ANNOTATE_SYSTEM_PROMPT_VERSION,
          requestId,
          userId,
          language: learningLanguage,
          cefrLevel: calibration.cefr,
          exerciseType: "reading",
          candidateCount: candidates.length,
        },
        async () => {
          const client = createObservedClaudeClient(ANTHROPIC_API_KEY);
          for await (const ev of streamAnnotation(client, {
            text,
            language: learningLanguage,
            proficiencyLevel: calibration.cefr,
            candidates,
            signal: abort.signal,
          })) {
            if (ev.kind === "flag") {
              writer.writeEvent("flag", ev.flag);
              flaggedCount++;
            }
          }
        },
      );
      console.log("[annotate-stream] streamAnnotation completed", { flaggedCount });
    } catch (err) {
      // The iterator throws on Claude errors, malformed responses, the
      // dedicated `AnnotateStreamMaxTokensError`, or an abort (client-close
      // OR our own soft-deadline). All four collapse to the same observable:
      // `error` with `code: 'AI_UNAVAILABLE'` IFF we haven't already
      // terminated (`terminated` is the wire-protocol single source of
      // truth — see Req 3.3). The deadline path gets a more specific
      // message so the user knows the passage was too heavy, not that AI
      // is broken. The Proxy already finalized the Langfuse generation
      // with level=ERROR (or WARNING for client_disconnect / max_tokens)
      // before re-throwing here (Req 5 AC 3).
      const message = deadlineFired
        ? "Annotation took longer than expected — try a shorter passage."
        : "Evaluation temporarily unavailable";
      if (deadlineFired) {
        console.warn(
          "[annotate-stream] soft-deadline aborted streamAnnotation",
          { flaggedCount },
        );
      } else if (err instanceof AnnotateStreamMaxTokensError) {
        console.warn(
          "[annotate-stream] max_tokens truncation",
          { flaggedCount },
        );
      } else {
        console.error("[annotate-stream] streamAnnotation threw", err);
      }
      if (!writer.terminated) {
        writer.writeTerminal("error", {
          code: "AI_UNAVAILABLE",
          message,
        });
      }
      clearTimeout(deadlineTimer);
      await writer.close();
      return;
    }
    // Iterator completed cleanly — no need to fire the deadline anymore.
    clearTimeout(deadlineTimer);

    // Step 11: insert the usage_events row AFTER the iterator finishes
    // successfully. A throw here MUST NOT cascade into a terminal `error` —
    // the user got their flags, and a failed metering write is a backend
    // observability problem, not a UX-visible one.
    try {
      await db.insert(usageEvents).values({
        userId,
        eventType: "read_annotation",
        metadata: {
          language: learningLanguage,
          textLength: text.length,
          candidateCount: candidates.length,
          flaggedCount,
        },
      });
    } catch (err) {
      console.error("[annotate-stream] usage insert failed", err);
    }

    // Step 12: terminal `done`. The writer's `terminated` flag ensures we
    // never reach here twice.
    if (!writer.terminated) {
      writer.writeTerminal("done", { flaggedCount });
    }
    console.log("[annotate-stream] done (success)", { flaggedCount });
    await writer.close();
  });
});

// ---------------------------------------------------------------------------
// Shared flow helpers (skim + deep)
// ---------------------------------------------------------------------------

/**
 * Wraps a flow in the once-per-invocation `flushObservability()` discipline
 * (Req 6 AC 2). The flush is a synchronous no-op when Langfuse is disabled
 * (keys absent in vitest / local dev), so wrapping even the pure-gate
 * short-circuits — which never start a trace — costs nothing. Both the skim
 * and deep-span flows run inside this so a trace started mid-flow is always
 * flushed before the handler's promise resolves.
 */
export async function withObservabilityFlush(
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } finally {
    await flushObservability();
  }
}

/**
 * The outcome of {@link runRequestGates}: either an early response was already
 * written + awaited (`proceed: false`, the caller just returns) or every gate
 * passed and the parsed body, the EN-narrowed `learningLanguage`, and the
 * verified `userId` are handed back for the flow-specific remainder.
 */
type RequestGateResult<T> =
  | { proceed: false }
  | {
      proceed: true;
      data: T;
      learningLanguage: LearningLanguage;
      userId: string;
    };

/**
 * Request gates 1–5 for the streaming-annotate Function URL, run by BOTH the
 * skim and deep-span flows so neither duplicates them:
 *   1. OPTIONS preflight                  → 204 (cors200)
 *   2. method != POST                     → 405 METHOD_NOT_ALLOWED
 *   3. JSON parse + body schema validate  → 400 VALIDATION_ERROR
 *   4. EN is source-only                  → 400 UNSUPPORTED_LANGUAGE
 *   5. Clerk JWT                          → 401 MISSING_SUB
 *
 * On any failure the matching terminal response is written AND awaited here;
 * the caller receives `{ proceed: false }` and must simply `return`. The body
 * schema is injected so each flow validates its own shape
 * (`AnnotateRequestSchema` vs `AnnotateSpanStreamRequest`) — both yield a
 * `language` field, which is all gate 4 inspects. Gate 6 (rate-limit) is
 * intentionally NOT shared: each flow owns its own bucket / limit (Req 2.3).
 */
export async function runRequestGates<T extends { language: Language }>(
  event: LambdaFunctionURLEvent,
  writer: SseWriter,
  schema: z.ZodType<T>,
): Promise<RequestGateResult<T>> {
  // ---- Gate 1: OPTIONS preflight ----
  const method = event.requestContext?.http?.method ?? "POST";
  if (method === "OPTIONS") {
    await writer.cors200();
    return { proceed: false };
  }

  // ---- Gate 2: method != POST ----
  if (method !== "POST") {
    await writer.errorJson(405, { code: "METHOD_NOT_ALLOWED", message: "Method Not Allowed" });
    return { proceed: false };
  }

  // ---- Gate 3: parse + validate body ----
  const rawBody = readBodyString(event);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    await writer.errorJson(400, { code: "VALIDATION_ERROR", message: "Invalid JSON body" });
    return { proceed: false };
  }
  const bodyResult = schema.safeParse(parsedJson);
  if (!bodyResult.success) {
    await writer.errorJson(400, {
      code: "VALIDATION_ERROR",
      message: "Invalid request body",
    });
    return { proceed: false };
  }

  // ---- Gate 4: EN is source-only ----
  if (bodyResult.data.language === Language.EN) {
    await writer.errorJson(400, {
      code: "UNSUPPORTED_LANGUAGE",
      message: "English is not a supported learning language",
    });
    return { proceed: false };
  }
  const learningLanguage = bodyResult.data.language as LearningLanguage;

  // ---- Gate 5: Clerk JWT verification ----
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization;
  const userId = await verifyClerkJwt(authHeader);
  if (!userId) {
    await writer.errorJson(401, { code: "MISSING_SUB", message: "Unauthorized" });
    return { proceed: false };
  }

  return { proceed: true, data: bodyResult.data, learningLanguage, userId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when the request targets the deep-span endpoint. Prefers the API-style
 * `requestContext.http.path` and falls back to `rawPath` (Function URL events
 * always carry one of the two). The bare base URL and `…/read/annotate` are
 * NOT matched, so they fall through to the skim flow.
 */
function isDeepSpanPath(event: LambdaFunctionURLEvent): boolean {
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  return path.endsWith("/read/annotate-span");
}

function readBodyString(event: LambdaFunctionURLEvent): string {
  if (event.body === undefined || event.body === null) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}
