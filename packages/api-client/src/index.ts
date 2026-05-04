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
export {
  CreateSessionRequestSchema,
  type CreateSessionRequest,
  CreateSessionResponseSchema,
  type CreateSessionResponse,
  CompleteSessionResponseSchema,
  type CompleteSessionResponse,
} from './schemas/session';
export {
  RadarAxisKeyEnum,
  RadarAxisSchema,
  ProgressRadarResponseSchema,
  HeatmapTopicSchema,
  ShadeThresholdsSchema,
  ProgressHeatmapResponseSchema,
  type RadarAxisKey,
  type RadarAxis,
  type ProgressRadarResponse,
  type HeatmapTopic,
  type ShadeThresholds,
  type ProgressHeatmapResponse,
} from './schemas/progress';
export { useHealth } from './hooks/useHealth';
export {
  useExercise,
  useSubmitAnswer,
  type UseExerciseParams,
  type SubmitAnswerParams,
  type UseSubmitAnswerOptions,
} from './hooks/useExercise';
export {
  useCreateSession,
  useCompleteSession,
  type UseCreateSessionOptions,
  type UseCompleteSessionOptions,
  type CompleteSessionParams,
} from './hooks/useSession';
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
export {
  useProgressRadar,
  useProgressHeatmap,
  type UseProgressRadarParams,
  type UseProgressHeatmapParams,
} from './hooks/useProgress';
export { createAuthenticatedFetch, type AuthenticatedFetch } from './fetchClient';
