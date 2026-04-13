export { HealthResponseSchema, type HealthResponse } from './schemas/health';
export {
  ExerciseResponseSchema,
  type ExerciseResponse,
  EvaluationResultSchema,
  type EvaluationResultResponse,
  ApiErrorSchema,
  type ApiErrorResponse,
} from './schemas/exercise';
export { useHealth } from './hooks/useHealth';
export {
  useExercise,
  useSubmitAnswer,
  type UseExerciseParams,
  type SubmitAnswerParams,
  type UseSubmitAnswerOptions,
} from './hooks/useExercise';
export { createAuthenticatedFetch, type AuthenticatedFetch } from './fetchClient';
