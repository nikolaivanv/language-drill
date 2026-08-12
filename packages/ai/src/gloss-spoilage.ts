/**
 * Gloss-spoilage audit (2026-08-12 design). In-repo prompt + forced tool + pure
 * parser, mirroring `collapse-triage.ts`. NOT a runtime Lambda path and NOT
 * registered in Langfuse — a dev-time aid run by a human via the `audit:gloss`
 * CLI. Do NOT add it to the PROMPTS manifest in `bootstrap-prompts.ts`. Bump the
 * version constant on prompt edits.
 *
 * Two judgements, deliberately separate:
 *   - `triageGlossPoint` — does English even MARK the distinction this point's
 *     blanks test? "The coffee is on the table" cannot leak ser vs estar, so a
 *     whole point can be excluded on one call.
 *   - `judgeGlossRow` — does THIS row's gloss state the rule trigger/outcome?
 *     A parenthetical can leak inside an otherwise-safe point.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { GrammarPoint } from '@language-drill/shared';

export const GLOSS_SPOILAGE_PROMPT_VERSION = 'gloss-spoilage@2026-08-12';
export const GLOSS_SPOILAGE_TOOL_NAME = 'report_point_triage';
export const GLOSS_ROW_TOOL_NAME = 'report_gloss_verdict';
export const GLOSS_SPOILAGE_MODEL = 'claude-sonnet-4-6';
export const GLOSS_SPOILAGE_MAX_TOKENS = 1024;
export const GLOSS_SPOILAGE_TEMPERATURE = 0.2;

const VERDICTS = ['spoiled', 'legitimate', 'borderline'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

export type GlossVerdictName = (typeof VERDICTS)[number];
export type GlossConfidence = (typeof CONFIDENCES)[number];

/** Signal 2: does English mark the distinction this point's blanks test? */
export type PointTriageVerdict = {
  englishEncodesDistinction: boolean;
  reasoning: string;
  confidence: GlossConfidence;
};

/** Row-level judgement. */
export type GlossVerdict = {
  verdict: GlossVerdictName;
  /** The exact substring that leaks, or null when nothing does. */
  offendingSpan: string | null;
  /** The gloss as it should read, or null when dropping the gloss is safe. */
  proposedGloss: string | null;
  /** True when the offending span is the only thing forcing the reading —
   * removing it (rather than replacing it) would make the blank ambiguous. */
  loadBearing: boolean;
  reasoning: string;
  confidence: GlossConfidence;
};

export type PointTriageInput = {
  grammarPoint: GrammarPoint;
  language: string;
  cefrLevel: string;
  sampleGlosses: readonly string[];
};

export type GlossRowInput = {
  grammarPoint: GrammarPoint;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  acceptableAnswers: readonly string[] | null;
  instructions: string;
  glossEn: string;
};

export const GLOSS_SPOILAGE_SYSTEM_PROMPT = `You audit a pre-generated cloze exercise pool for a defect in the English gloss shown to the learner alongside the sentence.

A cloze \`glossEn\` is an English gloss of the sentence's meaning. The generator is instructed to use it as a disambiguation device — a way to force a reading that a short L2 sentence cannot force on its own. But the generator is also forbidden from leaking the answer:

A gloss may convey MEANING that the learner must still convert into a form. It may NOT state the rule's TRIGGER or OUTCOME.

You are shown one point. Decide whether English even marks the distinction this point's blanks test at all — if it does not, no gloss for this point can leak the tested distinction (though a parenthetical could still separately leak something else, which is judged row by row).

Worked examples:
- es-a1-ser-estar-basic: English "is" collapses ser and estar into one word, so englishEncodesDistinction is FALSE — the gloss "The coffee is on the table" cannot leak which copula is correct.
- es-a1-demonstratives: English marks near/far deixis ("this" vs "that", or an explicit "(far away)"), so englishEncodesDistinction is TRUE.

"legitimate" (i.e. englishEncodesDistinction: false) is the DEFAULT WHEN YOU ARE UNSURE — a false positive here sends a row-level judgement pass over rows that could not possibly leak, which just costs money; a false negative in the other direction (missing that English DOES mark the distinction) risks excluding a point whose rows should be checked. When genuinely unsure, prefer the reading that keeps a point excluded only when you are confident English cannot express the contrast.

Call the ${GLOSS_SPOILAGE_TOOL_NAME} tool. Keep the reasoning to one sentence.`;

export function buildPointTriageUserPrompt(input: PointTriageInput): string {
  const { grammarPoint: gp } = input;
  return `Grammar point: ${gp.name} (${gp.key}, ${input.language} ${input.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}
Negative examples: ${gp.examplesNegative.join(' | ')}
Common errors: ${gp.commonErrors.join(' | ')}

Sample glosses from this point's approved pool:
${input.sampleGlosses.map((g) => `- ${g}`).join('\n')}

Does English mark the distinction this point's blanks test?`;
}

export const GLOSS_SPOILAGE_TOOL: Anthropic.Tool = {
  name: GLOSS_SPOILAGE_TOOL_NAME,
  description: "Report whether English marks the distinction one grammar point's blanks test.",
  input_schema: {
    type: 'object' as const,
    properties: {
      englishEncodesDistinction: { type: 'boolean' },
      reasoning: { type: 'string', description: 'One sentence.' },
      confidence: { type: 'string', enum: [...CONFIDENCES] },
    },
    required: ['englishEncodesDistinction', 'reasoning', 'confidence'],
  },
};

export const GLOSS_ROW_SYSTEM_PROMPT = `You audit one cloze exercise row's English gloss for a defect: does it state the trigger or outcome of the grammar rule it is meant to disambiguate, rather than just conveying meaning?

The line, stated precisely: a gloss may convey MEANING the learner must still convert into a form. It may NOT state the rule's TRIGGER or OUTCOME.

Legitimate glosses (do not flag these) — they supply meaning the learner still has to convert into a form:
| Gloss | Answer | Why it is fine |
|---|---|---|
| "The book belongs to the teacher (female)." | der | Gender given; the learner still supplies the dative form |
| "Could you (formal) please tell me…" | Könnten | Register given; the form is the tested skill |
| "Do you (all) see each other every day…" | euch | Addressee number given; the reflexive form is not |
| "I have two Spanish friends (female)…" | españolas | Gender given; the agreement is the skill |

Spoiled glosses (flag these) — they state the rule's trigger or outcome in English:
| Gloss | Answer | What it leaks |
|---|---|---|
| "Today the weather is very bad. (a current condition)" | está | Names estar's trigger |
| "It is without salt (right now)." | Está | Same |
| "She is very happy today. (temporary feeling)" | Está | Same |
| "This building is very old (it has always been old — it's ancient)." | es | Names ser's trigger |
| "The paper is (located) on the table." | está | Names estar's semantic role |
| "My sister is (standing/sitting) next to the window." | está | Same |
| "Do you see that tree (far away) over there?" | aquel | Names the deictic distance |
| "That dog over there (far away) is very big." | Aquel | Same |
| "This lady (near me) is very kind." | Esta | Same |
| "I like tomatoes (tomatoes in general)." | los | Names the generic trigger for the definite article |

Return one of three verdicts:
- "spoiled" — the gloss states the rule's trigger or outcome. Requires a non-empty offendingSpan: the exact substring that leaks.
- "legitimate" — the gloss conveys meaning only; nothing offends. offendingSpan and proposedGloss must both be null.
- "borderline" — you cannot confidently resolve it either way. offendingSpan and proposedGloss are optional.

"legitimate" is the DEFAULT WHEN YOU ARE UNSURE, mirroring how a good-faith reading favors the non-defect verdict elsewhere in this codebase. The asymmetry is deliberate: a false positive here causes a good disambiguating gloss to be trimmed, which silently turns a sound exercise into an ambiguous one. Only call "spoiled" when the leaked span genuinely names the rule's trigger or outcome, not merely when the gloss contains a parenthetical.

When you call "spoiled", also decide loadBearing: true when the offending span is the ONLY thing forcing the intended reading, so simply deleting it (rather than replacing it) would make the blank ambiguous — such rows need the sentence rewritten, which is authoring work, not a data edit, so proposedGloss must be non-null (either a rewritten gloss, or the original minus the offending span, whichever keeps the row from becoming ambiguous). When loadBearing is false, proposedGloss may be null to mean "drop the gloss entirely" or a rewritten gloss with the offending span removed.

Call the ${GLOSS_ROW_TOOL_NAME} tool. Keep the reasoning to one sentence.`;

export function buildGlossRowUserPrompt(input: GlossRowInput): string {
  const { grammarPoint: gp } = input;
  return `Grammar point: ${gp.name} (${gp.key}, ${input.language} ${input.cefrLevel})
Description: ${gp.description}

Sentence: ${input.sentence}
Correct answer: ${input.correctAnswer}
Other acceptable answers: ${input.acceptableAnswers?.length ? input.acceptableAnswers.join(', ') : '(none)'}
Instructions shown to the learner: ${input.instructions}
Gloss shown to the learner: ${input.glossEn}

Does this gloss state the rule's trigger or outcome, or does it only convey meaning?`;
}

export const GLOSS_ROW_TOOL: Anthropic.Tool = {
  name: GLOSS_ROW_TOOL_NAME,
  description: 'Report the spoilage verdict for one row\'s gloss.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      offendingSpan: {
        type: ['string', 'null'],
        description: 'The exact leaking substring. Required non-empty when verdict is "spoiled"; must be null when "legitimate".',
      },
      proposedGloss: {
        type: ['string', 'null'],
        description: 'The gloss as it should read, or null to drop it entirely. Must be non-null when loadBearing is true.',
      },
      loadBearing: {
        type: 'boolean',
        description: 'True when the offending span is the only thing forcing the reading, so it cannot simply be deleted.',
      },
      reasoning: { type: 'string', description: 'One sentence.' },
      confidence: { type: 'string', enum: [...CONFIDENCES] },
    },
    required: ['verdict', 'offendingSpan', 'proposedGloss', 'loadBearing', 'reasoning', 'confidence'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure validator for the point-triage tool output. Throws on any illegality —
 * the CLI catches per point and records the failure rather than aborting the
 * run.
 */
export function parsePointTriageVerdict(input: unknown): PointTriageVerdict {
  if (!isObject(input)) throw new Error('verdict must be an object');

  const englishEncodesDistinction = input.englishEncodesDistinction;
  if (typeof englishEncodesDistinction !== 'boolean') {
    throw new Error('englishEncodesDistinction must be a boolean');
  }
  const reasoning = input.reasoning;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    throw new Error('reasoning must be a non-empty string');
  }
  const confidence = input.confidence;
  if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
    throw new Error(`unknown confidence '${String(confidence)}'`);
  }

  return {
    englishEncodesDistinction,
    reasoning: reasoning.trim(),
    confidence: confidence as GlossConfidence,
  };
}

/**
 * Pure validator for the row-judgement tool output. Throws on any illegality.
 *
 * The cross-field rules are the ones that matter: "spoiled" requires a
 * non-empty offendingSpan (otherwise there is nothing to point at), a
 * "legitimate" verdict forbids one (a span here means the model contradicted
 * itself), and `loadBearing: true` with `proposedGloss: null` is a
 * contradiction — dropping a load-bearing gloss makes the blank ambiguous, so
 * "just delete it" is not a valid remedy.
 */
export function parseGlossVerdict(input: unknown): GlossVerdict {
  if (!isObject(input)) throw new Error('verdict must be an object');

  const verdict = input.verdict;
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    throw new Error(`unknown verdict '${String(verdict)}'`);
  }
  const reasoning = input.reasoning;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    throw new Error('reasoning must be a non-empty string');
  }
  const confidence = input.confidence;
  if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
    throw new Error(`unknown confidence '${String(confidence)}'`);
  }
  const loadBearingRaw = input.loadBearing;
  if (typeof loadBearingRaw !== 'boolean') {
    throw new Error('loadBearing must be a boolean');
  }

  const offendingSpanRaw = input.offendingSpan;
  if (offendingSpanRaw !== null && typeof offendingSpanRaw !== 'string') {
    throw new Error('offendingSpan must be a string or null');
  }
  const proposedGlossRaw = input.proposedGloss;
  if (proposedGlossRaw !== null && typeof proposedGlossRaw !== 'string') {
    throw new Error('proposedGloss must be a string or null');
  }

  if (verdict === 'spoiled') {
    if (typeof offendingSpanRaw !== 'string' || offendingSpanRaw.trim().length === 0) {
      throw new Error("verdict 'spoiled' requires a non-empty offendingSpan");
    }
  }
  if (verdict === 'legitimate' && offendingSpanRaw !== null) {
    throw new Error("verdict 'legitimate' forbids an offendingSpan");
  }
  // Only "spoiled" carries an actionable remedy; "legitimate" always
  // normalises proposedGloss to null below regardless of loadBearing, and
  // "borderline" is deliberately permissive on these fields.
  if (verdict === 'spoiled' && loadBearingRaw && proposedGlossRaw === null) {
    throw new Error('loadBearing verdicts require a non-null proposedGloss');
  }

  const normalizedSpan = verdict === 'legitimate' ? null : offendingSpanRaw;
  const normalizedProposal = verdict === 'legitimate' ? null : proposedGlossRaw;

  return {
    verdict: verdict as GlossVerdictName,
    offendingSpan: normalizedSpan,
    proposedGloss: normalizedProposal,
    loadBearing: loadBearingRaw,
    reasoning: reasoning.trim(),
    confidence: confidence as GlossConfidence,
  };
}

/**
 * Call Claude with the forced point-triage tool and return the validated
 * verdict plus token usage (the CLI's cost guard needs it). The system prompt
 * is cache-marked: a run triages ~70 points against an identical system
 * block, so prompt caching makes all but the first call cheap.
 */
export async function triageGlossPoint(
  client: Anthropic,
  input: PointTriageInput,
  signal?: AbortSignal,
): Promise<{ verdict: PointTriageVerdict; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: GLOSS_SPOILAGE_MODEL,
      max_tokens: GLOSS_SPOILAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: GLOSS_SPOILAGE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildPointTriageUserPrompt(input) }],
      tools: [GLOSS_SPOILAGE_TOOL],
      tool_choice: { type: 'tool' as const, name: GLOSS_SPOILAGE_TOOL_NAME },
      temperature: GLOSS_SPOILAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`triageGlossPoint: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { verdict: parsePointTriageVerdict(toolUse.input), usage: response.usage };
}

/**
 * Call Claude with the forced row-judgement tool and return the validated
 * verdict plus token usage. Same cache-marking rationale as `triageGlossPoint`
 * — a run judges up to ~1,568 rows against an identical system block.
 */
export async function judgeGlossRow(
  client: Anthropic,
  input: GlossRowInput,
  signal?: AbortSignal,
): Promise<{ verdict: GlossVerdict; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: GLOSS_SPOILAGE_MODEL,
      max_tokens: GLOSS_SPOILAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: GLOSS_ROW_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildGlossRowUserPrompt(input) }],
      tools: [GLOSS_ROW_TOOL],
      tool_choice: { type: 'tool' as const, name: GLOSS_ROW_TOOL_NAME },
      temperature: GLOSS_SPOILAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`judgeGlossRow: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { verdict: parseGlossVerdict(toolUse.input), usage: response.usage };
}
