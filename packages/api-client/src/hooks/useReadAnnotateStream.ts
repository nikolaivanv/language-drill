import { useCallback, useReducer, useRef } from "react";
import type { FlaggedMap, LearningLanguage, WordFlag } from "@language-drill/shared";

import {
  AnnotateDoneEventSchema,
  AnnotateErrorEventSchema,
  AnnotateFlagEventSchema,
  AnnotateMetaEventSchema,
  type AnnotateErrorEvent,
} from "../schemas/read";
import { fetchSse, type FetchSseError } from "../sse-client";

// ---------------------------------------------------------------------------
// State + actions (mirror design §useReadAnnotateStream)
// ---------------------------------------------------------------------------

export type Calibration = {
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  top: number;
};

export type AnnotateStreamState =
  | { phase: "idle" }
  | {
      phase: "streaming";
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: Calibration;
    }
  | {
      phase: "complete";
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: Calibration;
    }
  | {
      phase: "error";
      candidateCount?: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration?: Calibration;
      error: { code: string; message: string; status?: number };
    };

type Action =
  | { type: "START" }
  | { type: "META"; calibration: Calibration; candidateCount: number }
  | { type: "FLAG"; matchedForm: string; flag: WordFlag }
  | { type: "DONE"; flaggedCount: number }
  | {
      type: "ERROR";
      error: { code: string; message: string; status?: number };
    }
  | { type: "ABORTED" }
  | { type: "RESET" };

const INITIAL_STATE: AnnotateStreamState = { phase: "idle" };

// Pre-meta streaming state. `start` dispatches `START` immediately so the
// page can render the empty annotated view (Req 5.1) before the META event
// arrives — the calibration/candidateCount are populated by `META`.
function startState(): Extract<AnnotateStreamState, { phase: "streaming" }> {
  return {
    phase: "streaming",
    candidateCount: 0,
    flaggedMap: {},
    flaggedCount: 0,
    calibration: { cefr: "B1", top: 0 },
  };
}

function reducer(state: AnnotateStreamState, action: Action): AnnotateStreamState {
  switch (action.type) {
    case "START":
      return startState();

    case "META":
      // Meta lands once per stream, immediately after START. If a stray
      // META arrives outside `streaming` we ignore it — defensive against
      // out-of-order dispatches from a racing AbortController.
      if (state.phase !== "streaming") return state;
      return {
        ...state,
        calibration: action.calibration,
        candidateCount: action.candidateCount,
      };

    case "FLAG":
      if (state.phase !== "streaming") return state;
      return {
        ...state,
        flaggedMap: { ...state.flaggedMap, [action.matchedForm]: action.flag },
        flaggedCount: state.flaggedCount + 1,
      };

    case "DONE":
      if (state.phase !== "streaming") return state;
      return {
        phase: "complete",
        candidateCount: state.candidateCount,
        flaggedMap: state.flaggedMap,
        flaggedCount: action.flaggedCount,
        calibration: state.calibration,
      };

    case "ERROR": {
      // Retain `flaggedMap`/`flaggedCount` from whatever streaming/complete
      // state preceded the error — partial flags MUST stay visible to the
      // user (Req 5.10).
      const carry =
        state.phase === "streaming" || state.phase === "complete"
          ? {
              flaggedMap: state.flaggedMap,
              flaggedCount: state.flaggedCount,
              calibration: state.calibration,
              candidateCount: state.candidateCount,
            }
          : { flaggedMap: {} as FlaggedMap, flaggedCount: 0 };
      return {
        phase: "error",
        ...carry,
        error: action.error,
      };
    }

    case "ABORTED":
      // Abort cancels the upstream stream but doesn't mutate observable
      // state — the page caller decides whether to `reset()` (paste-new) or
      // leave the partial view visible.
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

export type UseReadAnnotateStreamOptions = {
  /** Function URL base — `process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL`. */
  baseUrl: string;
  getToken: (options?: { template?: string }) => Promise<string | null>;
};

export type UseReadAnnotateStreamReturn = {
  state: AnnotateStreamState;
  start: (input: { language: LearningLanguage; text: string }) => void;
  abort: () => void;
  reset: () => void;
};

export function useReadAnnotateStream(
  opts: UseReadAnnotateStreamOptions,
): UseReadAnnotateStreamReturn {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // The active controller. `start()` aborts any prior controller before
  // creating a new one, so the page can safely call `start()` twice in a
  // row without leaking a background iterator.
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(
    (input: { language: LearningLanguage; text: string }) => {
      // Cancel any in-flight run and reset the reducer to a fresh streaming
      // state before we touch the network.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      dispatch({ type: "START" });
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
  opts: UseReadAnnotateStreamOptions,
  input: { language: LearningLanguage; text: string },
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
        message: err instanceof Error ? err.message : "Failed to obtain auth token",
      },
    });
    return;
  }

  let terminalDispatched = false;
  const dispatchTerminal = (action: Extract<Action, { type: "DONE" | "ERROR" }>): void => {
    if (terminalDispatched) return;
    terminalDispatched = true;
    dispatch(action);
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    for await (const frame of fetchSse(opts.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller.signal,
    })) {
      handleFrame(frame, dispatch, dispatchTerminal);
    }
  } catch (err) {
    // AbortError → silent: the page already chose to cancel; we don't
    // surface that as an `error` phase.
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

  // Stream ended without a `done` or `error` frame → AI_UNAVAILABLE
  // (Req 5.10). Partial flags are retained by the reducer's ERROR branch.
  if (!terminalDispatched) {
    dispatch({
      type: "ERROR",
      error: {
        code: "AI_UNAVAILABLE",
        message: "Stream ended unexpectedly",
      },
    });
  }
}

function handleFrame(
  frame: { type: string; data: string },
  dispatch: (action: Action) => void,
  dispatchTerminal: (action: Extract<Action, { type: "DONE" | "ERROR" }>) => void,
): void {
  let parsedData: unknown;
  try {
    parsedData = JSON.parse(frame.data);
  } catch {
    // Malformed frame data — drop silently. The server contract is
    // JSON-only; this is defense against a misconfigured intermediary.
    return;
  }

  switch (frame.type) {
    case "meta": {
      const result = AnnotateMetaEventSchema.safeParse(parsedData);
      if (result.success) {
        dispatch({
          type: "META",
          calibration: result.data.calibration,
          candidateCount: result.data.candidateCount,
        });
      }
      return;
    }
    case "flag": {
      const result = AnnotateFlagEventSchema.safeParse(parsedData);
      if (!result.success) return;
      const { matchedForm, ...flag } = result.data;
      dispatch({ type: "FLAG", matchedForm, flag });
      return;
    }
    case "done": {
      const result = AnnotateDoneEventSchema.safeParse(parsedData);
      if (result.success) {
        dispatchTerminal({ type: "DONE", flaggedCount: result.data.flaggedCount });
      }
      return;
    }
    case "error": {
      const result = AnnotateErrorEventSchema.safeParse(parsedData);
      if (result.success) {
        dispatchTerminal({
          type: "ERROR",
          error: toErrorPayload(result.data),
        });
      }
      return;
    }
    default:
      return;
  }
}

function toErrorPayload(ev: AnnotateErrorEvent): {
  code: string;
  message: string;
} {
  return { code: ev.code, message: ev.message };
}

function mapStatusToCode(status: number | undefined): string {
  if (status === 401) return "MISSING_SUB";
  if (status === 429) return "RATE_LIMIT_EXCEEDED";
  if (status === 400) return "VALIDATION_ERROR";
  return "AI_UNAVAILABLE";
}
