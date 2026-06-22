export { HealthResponseSchema, type HealthResponse } from './schemas/health';
export {
  ExerciseResponseSchema,
  type ExerciseResponse,
  EvaluationResultSchema,
  type EvaluationResultResponse,
  DictationResultSchema,
  type DictationResultResponse,
  type SubmitResultResponse,
  parseSubmitResult,
  ApiErrorSchema,
  type ApiErrorResponse,
  FreeWritingEvaluationSchema,
  type FreeWritingEvaluationResponse,
} from './schemas/exercise';
export {
  LanguageProfileSchema,
  LanguageProfilesResponseSchema,
  type LanguageProfileResponse,
  type LanguageProfilesResponse,
} from './schemas/profile';
export {
  DailyGoalEnum,
  LearningLanguageEnum,
  LearningProfileSchema,
  PreferencesResponseSchema,
  type PreferencesResponse,
  UpdateLanguagesInputSchema,
  UpdateLanguagesResponseSchema,
  type UpdateLanguagesInput,
  type UpdateLanguagesResponse,
  UpdatePreferencesInputSchema,
  type UpdatePreferencesInput,
} from './schemas/preferences';
export {
  CreateSessionRequestSchema,
  type CreateSessionRequest,
  CreateSessionResponseSchema,
  type CreateSessionResponse,
  CompleteSessionResponseSchema,
  type CompleteSessionResponse,
  ResumeSessionResponseSchema,
  type ResumeSessionResponse,
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
  InsightsErrorThemeSchema,
  InsightsErrorsResponseSchema,
  type InsightsErrorTheme,
  type InsightsErrorsResponse,
} from './schemas/insights';
export {
  RadarAxisKeyEnum,
  RadarAxisSchema,
  ProgressRadarResponseSchema,
  type RadarAxisKey,
  type RadarAxis,
  type ProgressRadarResponse,
} from './schemas/progress';
export {
  TodayPlanItemStatusEnum,
  PlanReasonEnum,
  TodayPlanItemSchema,
  TodayPlanSummarySchema,
  TodayPlanResponseSchema,
  FreeWritingPlanBlockSchema,
  type TodayPlanItemStatus,
  type PlanReason,
  type TodayPlanItem,
  type TodayPlanSummary,
  type TodayPlanResponse,
  type FreeWritingPlanBlock,
} from './schemas/today';
export {
  AnnotateRequestSchema,
  AnnotateMetaEventSchema,
  AnnotateFlagEventSchema,
  AnnotateDoneEventSchema,
  AnnotateErrorEventSchema,
  SaveReadEntryRequestSchema,
  SaveReadEntryResponseSchema,
  UpdateBankRequestSchema,
  UpdateBankResponseSchema,
  ReadEntrySummarySchema,
  ReadEntriesResponseSchema,
  ReadEntryResponseSchema,
  SavedVocabItemSchema,
  AnnotateSpanRequestSchema,
  AnnotateSpanResponseSchema,
  SaveVocabularyCardRequestSchema,
  SaveVocabularyCardResponseSchema,
  DeleteVocabularyCardResponseSchema,
  GenerateReadingTextRequestSchema,
  GenerateReadingTextResponseSchema,
  WordFlagSchema,
  FlaggedMapSchema,
  DeepCardSchema,
  type AnnotateRequest,
  type AnnotateMetaEvent,
  type AnnotateFlagEvent,
  type AnnotateDoneEvent,
  type AnnotateErrorEvent,
  type SaveReadEntryRequest,
  type SavedVocabItem,
  type SaveReadEntryResponse,
  type UpdateBankRequest,
  type UpdateBankResponse,
  type ReadEntrySummary,
  type ReadEntriesResponse,
  type ReadEntryResponse,
  type AnnotateSpanRequest,
  type AnnotateSpanResponse,
  type SaveVocabularyCardRequest,
  type SaveVocabularyCardResponse,
  type DeleteVocabularyCardResponse,
  type GenerateReadingTextRequest,
  type GenerateReadingTextResponse,
  type WordFlag,
  type FlaggedMap,
  type DeepCard,
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
  useSubmitFreeWriting,
  type SubmitFreeWritingParams,
  type UseSubmitFreeWritingOptions,
} from './hooks/useSubmitFreeWriting';
export {
  BrainstormSchema,
  type BrainstormResponse,
  VocabBoostSchema,
  type VocabBoostResponse,
  StartMyParagraphSchema,
  type StartMyParagraphResponse,
} from './schemas/writing-helper';
export { useBrainstorm, type UseBrainstormOptions } from './hooks/useBrainstorm';
export { useVocabBoost, type UseVocabBoostOptions } from './hooks/useVocabBoost';
export { useStartMyParagraph, type UseStartMyParagraphOptions } from './hooks/useStartMyParagraph';
export {
  useCreateSession,
  useCompleteSession,
  useResumeSession,
  type UseCreateSessionOptions,
  type UseCompleteSessionOptions,
  type CompleteSessionParams,
  type UseResumeSessionOptions,
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
  useUpdateLanguages,
  useUpdatePreferences,
  type UseGetPreferencesParams,
  type UpdateLanguagesArgs,
  type UpdatePreferencesArgs,
} from './hooks/usePreferences';
export {
  useProgressRadar,
  type UseProgressRadarParams,
} from './hooks/useProgress';
export { useInsightsErrors, type UseInsightsErrorsParams } from './hooks/useInsights';
export {
  ErrorTrendThemeSchema,
  ErrorTrendsResponseSchema,
  type ErrorTrendTheme,
  type ErrorTrendsResponse,
} from './schemas/error-trends';
export { useErrorTrends, type UseErrorTrendsParams } from './hooks/useErrorTrends';
export {
  useTodayPlan,
  type UseTodayPlanParams,
} from './hooks/useTodayPlan';
export {
  useReadAnnotateStream,
  type UseReadAnnotateStreamOptions,
  type UseReadAnnotateStreamReturn,
  type AnnotateStreamState,
} from './hooks/useReadAnnotateStream';
export { fetchSse, type SseFrame, type FetchSseError } from './sse-client';
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
export {
  useGenerateReadingText,
  type UseGenerateReadingTextOptions,
} from './hooks/useGenerateReadingText';
export {
  useReadAnnotateSpanStream,
  type UseReadAnnotateSpanStreamOptions,
  type UseReadAnnotateSpanStreamReturn,
  type DeepCardStreamState,
  type DeepCardErrorPayload,
  type Span,
} from './hooks/useReadAnnotateSpanStream';
export {
  useSaveVocabularyCard,
  useDeleteVocabularyCard,
  type UseSaveVocabularyCardOptions,
  type UseDeleteVocabularyCardOptions,
} from './hooks/useVocabularyMutations';
export { createAuthenticatedFetch, type AuthenticatedFetch } from './fetchClient';
export { MeResponseSchema, type MeResponse } from './schemas/me';
export {
  RedeemResponseSchema,
  type RedeemResponse,
  AdminInviteSchema,
  AdminInvitesResponseSchema,
  type AdminInvite,
  CreateInvitesResponseSchema,
  type CreateInvitesResponse,
} from './schemas/invites';
export { useMe, type UseMeParams } from './hooks/useMe';
export {
  useRedeemInvite,
  RedeemError,
  type RedeemErrorKind,
  type UseRedeemInviteParams,
} from './hooks/useRedeemInvite';
export {
  useAdminInvites,
  useCreateInvites,
  useRevokeInvite,
  type UseAdminInvitesParams,
  type UseCreateInvitesParams,
  type CreateInvitesArgs,
  type UseRevokeInviteParams,
} from './hooks/useAdminInvites';
export {
  PoolStatusItemSchema,
  type PoolStatusItem,
  GenerationStatsSchema,
  type GenerationStats,
} from './schemas/pool-status';
export {
  TheoryListItemSchema,
  TheoryListResponseSchema,
  TheoryCoverageRowSchema,
  TheoryCoverageResponseSchema,
  PoolStatusTheoryItemSchema,
  type TheoryListItem,
  type TheoryListResponse,
  type TheoryCoverageRow,
  type TheoryCoverageResponse,
  type PoolStatusTheoryItem,
} from './schemas/theory';
export {
  parseTheoryTopicJson,
  type TheoryTopicJson,
  type TheorySectionJson,
  type TheoryBlockJson,
  type TheoryInlineJson,
} from '@language-drill/shared';
export {
  HubOverviewSchema,
  ReviewFilterSchema,
  StartReviewSessionRequestSchema,
  ReviewItemSchema,
  StartReviewSessionResponseSchema,
  SubmitReviewItemRequestSchema,
  ReviewItemResultSchema,
  ReviewSummaryItemSchema,
  ReviewSummarySchema,
  BankRowSchema,
  BankResponseSchema,
  WordHistoryEntrySchema,
  WordDetailSchema,
  UpdateWordRequestSchema,
  UpdateWordResponseSchema,
  DeleteWordResponseSchema,
  ActiveLemmasSchema,
  type HubOverview,
  type ReviewFilter,
  type StartReviewSessionRequest,
  type ReviewItem,
  type StartReviewSessionResponse,
  type SubmitReviewItemRequest,
  type ReviewItemResult,
  type ReviewSummaryItem,
  type ReviewSummary,
  type BankRow,
  type BankResponse,
  type WordHistoryEntry,
  type WordDetail,
  type UpdateWordRequest,
  type UpdateWordResponse,
  type DeleteWordResponse,
  type ActiveLemmas,
} from './schemas/review';
export {
  useReviewOverview,
  useReviewSummary,
  useVocabularyBank,
  useVocabularyWord,
  useActiveReviewLemmas,
  type UseReviewOverviewParams,
  type UseReviewSummaryParams,
  type UseVocabularyBankParams,
  type UseVocabularyWordParams,
  type UseActiveReviewLemmasParams,
} from './hooks/useReviewQueries';
export {
  useStartReviewSession,
  useSubmitReviewItem,
  useUpdateVocabularyWord,
  useDeleteVocabularyWord,
  type UseReviewMutationOptions,
  type StartReviewSessionParams,
  type SubmitReviewItemParams,
  type UpdateVocabularyWordParams,
  type DeleteVocabularyWordParams,
} from './hooks/useReviewMutations';
export {
  FluencySessionRequestSchema,
  type FluencySessionRequest,
  FluencySessionResponseSchema,
  type FluencySessionResponse,
  FluencyAttemptRequestSchema,
  type FluencyAttemptRequest,
  FluencyAttemptResponseSchema,
  type FluencyAttemptResponse,
  FluencyWeekBucketSchema,
  type FluencyWeekBucket,
  FluencyStatsResponseSchema,
  type FluencyStatsResponse,
} from './schemas/fluency';
export {
  useFluencySession,
  useSubmitFluencyAttempt,
  useFluencyStats,
  type UseFluencySessionOptions,
  type UseSubmitFluencyAttemptOptions,
  type UseFluencyStatsParams,
} from './hooks/useFluency';
export {
  FlaggedReasonSchema,
  FlaggedExerciseSchema, FlaggedExercisesResponseSchema,
  FlaggedTheorySchema, FlaggedTheoryResponseSchema,
  ResolveOutcomeSchema, ResolveResponseSchema,
  type FlaggedReason,
  type FlaggedExercise, type FlaggedTheory,
  type FlaggedExerciseFilters, type FlaggedTheoryFilters,
  type ResolveOutcome,
} from './schemas/flagged';
export {
  useFlaggedExercises, useFlaggedTheory,
  useResolveFlaggedExercise, useResolveFlaggedTheory,
} from './hooks/useFlaggedQueue';
export {
  ContentExerciseSchema, ContentExercisesResponseSchema,
  ContentTheorySchema, ContentTheoryResponseSchema, ContentReviewStatusSchema,
  type ContentExercise, type ContentTheory,
  type ContentExerciseParams, type ContentTheoryParams,
} from './schemas/content';
export {
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
} from './hooks/useContentBrowser';
export {
  PoolCellDetailSchema,
  type PoolCellDetail, type PoolCellQuery,
} from './schemas/pool-cell';
export { usePoolCell } from './hooks/usePoolCell';
export { usePoolStatus, type PoolStatusParams } from './hooks/usePoolStatus';
export { useGenerationStats } from './hooks/useGenerationStats';
export { useTheoryCoverage } from './hooks/useTheoryCoverage';
export { useTheoryPoolStatus, type TheoryPoolStatusParams } from './hooks/useTheoryPoolStatus';
export {
  GenerateCellResponseSchema,
  type GenerateCellRequest,
  type GenerateCellResponse,
} from './schemas/generate';
export { useGenerateCell } from './hooks/useGenerateCell';
export {
  RevalidateResponseSchema,
  type RevalidateRequest,
  type RevalidateResponse,
} from './schemas/revalidate';
export { useRevalidateCell } from './hooks/useRevalidateCell';
export { AuditEntrySchema, AuditLogResponseSchema, type AuditEntry, type AuditQuery } from './schemas/audit';
export { useAuditLog } from './hooks/useAuditLog';
export { CapacityResponseSchema, type CapacityResponse } from './schemas/capacity';
export { useCapacity } from './hooks/useCapacity';
export {
  CurriculumEntrySchema,
  CurriculumResponseSchema,
  type CurriculumEntry,
  type CurriculumResponse,
  PointStateEnum,
  CurriculumMapPointSchema,
  CurriculumMapLevelSchema,
  CurriculumMapResponseSchema,
  type PointState,
  type CurriculumMapPoint,
  type CurriculumMapLevel,
  type CurriculumMapResponse,
} from './schemas/curriculum';
export { useCurriculum, type CurriculumParams } from './hooks/useCurriculum';
export { useCurriculumMap, type UseCurriculumMapParams } from './hooks/useCurriculumMap';
export {
  FlagCategoryEnum, type FlagCategory,
  FlagExerciseRequestSchema, type FlagExerciseRequest,
  FlagExerciseResponseSchema, type FlagExerciseResponse,
  UserFlagQueueItemSchema, type UserFlagQueueItem,
  UserFlagsResponseSchema, type UserFlagsResponse,
  ResolveUserFlagOutcomeSchema,
  ResolveUserFlagResponseSchema, type ResolveUserFlagOutcome,
} from './schemas/user-flags';
export {
  useFlagExercise, useUserFlagsQueue, useResolveUserFlag, type UserFlagStatus,
} from './hooks/useUserFlags';
export {
  ActivitySessionListItemSchema, type ActivitySessionListItem,
  ActivitySessionDetailSchema, type ActivitySessionDetail,
  ActivityFailureItemSchema, type ActivityFailureItem,
} from './schemas/admin-activity';
export { useActivitySessions, type ActivitySessionsParams } from './hooks/useActivitySessions';
export { useActivitySessionDetail } from './hooks/useActivitySessionDetail';
export { useActivityFailures, type ActivityFailuresParams } from './hooks/useActivityFailures';
