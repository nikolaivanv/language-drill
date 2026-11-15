/**
 * Read-only scope audit: does each theory page teach everything its curriculum
 * entry makes exercises drill?
 *
 * The exercise generator works from the grammar point's description,
 * examplesPositive, constructionVariants and coverageSpec, so a construction
 * named there but absent from the page is one a learner can be drilled on
 * without the page ever explaining it (the tr-a1-questions report of
 * 2026-11-15: either/or questions and acaba).
 *
 * Input: a directory of exported pages, `<key>.json` with the page under
 * `content` (the shape of the 2026-11 theory-audit exports). Never touches the
 * database. One Claude call per page.
 *
 *   pnpm --filter @language-drill/ai exec tsx scripts/audit-theory-scope.ts \
 *     --pages-dir /abs/pages --out /abs/report.json [--keys k1,k2] [--concurrency 8] [--max-cost-usd 25]
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getGrammarPoint } from "@language-drill/db";
import { applyShaped, extractToolUse, shapeToolRequest } from "../src/model-request.js";
import { estimateCostUsdFor } from "../src/cost-model.js";

const MODEL = "claude-sonnet-5-5";
const TOOL_NAME = "report_scope_gaps";

type Inline = { kind: string; text?: string; children?: Inline[] };
type Block = {
  kind: string;
  text?: Inline[];
  children?: Block[];
  items?: Block[][];
  head?: string[];
  rows?: string[][];
  target?: Inline[];
  en?: string;
  note?: Inline[];
};
export type Page = { title: string; subtitle: string; sections: { title: string; body: Block[] }[] };

function inl(xs: Inline[] | undefined): string {
  return (xs ?? []).map((x) => (x.kind === "text" ? x.text ?? "" : inl(x.children))).join("");
}

function block(b: Block, indent = ""): string {
  switch (b.kind) {
    case "paragraph":
      return indent + inl(b.text);
    case "callout":
      return (b.children ?? []).map((c) => block(c, indent + "> ")).join("\n");
    case "list":
      return (b.items ?? []).map((it) => it.map((c) => block(c, indent + "- ")).join("\n")).join("\n");
    case "conjugation-table":
      return [b.head ?? [], ...(b.rows ?? [])].map((r) => indent + "| " + r.join(" | ") + " |").join("\n");
    case "example":
      return `${indent}EXAMPLE: ${inl(b.target)} — "${b.en}"${b.note ? ` (${inl(b.note)})` : ""}`;
    default:
      return indent + JSON.stringify(b);
  }
}

export function renderPage(p: Page): string {
  return [
    `# ${p.title} — ${p.subtitle}`,
    ...p.sections.map((s) => `## ${s.title}\n${s.body.map((b) => block(b)).join("\n")}`),
  ].join("\n\n");
}

function renderCurriculum(key: string): string {
  const gp = getGrammarPoint(key);
  if (!gp) throw new Error(`unknown grammar point ${key}`);
  const g = gp as unknown as Record<string, unknown>;
  const lines: string[] = [
    `key: ${gp.key}`,
    `name: ${gp.name}`,
    `level: ${gp.cefrLevel}`,
    `description: ${gp.description}`,
    `examplesPositive:\n${(gp.examplesPositive ?? []).map((e) => `  - ${e}`).join("\n")}`,
  ];
  const variants = g.constructionVariants as { id: string; directive: string; share: number }[] | undefined;
  if (variants?.length) {
    lines.push(
      `constructionVariants (each is a construction the exercise generator is told to produce; share = relative frequency):\n` +
        variants.map((v) => `  - [${v.id}, share ${v.share}] ${v.directive}`).join("\n"),
    );
  }
  const spec = g.coverageSpec as { axes: { name: string; floors: Record<string, number> }[] } | undefined;
  if (spec?.axes?.length) {
    lines.push(
      `coverageSpec (exercises are spread across these values):\n` +
        spec.axes.map((a) => `  - ${a.name}: ${Object.keys(a.floors).join(", ")}`).join("\n"),
    );
  }
  if (gp.commonErrors?.length) {
    lines.push(`commonErrors:\n${gp.commonErrors.map((e) => `  - ${e}`).join("\n")}`);
  }
  return lines.join("\n");
}

const SYSTEM = `You audit language-learning theory pages for SCOPE, not accuracy.

Each grammar point has a curriculum entry. The exercise generator writes the drills for that point from the entry's description, examplesPositive, constructionVariants and coverageSpec. The theory page is what the learner reads before or while drilling. A construction, form or rule the exercises will test that the page never teaches is a gap: the learner meets an exercise the page gave them no way to solve. Example of an important gap: the curriculum makes either/or questions ("Çay mı kahve mi?") and the particle "acaba" part of a question-formation point, but the page only covers plain yes/no and WH questions.

Report every gap between the curriculum entry and the page. Rules:
- Only report what the curriculum entry actually makes in scope (description, examplesPositive, constructionVariants, coverageSpec values, commonErrors). Never report things that you merely think a good page should also cover.
- A construction counts as COVERED when the page explains it or shows it in a way a learner can generalize from (a rule plus an example, a table row, or an explained example). A general rule that clearly produces the form counts as covered. Do not demand a separate example for every lexical item.
- "mentioned-only": the page names the construction or uses it once in passing, but never explains how it is formed or used, so a learner could not produce it.
- severity "important": an exercise built from the entry could test this, and the page gives a learner no way to work it out (absent, or mentioned-only for a construction with its own form or rule). This includes a constructionVariant with no counterpart on the page, a coverageSpec value that needs a form the page never shows, and a distinct construction in the description or examplesPositive.
- severity "minor": the construction is covered only thinly, or is a commonErrors entry the pitfalls section does not address, or is a marginal item an exercise is unlikely to hinge on.
- Do NOT report factual errors, wording, pedagogy, density, or level-appropriateness. Those are audited elsewhere.
- Quote the curriculum text that puts the item in scope.
- If nothing is missing, return an empty gaps list with verdict "complete".`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Report the scope gaps between the curriculum entry and the theory page.",
  input_schema: {
    type: "object",
    properties: {
      gaps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            construction: { type: "string", description: "Short name of the missing construction/form/rule, with a target-language example." },
            curriculumEvidence: { type: "string", description: "Verbatim quote from the curriculum entry that puts it in scope, prefixed by the field name." },
            pageStatus: { type: "string", enum: ["absent", "mentioned-only", "thin"] },
            severity: { type: "string", enum: ["important", "minor"] },
            note: { type: "string", description: "One sentence: what the page lacks and what an exercise would demand." },
          },
          required: ["construction", "curriculumEvidence", "pageStatus", "severity", "note"],
        },
      },
      verdict: { type: "string", enum: ["complete", "minor-gaps", "important-gaps"] },
    },
    required: ["gaps", "verdict"],
  },
};

export type Gap = { construction: string; curriculumEvidence: string; pageStatus: string; severity: string; note: string };
type Verdict = { key: string; verdict?: string; gaps?: Gap[]; costUsd: number; error?: string };

export async function auditOne(client: Anthropic, key: string, page: Page): Promise<Verdict> {
  const shaped = shapeToolRequest(MODEL, { tool: TOOL, thinking: "adaptive" });
  const user = `CURRICULUM ENTRY\n${renderCurriculum(key)}\n\nTHEORY PAGE\n${renderPage(page)}`;
  const req = applyShaped(
    {
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    },
    shaped,
  );
  const res = await client.messages.create(req);
  const u = res.usage;
  const costUsd = estimateCostUsdFor(MODEL, {
    inputTokens: u.input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens,
  });
  const out = extractToolUse(res, TOOL_NAME) as { gaps: Gap[]; verdict: string };
  return { key, verdict: out.verdict, gaps: out.gaps, costUsd };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "pages-dir": { type: "string" },
      out: { type: "string" },
      keys: { type: "string" },
      concurrency: { type: "string", default: "8" },
      "max-cost-usd": { type: "string", default: "25" },
    },
  });
  const dir = values["pages-dir"];
  const outPath = values.out;
  if (!dir || !outPath) throw new Error("--pages-dir and --out are required (absolute paths)");
  const only = values.keys ? new Set(values.keys.split(",")) : undefined;
  const keys = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((k) => !only || only.has(k));
  const cap = Number(values["max-cost-usd"]);
  const client = new Anthropic({ maxRetries: 4 });
  const results: Verdict[] = [];
  let spent = 0;
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      if (spent >= cap) {
        results.push({ key, costUsd: 0, error: "skipped: cost cap" });
        continue;
      }
      const page = JSON.parse(readFileSync(join(dir, `${key}.json`), "utf8")).content as Page;
      try {
        const v = await auditOne(client, key, page);
        spent += v.costUsd;
        results.push(v);
        const imp = v.gaps?.filter((g) => g.severity === "important").length ?? 0;
        console.log(`${key.padEnd(48)} ${v.verdict?.padEnd(15)} important=${imp} minor=${(v.gaps?.length ?? 0) - imp}  $${spent.toFixed(2)}`);
      } catch (err) {
        results.push({ key, costUsd: 0, error: String(err) });
        console.log(`${key.padEnd(48)} ERROR ${String(err).slice(0, 120)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  results.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(outPath, JSON.stringify({ model: MODEL, costUsd: spent, results }, null, 1));
  console.log(`wrote ${outPath} · ${results.length} pages · $${spent.toFixed(2)}`);
}

if (process.argv[1]?.endsWith("audit-theory-scope.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
