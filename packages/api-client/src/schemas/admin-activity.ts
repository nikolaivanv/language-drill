import { z } from 'zod';

const SignalSchema = z.enum(['flagged', 'abandoned', 'low_score']);

export const ActivitySessionListItemSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  language: z.string(),
  difficulty: z.string(),
  exerciseCount: z.number(),
  correctCount: z.number(),
  completedAt: z.string().nullable(),
  startedAt: z.string(),
  signals: SignalSchema.array(),
  primarySignal: SignalSchema.nullable(),
});
export type ActivitySessionListItem = z.infer<typeof ActivitySessionListItemSchema>;

const SessionDetailExerciseSchema = z.object({
  exerciseId: z.string(),
  order: z.number(),
  type: z.string().nullable(),
  content: z.unknown(),
  score: z.number().nullable(),
  response: z.unknown(),
  evaluatedAt: z.string().nullable(),
  errors: z
    .object({
      errorType: z.string(),
      severity: z.string(),
      wrongText: z.string(),
      correction: z.string(),
      errorGrammarPointKey: z.string().nullable(),
    })
    .array(),
  flag: z
    .object({ category: z.string(), note: z.string().nullable(), status: z.string(), createdAt: z.string() })
    .nullable(),
});

export const ActivitySessionDetailSchema = z.object({
  session: z.object({
    sessionId: z.string(),
    userId: z.string(),
    language: z.string(),
    difficulty: z.string(),
    exerciseCount: z.number(),
    correctCount: z.number(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  }),
  exercises: SessionDetailExerciseSchema.array(),
});
export type ActivitySessionDetail = z.infer<typeof ActivitySessionDetailSchema>;

export const ActivityFailureItemSchema = z.object({
  exerciseId: z.string(),
  language: z.string(),
  difficulty: z.string(),
  type: z.string(),
  grammarPointKey: z.string().nullable(),
  attempts: z.number(),
  distinctUsers: z.number(),
  failRate: z.number(),
  avgScore: z.number(),
  qualityScore: z.number().nullable(),
  openFlags: z.number(),
});
export type ActivityFailureItem = z.infer<typeof ActivityFailureItemSchema>;

export const ActivityRosterItemSchema = z.object({
  userId: z.string(),
  lastActiveAt: z.string().nullable(),
  sessions7d: z.number(),
  sessions30d: z.number(),
  drills7d: z.number(),
  drills30d: z.number(),
  languages: z.string().array(),
  avgScore30d: z.number().nullable(),
  aiEvents7d: z.number(),
});
export type ActivityRosterItem = z.infer<typeof ActivityRosterItemSchema>;
