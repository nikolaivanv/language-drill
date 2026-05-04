import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import {
  TodayPlanItemSchema,
  TodayPlanResponseSchema,
  type TodayPlanItem,
} from './today';

// Build a valid baseline item that the table-driven cases below can mutate.
// Keeping a single canonical shape makes each rejection case a focused diff.
const validItem = (overrides: Partial<TodayPlanItem> = {}): TodayPlanItem => ({
  index: 1,
  type: ExerciseType.CLOZE,
  topicHint: 'subjunctive',
  difficulty: CefrLevel.B1,
  itemCount: 4,
  estimatedMinutes: 2,
  status: 'queued',
  ...overrides,
});

const queuedItems: TodayPlanItem[] = [
  validItem({ index: 1 }),
  validItem({ index: 2 }),
  validItem({ index: 3, type: ExerciseType.TRANSLATION, estimatedMinutes: 4 }),
  validItem({ index: 4, type: ExerciseType.VOCAB_RECALL }),
  validItem({ index: 5 }),
];

const doneItems: TodayPlanItem[] = queuedItems.map((it) => ({
  ...it,
  status: 'done' as const,
}));

describe('TodayPlanResponseSchema', () => {
  it('parses a happy-path payload (5 queued items, summary: null, code: null)', () => {
    const payload = {
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('parses an all-done payload with a populated summary', () => {
    const payload = {
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: doneItems,
      summary: { itemCount: 5, correctCount: 4, durationMinutes: 18 },
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('parses an insufficient-pool payload (items: [], code: INSUFFICIENT_POOL)', () => {
    const payload = {
      language: Language.DE,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 0,
      items: [],
      summary: null,
      code: 'INSUFFICIENT_POOL' as const,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects items array longer than 5', () => {
    const payload = {
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 14,
      items: [...queuedItems, validItem({ index: 5 })],
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects language: EN (LearningLanguageEnum is ES/DE/TR only)', () => {
    const payload = {
      language: Language.EN,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown status value on an item', () => {
    const payload = {
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: [...queuedItems.slice(0, 4), { ...queuedItems[4], status: 'skipped' }],
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO generatedAt string', () => {
    const payload = {
      language: Language.ES,
      generatedAt: 'not-a-date',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects negative totalEstimatedMinutes', () => {
    const payload = {
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: -1,
      items: queuedItems,
      summary: null,
      code: null,
    };
    const result = TodayPlanResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe('TodayPlanItemSchema', () => {
  it('rejects index 0 (1-based)', () => {
    const result = TodayPlanItemSchema.safeParse(validItem({ index: 0 }));
    expect(result.success).toBe(false);
  });

  it('rejects index 6 (max 5)', () => {
    const result = TodayPlanItemSchema.safeParse(validItem({ index: 6 }));
    expect(result.success).toBe(false);
  });

  it('rejects estimatedMinutes 0 (must be ≥ 1)', () => {
    const result = TodayPlanItemSchema.safeParse(
      validItem({ estimatedMinutes: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts topicHint: null', () => {
    const result = TodayPlanItemSchema.safeParse(validItem({ topicHint: null }));
    expect(result.success).toBe(true);
  });
});
