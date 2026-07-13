/**
 * Deep-span (single deep-card) flow for the streaming-annotate Function URL.
 *
 * This is the SSE counterpart of the (removed-in-task-17) Hono
 * `POST /read/annotate-span` route. The handler runs the shared gates 1–5
 * (`runRequestGates`) and dispatches here by path (task 14); this module owns
 * every server-authoritative step that is specific to a single tapped/selected
 * span:
 *
 *   1. Validate the offset cross-field invariant (`start < end <= text.length`)
 *      → `VALIDATION_ERROR` (Req 2.4).
 *   2. Derive `spanType` from the offsets via `resolveSpanType` (never trusted
 *      from the client) — drives the card shape and the meter metadata.
 *   3. Cache hit (SAVED entries only): if `entryId` is owned AND its
 *      `span_annotations` already holds the `"start:end"` key, stream the
 *      cached card straight back — one `field` per top-level key + a terminal
 *      `done` — with NO model call and NO metering (Req 2.1, 2.6). Unsaved
 *      passages carry no `entryId`, so within-session repeats rely on client
 *      state; there is no server cache for them.
 *   4. Tier + global capacity brake, then a rate-limit on the DEDICATED
 *      `read_span_annotation` bucket (tier-aware via `limitFor`) — a SEPARATE
 *      budget from the skim flow's shared `ai_evaluation`/`read_annotation`
 *      bucket (Req 2.3).
 *   5. Resolve the learner's CEFR level (B1 fallback) for the model call.
 *
 * Step 1–5 live in {@link runDeepSpanPreModel}. The model stream + post-success
 * side effects (write-back, meter, terminal `done`) plug into the seam in
 * {@link handleDeepSpan} and are implemented in task 13b.
 */

import { and, count, eq, gte, sql } from "drizzle-orm";

import { CefrLevel, type DeepCard, type LearningLanguage } from "@language-drill/shared";
import {
  createObservedClaudeClient,
  READ_SPAN_PROMPT_VERSION,
  ReadSpanStreamMaxTokensError,
  streamSpan,
  withLlmTrace,
} from "@language-drill/ai";
import type { SpanType } from "@language-drill/ai";
import { readEntries, usageEvents, userLanguageProfiles } from "@language-drill/db";

import { db } from "../db";
import { limitFor } from "../usage/limits";
import { getEffectivePlan, isAdmin } from "../usage/plan";
import { checkGlobalCapacity } from "../usage/global-capacity";
import { resolveSpanType } from "../routes/read-span-utils";
import { upsertGlossCacheRows } from "./gloss-cache";
import type { ResponseStream, SseWriter } from "./sse";
import type { AnnotateSpanStreamRequest } from "./handler";
import type { LambdaFunctionURLEvent } from "aws-lambda";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// Soft deadline mirrored from the skim handler: the Lambda timeout is 29 s, but
// if Claude streaming runs past this we abort it ourselves AND write a useful
// terminal `error` before the runtime SIGKILLs us — otherwise the client sees
// the body close with no terminal event (Req 1.7).
const SOFT_DEADLINE_MS = 25_000;

// CEFR fallback for the deep call when the user has no profile row for this
// language — the same default `annotate-stream/pipeline.ts` applies.
const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;
const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));

function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === "string" && CEFR_LEVELS.has(value);
}

/**
 * The validated, narrowed inputs the deep flow operates on after gates 1–5.
 * `learningLanguage` is the EN-excluded narrowing produced by `runRequestGates`
 * gate 4; `request` is the raw parsed body.
 */
export type HandleDeepSpanArgs = {
  event: LambdaFunctionURLEvent;
  responseStream: ResponseStream;
  writer: SseWriter;
  userId: string;
  learningLanguage: LearningLanguage;
  request: AnnotateSpanStreamRequest;
};

/**
 * Outcome of {@link runDeepSpanPreModel}: either an early response was already
 * written + awaited (`proceed: false` — validation error, cache hit, or
 * rate-limit) and the caller just returns, or every pre-model step passed and
 * the resolved span type, CEFR level, and cache key are handed to the model
 * stage (task 13b).
 */
export type DeepSpanPreModelResult =
  | { proceed: false }
  | {
      proceed: true;
      spanType: SpanType;
      proficiencyLevel: CefrLevel;
      /** `"start:end"` — the `span_annotations` cache key + write-back key. */
      key: string;
    };

/**
 * Deep-flow pre-model gates (steps 1–5; see the module header). Returns
 * `{ proceed: false }` after writing the matching terminal response (the
 * caller returns), or `{ proceed: true, … }` with the resolved context for the
 * model stage. No model call and no metering happen here.
 */
export async function runDeepSpanPreModel(
  args: HandleDeepSpanArgs,
): Promise<DeepSpanPreModelResult> {
  const { writer, userId, learningLanguage, request } = args;
  const { text, start, end, entryId } = request;

  // 1. Offset cross-field invariant Zod can't express: a non-empty, in-range
  //    span. `text` is the untrimmed body (the deep schema doesn't trim), so
  //    `text.length` is aligned to the client's offsets.
  if (start >= end || end > text.length) {
    await writer.errorJson(400, {
      code: "VALIDATION_ERROR",
      message: "Span offsets out of range",
    });
    return { proceed: false };
  }

  // 2. Server-authoritative span type — drives the card shape and the meter
  //    metadata (never trusted from the client).
  const spanType = resolveSpanType(text, start, end);
  const key = `${start}:${end}`;

  // 3. Durable cache (SAVED entries only). Ownership is enforced by the
  //    `user_id` predicate, so a cross-user / unknown `entryId` simply misses.
  //    On a hit we stream the stored card straight back — one `field` per
  //    top-level key then a terminal `done` — with NO model call / NO meter.
  if (entryId) {
    const rows = await db
      .select({ spanAnnotations: readEntries.spanAnnotations })
      .from(readEntries)
      .where(and(eq(readEntries.id, entryId), eq(readEntries.userId, userId)))
      .limit(1);

    const cached = rows[0]?.spanAnnotations?.[key];
    if (cached) {
      writer.openSse();
      for (const [fieldKey, value] of Object.entries(cached)) {
        writer.writeEvent("field", { key: fieldKey, value });
      }
      writer.writeTerminal("done", { card: cached });
      await writer.close();
      return { proceed: false };
    }
  }

  // 4. Tier + global brake, then the DEDICATED read_span_annotation per-user cap.
  const plan = await getEffectivePlan(userId);
  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== "ok") {
    await writer.errorJson(503, {
      code: "GLOBAL_CAPACITY",
      message: "AI temporarily at capacity",
    });
    return { proceed: false };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usageRows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, "read_span_annotation"),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(usageRows[0]?.count ?? 0) >= limitFor("read_span_annotation", plan)) {
    await writer.errorJson(429, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Daily span-annotation limit exceeded",
    });
    return { proceed: false };
  }

  // 5. Resolve the learner's CEFR level for this language (B1 fallback),
  //    exactly as `annotate-stream/pipeline.ts` does.
  const profileRows = await db
    .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
    .from(userLanguageProfiles)
    .where(
      and(
        eq(userLanguageProfiles.userId, userId),
        eq(userLanguageProfiles.language, learningLanguage),
      ),
    )
    .limit(1);
  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;

  return { proceed: true, spanType, proficiencyLevel, key };
}

/**
 * Deep-span flow entry point, called by the handler after the shared gates
 * (task 14 wires the path dispatch). Runs the pre-model gates and, on
 * `proceed`, streams the deep card from the model and applies the post-success
 * side effects.
 *
 * Model stage (Req 1.x, 2.5–2.7): open SSE; wire the soft-deadline + client-
 * disconnect abort (reused from the skim handler); run the `streamSpan` loop
 * inside `withLlmTrace({ feature: "annotate-span", … })`, writing each `field`
 * and collecting the authoritative final `done` card; on success, best-effort
 * write-back into `read_entries.span_annotations` (saved entries only) +
 * best-effort meter of exactly one `read_span_annotation` usage row + terminal
 * `done`; on any throw / abort / deadline, a terminal `error` (`AI_UNAVAILABLE`)
 * iff not already terminated, and NO meter.
 */
export async function handleDeepSpan(args: HandleDeepSpanArgs): Promise<void> {
  const pre = await runDeepSpanPreModel(args);
  if (!pre.proceed) return;

  const { event, responseStream, writer, userId, learningLanguage, request } = args;
  const { text, start, end, entryId } = request;
  const { spanType, proficiencyLevel, key } = pre;

  writer.openSse();

  // Client-disconnect → abort the upstream Claude stream (Req 1.7). ALSO a
  // soft-deadline at 25 s so we can emit a useful terminal `error` before the
  // 29 s Lambda timeout SIGKILLs us. Mirrors the skim handler verbatim.
  const abort = new AbortController();
  let deadlineFired = false;
  responseStream.on("close", () => abort.abort());
  const deadlineTimer = setTimeout(() => {
    deadlineFired = true;
    console.warn("[annotate-span] soft-deadline fired", {
      thresholdMs: SOFT_DEADLINE_MS,
    });
    abort.abort();
  }, SOFT_DEADLINE_MS);

  const requestId = event.requestContext?.requestId ?? "local";
  let card: DeepCard | undefined;
  try {
    // The Proxy maps the `submit_deep_card` tool to the `annotate-span`
    // feature; the ALS `feature` here is the fallback if the tool name is ever
    // absent. The trace context lands on the ALS frame before `streamSpan`
    // opens the model stream.
    await withLlmTrace(
      {
        feature: "annotate-span",
        env: (process.env.LANGFUSE_ENV ?? "dev") as "prod" | "dev",
        promptVersion: READ_SPAN_PROMPT_VERSION,
        requestId,
        userId,
        language: learningLanguage,
        cefrLevel: proficiencyLevel,
        exerciseType: "reading",
      },
      async () => {
        const client = createObservedClaudeClient(ANTHROPIC_API_KEY);
        for await (const ev of streamSpan(client, {
          language: learningLanguage,
          text,
          start,
          end,
          spanType,
          proficiencyLevel,
          signal: abort.signal,
        })) {
          if (ev.kind === "field") {
            writer.writeEvent("field", { key: ev.key, value: ev.value });
          } else {
            // The terminal `done` carries the authoritative, fully-validated
            // card (re-parsed from the SDK-assembled final tool input).
            card = ev.card;
          }
        }
      },
    );
  } catch (err) {
    // `streamSpan` throws on Claude/SDK errors, malformed output, the dedicated
    // `ReadSpanStreamMaxTokensError`, or an abort (client-close OR our soft-
    // deadline). All collapse to a terminal `error` with `AI_UNAVAILABLE` IFF
    // we haven't already terminated (the writer's flag is the single source of
    // truth — Req 1.8). NO meter row is written on any of these (Req 2.6).
    const message = deadlineFired
      ? "Annotation took longer than expected — try a shorter selection."
      : "Annotation temporarily unavailable";
    if (deadlineFired) {
      console.warn("[annotate-span] soft-deadline aborted streamSpan");
    } else if (err instanceof ReadSpanStreamMaxTokensError) {
      console.warn("[annotate-span] max_tokens truncation");
    } else {
      console.error("[annotate-span] streamSpan threw", err);
    }
    if (!writer.terminated) {
      writer.writeTerminal("error", { code: "AI_UNAVAILABLE", message });
    }
    clearTimeout(deadlineTimer);
    await writer.close();
    return;
  }
  // Iterator completed cleanly — no need to fire the deadline anymore.
  clearTimeout(deadlineTimer);

  // Defensive: `streamSpan` always yields `done` or throws, so a missing card
  // here is a contract violation. Treat it as an AI failure rather than
  // emitting a `done` with no card.
  if (card === undefined) {
    if (!writer.terminated) {
      writer.writeTerminal("error", {
        code: "AI_UNAVAILABLE",
        message: "Annotation temporarily unavailable",
      });
    }
    await writer.close();
    return;
  }

  // Write-back onto the saved entry (Req 2.5) — incremental jsonb merge keyed
  // by "start:end", scoped to id+user so an unowned `entryId` is a no-op.
  // Best-effort: a failure here is logged and swallowed because the card
  // already resolved and was streamed to the client.
  if (entryId) {
    try {
      await db
        .update(readEntries)
        .set({
          spanAnnotations: sql`COALESCE(${readEntries.spanAnnotations}, '{}'::jsonb) || jsonb_build_object(${key}, ${JSON.stringify(card)}::jsonb)`,
        })
        .where(and(eq(readEntries.id, entryId), eq(readEntries.userId, userId)));
    } catch (err) {
      console.error("[annotate-span] span_annotations write-back failed", err);
    }
  }

  // Feed the shared gloss cache from the resolved base gloss (word cards only).
  // Best-effort: the card already streamed to the client; a cache write failure
  // is backend-only. Older cards predate `baseGloss` and are skipped.
  if (card.type === "word" && typeof card.baseGloss === "string" && card.baseGloss.trim() !== "") {
    try {
      await upsertGlossCacheRows([
        {
          language: learningLanguage,
          lemma: card.lemma,
          baseGloss: card.baseGloss,
          pos: card.pos,
          // `DeepCard.cefr` is a Zod string-literal union (module-init cycle
          // defense — see read.ts); the DB column's `$type<CefrLevel>()` is
          // the nominal enum with identical string values (house convention,
          // e.g. routes/read.ts:726, annotate-stream/handler.ts:312-315).
          cefr: card.cefr as CefrLevel,
          freqRank: card.freq ?? null,
          source: "deep",
          promptVersion: READ_SPAN_PROMPT_VERSION,
        },
      ]);
    } catch (err) {
      console.error("[annotate-span] gloss-cache write-through failed", err);
    }
  }

  // Meter exactly one real call (Req 2.6). Best-effort: a metering write
  // failure is a backend observability problem, not a UX-visible one.
  try {
    await db.insert(usageEvents).values({
      userId,
      eventType: "read_span_annotation",
      metadata: { language: learningLanguage, spanType, entryId: entryId ?? null },
    });
  } catch (err) {
    console.error("[annotate-span] usage insert failed", err);
  }

  // Terminal `done`. The writer's `terminated` flag ensures we never reach
  // here twice.
  if (!writer.terminated) {
    writer.writeTerminal("done", { card });
  }
  await writer.close();
}
