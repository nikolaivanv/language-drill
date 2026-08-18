import { describe, it, expect, vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import type Anthropic from '@anthropic-ai/sdk';
import {
  pLimit,
  sampleRowsForCell,
  analyzeCell,
  FINDING_MAX_SHARE,
  JUDGE_HEALTH_MAX_UNRESOLVED_SHARE,
  type ClaimedConstruction,
  CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT,
  ENUMERATION_TOOL,
  ENUMERATION_TOOL_NAME,
  buildEnumerationUserPrompt,
  parsePointEnumeration,
  enumeratePointConstructions,
  CONSTRUCTION_COVERAGE_MODEL,
} from './construction-coverage.js';

const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}` }));

const constructions: ClaimedConstruction[] = [
  { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'r' },
  { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'r' },
  { id: 'flavour', label: 'lexical variation', mustRepresent: false, rationale: 'r' },
];

describe('pLimit', () => {
  it('never runs more than `concurrency` jobs at once', async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects a concurrency below 1', () => {
    expect(() => pLimit(0)).toThrow(/concurrency/);
  });
});

describe('sampleRowsForCell', () => {
  it('is deterministic for a given seed', () => {
    const a = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const b = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('changes with the seed', () => {
    const a = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const b = sampleRowsForCell(rows, 'seed-2', 24).map((r) => r.id);
    expect(a).not.toEqual(b);
  });

  it('caps at the requested size', () => {
    expect(sampleRowsForCell(rows, 'seed-1', 24)).toHaveLength(24);
  });

  it('returns every row when the cell is at or under the cap', () => {
    const small = rows.slice(0, 10);
    expect(sampleRowsForCell(small, 'seed-1', 24)).toHaveLength(10);
  });

  // Guards the spec's reason for hashing rather than slicing: rows arrive in
  // creation order, and consecutive rows share a generation batch, so a
  // head-of-list sample would measure one batch's habits.
  it('does not simply take the head of the input order', () => {
    const picked = sampleRowsForCell(rows, 'seed-1', 24).map((r) => r.id);
    const head = rows.slice(0, 24).map((r) => r.id);
    expect(picked).not.toEqual(head);
  });
});

describe('analyzeCell', () => {
  const classify = (counts: Record<string, number>) =>
    Object.entries(counts).flatMap(([id, n]) =>
      Array.from({ length: n }, () => ({ constructionId: id })),
    );

  it('reports a finding for a mustRepresent construction at zero', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 24 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('finding');
    expect(result.missing.map((m) => m.id)).toEqual(['command']);
  });

  it('reports a finding at or below the 5% share', () => {
    // 1/24 = 4.2% — a finding. The spec makes this cliff explicit.
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 23, command: 1 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('finding');
    expect(result.missing.map((m) => m.id)).toEqual(['command']);
  });

  it('does not report above the 5% share', () => {
    // 2/24 = 8.3% — not a finding.
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 22, command: 2 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('ok');
    expect(result.missing).toEqual([]);
  });

  it('ignores constructions that are not mustRepresent', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 12, command: 12 }),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('ok');
  });

  it('suppresses a dismissed construction', () => {
    const result = analyzeCell({
      constructions,
      classifications: classify({ backshift: 24 }),
      dismissedConstructionIds: new Set(['command']),
    });
    expect(result.status).toBe('ok');
    expect(result.missing).toEqual([]);
  });

  it('reports enumeration-suspect when too many rows are unresolved', () => {
    const result = analyzeCell({
      constructions,
      classifications: [
        ...classify({ backshift: 10 }),
        ...Array.from({ length: 10 }, () => ({ constructionId: null })),
      ],
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('enumeration-suspect');
    expect(result.missing).toEqual([]);
  });

  it('treats a fully unresolved cell as enumeration-suspect, not a finding', () => {
    const result = analyzeCell({
      constructions,
      classifications: Array.from({ length: 12 }, () => ({ constructionId: null })),
      dismissedConstructionIds: new Set<string>(),
    });
    expect(result.status).toBe('enumeration-suspect');
    expect(result.classified).toBe(0);
  });

  it('exposes the thresholds it enforces', () => {
    expect(FINDING_MAX_SHARE).toBe(0.05);
    expect(JUDGE_HEALTH_MAX_UNRESOLVED_SHARE).toBe(0.33);
  });
});

const gp: GrammarPoint = {
  key: 'es-b1-reported-speech',
  kind: 'grammar',
  name: 'Reported speech (present-to-past)',
  description: 'Reporting what someone said with dijo que + imperfect, and reported commands with que + present subjunctive.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['Dijo que estaba cansada.', 'Me dijo que viniera temprano.'],
  examplesNegative: ['*Dijo que está cansada.'],
  commonErrors: ['Failing to backshift the tense.'],
} as GrammarPoint;

describe('buildEnumerationUserPrompt', () => {
  it('includes the description and examples', () => {
    const prompt = buildEnumerationUserPrompt(gp);
    expect(prompt).toContain(gp.description);
    expect(prompt).toContain('Dijo que estaba cansada.');
  });

  // The spec's rule: stage 1 must enumerate what the point CLAIMS before
  // seeing what was built, or it rationalizes the existing distribution as
  // complete — the exact blindness that let 96/99 look fine.
  it('never mentions the pool', () => {
    const prompt = buildEnumerationUserPrompt(gp);
    expect(prompt.toLowerCase()).not.toContain('approved');
    expect(prompt.toLowerCase()).not.toContain('pool');
  });
});

describe('parsePointEnumeration', () => {
  const valid = {
    mechanism: 'construction-variants',
    constructions: [
      { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'r' },
      { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'r' },
    ],
  };

  it('accepts a well-formed enumeration', () => {
    const parsed = parsePointEnumeration(valid, 'es-b1-reported-speech');
    expect(parsed.constructions).toHaveLength(2);
    expect(parsed.grammarPointKey).toBe('es-b1-reported-speech');
  });

  it('rejects a non-kebab-case id', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [{ ...valid.constructions[0], id: 'Back Shift' }] },
        'k',
      ),
    ).toThrow(/kebab-case/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [valid.constructions[0], valid.constructions[0]] },
        'k',
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown mechanism', () => {
    expect(() => parsePointEnumeration({ ...valid, mechanism: 'vibes' }, 'k')).toThrow(/mechanism/);
  });

  it('rejects a missing rationale', () => {
    expect(() =>
      parsePointEnumeration(
        { ...valid, constructions: [{ ...valid.constructions[0], rationale: '  ' }] },
        'k',
      ),
    ).toThrow(/rationale/);
  });

  it('accepts an empty construction list', () => {
    expect(parsePointEnumeration({ mechanism: 'none', constructions: [] }, 'k').constructions)
      .toEqual([]);
  });
});

describe('enumeratePointConstructions', () => {
  it('forces the tool and returns the parsed enumeration plus usage', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: {
            mechanism: 'construction-variants',
            constructions: [
              { id: 'backshift', label: 'a', mustRepresent: true, rationale: 'r' },
              { id: 'command', label: 'b', mustRepresent: true, rationale: 'r' },
            ],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { enumeration, usage } = await enumeratePointConstructions(client, gp);

    expect(enumeration.constructions).toHaveLength(2);
    expect(usage.input_tokens).toBe(100);
    const args = create.mock.calls[0][0];
    expect(args.model).toBe(CONSTRUCTION_COVERAGE_MODEL);
    expect(args.tool_choice).toEqual({ type: 'tool', name: ENUMERATION_TOOL_NAME });
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws when no tool_use block comes back', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'nope' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        }),
      },
    } as unknown as Anthropic;

    await expect(enumeratePointConstructions(client, gp)).rejects.toThrow(/no tool_use/);
  });
});

describe('ENUMERATION_TOOL', () => {
  it('requires every field the parser enforces', () => {
    const props = ENUMERATION_TOOL.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['constructions', 'mechanism']);
  });
});

describe('CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT', () => {
  it('states the three-part mustRepresent test', () => {
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Distinct form');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Actually claimed');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Cell-realizable');
  });
});
