/**
 * LLM-assisted book-coverage ledger authoring (see
 * docs/superpowers/specs/2026-07-15-book-coverage-ledger-design.md).
 * In-repo prompt + forced tool + pure parser, mirroring
 * `coverage-spec-proposal.ts`. NOT a runtime Lambda path and NOT registered in
 * Langfuse — a dev-time authoring aid run by a human via the
 * `propose:book-coverage` CLI. The model PROPOSES per-section decisions; a
 * human reviews the emitted fragment and commits it into the ledger. Bump the
 * version on prompt edits.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const BOOK_COVERAGE_PROPOSAL_PROMPT_VERSION = "book-coverage@2026-07-15b";
export const PROPOSE_BOOK_COVERAGE_TOOL_NAME = "propose_book_coverage";
const PROPOSAL_MODEL = "claude-sonnet-4-6";
const PROPOSAL_MAX_TOKENS = 8192;
const PROPOSAL_TEMPERATURE = 0.2;
/** Chapters longer than this are truncated in the prompt (titles still cover all sections). */
const CHAPTER_TEXT_MAX_CHARS = 120_000;

export const BOOK_COVERAGE_PROPOSAL_SYSTEM_PROMPT_TEMPLATE = `You map sections of a reference grammar book to the grammar points of a language-learning curriculum, producing one explicit coverage decision per section.

For EVERY section you are given, decide exactly one of:
- "points": the listed curriculum keys whose topic TEACHES this section's content.
- "excluded": a short reason this section is a conscious skip.
- "gap": the section is core A1–B2 production grammar, but NO listed point teaches it — a real curriculum gap a human must triage.

Rules:
- Claim at the CONSTRUCTION level, not the form level. A point that teaches a verb form does not cover a section about a multi-clause construction using that form. (Historical failure this ledger exists to prevent: a "conditional tense" point and a "past subjunctive" point both existed, so the "remote conditionals" section — si + imperfect subjunctive → conditional — looked covered while no point taught the construction. That section was a gap.)
- Only claim keys from the provided curriculum list, and only when the point's name/description actually covers the section — never claim by topical adjacency.
- Excluded reasons are short but real. Use these categories where they fit: 'C1+', 'regional/dialectal', 'receptive-only', 'lexical, not grammatical', 'chapter intro', 'front matter', or 'folded into <key>' when another point's description or commonErrors explicitly absorbs it.
- When unsure between "excluded" and "gap", prefer "gap" — a false gap costs one minute of human review; a false exclusion hides a hole permanently.
- Decide every section you are given, including the chapter heading itself ('chapter intro' is a fine exclusion when the content lives in subsections).
- Set exactly ONE of points / excluded / gap per section — never two or three together.
- Do not invent sections or anchors.

Call the ${PROPOSE_BOOK_COVERAGE_TOOL_NAME} tool with one decision per section.`;

export type BookCoverageProposalInput = {
  /** Human-readable book identification shown to the model. */
  book: string;
  /** e.g. 'Spanish' */
  languageName: string;
  /** The chapter's sections, in book order, including the chapter anchor itself. */
  sections: readonly { anchor: string; title: string }[];
  /** Full markdown of the chapter (truncated if enormous). */
  chapterMarkdown: string;
  /** One line per curriculum point: `key — name (CEFR): description`. */
  curriculumSummary: string;
  /** The claimable curriculum keys (authoritative; the summary is display-only). */
  curriculumKeys: readonly string[];
};

export function buildBookCoverageProposalUserPrompt(
  input: BookCoverageProposalInput,
): string {
  const truncated =
    input.chapterMarkdown.length > CHAPTER_TEXT_MAX_CHARS
      ? `${input.chapterMarkdown.slice(0, CHAPTER_TEXT_MAX_CHARS)}\n\n[... chapter text truncated ...]`
      : input.chapterMarkdown;
  const sectionLines = input.sections
    .map((s) => `- ${s.anchor}: ${s.title}`)
    .join("\n");
  return `Book: ${input.book}
Curriculum language: ${input.languageName}

Sections to decide (use these anchors exactly):
${sectionLines}

Curriculum grammar points (the ONLY claimable keys):
${input.curriculumSummary}

Chapter text:
${truncated}`;
}

export const PROPOSE_BOOK_COVERAGE_TOOL: Anthropic.Tool = {
  name: PROPOSE_BOOK_COVERAGE_TOOL_NAME,
  description: "Submit one coverage decision per book section.",
  input_schema: {
    type: "object" as const,
    properties: {
      sections: {
        type: "array",
        description:
          "One entry per section, in book order. Exactly one of points / excluded / gap per entry.",
        items: {
          type: "object",
          properties: {
            anchor: { type: "string", description: "The section anchor, verbatim." },
            points: {
              type: "array",
              items: { type: "string" },
              description: "Curriculum keys that teach this section's content.",
            },
            excluded: { type: "string", description: "Short reason for a conscious skip." },
            gap: {
              type: "string",
              description:
                "One-line rationale for why this is core A1–B2 content with no owning point.",
            },
          },
          required: ["anchor"],
        },
      },
    },
    required: ["sections"],
  },
};

export type BookCoverageSectionProposal =
  | { anchor: string; points: string[] }
  | { anchor: string; excluded: string }
  | { anchor: string; gap: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pure validator for the tool output. Throws on any illegality; unknown
 * anchors/keys are illegal so hallucinations never reach the ledger fragment.
 */
export function parseBookCoverageProposal(
  input: unknown,
  allowedAnchors: ReadonlySet<string>,
  allowedKeys: ReadonlySet<string>,
): BookCoverageSectionProposal[] {
  if (!isObject(input) || !Array.isArray(input.sections)) {
    throw new Error("proposal must be an object with a `sections` array");
  }
  const seen = new Set<string>();
  const out: BookCoverageSectionProposal[] = [];
  for (const raw of input.sections) {
    if (!isObject(raw) || typeof raw.anchor !== "string") {
      throw new Error("each section must be an object with a string `anchor`");
    }
    const anchor = raw.anchor;
    if (!allowedAnchors.has(anchor)) throw new Error(`unknown anchor '${anchor}'`);
    if (seen.has(anchor)) throw new Error(`duplicate decision for anchor '${anchor}'`);
    seen.add(anchor);
    // Precedence gap > points > excluded when the model hedges with several
    // kinds on one section: a gap is a review flag, so keeping it loses
    // nothing, whereas throwing dead-loops the retry (observed on a real
    // Hammer ch. 11 run). A null or blank-string kind is treated as absent —
    // models also hedge with `"gap": null` next to a real claim (observed on
    // B&B ch. 8), which must not shadow it. Zero kinds is still an error.
    const kinds = (["gap", "points", "excluded"] as const).filter((k) => {
      const value = raw[k];
      if (value === undefined || value === null) return false;
      return !(typeof value === "string" && value.trim().length === 0);
    });
    if (kinds.length === 0) {
      throw new Error(`anchor '${anchor}' has no decision (points/excluded/gap)`);
    }
    if (kinds[0] === "points") {
      if (
        !Array.isArray(raw.points) ||
        raw.points.length === 0 ||
        raw.points.some((k) => typeof k !== "string")
      ) {
        throw new Error(`anchor '${anchor}' points must be a non-empty string array`);
      }
      for (const key of raw.points as string[]) {
        if (!allowedKeys.has(key)) {
          throw new Error(`anchor '${anchor}' claims unknown curriculum key '${key}'`);
        }
      }
      out.push({ anchor, points: raw.points as string[] });
    } else {
      const reason = raw[kinds[0]];
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error(`anchor '${anchor}' ${kinds[0]} reason must be a non-empty string`);
      }
      out.push(
        kinds[0] === "excluded" ? { anchor, excluded: reason } : { anchor, gap: reason },
      );
    }
  }
  return out;
}

/**
 * Render the paste-ready ledger fragment. `gap` decisions become commented
 * lines: they are NOT ledger decisions — the human either authors the missing
 * point or downgrades the row to an exclusion. `excludedSubtree` is never
 * proposed (a human-only compression applied during review).
 */
export function renderBookCoverageFragment(
  proposals: readonly BookCoverageSectionProposal[],
): string {
  const lines = proposals.map((p) => {
    if ("points" in p) {
      const keys = p.points.map((k) => `'${k}'`).join(", ");
      return `  '${p.anchor}': { points: [${keys}] },`;
    }
    if ("excluded" in p) {
      return `  '${p.anchor}': { excluded: '${p.excluded.replace(/'/g, "\\'")}' },`;
    }
    return `  // GAP '${p.anchor}': ${p.gap} — author a point or exclude with a reason.`;
  });
  return lines.join("\n");
}

/** Call Claude with the forced tool and return the validated proposals. */
export async function proposeBookCoverage(
  client: Anthropic,
  input: BookCoverageProposalInput,
  signal?: AbortSignal,
): Promise<BookCoverageSectionProposal[]> {
  const response = await client.messages.create(
    {
      model: PROPOSAL_MODEL,
      max_tokens: PROPOSAL_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: BOOK_COVERAGE_PROPOSAL_SYSTEM_PROMPT_TEMPLATE,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [
        { role: "user" as const, content: buildBookCoverageProposalUserPrompt(input) },
      ],
      tools: [PROPOSE_BOOK_COVERAGE_TOOL],
      tool_choice: { type: "tool" as const, name: PROPOSE_BOOK_COVERAGE_TOOL_NAME },
      temperature: PROPOSAL_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`proposal: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  const allowedAnchors = new Set(input.sections.map((s) => s.anchor));
  return parseBookCoverageProposal(
    toolUse.input,
    allowedAnchors,
    new Set(input.curriculumKeys),
  );
}
