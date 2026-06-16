import { z } from 'zod';

/**
 * Per-grammar-point mastery movement for the session debrief "skills you moved"
 * panel. Sibling of MasteryDelta (review.ts), but deliberately carries NO raw
 * from/to scores — only a band + confidence — so the client cannot render mastery
 * numbers (the trust-presentation decision; see the design spec).
 */
export const SKILL_MOVEMENT_BANDS = ['new', 'strong-gain', 'gain', 'steady', 'slip'] as const;

export const SkillMovementBandSchema = z.enum(SKILL_MOVEMENT_BANDS);
export type SkillMovementBand = z.infer<typeof SkillMovementBandSchema>;

export const SkillMovementSchema = z.object({
  grammarPointKey: z.string().min(1),
  label: z.string().min(1),
  band: SkillMovementBandSchema,
  confidence: z.enum(['high', 'low']),
});
export type SkillMovement = z.infer<typeof SkillMovementSchema>;
