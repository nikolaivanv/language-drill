// Direct import of `useReducer`/`useRef`/`useCallback` from "react" trips
// Next.js's static "client-only API" check when the api-client barrel is
// pulled into a Server Component. Marking the module as a client boundary
// tells the bundler not to evaluate it on the server. Mirrors
// `useReadAnnotateStream`.
"use client";

import { useCallback, useReducer, useRef } from "react";
import type { DeepCard } from "@language-drill/shared";

import {
  AnnotateSpanDoneEventSchema,
  AnnotateErrorEventSchema,
  AnnotateSpanFieldEventSchema,
  type AnnotateErrorEvent,
  type AnnotateSpanRequest,
} from "../schemas/read";
import { fetchSse, type FetchSseError } from "../sse-client";

// ---------------------------------------------------------------------------
// State + actions (mirror design §useReadAnnotateSpanStream / Component 6)
// ---------------------------------------------------------------------------

/** The selected span being annotated — the request body, carried through state
 * so the page can position the card and (in `onResolved`) write the resolved
 * card back keyed by `entryId`/`start`/`end`. */
export type Span = AnnotateSpanRequest;

export type DeepCardErrorPayload = {
  code: string;
  message: string;
  status?: number;
};

export type DeepCardStreamState =
  | { phase: "idle" }
  | { phase: "streaming"; partial: Partial<DeepCard>; span: Span }
  | { phase: "complete"; card: DeepCard; span: Span }
  | { phase: "error"; error: DeepCardErrorPayload; span: Span };

type Action =
  | { type: "START"; span: Span }
  | { type: "FIELD"; key: string; value: unknown }
  | { type: "DONE"; card: DeepCard }
  | { type: "ERROR"; error: DeepCardErrorPayload }
  | { type: "ABORTED" }
  | { type: "RESET" };

const INITIAL_STATE: DeepCardStreamState = { phase: "idle" };

function reducer(
  state: DeepCardStreamState,
  action: Action,
): DeepCardStreamState {
  switch (action.type) {
    case "START":
      // A fresh stream always starts from an empty partial card. `start()`
      // dispatches this synchronously so the page can render the card shell
      // before the first `field` arrives (Req 1.2).
      return { phase: "streaming", partial: {}, span: action.span };

    case "FIELD":
      // Merge a completed top-level field into the partial preview. The
      // streamed value is a preview fragment, never the source of truth (the
      // `done` card is) — so we store it loosely without per-field validation.
      if (state.phase !== "streaming") return state;
      return {
        ...state,
        partial: {
          ...state.partial,
          [action.key]: action.value,
        } as Partial<DeepCard>,
      };

    case "DONE":
      // The authoritative card replaces the partial preview (Req 1.3).
      if (state.phase !== "streaming") return state;
      return { phase: "complete", card: action.card, span: state.span };

    case "ERROR": {
      // Attach the error to the in-flight span so the card UI can render an
      // inline error + retry in place (Req 1.5). The partial preview is
      // discarded — a failed stream has no trustworthy card to show.
      const span =
        state.phase === "streaming" ||
        state.phase === "complete" ||
        state.phase === "error"
          ? state.span
          : undefined;
      if (!span) return state;
      return { phase: "error", error: action.error, span };
    }

    case "ABORTED":
      // Abort cancels the upstream stream but doesn't mutate observable state —
      // the page decides whether to dismiss the card or leave the preview.
      return state;

    case "RESET":
      return INITIAL_STATE;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseReadAnnotateSpanStreamOptions = {
  /** Function URL base — `process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL`. The
   * deep-span path is appended to it. */
  baseUrl: string;
  getToken: (options?: { template?: string }) => Promise<string | null>;
  /** Fired once with the authoritative card on `done`, so the page can write
   * it through into the entry cache + session map (Req 1.3, 2.8). */
  onResolved?: (card: DeepCard, span: Span) => void;
};

export type UseReadAnnotateSpanStreamReturn = {
  state: DeepCardStreamState;
  start: (input: AnnotateSpanRequest) => void;
  abort: () => void;
  reset: () => void;
};

export function useReadAnnotateSpanStream(
  opts: UseReadAnnotateSpanStreamOptions,
): UseReadAnnotateSpanStreamReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // The active controller. `start()` aborts any prior controller before
  // creating a new one, so a rapid second tap can't leak a background iterator.
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (input: AnnotateSpanRequest) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      dispatch({ type: "START", span: input });
      void runStream(opts, input, controller, dispatch);
    },
    [opts],
  );

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "ABORTED" });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  return { state, start, abort, reset };
}

// ---------------------------------------------------------------------------
// runStream — the async iterator loop (extracted so it can be unit-tested)
// ---------------------------------------------------------------------------

async function runStream(
  opts: UseReadAnnotateSpanStreamOptions,
  span: AnnotateSpanRequest,
  controller: AbortController,
  dispatch: (action: Action) => void,
): Promise<void> {
  let token: string | null;
  try {
    token = await opts.getToken({ template: "api" });
  } catch (err) {
    dispatch({
      type: "ERROR",
      error: {
        code: "AI_UNAVAILABLE",
        message:
          err instanceof Error ? err.message : "Failed to obtain auth token",
      },
    });
    return;
  }

  let terminalDispatched = false;
  const dispatchTerminal = (
    action: Extract<Action, { type: "DONE" | "ERROR" }>,
  ): void => {
    if (terminalDispatched) return;
    terminalDispatched = true;
    dispatch(action);
  };
  // Fire `onResolved` exactly once, alongside the terminal `DONE` dispatch.
  const onCardResolved = (card: DeepCard): void => {
    opts.onResolved?.(card, span);
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url = `${opts.baseUrl.replace(/\/$/, "")}/read/annotate-span`;

  try {
    for await (const frame of fetchSse(url, {
      method: "POST",
      headers,
      body: JSON.stringify(span),
      signal: controller.signal,
    })) {
      handleFrame(frame, dispatch, dispatchTerminal, onCardResolved);
    }
  } catch (err) {
    // AbortError → silent: the page chose to cancel; not an `error` phase.
    if (controller.signal.aborted) return;

    const fse = err as FetchSseError;
    const status = typeof fse.status === "number" ? fse.status : undefined;
    const body = fse.body as { code?: string; message?: string } | null;
    dispatchTerminal({
      type: "ERROR",
      error: {
        code: body?.code ?? mapStatusToCode(status),
        message: body?.message ?? fse.message ?? "Request failed",
        status,
      },
    });
    return;
  }

  // Stream ended without a `done` or `error` frame → AI_UNAVAILABLE (Req 1.5).
  if (!terminalDispatched) {
    dispatch({
      type: "ERROR",
      error: { code: "AI_UNAVAILABLE", message: "Stream ended unexpectedly" },
    });
  }
}

function handleFrame(
  frame: { type: string; data: string },
  dispatch: (action: Action) => void,
  dispatchTerminal: (
    action: Extract<Action, { type: "DONE" | "ERROR" }>,
  ) => void,
  onCardResolved: (card: DeepCard) => void,
): void {
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(frame.data);
  } catch {
    // Malformed frame data — drop silently. The server contract is JSON-only.
    return;
  }

  switch (frame.type) {
    case "field": {
      const result = AnnotateSpanFieldEventSchema.safeParse(parsedData);
      if (!result.success) return;
      dispatch({ type: "FIELD", key: result.data.key, value: result.data.value });
      return;
    }
    case "done": {
      const result = AnnotateSpanDoneEventSchema.safeParse(parsedData);
      if (!result.success) return;
      dispatchTerminal({ type: "DONE", card: result.data.card });
      onCardResolved(result.data.card);
      return;
    }
    case "error": {
      const result = AnnotateErrorEventSchema.safeParse(parsedData);
      if (result.success) {
        dispatchTerminal({ type: "ERROR", error: toErrorPayload(result.data) });
      }
      return;
    }
    default:
      return;
  }
}

function toErrorPayload(ev: AnnotateErrorEvent): DeepCardErrorPayload {
  return { code: ev.code, message: ev.message };
}

function mapStatusToCode(status: number | undefined): string {
  if (status === 401) return "MISSING_SUB";
  if (status === 429) return "RATE_LIMIT_EXCEEDED";
  if (status === 400) return "VALIDATION_ERROR";
  return "AI_UNAVAILABLE";
}
