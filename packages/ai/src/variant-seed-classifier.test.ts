import { describe, it, expect, vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildClassifierSystemPrompt,
  buildClassifierUserPrompt,
  parseClassifierResult,
  VARIANT_SEED_CLASSIFIER_TOOL,
  classifyVariantSeeds,
  ClassifierResultError,
  VARIANT_SEED_CLASSIFIER_TOOL_NAME,
  VARIANT_SEED_CLASSIFIER_MODEL,
  type ClassifierRow,
} from './variant-seed-classifier.js';

const gp: GrammarPoint = {
  key: 'es-b1-que-vs-cual',
  kind: 'grammar',
  name: 'qué vs cuál',
  description: 'Interrogatives qué and cuál.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['¿Qué es la democracia?', '¿Cuál prefieres?'],
  examplesNegative: ['*¿Cuál libro lees?'],
  commonErrors: ['Using cuál before a noun.'],
  constructionVariants: [
    { id: 'que-definition-of-concept', directive: 'qué asking for a definition (¿Qué es la democracia?)' },
    { id: 'cual-selection-from-set', directive: 'cuál selecting from a known set (¿Cuál prefieres?)' },
    { id: 'que-before-noun', directive: 'qué directly before a noun (¿Qué libro lees?)' },
  ],
} as GrammarPoint;

const rows: ClassifierRow[] = [
  { rowId: 'r1', prompt: '¿___ es la democracia?', answer: 'Qué' },
  { rowId: 'r2', prompt: '¿___ libro estás leyendo?', answer: 'Qué' },
];

describe('buildClassifierSystemPrompt', () => {
  it('lists every declared variant id with its directive', () => {
    const p = buildClassifierSystemPrompt(gp);
    for (const v of gp.constructionVariants!) {
      expect(p).toContain(v.id);
      expect(p).toContain(v.directive);
    }
  });

  it('includes the point name and description for context', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p).toContain('qué vs cuál');
    expect(p).toContain('Interrogatives qué and cuál.');
  });

  it('tells the model null is a valid answer and that guessing is worse', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p.toLowerCase()).toContain('null');
    expect(p.toLowerCase()).toContain('guess');
  });
});

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('buildClassifierUserPrompt', () => {
  it('includes each row id, prompt and answer', () => {
    const p = buildClassifierUserPrompt(rows);
    expect(p).toContain('r1');
    expect(p).toContain('¿___ es la democracia?');
    expect(p).toContain('Qué');
    expect(p).toContain('r2');
    expect(p).toContain('¿___ libro estás leyendo?');
  });

  it('binds each row id to ITS OWN exercise and answer', () => {
    // Presence checks alone (`toContain` each id, each sentence) all still pass
    // if the builder emitted every row's content under the NEXT row's id. That
    // off-by-one is the one link in the misattribution chain the parser cannot
    // defend: shuffled ids are still valid, unique and complete, so
    // parseClassifierResult waves them through and the CLI writes the wrong
    // variant to a real production row BY PRIMARY KEY. Assert the pairing.
    const paired: ClassifierRow[] = [
      { rowId: 'r1', prompt: '¿___ es la democracia?', answer: 'Qué' },
      { rowId: 'r2', prompt: '¿___ libro estás leyendo?', answer: 'Cuál' },
      { rowId: 'r3', prompt: '¿___ prefieres?', answer: 'Cuáles' },
    ];
    const p = buildClassifierUserPrompt(paired);
    for (const r of paired) {
      expect(p).toMatch(
        new RegExp(
          `\\[${r.rowId}\\]\\s*\\n\\s*exercise: ${escapeRe(r.prompt)}\\s*\\n\\s*answer: ${escapeRe(r.answer)}(\\s|$)`,
        ),
      );
    }
  });

  it('emits the rows in the order they were given', () => {
    const p = buildClassifierUserPrompt(rows);
    expect(p.indexOf('r1')).toBeLessThan(p.indexOf('democracia'));
    expect(p.indexOf('democracia')).toBeLessThan(p.indexOf('r2'));
    expect(p.indexOf('r2')).toBeLessThan(p.indexOf('libro'));
  });
});

describe('parseClassifierResult', () => {
  const ok = {
    assignments: [
      { rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' },
      { rowId: 'r2', variantId: 'que-before-noun', confidence: 'medium' },
    ],
  };

  it('accepts a well-formed result covering every row', () => {
    const out = parseClassifierResult(ok, gp, rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' });
  });

  it('accepts a null variantId — an unclassifiable row is a valid outcome', () => {
    const out = parseClassifierResult(
      { assignments: [
        { rowId: 'r1', variantId: null, confidence: 'low' },
        { rowId: 'r2', variantId: null, confidence: 'low' },
      ] },
      gp,
      rows,
    );
    expect(out[0].variantId).toBeNull();
  });

  it('rejects a variantId not declared on this point', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: 'hearsay-dicen-que', confidence: 'high' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/variantId/);
  });

  it('rejects a rowId that was not in the batch', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'INVENTED', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/rowId/);
  });

  it('rejects a batch with a row missing — a silent drop must not pass', () => {
    expect(() =>
      parseClassifierResult({ assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] }, gp, rows),
    ).toThrow(/missing/);
  });

  it('rejects a duplicated rowId', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'r1', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'certain' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/confidence/);
  });

  it('rejects a non-object or a missing assignments array', () => {
    expect(() => parseClassifierResult(null, gp, rows)).toThrow();
    expect(() => parseClassifierResult({}, gp, rows)).toThrow(/assignments/);
  });

  it('throws for a point with no constructionVariants', () => {
    const bare = { ...gp, constructionVariants: undefined } as GrammarPoint;
    expect(() => parseClassifierResult(ok, bare, rows)).toThrow(/constructionVariants/);
  });
});

describe('VARIANT_SEED_CLASSIFIER_TOOL', () => {
  it('requires the assignments array', () => {
    expect(VARIANT_SEED_CLASSIFIER_TOOL.input_schema.required).toEqual(['assignments']);
  });
});

const fakeClient = (content: unknown[], stopReason = 'tool_use') =>
  ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content,
        stop_reason: stopReason,
        usage: { input_tokens: 1200, output_tokens: 150 },
      }),
    },
  }) as unknown as Anthropic;

describe('classifyVariantSeeds', () => {
  const toolUse = {
    type: 'tool_use',
    name: VARIANT_SEED_CLASSIFIER_TOOL_NAME,
    id: 't1',
    input: {
      assignments: [
        { rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' },
        { rowId: 'r2', variantId: 'que-before-noun', confidence: 'high' },
      ],
    },
  };

  it('forces the tool, caches the system block, and returns assignments plus usage', async () => {
    const client = fakeClient([toolUse]);
    const { assignments, usage } = await classifyVariantSeeds(client, gp, rows);
    expect(assignments).toHaveLength(2);
    expect(usage.input_tokens).toBe(1200);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(VARIANT_SEED_CLASSIFIER_MODEL);
    expect(call.temperature).toBe(0);
    expect(call.tool_choice).toEqual({ type: 'tool', name: VARIANT_SEED_CLASSIFIER_TOOL_NAME });
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws a diagnostic error when no tool_use block comes back', async () => {
    await expect(
      classifyVariantSeeds(fakeClient([{ type: 'text', text: 'hm' }], 'end_turn'), gp, rows),
    ).rejects.toThrow(/no tool_use block .*end_turn/);
  });

  it('propagates a parser error for a malformed result', async () => {
    const bad = { ...toolUse, input: { assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] } };
    await expect(classifyVariantSeeds(fakeClient([bad]), gp, rows)).rejects.toThrow(/missing/);
  });

  it('carries the billed usage on a post-response failure so the caller can charge for it', async () => {
    // Both failure modes happened AFTER Anthropic answered, so both were paid
    // for. A caller that only accumulates usage on success under-counts cost
    // without bound as validation failures accumulate.
    const bad = { ...toolUse, input: { assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] } };
    await expect(classifyVariantSeeds(fakeClient([bad]), gp, rows)).rejects.toBeInstanceOf(
      ClassifierResultError,
    );
    await expect(classifyVariantSeeds(fakeClient([bad]), gp, rows)).rejects.toMatchObject({
      usage: { input_tokens: 1200, output_tokens: 150 },
    });
    await expect(
      classifyVariantSeeds(fakeClient([{ type: 'text', text: 'hm' }], 'end_turn'), gp, rows),
    ).rejects.toMatchObject({ usage: { input_tokens: 1200, output_tokens: 150 } });
  });
});
