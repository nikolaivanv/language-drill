import type {
  ReviewItem,
  ReviewItemResult,
  StartReviewSessionResponse,
} from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// Review session state machine
// ---------------------------------------------------------------------------
// Adapted from the drill `session-reducer.ts` (idle → creating → inSession →
// completing, per-item submission states, burndown selectors), retyped over the
// vocabulary-review wire types: the queue is `ReviewItem[]` fetched up-front and
// each item is graded locally into a `ReviewItemResult`. As in drill, `completing`
// is the terminal in-reducer state — on a successful complete the session page
// navigates to the summary and unmounts; `COMPLETE_FAILED` strips back to
// `inSession`. No LLM calls, no metering in this phase.
// ---------------------------------------------------------------------------

// What the session knew when it submitted the item, retained alongside the
// graded result so the feedback pane can echo the answer and hint usage.
export type ReviewSubmissionMeta = {
  answer: string;
  hintsUsed: number;
};

export type ReviewSubmissionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'evaluated'; result: ReviewItemResult; meta: ReviewSubmissionMeta }
  | { kind: 'error'; error: Error };

interface ReviewSessionInProgress {
  session: { id: string };
  items: ReviewItem[];
  index: number;
  perItemSubmission: ReviewSubmissionState;
  skippedCount: number;
}

export type ReviewSessionState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'createError'; error: Error }
  | ({ kind: 'inSession' } & ReviewSessionInProgress)
  | ({ kind: 'completing' } & ReviewSessionInProgress);

export type ReviewSessionAction =
  | { type: 'CREATE_REQUESTED' }
  | { type: 'CREATE_SUCCEEDED'; session: StartReviewSessionResponse }
  | { type: 'CREATE_FAILED'; error: Error }
  | { type: 'ITEM_SUBMITTING' }
  | { type: 'ITEM_EVALUATED'; result: ReviewItemResult; meta: ReviewSubmissionMeta }
  | { type: 'ITEM_ERROR'; error: Error }
  | { type: 'ITEM_NEXT' }
  | { type: 'ITEM_SKIP' }
  | { type: 'ITEM_RETRY' }
  | { type: 'COMPLETE_REQUESTED' }
  | { type: 'COMPLETE_FAILED'; error: Error }
  | { type: 'RESET' };

export const initialReviewSessionState: ReviewSessionState = { kind: 'idle' };

export function reviewSessionReducer(
  state: ReviewSessionState,
  action: ReviewSessionAction,
): ReviewSessionState {
  switch (action.type) {
    case 'CREATE_REQUESTED':
      if (state.kind === 'idle' || state.kind === 'createError') {
        return { kind: 'creating' };
      }
      return state;

    case 'CREATE_SUCCEEDED':
      if (state.kind !== 'creating') return state;
      return {
        kind: 'inSession',
        session: { id: action.session.sessionId },
        items: action.session.items,
        index: 0,
        perItemSubmission: { kind: 'idle' },
        skippedCount: 0,
      };

    case 'CREATE_FAILED':
      if (state.kind !== 'creating') return state;
      return { kind: 'createError', error: action.error };

    case 'ITEM_SUBMITTING':
      if (state.kind !== 'inSession') return state;
      return { ...state, perItemSubmission: { kind: 'submitting' } };

    case 'ITEM_EVALUATED':
      if (state.kind !== 'inSession') return state;
      return {
        ...state,
        perItemSubmission: {
          kind: 'evaluated',
          result: action.result,
          meta: action.meta,
        },
      };

    case 'ITEM_ERROR':
      if (state.kind !== 'inSession') return state;
      return {
        ...state,
        perItemSubmission: { kind: 'error', error: action.error },
      };

    case 'ITEM_NEXT':
      if (state.kind !== 'inSession') return state;
      if (state.index >= state.items.length - 1) return state;
      if (state.perItemSubmission.kind !== 'evaluated') return state;
      return {
        ...state,
        index: state.index + 1,
        perItemSubmission: { kind: 'idle' },
      };

    case 'ITEM_SKIP':
      if (state.kind !== 'inSession') return state;
      if (state.perItemSubmission.kind !== 'error') return state;
      return {
        ...state,
        index: state.index + 1,
        perItemSubmission: { kind: 'idle' },
        skippedCount: state.skippedCount + 1,
      };

    case 'ITEM_RETRY':
      if (state.kind !== 'inSession') return state;
      if (state.perItemSubmission.kind !== 'error') return state;
      return { ...state, perItemSubmission: { kind: 'idle' } };

    case 'COMPLETE_REQUESTED':
      if (state.kind !== 'inSession') return state;
      return { ...state, kind: 'completing' };

    case 'COMPLETE_FAILED':
      if (state.kind !== 'completing') return state;
      // Strip 'completing' back to 'inSession'; per-item state is preserved.
      return {
        kind: 'inSession',
        session: state.session,
        items: state.items,
        index: state.index,
        perItemSubmission: state.perItemSubmission,
        skippedCount: state.skippedCount,
      };

    case 'RESET':
      return { kind: 'idle' };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectCurrentReviewItem(state: ReviewSessionState): ReviewItem | null {
  if (state.kind !== 'inSession') return null;
  return state.items[state.index] ?? null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function selectReviewProgressFraction(state: ReviewSessionState): number {
  switch (state.kind) {
    case 'idle':
    case 'creating':
    case 'createError':
      return 0;
    case 'inSession': {
      const evaluatedBoost = state.perItemSubmission.kind === 'evaluated' ? 1 : 0;
      return clamp01((state.index + evaluatedBoost) / state.items.length);
    }
    case 'completing':
      return 1;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unknown ReviewSessionState: ${String(_exhaustive)}`);
    }
  }
}

export function selectIsLastReviewItem(state: ReviewSessionState): boolean {
  return state.kind === 'inSession' && state.index === state.items.length - 1;
}
