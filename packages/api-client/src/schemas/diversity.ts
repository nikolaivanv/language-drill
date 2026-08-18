import { z } from 'zod';

export const DiversityAxisSchema = z.object({
  name: z.string(),
  role: z.enum(['controlled', 'monitored']),
  values: z.array(
    z.object({
      value: z.string(),
      count: z.number(),
      floor: z.number().nullable(),
    }),
  ),
  untagged: z.number(),
});

export const DiversitySeedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('construction-variants'),
    variants: z.array(
      z.object({
        id: z.string(),
        directive: z.string(),
        share: z.number(),
        count: z.number(),
        quota: z.number(),
      }),
    ),
    unlabelledRows: z.number(),
  }),
  z.object({
    kind: z.literal('curated'),
    source: z.string(),
    poolSize: z.number(),
    usedCount: z.number(),
    unused: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('frequency-band'),
    band: z.string(),
    rankMax: z.number(),
    distinctSeeds: z.number(),
    unlabelledRows: z.number(),
  }),
  z.object({ kind: z.literal('vocab-target') }),
  z.object({ kind: z.literal('none') }),
]);

export const DiversityCellSchema = z.object({
  cellKey: z.string(),
  type: z.string(),
  level: z.string(),
  approved: z.number(),
  target: z.number(),
  atTarget: z.boolean(),
  axes: z.array(DiversityAxisSchema),
  seed: DiversitySeedSchema,
  shortfalls: z.array(
    z.object({
      axis: z.string(),
      value: z.string(),
      floor: z.number(),
      actual: z.number(),
    }),
  ),
  // Per-cell issue counts. A point's counts are the sum over its cells, so
  // the pool table can badge a single (language, level, type, point) row.
  provenIssues: z.number(),
  unknowns: z.number(),
});

export const DiversityPointSchema = z.object({
  key: z.string(),
  name: z.string(),
  language: z.string(),
  cefrLevel: z.string(),
  kind: z.string(),
  targetOverride: z.number().nullable(),
  provenIssues: z.number(),
  unknowns: z.number(),
  cells: z.array(DiversityCellSchema),
});

export const DiversityResponseSchema = z.object({
  items: z.array(DiversityPointSchema),
});

export type DiversityAxis = z.infer<typeof DiversityAxisSchema>;
export type DiversitySeed = z.infer<typeof DiversitySeedSchema>;
export type DiversityCell = z.infer<typeof DiversityCellSchema>;
export type DiversityPoint = z.infer<typeof DiversityPointSchema>;

/** Scoping only — mechanism filtering happens client-side, on the full
 *  in-scope set, so every row can still render its own mechanism chips. */
export type DiversityQuery = {
  language?: string;
  level?: string;
  kind?: string;
};
