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
  DebriefItemStatusSchema,
  type DebriefItemStatus,
  DebriefItemSchema,
  type DebriefItem,
  DebriefResponseSchema,
  type DebriefResponse,
} from './schemas/debrief';
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
export {
  TodayPlanItemStatusEnum,
  TodayPlanItemSchema,
  TodayPlanSummarySchema,
  TodayPlanResponseSchema,
  type TodayPlanItemStatus,
  type TodayPlanItem,
  type TodayPlanSummary,
  type TodayPlanResponse,
} from './schemas/today';
export {
  AnnotateRequestSchema,
  AnnotateResponseSchema,
  SaveReadEntryRequestSchema,
  SaveReadEntryResponseSchema,
  UpdateBankRequestSchema,
  UpdateBankResponseSchema,
  ReadEntrySummarySchema,
  ReadEntriesResponseSchema,
  ReadEntryResponseSchema,
  WordFlagSchema,
  FlaggedMapSchema,
  type AnnotateRequest,
  type AnnotateResponse,
  type SaveReadEntryRequest,
  type SaveReadEntryResponse,
  type UpdateBankRequest,
  type UpdateBankResponse,
  type ReadEntrySummary,
  type ReadEntriesResponse,
  type ReadEntryResponse,
  type WordFlag,
  type FlaggedMap,
} from './schemas/read';
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
  useSessionDebrief,
  type UseSessionDebriefOptions,
} from './hooks/useDebrief';
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
export {
  useTodayPlan,
  type UseTodayPlanParams,
} from './hooks/useTodayPlan';
export {
  useReadAnnotate,
  type UseReadAnnotateOptions,
} from './hooks/useReadAnnotate';
export {
  useReadEntries,
  useReadEntry,
  type UseReadEntriesParams,
  type UseReadEntryParams,
} from './hooks/useReadEntries';
export {
  useSaveReadEntry,
  useUpdateReadBank,
  type UseSaveReadEntryOptions,
  type UseUpdateReadBankOptions,
  type UpdateReadBankParams,
} from './hooks/useReadEntryMutations';
export { createAuthenticatedFetch, type AuthenticatedFetch } from './fetchClient';
