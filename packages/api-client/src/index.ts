export { HealthResponseSchema, type HealthResponse } from './schemas/health';
export {
  ExerciseResponseSchema,
  type ExerciseResponse,
  EvaluationResultSchema,
  type EvaluationResultResponse,
  ApiErrorSchema,
  type ApiErrorResponse,
} from './schemas/exercise';
export {
  LanguageProfileSchema,
  LanguageProfilesResponseSchema,
  type LanguageProfileResponse,
  type LanguageProfilesResponse,
} from './schemas/profile';
export {
  LearningLanguageEnum,
  PreferencesResponseSchema,
  type PreferencesResponse,
  SavePreferencesInputSchema,
  type SavePreferencesInput,
} from './schemas/preferences';
export { useHealth } from './hooks/useHealth';
export {
  useExercise,
  useSubmitAnswer,
  type UseExerciseParams,
  type SubmitAnswerParams,
  type UseSubmitAnswerOptions,
} from './hooks/useExercise';
export {
  useLanguageProfiles,
  type UseLanguageProfilesParams,
} from './hooks/useLanguageProfiles';
export {
  useGetPreferences,
  useSavePreferences,
  type UseGetPreferencesParams,
  type UseSavePreferencesParams,
  type SavePreferencesArgs,
  type SavePreferencesResponse,
} from './hooks/usePreferences';
export { createAuthenticatedFetch, type AuthenticatedFetch } from './fetchClient';
