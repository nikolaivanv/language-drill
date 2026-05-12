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

import { and, count, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { LambdaFunctionURLEvent } from "aws-lambda";

import {
  Language,
  READ_TEXT_MAX_CHARS,
} from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { usageEvents } from "@language-drill/db";
import {
  AnnotateStreamMaxTokensError,
  createClaudeClient,
  streamAnnotation,
} from "@language-drill/ai";

import { db } from "../db";
import { verifyClerkJwt } from "./jwt";
import { buildCandidateList } from "./pipeline";
import { createSseWriter } from "./sse";

// Touch `loadFrequency` so esbuild can't tree-shake the side-effecting
// import above. Reading any language is fine — `loadFrequency` is memoized
// and the first call populates all three module-init caches transitively
// via the `FREQUENCY_BY_LANGUAGE` table in `@language-drill/ai/frequency`.
void loadFrequency;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const DAILY_EVAL_LIMIT = 50;

// `language` is parsed as the full `Language` enum (incl. EN) so the handler
// can distinguish "shape error" from "EN is source-only" — the latter has
// its own 400 UNSUPPORTED_LANGUAGE response. Mirrors the same defense in
// the (now-deleted) `infra/lambda/src/routes/read.ts:34-44`.
const AnnotateRequestSchema = z.object({
  text: z.string().trim().min(1).max(READ_TEXT_MAX_CHARS),
  language: z.nativeEnum(Language),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = awslambda.streamifyResponse<
  LambdaFunctionURLEvent,
  unknown
>(async (event, responseStream) => {
  const writer = createSseWriter(responseStream);

  // Every exit path below MUST `await` whichever writer method emits the
  // final bytes (`cors200`, `errorJson`, or `close`). AWS's response-streaming
  // runtime closes the socket as soon as this handler's promise resolves —
  // without an explicit wait for the underlying `Writable` to emit `'finish'`,
  // the last write can stay queued in userspace and never reach the client.
  // The symptom is "browser receives `meta` but never `flag`/`done`" because
  // `meta` is followed by a slow Claude call that gives the kernel time to
  // drain, while `done`/`error` aren't.

  // ---- Gate 1: OPTIONS preflight ----
  const method = event.requestContext?.http?.method ?? "POST";
  if (method === "OPTIONS") {
    await writer.cors200();
    return;
  }

  // ---- Gate 2: method != POST ----
  if (method !== "POST") {
    await writer.errorJson(405, { code: "METHOD_NOT_ALLOWED", message: "Method Not Allowed" });
    return;
  }

  // ---- Gate 3: parse + validate body ----
  const rawBody = readBodyString(event);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    await writer.errorJson(400, { code: "VALIDATION_ERROR", message: "Invalid JSON body" });
    return;
  }
  const bodyResult = AnnotateRequestSchema.safeParse(parsedJson);
  if (!bodyResult.success) {
    await writer.errorJson(400, {
      code: "VALIDATION_ERROR",
      message: "Invalid request body",
    });
    return;
  }
  const { text, language } = bodyResult.data;

  // ---- Gate 4: EN is source-only ----
  if (language === Language.EN) {
    await writer.errorJson(400, {
      code: "UNSUPPORTED_LANGUAGE",
      message: "English is not a supported learning language",
    });
    return;
  }
  const learningLanguage = language as LearningLanguage;

  // ---- Gate 5: Clerk JWT verification ----
  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization;
  const userId = await verifyClerkJwt(authHeader);
  if (!userId) {
    await writer.errorJson(401, { code: "MISSING_SUB", message: "Unauthorized" });
    return;
  }

  // ---- Gate 6: rate-limit (rolling 24h, shared with ai_evaluation) ----
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usageRows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        inArray(usageEvents.eventType, ["ai_evaluation", "read_annotation"]),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(usageRows[0]?.count ?? 0) >= DAILY_EVAL_LIMIT) {
    await writer.errorJson(429, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Daily evaluation limit exceeded",
    });
    return;
  }

  // ---------------------------------------------------------------------
  // Gates passed — open the SSE stream and begin the candidate pipeline.
  // ---------------------------------------------------------------------
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

  // Step 10: stream Claude's enrichment events, one flag at a time.
  let flaggedCount = 0;
  try {
    const client = createClaudeClient(ANTHROPIC_API_KEY);
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
    console.log("[annotate-stream] streamAnnotation completed", { flaggedCount });
  } catch (err) {
    // The iterator throws on Claude errors, malformed responses, the
    // dedicated `AnnotateStreamMaxTokensError`, or an abort (client-close
    // OR our own soft-deadline). All four collapse to the same observable:
    // `error` with `code: 'AI_UNAVAILABLE'` IFF we haven't already
    // terminated (`terminated` is the wire-protocol single source of
    // truth — see Req 3.3). The deadline path gets a more specific
    // message so the user knows the passage was too heavy, not that AI
    // is broken.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBodyString(event: LambdaFunctionURLEvent): string {
  if (event.body === undefined || event.body === null) return "";
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }
  return event.body;
}
