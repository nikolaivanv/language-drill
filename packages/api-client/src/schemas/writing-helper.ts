import { z } from 'zod';

// Brainstorm response from POST /exercises/:id/brainstorm
export const BrainstormSchema = z.object({
  groups: z.array(z.object({ label: z.string(), points: z.array(z.string()) })),
});
export type BrainstormResponse = z.infer<typeof BrainstormSchema>;

// Vocab-boost response from POST /exercises/:id/vocab-boost
export const VocabBoostSchema = z.object({
  items: z.array(z.object({ term: z.string(), gloss: z.string() })),
});
export type VocabBoostResponse = z.infer<typeof VocabBoostSchema>;

// Start-my-paragraph response from POST /exercises/:id/start-my-paragraph
export const StartMyParagraphSchema = z.object({
  opener: z.string(),
});
export type StartMyParagraphResponse = z.infer<typeof StartMyParagraphSchema>;
