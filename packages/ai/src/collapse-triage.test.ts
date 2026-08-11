import { describe, it, expect, vi } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildTriageUserPrompt,
  parseTriageVerdict,
  COLLAPSE_TRIAGE_SYSTEM_PROMPT,
  COLLAPSE_TRIAGE_TOOL,
  triageCell,
  COLLAPSE_TRIAGE_TOOL_NAME,
  COLLAPSE_TRIAGE_MODEL,
} from './collapse-triage.js';

const gp: GrammarPoint = {
  key: 'de-b1-um-zu-damit',
  kind: 'grammar',
  name: 'Purpose clauses: um … zu vs. damit',
  description: 'Purpose clauses with um … zu (same subject) and damit (different subject).',
  cefrLevel: 'B1',
  language: 'DE',
  examplesPositive: ['Ich lerne, um zu bestehen.', 'Ich helfe, damit du Zeit hast.'],
  examplesNegative: ['*Ich lerne, um ich bestehe.'],
  commonErrors: ['Using damit when the subject is shared.'],
} as GrammarPoint;

const input = {
  grammarPoint: gp,
  exerciseType: ExerciseType.CLOZE,
  approved: 50,
  target: 50,
  signal: 'answer-surface' as const,
  surface: {
    topSurface: 'damit',
    topCount: 49,
    total: 50,
    share: 0.98,
    distribution: [
      { surface: 'damit', count: 49 },
      { surface: 'um', count: 1 },
    ],
  },
  monotony: null,
};

describe('buildTriageUserPrompt', () => {
  it('includes the point text the verdict depends on', () => {
    const p = buildTriageUserPrompt(input);
    expect(p).toContain('de-b1-um-zu-damit');
    expect(p).toContain('Purpose clauses with um … zu');
    expect(p).toContain('Ich lerne, um zu bestehen.');
    expect(p).toContain('Using damit when the subject is shared.');
  });

  it('includes the observed distribution with counts and the share', () => {
    const p = buildTriageUserPrompt(input);
    expect(p).toContain('damit: 49');
    expect(p).toContain('98%');
  });

  it('states the declared config so the model cannot recommend a duplicate axis', () => {
    const withSpec = buildTriageUserPrompt({
      ...input,
      grammarPoint: {
        ...gp,
        coverageSpec: { axes: [{ name: 'polarity', floors: { affirmative: 10, negative: 8 } }] },
      } as GrammarPoint,
    });
    expect(withSpec).toContain('polarity');
    expect(buildTriageUserPrompt(input)).toContain('none declared');
  });
});

describe('COLLAPSE_TRIAGE_SYSTEM_PROMPT', () => {
  it('names the legitimate-concentration default and its worked examples', () => {
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('legitimate-concentration');
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('es-a2-personal-a');
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('es-b1-ser-location-events');
  });

  it('warns against recommending an axis a variant already hard-codes', () => {
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('constructionVariants');
  });
});

describe('parseTriageVerdict', () => {
  it('accepts a well-formed collapsed verdict recommending construction variants', () => {
    const v = parseTriageVerdict({
      verdict: 'collapsed',
      mechanism: 'construction-variants',
      missingConstructions: ['um … zu, same subject'],
      rationale: 'The point is the um-zu/damit contrast; um…zu is never drilled.',
      confidence: 'high',
    });
    expect(v.verdict).toBe('collapsed');
    expect(v.mechanism).toBe('construction-variants');
    expect(v.missingConstructions).toEqual(['um … zu, same subject']);
  });

  it('accepts a coverage-spec verdict carrying a legal axis', () => {
    const v = parseTriageVerdict({
      verdict: 'collapsed',
      mechanism: 'coverage-spec',
      axis: 'person',
      rationale: 'Every approved row is 3sg on a point claiming a full paradigm.',
      confidence: 'medium',
    });
    expect(v.axis).toBe('person');
  });

  it('accepts a dismissal without a mechanism', () => {
    const v = parseTriageVerdict({
      verdict: 'legitimate-concentration',
      rationale: 'The marker is the point; no other answer exists.',
      confidence: 'high',
    });
    expect(v.mechanism).toBeUndefined();
  });

  it('rejects an unknown verdict', () => {
    expect(() => parseTriageVerdict({ verdict: 'maybe', rationale: 'x', confidence: 'low' })).toThrow(
      /verdict/,
    );
  });

  it('rejects a collapsed verdict with no mechanism — the finding would not be actionable', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'collapsed', rationale: 'x', confidence: 'low' }),
    ).toThrow(/mechanism/);
  });

  it('rejects an axis on a non-coverage-spec mechanism', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'seed-pool',
        axis: 'person',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects a coverage-spec mechanism with no axis', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'coverage-spec',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects an unknown axis', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'coverage-spec',
        axis: 'tense',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects a missing or empty rationale', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'metric-artifact', rationale: '', confidence: 'low' }),
    ).toThrow(/rationale/);
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'metric-artifact', rationale: 'x', confidence: 'certain' }),
    ).toThrow(/confidence/);
  });

  it('rejects a non-object', () => {
    expect(() => parseTriageVerdict(null)).toThrow();
    expect(() => parseTriageVerdict([])).toThrow();
  });
});

describe('COLLAPSE_TRIAGE_TOOL', () => {
  it('forces the four fields the parser requires', () => {
    expect(COLLAPSE_TRIAGE_TOOL.input_schema.required).toEqual(['verdict', 'rationale', 'confidence']);
  });
});

const fakeClient = (content: unknown[], stopReason = 'tool_use') =>
  ({
    messages: {
      create: vi.fn().mockResolvedValue({ content, stop_reason: stopReason, usage: { input_tokens: 900, output_tokens: 120 } }),
    },
  }) as unknown as Anthropic;

describe('triageCell', () => {
  const toolUse = {
    type: 'tool_use',
    name: COLLAPSE_TRIAGE_TOOL_NAME,
    id: 't1',
    input: {
      verdict: 'collapsed',
      mechanism: 'construction-variants',
      missingConstructions: ['um … zu'],
      rationale: 'um…zu is never drilled.',
      confidence: 'high',
    },
  };

  it('forces the tool and returns the parsed verdict plus usage', async () => {
    const client = fakeClient([toolUse]);
    const { verdict, usage } = await triageCell(client, input);
    expect(verdict.mechanism).toBe('construction-variants');
    expect(usage.input_tokens).toBe(900);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(COLLAPSE_TRIAGE_MODEL);
    expect(call.tool_choice).toEqual({ type: 'tool', name: COLLAPSE_TRIAGE_TOOL_NAME });
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws a diagnostic error when no tool_use block comes back', async () => {
    await expect(triageCell(fakeClient([{ type: 'text', text: 'hm' }], 'end_turn'), input)).rejects.toThrow(
      /no tool_use block .*end_turn/,
    );
  });

  it('propagates a parser error for a malformed verdict', async () => {
    const bad = { ...toolUse, input: { verdict: 'collapsed', rationale: 'x', confidence: 'low' } };
    await expect(triageCell(fakeClient([bad]), input)).rejects.toThrow(/mechanism/);
  });
});
