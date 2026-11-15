/**
 * Draft, apply and gate scope repairs for theory pages flagged by
 * audit-theory-scope.ts. Never writes to the database.
 *
 * Per page with important gaps:
 *   1. Opus drafts a patch (ops in the 2026-11 apply_patch.py format) that adds
 *      the missing constructions in the page's own style.
 *   2. The patch is applied in-process and the page is schema-parsed.
 *   3. Gates: the production theory validator must auto-approve with zero
 *      factual errors, and a re-run of the scope audit must find no important
 *      gaps. A failed gate feeds its reasons back for one more attempt
 *      (--attempts, default 3 total).
 *
 * Writes <out-dir>/patches/<key>.json (the patch), <out-dir>/after/<key>.json
 * ({id,key,base_md5,content} for build_sql), and <out-dir>/repair-report.json.
 *
 *   pnpm --filter @language-drill/ai exec tsx scripts/repair-theory-scope.ts \
 *     --pages-dir /abs/before --report /abs/scope-report.json --out-dir /abs/out \
 *     [--keys a,b] [--concurrency 4] [--max-cost-usd 40]
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-pointer edits walk untyped page JSON */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Language, parseTheoryTopicJson } from "@language-drill/shared";
import { getGrammarPoint, routeTheoryValidationResult } from "@language-drill/db";
import { applyShaped, extractToolUse, shapeToolRequest } from "../src/model-request.js";
import { estimateCostUsdFor } from "../src/cost-model.js";
import { validateTheoryDraft } from "../src/theory-validate.js";
import { THEORY_VALIDATION_MODEL } from "../src/theory-validate.js";
import type { TheoryDraft, TheoryGenerationSpec } from "../src/theory-generate.js";
import { auditOne, renderPage, type Gap, type Page } from "./audit-theory-scope.js";

const MODEL = "claude-opus-5-5";
const TOOL_NAME = "submit_page_patch";
const LANG: Record<string, Exclude<Language, Language.EN>> = {
  es: Language.ES,
  de: Language.DE,
  tr: Language.TR,
} as Record<string, Exclude<Language, Language.EN>>;

const SYSTEM = `You repair SCOPE gaps in a language-learning theory page by writing a patch.

The page is JSON with this block taxonomy (the only kinds allowed):
- inline: {"kind":"text","text":"…"} | {"kind":"strong"|"em"|"hilite"|"mono","children":[inline…]}
- block: {"kind":"paragraph","text":[inline…]}
       | {"kind":"callout","variant":"default"|"warn","children":[block…]}
       | {"kind":"example","target":[inline…],"en":"English translation","note":[inline…]}
       | {"kind":"list","items":[[block…], …]}   (each item is an array of blocks)
       | {"kind":"conjugation-table","head":["…"],"rows":[["…"], …]}  (every row has head.length cells)
Sections, in order: what-is-it (one paragraph), when-to-use-it, formation, examples-in-context, common-pitfalls.

You get the curriculum entry, the page JSON, and the list of gaps: constructions the exercises drill that the page does not teach. Write the smallest patch that makes the page teach every listed gap well enough that a learner can solve an exercise on it:
- Put each item where it belongs: usage in when-to-use-it (usually a new list item, in the style of the existing items), how it is built in formation (a paragraph and/or table rows, showing each allomorph or class the rule distinguishes), at least one "example" block per gap in examples-in-context with a note that explains it, and a pitfall only when the curriculum's commonErrors names one.
- If a gap needs only a sentence in what-is-it, extend the existing paragraph: append an inline to its text array. Never add a second paragraph to what-is-it.
- Match the page's tone, terminology and level (CEFR level is given). Keep the wording plain and short.
- Accuracy is paramount: every form, rule and example must be correct standard usage. State rules with the right scope ("usually", "in standard written X") rather than over-absolute. Do not invent exceptions. If an existing sentence on the page now contradicts what you add, fix it with a "replace" or "set" op.
- Prefer inserting NEW blocks (list items, paragraphs, table rows, examples). Use "replace"/"set" on existing text ONLY to fix a statement that is wrong or that your addition contradicts, or to append a clause to the what-is-it paragraph. Never splice text into the middle of an existing sentence; a replacement must read as complete, well-punctuated sentences.
- Never remove or shorten correct existing content (callouts, notes, table rows, examples). Do not add material outside the listed gaps.
- Use only Latin-script letters of the target language (no Cyrillic/Greek look-alikes).

Patch ops (applied in order; paths are JSON pointers into the page JSON, evaluated AFTER earlier ops):
- {"op":"insert","path":"/sections/3/body/6","valueJson":"<block JSON>"} — inserts before that index; index == length appends.
- {"op":"set","path":"/sections/0/body/0/text/9","valueJson":"<JSON>"} — replace the node at path (also used to append to an array: path index == length is NOT allowed for set; use insert).
- {"op":"replace","find":"exact substring of ONE string leaf","replace":"new text"}
- {"op":"remove","path":"…"}
valueJson is the JSON value serialized as a string. To append to a list's items use insert at /sections/i/body/j/items/<len> with an array of blocks as the value. To extend a paragraph, insert an inline at /sections/i/body/j/text/<len>.
Also give a "subtitle" only if the current subtitle names the point's sub-topics and would now be misleading; otherwise leave it empty.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Submit the patch that adds the missing constructions to the page.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["insert", "set", "replace", "remove"] },
            path: { type: "string", description: "JSON pointer (insert/set/remove); empty for replace." },
            valueJson: { type: "string", description: "JSON-serialized value (insert/set); empty otherwise." },
            find: { type: "string", description: "replace only; empty otherwise." },
            replace: { type: "string", description: "replace only; empty otherwise." },
            gap: { type: "string", description: "Which gap this edit addresses." },
          },
          required: ["op", "path", "valueJson", "find", "replace", "gap"],
        },
      },
      subtitle: { type: "string" },
    },
    required: ["edits", "subtitle"],
  },
};

type Edit = { op: string; path: string; valueJson: string; find: string; replace: string; gap: string };
type PatchEdit = { op: string; path?: string; value?: unknown; find?: string; replace?: string; finding: string };

function ptr(p: string): (string | number)[] {
  return p
    .split("/")
    .filter((x) => x !== "")
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));
}

function leaves(o: unknown, path: (string | number)[] = [], out: [(string | number)[], string][] = []) {
  if (Array.isArray(o)) o.forEach((v, i) => leaves(v, [...path, i], out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) leaves(v, [...path, k], out);
  else if (typeof o === "string") out.push([path, o]);
  return out;
}

function getAt(o: unknown, path: (string | number)[]): any {
  let cur: any = o;
  for (const p of path) cur = cur[p as any];
  return cur;
}

/** Same semantics as docs/analysis/theory-audit-2026-11-01/page-repairs/apply_patch.py. */
export function applyPatch(content: unknown, edits: PatchEdit[]): unknown {
  const c = structuredClone(content);
  edits.forEach((e, i) => {
    try {
      if (e.op === "replace") {
        const hits = leaves(c).filter(([, s]) => s.includes(e.find!));
        const n = hits.reduce((a, [, s]) => a + s.split(e.find!).length - 1, 0);
        if (n !== 1) throw new Error(`find matched ${n} times: ${JSON.stringify(e.find)}`);
        const [p, s] = hits[0];
        getAt(c, p.slice(0, -1))[p[p.length - 1] as any] = s.replace(e.find!, e.replace!);
        return;
      }
      const path = ptr(e.path!);
      const parent = getAt(c, path.slice(0, -1));
      const last = path[path.length - 1];
      if (e.op === "set") {
        if (Array.isArray(parent) && !(typeof last === "number" && last >= 0 && last < parent.length))
          throw new Error(`index ${last} out of range`);
        parent[last as any] = e.value;
      } else if (e.op === "insert") {
        if (!Array.isArray(parent) || typeof last !== "number" || last < 0 || last > parent.length)
          throw new Error(`bad insert path ${e.path}`);
        parent.splice(last, 0, e.value);
      } else if (e.op === "remove") {
        if (Array.isArray(parent)) parent.splice(last as number, 1);
        else delete parent[last as any];
      } else throw new Error(`unknown op ${e.op}`);
    } catch (err) {
      throw new Error(`edit ${i} (${e.op}): ${err instanceof Error ? err.message : err}`);
    }
  });
  return c;
}

const MIXED = /(?=\S*[Ѐ-ӿͰ-Ͽ])(?=\S*[A-Za-zÀ-ɏ])\S+/;

function curriculumText(key: string): string {
  const gp = getGrammarPoint(key)!;
  const g = gp as unknown as Record<string, unknown>;
  return JSON.stringify(
    {
      key: gp.key,
      name: gp.name,
      cefrLevel: gp.cefrLevel,
      description: gp.description,
      examplesPositive: gp.examplesPositive,
      examplesNegative: g.examplesNegative,
      constructionVariants: g.constructionVariants,
      coverageSpec: g.coverageSpec,
      commonErrors: gp.commonErrors,
    },
    null,
    1,
  );
}

function renderLines(p: Page): string[] {
  return renderPage(p).split("\n");
}

/** Minimal LCS line diff: lines prefixed "- " (removed) / "+ " (added). */
export function lineDiff(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push("- " + a[i++]);
    else out.push("+ " + b[j++]);
  }
  while (i < n) out.push("- " + a[i++]);
  while (j < m) out.push("+ " + b[j++]);
  return out;
}

const REVIEW_MODEL = "claude-sonnet-5-5";
const REVIEW_TOOL: Anthropic.Tool = {
  name: "report_edit_review",
  description: "Report problems in the edit of a theory page.",
  input_schema: {
    type: "object",
    properties: {
      problems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["broken-text", "removed-correct-content", "out-of-scope", "inconsistent"] },
            detail: { type: "string" },
          },
          required: ["kind", "detail"],
        },
      },
    },
    required: ["problems"],
  },
};
const REVIEW_SYSTEM = `You review an edit to a language-learning theory page. You get the list of scope gaps the edit was meant to fill and a line diff of the page rendered as text ("- " removed, "+ " added; a changed line shows as a removed line plus an added line).

Report only these problems:
- broken-text: an added or changed line with a splice error — a sentence glued into another mid-sentence, missing or doubled punctuation, a dangling fragment, duplicated text, an example that does not show what its note says.
- removed-correct-content: a removed (or shortened) line whose content was correct and is not restated elsewhere in the added lines. Rewording a sentence to fix an error or to narrow an over-absolute claim is fine.
- out-of-scope: added material unrelated to the listed gaps and not a correction of an error.
- inconsistent: an added line that contradicts another line of the page.
Do not judge grammar facts; a separate fact-checker does that. Return an empty list if the edit is clean.`;

type Problem = { kind: string; detail: string };

async function reviewEdit(client: Anthropic, gaps: Gap[], before: Page, after: Page): Promise<{ problems: Problem[]; costUsd: number }> {
  const diff = lineDiff(renderLines(before), renderLines(after)).join("\n");
  const shaped = shapeToolRequest(REVIEW_MODEL, { tool: REVIEW_TOOL, thinking: "adaptive" });
  const res = await client.messages.create(
    applyShaped(
      {
        model: REVIEW_MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `GAPS\n${JSON.stringify(gaps.map((g) => g.construction), null, 1)}\n\nDIFF\n${diff}` }],
      },
      shaped,
    ),
  );
  const costUsd = estimateCostUsdFor(REVIEW_MODEL, {
    inputTokens: res.usage.input_tokens,
    cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
    outputTokens: res.usage.output_tokens,
  });
  const outp = extractToolUse(res, REVIEW_TOOL.name) as { problems: Problem[] };
  return { problems: outp.problems, costUsd };
}

type Attempt = {
  edits?: PatchEdit[];
  error?: string;
  validator?: { status: string; score: number; factualErrors: string[]; flaggedReasons: string[] };
  scope?: { verdict?: string; important: Gap[] };
  review?: Problem[];
};
type Outcome = { key: string; ok: boolean; attempts: Attempt[]; costUsd: number; final?: { content: unknown; edits: PatchEdit[] } };

async function repairOne(client: Anthropic, key: string, src: any, gaps: Gap[], attempts: number): Promise<Outcome> {
  const out: Outcome = { key, ok: false, attempts: [], costUsd: 0 };
  const gp = getGrammarPoint(key);
  if (!gp) throw new Error(`no curriculum point ${key}`);
  const spec: TheoryGenerationSpec = { language: LANG[key.slice(0, 2)], cefrLevel: gp.cefrLevel, grammarPoint: gp, batchSeed: "scope-repair" };
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `CURRICULUM ENTRY\n${curriculumText(key)}\n\nGAPS TO FIX\n${JSON.stringify(gaps, null, 1)}\n\nPAGE JSON\n${JSON.stringify(src.content, null, 1)}`,
    },
  ];
  for (let a = 0; a < attempts; a++) {
    const att: Attempt = {};
    out.attempts.push(att);
    const shaped = shapeToolRequest(MODEL, { tool: TOOL, thinking: "adaptive" });
    const res = await client.messages
      .stream(applyShaped({ model: MODEL, max_tokens: 32000, system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }], messages }, shaped))
      .finalMessage();
    out.costUsd += estimateCostUsdFor(MODEL, {
      inputTokens: res.usage.input_tokens,
      cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
      outputTokens: res.usage.output_tokens,
    });
    let feedback: string;
    let page: any;
    try {
      const raw = extractToolUse(res, TOOL_NAME) as { edits: Edit[]; subtitle: string };
      const edits: PatchEdit[] = raw.edits.map((e) =>
        e.op === "replace"
          ? { op: "replace", find: e.find, replace: e.replace, finding: e.gap }
          : e.op === "remove"
            ? { op: "remove", path: e.path, finding: e.gap }
            : { op: e.op, path: e.path, value: JSON.parse(e.valueJson), finding: e.gap },
      );
      if (raw.subtitle?.trim()) edits.push({ op: "set", path: "/subtitle", value: raw.subtitle.trim(), finding: "subtitle" });
      att.edits = edits;
      page = applyPatch(src.content, edits);
      parseTheoryTopicJson(page);
      const mixed = leaves(page).flatMap(([, s]) => s.split(/\s+/).filter((w) => MIXED.test(w)));
      if (mixed.length) throw new Error(`mixed-script words: ${mixed.join(", ")}`);
    } catch (err) {
      att.error = err instanceof Error ? err.message : String(err);
      feedback = `Your patch could not be applied: ${att.error}\nSubmit a corrected COMPLETE patch against the ORIGINAL page JSON (not on top of your previous patch).`;
      messages.push({ role: "assistant", content: res.content }, toolResult(res, feedback));
      continue;
    }
    const draft: TheoryDraft = {
      id: "00000000-0000-0000-0000-000000000000",
      topicId: key.slice(3),
      contentJson: page,
      metadata: { grammarPointKey: key, modelId: "scope-repair", inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    };
    const [{ result, tokenUsage }, scope, review] = await Promise.all([
      validateTheoryDraft(client, draft, spec),
      auditOne(client, key, page as Page),
      reviewEdit(client, gaps, src.content as Page, page as Page),
    ]);
    out.costUsd += estimateCostUsdFor(THEORY_VALIDATION_MODEL, tokenUsage) + scope.costUsd + review.costUsd;
    att.review = review.problems;
    const decision = routeTheoryValidationResult(result);
    att.validator = { status: decision.reviewStatus, score: result.qualityScore, factualErrors: result.factualErrors, flaggedReasons: result.flaggedReasons };
    const important = (scope.gaps ?? []).filter((g) => g.severity === "important");
    att.scope = { verdict: scope.verdict, important };
    const validatorOk = decision.reviewStatus === "auto-approved" && result.factualErrors.length === 0;
    // out-of-scope is informational: fixes the fact-checker asks for (formation
    // completeness, unaddressed commonErrors) always look out of scope to it.
    const blocking = review.problems.filter((p) => p.kind !== "out-of-scope");
    if (validatorOk && important.length === 0 && blocking.length === 0) {
      out.ok = true;
      out.final = { content: page, edits: att.edits! };
      return out;
    }
    feedback = [
      "Your patch applied, but the page did not pass review. Fix every point below and submit a corrected COMPLETE patch against the ORIGINAL page JSON (not on top of your previous patch).",
      result.factualErrors.length ? `Fact-checker FACTUAL ERRORS (verify each; fix the real ones, rephrase overstated ones with the right scope):\n- ${result.factualErrors.join("\n- ")}` : "",
      decision.reviewStatus !== "auto-approved" ? `Fact-checker status ${decision.reviewStatus}, score ${result.qualityScore}. Other reasons:\n- ${result.flaggedReasons.join("\n- ")}` : "",
      important.length ? `Scope gaps still open:\n${JSON.stringify(important, null, 1)}` : "",
      blocking.length ? `Edit reviewer problems (fix each):\n${blocking.map((p) => `- [${p.kind}] ${p.detail}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    messages.push({ role: "assistant", content: res.content }, toolResult(res, feedback));
  }
  return out;
}

function toolResult(res: Anthropic.Message, text: string): Anthropic.MessageParam {
  const tu = res.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!tu) return { role: "user", content: text };
  return { role: "user", content: [{ type: "tool_result", tool_use_id: tu.id, content: text, is_error: true }] };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "pages-dir": { type: "string" },
      report: { type: "string" },
      "out-dir": { type: "string" },
      keys: { type: "string" },
      attempts: { type: "string", default: "4" },
      concurrency: { type: "string", default: "4" },
      "max-cost-usd": { type: "string", default: "40" },
    },
  });
  const pagesDir = values["pages-dir"]!;
  const outDir = values["out-dir"]!;
  const report = JSON.parse(readFileSync(values.report!, "utf8")) as { results: { key: string; gaps?: Gap[] }[] };
  const only = values.keys ? new Set(values.keys.split(",")) : undefined;
  const todo = report.results
    .map((r) => ({ key: r.key, gaps: (r.gaps ?? []).filter((g) => g.severity === "important") }))
    .filter((r) => r.gaps.length && (!only || only.has(r.key)));
  mkdirSync(join(outDir, "patches"), { recursive: true });
  mkdirSync(join(outDir, "after"), { recursive: true });
  const client = new Anthropic({ maxRetries: 4 });
  const cap = Number(values["max-cost-usd"]);
  const outcomes: Outcome[] = [];
  let spent = 0;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { key, gaps } = todo[next++];
      if (spent >= cap) {
        outcomes.push({ key, ok: false, attempts: [{ error: "skipped: cost cap" }], costUsd: 0 });
        continue;
      }
      const src = JSON.parse(readFileSync(join(pagesDir, `${key}.json`), "utf8"));
      try {
        const o = await repairOne(client, key, src, gaps, Number(values.attempts));
        spent += o.costUsd;
        outcomes.push(o);
        const fin = o.final;
        if (fin) {
          writeFileSync(join(outDir, "patches", `${key}.json`), JSON.stringify({ key, edits: fin.edits }, null, 1));
          writeFileSync(join(outDir, "after", `${key}.json`), JSON.stringify({ id: src.id, key, base_md5: src.md5, content: fin.content }, null, 1));
          delete o.final;
        }
        const last = o.attempts[o.attempts.length - 1];
        console.log(
          `${o.ok ? "ok  " : "FAIL"} ${key.padEnd(48)} attempts=${o.attempts.length} ${last.validator ? `${last.validator.status} ${last.validator.score} fe=${last.validator.factualErrors.length} openGaps=${last.scope?.important.length} review=${last.review?.length}` : last.error?.slice(0, 100) ?? ""}  $${spent.toFixed(2)}`,
        );
      } catch (err) {
        outcomes.push({ key, ok: false, attempts: [{ error: String(err) }], costUsd: 0 });
        console.log(`ERR  ${key} ${String(err).slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  outcomes.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(join(outDir, "repair-report.json"), JSON.stringify({ model: MODEL, costUsd: spent, outcomes }, null, 1));
  console.log(`done · ok ${outcomes.filter((o) => o.ok).length}/${outcomes.length} · $${spent.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
