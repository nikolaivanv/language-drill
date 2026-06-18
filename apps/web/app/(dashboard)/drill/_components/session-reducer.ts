import type {
  CreateSessionResponse,
  ExerciseResponse,
} from '@language-drill/api-client';
import type { SubmissionMeta, SubmissionResult, SubmissionState } from './types';

interface SessionInProgress {
  session: { id: string };
  items: ExerciseResponse[];
  index: number;
  perItemSubmission: SubmissionState;
  skippedCount: number;
}

export type SessionState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'createError'; error: Error }
  | ({ kind: 'inSession' } & SessionInProgress)
  | ({ kind: 'completing' } & SessionInProgress);

export type SessionAction =
  | { type: 'CREATE_REQUESTED' }
  | { type: 'CREATE_SUCCEEDED'; session: CreateSessionResponse }
  | { type: 'CREATE_FAILED'; error: Error }
  | { type: 'ITEM_SUBMITTING' }
  | { type: 'ITEM_EVALUATED'; result: SubmissionResult; meta: SubmissionMeta; submissionId?: string }
  | { type: 'ITEM_ERROR'; error: Error }
  | { type: 'ITEM_NEXT' }
  | { type: 'ITEM_SKIP' }
  | { type: 'ITEM_RETRY' }
  | { type: 'COMPLETE_REQUESTED' }
  | { type: 'COMPLETE_FAILED'; error: Error }
  | { type: 'RESET' };

export const initialSessionState: SessionState = { kind: 'idle' };

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
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
        session: { id: action.session.id },
        items: action.session.exercises,
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
          submissionId: action.submissionId,
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

export function selectCurrentItem(state: SessionState): ExerciseResponse | null {
  if (state.kind !== 'inSession') return null;
  return state.items[state.index] ?? null;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function selectProgressFraction(state: SessionState): number {
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
      throw new Error(`unknown SessionState: ${String(_exhaustive)}`);
    }
  }
}

export function selectIsLastItem(state: SessionState): boolean {
  return state.kind === 'inSession' && state.index === state.items.length - 1;
}
