import { z } from 'zod';
import { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import { ExerciseResponseSchema } from './exercise';

// Request body for POST /sessions
export const CreateSessionRequestSchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  exerciseCount: z.number().int().min(1).max(20),
  // Optional single-type filter. Omitted → a mixed pull (quick drill); set to a
  // type (e.g. dictation) → a single-type run (dictation-only launcher).
  exerciseType: z.nativeEnum(ExerciseType).optional(),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// Response body for POST /sessions
export const CreateSessionResponseSchema = z.object({
  id: z.string().uuid(),
  exercises: z.array(ExerciseResponseSchema),
});

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

// Response body for POST /sessions/:id/complete
export const CompleteSessionResponseSchema = z.object({
  id: z.string().uuid(),
  exerciseCount: z.number().int().nonnegative(),
  correctCount: z.number().int().nonnegative(),
  attemptedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
});

export type CompleteSessionResponse = z.infer<typeof CompleteSessionResponseSchema>;
