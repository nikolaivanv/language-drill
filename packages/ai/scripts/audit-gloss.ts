/**
 * packages/ai — audit:gloss CLI. Measures gloss spoilage in the approved cloze
 * pool: an English `glossEn` is meant to disambiguate meaning while leaving the
 * grammar to the learner, but some rows state the rule outright (a parenthetical
 * like "(a current condition)" handing over `está`). Judging all 1,568 approved
 * glossed rows with an LLM is expensive, so this file's `selectRowsToJudge`
 * narrows the judged set to rows an English speaker could actually spoil.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 *
 * This file holds only the pure, network-free logic — arg parsing, parenthetical
 * extraction, and row selection. The database loader, LLM judging, and `main()`
 * wiring land in a follow-up task.
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export type AuditGlossFilters = {
  language?: string;
  cefr?: string;
  grammarPoint?: string;
  limit?: number;
  maxCostUsd?: number;
  out?: string;
  dryRun: boolean;
  checkFixture: boolean;
};

export function parseAuditGlossArgs(argv: string[]): AuditGlossFilters {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      'grammar-point': { type: 'string' },
      limit: { type: 'string' },
      'max-cost-usd': { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'check-fixture': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:gloss [--language ES] [--cefr A1] [--grammar-point <key>]\n' +
        '                   [--limit N] [--max-cost-usd 2] [--out <path>] [--dry-run] [--check-fixture]',
    );
    process.exit(0);
  }

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer, got '${values.limit}'`);
    }
  }

  let maxCostUsd: number | undefined;
  if (values['max-cost-usd'] !== undefined) {
    maxCostUsd = Number(values['max-cost-usd']);
    if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new Error(`--max-cost-usd must be positive, got '${values['max-cost-usd']}'`);
    }
  }

  return {
    // Uppercased so `--language es` works: the pool stores 'ES' / 'A1'. Same
    // footgun as audit-collapse.ts and qa-sample-run.ts — lowercase silently
    // matches zero rows and looks like an empty pool, not a typo.
    language: values.language?.toUpperCase(),
    cefr: values.cefr?.toUpperCase(),
    grammarPoint: values['grammar-point'],
    limit,
    maxCostUsd,
    out: values.out,
    dryRun: values['dry-run'] ?? false,
    checkFixture: values['check-fixture'] ?? false,
  };
}

/** Non-greedy per-span match: `[^)]*` excludes `)` from the content, so a string
 *  with multiple parentheticals yields one match per `(...)` pair instead of one
 *  greedy span running from the first `(` to the last `)`. An unclosed `(` never
 *  matches, since there is no `)` to close it. */
const PARENTHETICAL_RE = /\([^)]*\)/g;

export function hasParenthetical(gloss: string): boolean {
  // A fresh non-global test avoids the /g flag's stateful lastIndex entirely —
  // .match() below reads the whole string in one pass and needs /g, but a
  // single true/false check doesn't, so use a plain (non-stateful) regex.
  return /\([^)]*\)/.test(gloss);
}

export function extractParentheticals(gloss: string): string[] {
  return gloss.match(PARENTHETICAL_RE) ?? [];
}

export type GlossRow = {
  id: string;
  grammarPointKey: string;
  language: string;
  cefrLevel: string;
  sentence: string;
  correctAnswer: string;
  acceptableAnswers: string[] | null;
  instructions: string;
  glossEn: string;
};

/**
 * The two-signal rule: keep a row if EITHER signal says it might leak.
 *
 *   1. Point-level — the point's triage verdict is `true` (English marks the
 *      distinction this point tests, e.g. demonstratives), so every gloss in
 *      the point is a candidate leak.
 *   2. Row-level — the row's own gloss carries a parenthetical, REGARDLESS of
 *      the point's verdict. This is what catches "(a current condition)" on a
 *      ser/estar blank: English "is" hides ser/estar, so that point verdicts
 *      `false` and would otherwise be skipped wholesale — yet this one row
 *      states the rule outright anyway. Point-level filtering alone misses it.
 *
 * A point with NO verdict (unknown key, or triage failed/errored) is never
 * silently excluded — an API error must not turn into invisible missing
 * coverage, so every row of an unverdicted point is judged.
 *
 * Each row is returned at most once even when both signals apply.
 */
export function selectRowsToJudge(
  rows: readonly GlossRow[],
  pointVerdicts: ReadonlyMap<string, boolean>,
): GlossRow[] {
  const out: GlossRow[] = [];
  for (const row of rows) {
    const verdict = pointVerdicts.get(row.grammarPointKey);
    const pointLeaks = verdict === undefined || verdict === true;
    if (pointLeaks || hasParenthetical(row.glossEn)) {
      out.push(row);
    }
  }
  return out;
}

async function main(): Promise<void> {
  parseAuditGlossArgs(process.argv.slice(2));
  throw new Error(
    '[audit-gloss] main() is not implemented yet — the database loader and LLM judging land in a follow-up task.',
  );
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[audit-gloss] unhandled failure:', err);
    process.exit(1);
  });
}
