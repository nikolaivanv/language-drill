import { describe, it, expect, vi } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { ClozeContent, TranslationContent } from '@language-drill/shared';
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
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_TOOL_NAME,
  rowSurfaceFor,
  buildClassificationUserPrompt,
  parseRowClassifications,
  classifyRowBatch,
  DEFAULT_CLASSIFICATION_BATCH_SIZE,
  PROPOSAL_TOOL_NAME,
  buildProposalUserPrompt,
  parseMechanismProposal,
  proposeMechanism,
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

  // Both TR enumeration faults in the 2026-08-21 sweep were a capital I:
  // 'ordinal-suffix-incI' (tr-a1-numbers-ordinals) and
  // 'past-necessitative-maliydI' (tr-b2-compound-past-hikaye). Turkish
  // morphological notation writes suffixes with capitals (-(I)ncI, -mAlIydI),
  // so the model reproduces them in the id and the whole point's enumeration is
  // lost. An id is an identifier — case carries no meaning — so normalize
  // rather than reject.
  it('normalizes a capitalized id to lower case instead of rejecting it', () => {
    const parsed = parsePointEnumeration(
      { ...valid, constructions: [{ ...valid.constructions[0], id: 'past-necessitative-maliydI' }] },
      'tr-b2-compound-past-hikaye',
    );
    expect(parsed.constructions[0].id).toBe('past-necessitative-maliydi');
  });

  it('still detects duplicates that differ only in case', () => {
    expect(() =>
      parsePointEnumeration(
        {
          ...valid,
          constructions: [
            { ...valid.constructions[0], id: 'back-shift' },
            { ...valid.constructions[1], id: 'Back-Shift' },
          ],
        },
        'k',
      ),
    ).toThrow(/duplicate/);
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

  // Regression: Anthropic tool-use intermittently serializes a nested array as
  // a JSON string. This cost 3 of 114 points on the 2026-08-19 ES sweep, all
  // three with stop_reason 'tool_use' and output well under the cap — the
  // serialization, not truncation. @language-drill/shared's parseTheoryTopicJson
  // has defended against the same behaviour for theory generation since 2026-05.
  it('decodes a constructions array that arrived as a JSON string', () => {
    const parsed = parsePointEnumeration(
      { mechanism: 'construction-variants', constructions: JSON.stringify(valid.constructions) },
      'k',
    );
    expect(parsed.constructions).toHaveLength(2);
    expect(parsed.constructions[0].id).toBe('backshift');
  });

  it('still rejects a string that does not decode to an array', () => {
    expect(() =>
      parsePointEnumeration({ mechanism: 'none', constructions: 'not json at all' }, 'k'),
    ).toThrow(/constructions must be an array/);
    expect(() =>
      parsePointEnumeration({ mechanism: 'none', constructions: '{"a":1}' }, 'k'),
    ).toThrow(/constructions must be an array/);
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
  it('requires ASCII kebab-case ids and meaning-based disambiguation', () => {
    // Two enumeration failures on the 2026-08-19 ES sweep were ids carrying
    // accented characters ('tu-tú', 'invariable-adjective-estándar-gratis').
    // Every committed constructionVariants id is ASCII, and ids become
    // content_json.seedWord values and coverage keys, so the convention is
    // enforced in the prompt rather than relaxed in the parser.
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('ASCII kebab-case');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('disambiguate them by MEANING');
  });

  it('states the three-part mustRepresent test', () => {
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Distinct form');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Actually claimed');
    expect(CONSTRUCTION_ENUMERATION_SYSTEM_PROMPT).toContain('Cell-realizable');
  });
});

describe('rowSurfaceFor', () => {
  // These fixtures are pinned to the SHARED content types with `satisfies`, not
  // written as free-form literals. The first version of this suite used
  // `sourceText` for cloze — which is the TRANSLATION field; the real one is
  // `ClozeContent.sentence`. The tests passed and every real cloze row
  // surfaced as null in production, so the whole cloze half of the audit
  // classified as unresolved and silently produced no findings. Pinning the
  // field names means a future rename breaks the build instead of the sweep.
  const clozeFields = {
    sentence: 'Dijo que ___ cansada.',
    correctAnswer: 'estaba',
  } satisfies Pick<ClozeContent, 'sentence' | 'correctAnswer'>;

  const translationFields = {
    sourceText: 'She said she was tired.',
    referenceTranslation: 'Dijo que estaba cansada.',
  } satisfies Pick<TranslationContent, 'sourceText' | 'referenceTranslation'>;

  it('renders a cloze from the sentence plus the answer', () => {
    const s = rowSurfaceFor(ExerciseType.CLOZE, { ...clozeFields });
    expect(s).toContain('Dijo que ___ cansada.');
    expect(s).toContain('estaba');
  });

  it('does not read the translation stem field for a cloze', () => {
    // Regression guard for the production defect described above.
    expect(rowSurfaceFor(ExerciseType.CLOZE, { sourceText: 'x', correctAnswer: 'y' })).toBeNull();
  });

  it('renders a translation as source plus reference', () => {
    const s = rowSurfaceFor(ExerciseType.TRANSLATION, { ...translationFields });
    expect(s).toContain('She said she was tired.');
    expect(s).toContain('Dijo que estaba cansada.');
  });

  it('returns null when the fields are missing or not strings', () => {
    expect(rowSurfaceFor(ExerciseType.CLOZE, {})).toBeNull();
    expect(rowSurfaceFor(ExerciseType.CLOZE, { sentence: 5, correctAnswer: 'x' })).toBeNull();
  });
});

describe('buildClassificationUserPrompt', () => {
  const constructions: ClaimedConstruction[] = [
    { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, rationale: 'why' },
    { id: 'command', label: 'que + present subjunctive', mustRepresent: true, rationale: 'why' },
  ];

  it('lists the rows with 1-based indices', () => {
    const prompt = buildClassificationUserPrompt({
      constructions,
      type: ExerciseType.CLOZE,
      rows: [
        { id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } },
        { id: 'b', content: { sourceText: 'p ___', correctAnswer: 'q' } },
      ],
    });
    expect(prompt).toContain('1.');
    expect(prompt).toContain('2.');
  });

  // The spec: the classifier sees only the labels, so it classifies what a row
  // IS rather than what the enumerator hoped to find.
  it('does not leak the enumerator rationale', () => {
    const prompt = buildClassificationUserPrompt({
      constructions,
      type: ExerciseType.CLOZE,
      rows: [{ id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } }],
    });
    expect(prompt).not.toContain('why');
  });
});

describe('parseRowClassifications', () => {
  const validIds = new Set(['backshift', 'command']);

  it('maps ids through and nulls out none/unclear', () => {
    const parsed = parseRowClassifications(
      {
        classifications: [
          { index: 1, constructionId: 'backshift' },
          { index: 2, constructionId: 'none' },
          { index: 3, constructionId: 'unclear' },
        ],
      },
      3,
      validIds,
    );
    expect(parsed.map((p) => p.constructionId)).toEqual(['backshift', null, null]);
  });

  it('nulls out an id that was never enumerated rather than trusting it', () => {
    const parsed = parseRowClassifications(
      { classifications: [{ index: 1, constructionId: 'invented' }] },
      1,
      validIds,
    );
    expect(parsed[0].constructionId).toBeNull();
  });

  it('nulls out any row the model omitted', () => {
    const parsed = parseRowClassifications(
      { classifications: [{ index: 1, constructionId: 'backshift' }] },
      3,
      validIds,
    );
    expect(parsed).toHaveLength(3);
    expect(parsed[1].constructionId).toBeNull();
    expect(parsed[2].constructionId).toBeNull();
  });

  it('rejects an out-of-range index', () => {
    expect(() =>
      parseRowClassifications({ classifications: [{ index: 9, constructionId: 'backshift' }] }, 3, validIds),
    ).toThrow(/index/);
  });
});

describe('classifyRowBatch', () => {
  it('forces the tool and returns classifications plus usage', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: { classifications: [{ index: 1, constructionId: 'backshift' }] },
        },
      ],
      usage: { input_tokens: 200, output_tokens: 30 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { classifications, usage } = await classifyRowBatch(client, {
      constructions: [
        { id: 'backshift', label: 'a', mustRepresent: true, rationale: 'r' },
      ],
      type: ExerciseType.CLOZE,
      rows: [{ id: 'a', content: { sourceText: 'x ___', correctAnswer: 'y' } }],
    });

    expect(classifications).toEqual([{ constructionId: 'backshift' }]);
    expect(usage.output_tokens).toBe(30);
    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'tool',
      name: CLASSIFICATION_TOOL_NAME,
    });
  });
});

describe('CLASSIFICATION_SYSTEM_PROMPT', () => {
  it('offers none and unclear as escape hatches', () => {
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain('none');
    expect(CLASSIFICATION_SYSTEM_PROMPT).toContain('unclear');
  });

  it('batches at a size that keeps the system block cacheable', () => {
    expect(DEFAULT_CLASSIFICATION_BATCH_SIZE).toBe(20);
  });
});

const proposalInput = {
  grammarPoint: gp,
  mechanism: 'construction-variants' as const,
  counts: [
    { id: 'backshift', label: 'dijo que + imperfect', mustRepresent: true, count: 23, share: 0.96 },
    { id: 'command', label: 'que + present subjunctive', mustRepresent: true, count: 1, share: 0.04 },
  ],
  sampled: 24,
};

describe('buildProposalUserPrompt', () => {
  it('shows each construction with its measured realized count', () => {
    const prompt = buildProposalUserPrompt(proposalInput);
    expect(prompt).toContain('23');
    expect(prompt).toContain('1');
    expect(prompt).toContain('24');
  });
});

describe('parseMechanismProposal', () => {
  it('accepts a construction-variants proposal', () => {
    const parsed = parseMechanismProposal({
      mechanism: 'construction-variants',
      snippet: 'constructionVariants: [...]',
      notes: 'Split by reporting-verb tense zone.',
    });
    expect(parsed.mechanism).toBe('construction-variants');
    expect(parsed.snippet).toContain('constructionVariants');
  });

  it('rejects an empty snippet', () => {
    expect(() =>
      parseMechanismProposal({ mechanism: 'coverage-spec', snippet: '  ', notes: 'n' }),
    ).toThrow(/snippet/);
  });

  it('rejects the none mechanism — there is nothing to propose', () => {
    expect(() =>
      parseMechanismProposal({ mechanism: 'none', snippet: 'x', notes: 'n' }),
    ).toThrow(/mechanism/);
  });
});

describe('proposeMechanism', () => {
  it('forces the proposal tool', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          input: {
            mechanism: 'construction-variants',
            snippet: 'constructionVariants: [...]',
            notes: 'n',
          },
        },
      ],
      usage: { input_tokens: 300, output_tokens: 200 },
      stop_reason: 'tool_use',
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { proposal } = await proposeMechanism(client, proposalInput);

    expect(proposal.snippet).toContain('constructionVariants');
    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'tool',
      name: PROPOSAL_TOOL_NAME,
    });
  });
});
