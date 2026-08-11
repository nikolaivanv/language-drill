/**
 * packages/ai — audit:collapse CLI. Measures distributional collapse in the
 * approved exercise pool, triages each flagged cell with one Anthropic call, and
 * writes a JSON + markdown report to ./audit-runs/<name>.{json,md}.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 * See docs/superpowers/specs/2026-08-11-pool-collapse-audit-design.md.
 *
 * Usage:
 *   pnpm audit:collapse --dry-run
 *   pnpm audit:collapse --language ES --cefr B1 --max-cost-usd 2
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { and, inArray, isNotNull, sql } from 'drizzle-orm';

import { ExerciseType, resolveCellTargetFor } from '@language-drill/shared';
import type { CoverageTags, CurriculumCefrLevel, GrammarPoint, LearningLanguage } from '@language-drill/shared';
import { createDb, exercises, getGrammarPoint, requireEnv, findDismissal } from '@language-drill/db';
import type { CollapseSignal } from '@language-drill/db';
import type Anthropic from '@anthropic-ai/sdk';

import {
  computeSpecShortfall,
  computeStemMonotony,
  computeSurfaceCollapse,
  computeVariantSkew,
  isSurfaceFlagged,
  MONOTONY_THRESHOLD_DEFAULT,
  type AuditRow,
  type SpecShortfall,
  type StemMonotony,
  type SurfaceDistribution,
  type VariantSkew,
} from '../src/collapse-metrics.js';
import { createClaudeClient, triageCell, type TriageVerdict } from '../src/index.js';

/** One row as loaded from Postgres, before curriculum resolution. */
export type LoadedRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: Record<string, unknown> | null;
  coverageTags: CoverageTags | null;
};

export type AuditCell = {
  cellKey: string;
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  target: number;
  rows: AuditRow[];
};

export type AuditFilters = {
  language?: string;
  cefr?: string;
  type?: string;
  grammarPoint?: string;
  limit?: number;
  minRows: number;
  threshold: number;
  monotonyThreshold: number;
  maxCostUsd: number;
  dryRun: boolean;
  name: string;
};

const EXERCISE_TYPES = new Set<string>(Object.values(ExerciseType));

export function cellKeyOf(
  language: string,
  cefrLevel: string,
  type: ExerciseType,
  grammarPointKey: string,
): string {
  return `${language}:${cefrLevel}:${type}:${grammarPointKey}`;
}

export function parseAuditArgs(argv: string[]): AuditFilters {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      type: { type: 'string' },
      'grammar-point': { type: 'string' },
      limit: { type: 'string' },
      'min-rows': { type: 'string', default: '15' },
      threshold: { type: 'string', default: '0.65' },
      // Sourced from the constant so editing the documented default actually
      // changes the CLI default — a hard-coded literal here silently forked them.
      'monotony-threshold': { type: 'string', default: String(MONOTONY_THRESHOLD_DEFAULT) },
      'max-cost-usd': { type: 'string', default: '2' },
      'dry-run': { type: 'boolean', default: false },
      name: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:collapse [--language ES] [--cefr B1] [--type cloze] [--grammar-point <key>]\n' +
        '                     [--limit N] [--min-rows 15] [--threshold 0.65]\n' +
        `                     [--monotony-threshold ${MONOTONY_THRESHOLD_DEFAULT}] [--max-cost-usd 2] [--dry-run] [--name <run>]`,
    );
    process.exit(0);
  }

  // Fail fast on a typo'd type. Unvalidated, `--type close` matches zero rows and
  // the run reports "No collapse findings. Nothing to act on." — a clean bill of
  // health for a query that never ran.
  if (values.type !== undefined && !EXERCISE_TYPES.has(values.type)) {
    throw new Error(
      `--type must be one of ${[...EXERCISE_TYPES].sort().join(', ')}, got '${values.type}'`,
    );
  }

  const minRows = Number(values['min-rows']);
  if (!Number.isInteger(minRows) || minRows < 1) {
    throw new Error(`--min-rows must be a positive integer, got '${values['min-rows']}'`);
  }
  const threshold = Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`--threshold must be in (0, 1], got '${values.threshold}'`);
  }
  const monotonyThreshold = Number(values['monotony-threshold']);
  if (!Number.isFinite(monotonyThreshold) || monotonyThreshold <= 0 || monotonyThreshold > 1) {
    throw new Error(`--monotony-threshold must be in (0, 1], got '${values['monotony-threshold']}'`);
  }
  const maxCostUsd = Number(values['max-cost-usd']);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(`--max-cost-usd must be positive, got '${values['max-cost-usd']}'`);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got '${values.limit}'`);
  }

  return {
    // Uppercased so `--language es` works: the DB stores 'ES' / 'B1'. The
    // qa:sample CLI has the same footgun and requires uppercase by hand.
    language: values.language?.toUpperCase(),
    cefr: values.cefr?.toUpperCase(),
    type: values.type,
    grammarPoint: values['grammar-point'],
    limit,
    minRows,
    threshold,
    monotonyThreshold,
    maxCostUsd,
    dryRun: values['dry-run'] ?? false,
    name: values.name ?? 'audit-collapse',
  };
}

/**
 * Group loaded rows into cells, resolving each against the live curriculum.
 * Rows are dropped (not errored) when their grammar point no longer exists or
 * their type is not a current `ExerciseType` — the pool outlives curriculum
 * edits, and a retired point is not an audit finding.
 */
export function groupRowsIntoCells(rows: readonly LoadedRow[]): AuditCell[] {
  const cells = new Map<string, AuditCell>();

  for (const r of rows) {
    if (!r.grammarPointKey || !r.type || !r.language || !r.difficulty) continue;
    if (!EXERCISE_TYPES.has(r.type)) continue;
    const gp = getGrammarPoint(r.grammarPointKey);
    if (!gp) continue;

    const exerciseType = r.type as ExerciseType;
    const cefrLevel = r.difficulty as CurriculumCefrLevel;
    const key = cellKeyOf(r.language, r.difficulty, exerciseType, r.grammarPointKey);

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        cellKey: key,
        language: r.language as LearningLanguage,
        cefrLevel,
        exerciseType,
        grammarPoint: gp,
        target: resolveCellTargetFor({ exerciseType, cefrLevel, grammarPoint: gp }),
        rows: [],
      };
      cells.set(key, cell);
    }
    cell.rows.push({
      id: r.id,
      type: exerciseType,
      content: r.contentJson ?? {},
      coverageTags: r.coverageTags,
    });
  }

  return [...cells.values()].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}

/** Load every approved row matching the filters. Read-only. */
export async function loadApprovedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditFilters,
): Promise<LoadedRow[]> {
  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNotNull(exercises.grammarPointKey),
  ];
  if (filters.language) conditions.push(sql`${exercises.language} = ${filters.language}`);
  if (filters.cefr) conditions.push(sql`${exercises.difficulty} = ${filters.cefr}`);
  if (filters.type) conditions.push(sql`${exercises.type} = ${filters.type}`);
  if (filters.grammarPoint) {
    conditions.push(sql`${exercises.grammarPointKey} = ${filters.grammarPoint}`);
  }

  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      coverageTags: exercises.coverageTags,
    })
    .from(exercises)
    .where(and(...conditions));

  return rows as LoadedRow[];
}

export type AnalyzeOptions = {
  minRows: number;
  threshold: number;
  monotonyThreshold: number;
};

/** A ledger entry that accounted for one of this cell's flags, flattened for the
 *  report JSON. Carries `reason` / `dismissedOn` so the markdown can show WHY a
 *  cell was suppressed instead of the bare word "ledger". */
export type LedgerNote = {
  signal: CollapseSignal;
  /** null = the entry dismisses the cell whatever surface dominates. */
  surface: string | null;
  reason: string;
  dismissedOn: string;
};

export type CellFinding = {
  cellKey: string;
  grammarPointKey: string;
  grammarPointName: string;
  exerciseType: ExerciseType;
  approved: number;
  target: number;
  surface: SurfaceDistribution | null;
  surfaceFlagged: boolean;
  monotony: StemMonotony | null;
  monotonyFlagged: boolean;
  specShortfall: SpecShortfall | null;
  variantSkew: VariantSkew | null;
  /**
   * PER-SIGNAL dismissal state. Kept separate on purpose: collapsing them into a
   * single boolean meant a `stem-monotony` dismissal also suppressed an
   * UNDISMISSED answer-surface collapse on the same cell (and vice versa), which
   * contradicts the ledger's (point, type, surface, signal) key.
   */
  surfaceDismissed: boolean;
  monotonyDismissed: boolean;
  /** Derived: `surfaceDismissed || monotonyDismissed`. Only the Dismissed
   *  section may use this — it must never gate a per-signal section or triage. */
  dismissedByLedger: boolean;
  /** The matched ledger entries, for the Dismissed section's rationale line. */
  ledgerNotes: LedgerNote[];
  /** Signal 2 already explains this cell — see `analyzeCell`. */
  preempted: boolean;
  needsTriage: boolean;
  verdict: TriageVerdict | null;
  triageError: string | null;
};

/** True when the point declares a mechanism the pool has not realized. */
function declaredButUnrealized(
  spec: SpecShortfall | null,
  variants: VariantSkew | null,
): boolean {
  if (spec && spec.shortfalls.length > 0) return true;
  // `overQuota` is deliberately NOT a trigger here. It fires on ANY imbalance —
  // an 11/9 split, or 11/10 where exact balance is impossible — so including it
  // would mark almost every variant-bearing cell as pre-empted and silently
  // suppress triage across the board. Over-representation means the mechanism IS
  // working, just unevenly; it is reported (see the `unrealized` render filter)
  // but it does not stand in for a missing mechanism.
  if (variants && (variants.underMin.length > 0 || variants.unrecognizedSeedCount > 0)) return true;
  return false;
}

/**
 * Run all three signals over one cell and decide whether it needs an LLM call.
 *
 * Two things suppress triage, in this order:
 *   1. PRE-EMPTION — when the point already declares a mechanism the pool has not
 *      realized, THAT is the finding. Asking the model "should this point have
 *      construction variants?" about a point that already has them wastes a call
 *      and invites a confused verdict. Today this is the common case: #631 merged
 *      inert and the pool repass was never run.
 *   2. The dismissals ledger — a recorded human judgement that this exact
 *      concentration is correct.
 */
export function analyzeCell(cell: AuditCell, opts: AnalyzeOptions): CellFinding {
  const surface = computeSurfaceCollapse(cell.exerciseType, cell.rows);
  const surfaceFlagged = isSurfaceFlagged(surface, opts);

  const monotony = computeStemMonotony(cell.exerciseType, cell.rows);
  const monotonyFlagged =
    monotony !== null && monotony.total >= opts.minRows && monotony.share >= opts.monotonyThreshold;

  const specShortfall = computeSpecShortfall(cell.grammarPoint, cell.rows, cell.target);
  const variantSkew = computeVariantSkew(cell.grammarPoint, cell.rows);

  const preempted = declaredButUnrealized(specShortfall, variantSkew);

  const surfaceEntry =
    surfaceFlagged && surface !== null
      ? findDismissal(cell.grammarPoint.key, cell.exerciseType, surface.topSurface, 'answer-surface')
      : undefined;
  const monotonyEntry =
    monotonyFlagged && monotony !== null
      ? findDismissal(cell.grammarPoint.key, cell.exerciseType, monotony.topLemma, 'stem-monotony')
      : undefined;

  const surfaceDismissed = surfaceEntry !== undefined;
  const monotonyDismissed = monotonyEntry !== undefined;
  const ledgerNotes: LedgerNote[] = [surfaceEntry, monotonyEntry]
    .filter((d): d is NonNullable<typeof d> => d !== undefined)
    .map((d) => ({
      signal: d.signal,
      surface: d.surface,
      reason: d.reason,
      dismissedOn: d.dismissedOn,
    }));

  // Each signal is judged against ITS OWN dismissal, so a dismissed monotony flag
  // cannot swallow a live surface collapse.
  const liveSurface = surfaceFlagged && !surfaceDismissed;
  const liveMonotony = monotonyFlagged && !monotonyDismissed;

  return {
    cellKey: cell.cellKey,
    grammarPointKey: cell.grammarPoint.key,
    grammarPointName: cell.grammarPoint.name,
    exerciseType: cell.exerciseType,
    approved: cell.rows.length,
    target: cell.target,
    surface,
    surfaceFlagged,
    monotony,
    monotonyFlagged,
    specShortfall,
    variantSkew,
    surfaceDismissed,
    monotonyDismissed,
    dismissedByLedger: surfaceDismissed || monotonyDismissed,
    ledgerNotes,
    preempted,
    needsTriage: (liveSurface || liveMonotony) && !preempted,
    verdict: null,
    triageError: null,
  };
}

// Sonnet list pricing, USD per million tokens. Indicative only — used for the
// run's cost guard, not for billing.
const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;

export function estimateTriageCostUsd(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

export type AuditReport = {
  name: string;
  scanned: number;
  costUsd: number;
  findings: CellFinding[];
};

const NEXT_ACTION: Record<string, string> = {
  'coverage-spec': 'author `coverageSpec`',
  'construction-variants': 'author `constructionVariants`',
  'seed-pool': 'add a curated seed pool (`conjugationSeedWords` / `elicitationSeedValues`)',
};

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * Which signal a finding is actually being reported ON. The single definition
 * used by the renderer AND by `main()` when it builds the triage input — they
 * must agree, or the report explains a cell with numbers from the other signal.
 */
export function primarySignal(f: CellFinding): CollapseSignal {
  return f.surfaceFlagged && !f.surfaceDismissed ? 'answer-surface' : 'stem-monotony';
}

/** The one-line evidence for whichever signal fired. Monotony supplies most
 *  flags under `--dry-run`, so printing the surface share there showed a number
 *  BELOW the flag threshold — or literally `undefined` when `surface` is null. */
function signalDetail(f: CellFinding): string {
  const surfaceLine = (s: NonNullable<CellFinding['surface']>): string =>
    `- Top surface: \`${s.topSurface}\` at **${pct(s.share)}** (${s.topCount}/${s.total})`;
  const monotonyLine = (m: NonNullable<CellFinding['monotony']>): string =>
    `- Top stem lemma: \`${m.topLemma}\` in **${pct(m.share)}** of stems (${m.count}/${m.total})`;

  if (primarySignal(f) === 'answer-surface' && f.surface !== null) return surfaceLine(f.surface);
  if (f.monotony !== null) return monotonyLine(f.monotony);
  if (f.surface !== null) return surfaceLine(f.surface);
  return '- No surface or stem detail recorded for this cell.';
}

/** Ranking key for the flagged sections: the share of the signal that fired, so a
 *  monotony-driven collapse is not sorted below every surface finding. */
function signalShare(f: CellFinding): number {
  if (primarySignal(f) === 'answer-surface' && f.surface !== null) return f.surface.share;
  return f.monotony?.share ?? f.surface?.share ?? 0;
}

export function renderMarkdown(report: AuditReport): string {
  const confirmed = report.findings.filter((f) => f.verdict?.verdict === 'collapsed');
  const awaitingTriage = report.findings.filter(
    (f) => f.needsTriage && f.verdict === null && f.triageError === null,
  );
  // A MISSING mechanism: a declared floor with nothing behind it, a variant too
  // thin to rotate, or rows carrying no recognized variant id. Exactly the
  // triggers `declaredButUnrealized` uses — the two lists must stay in step, and
  // the "every non-trivial finding renders somewhere" test locks that.
  const unrealized = report.findings.filter(
    (f) =>
      f.specShortfall?.shortfalls.length ||
      f.variantSkew?.underMin.length ||
      f.variantSkew?.unrecognizedSeedCount,
  );
  // Realized but UNEVEN. `overQuota` fires on any split that is not exactly even
  // (11/9 trips it; so does 11/10, where exact balance is impossible), so these
  // cells are not evidence of a missing mechanism and must never be filed under a
  // heading that prescribes a demote.
  const imbalanced = report.findings.filter(
    (f) => f.variantSkew?.overQuota.length && !unrealized.includes(f),
  );
  const monotony = report.findings.filter((f) => f.monotonyFlagged && !f.monotonyDismissed);
  const dismissed = report.findings.filter(
    (f) => f.dismissedByLedger || f.verdict?.verdict === 'legitimate-concentration' || f.verdict?.verdict === 'metric-artifact',
  );
  const errors = report.findings.filter((f) => f.triageError !== null);

  const out: string[] = [
    `# Pool collapse audit — ${report.name}`,
    '',
    '## Summary',
    '',
    `- Cells scanned: **${report.scanned}**`,
    `- Flagged by a signal: **${report.findings.filter((f) => f.surfaceFlagged || f.monotonyFlagged).length}**`,
    `- Confirmed collapsed: **${confirmed.length}**`,
    `- Cells awaiting triage (no verdict yet): **${awaitingTriage.length}**`,
    `- Cells with a declared-but-unrealized mechanism: **${unrealized.length}**`,
    `- Cells whose declared variants are realized but unevenly spread: **${imbalanced.length}**`,
    `- Cells whose surface/monotony flag was dismissed (ledger + triage): **${dismissed.length}**`,
    `- Triage errors: **${errors.length}**`,
    `- Estimated cost: **$${report.costUsd.toFixed(2)}**`,
    '',
  ];

  if (
    confirmed.length === 0 &&
    awaitingTriage.length === 0 &&
    unrealized.length === 0 &&
    imbalanced.length === 0 &&
    monotony.length === 0 &&
    dismissed.length === 0 &&
    errors.length === 0
  ) {
    out.push('No collapse findings. Nothing to act on.', '');
  }

  if (confirmed.length > 0) {
    out.push('## Confirmed collapsed', '');
    const ranked = [...confirmed].sort((a, b) => signalShare(b) - signalShare(a));
    for (const f of ranked) {
      const v = f.verdict!;
      const action = v.mechanism ? NEXT_ACTION[v.mechanism] : 'investigate';
      out.push(
        `### \`${f.cellKey}\` — ${f.grammarPointName}`,
        '',
        `- Signal: **${primarySignal(f)}**`,
        signalDetail(f),
        `- Approved: ${f.approved} / target ${f.target}`,
        `- Mechanism: **${v.mechanism}**${v.axis ? ` (axis \`${v.axis}\`)` : ''} — confidence ${v.confidence}`,
        v.missingConstructions?.length
          ? `- Missing: ${v.missingConstructions.map((m) => `\`${m}\``).join(', ')}`
          : '',
        `- Rationale: ${v.rationale}`,
        `- **Next action:** ${action}`,
        f.approved >= f.target
          ? '- ⚠️ Cell is **at target** — **demote required**, it will not self-heal. `need = target − approved` is zero, so the scheduler never revisits it.'
          : '- Cell is below target; it will refill under the new config once generation resumes.',
        '',
      );
    }
  }

  if (awaitingTriage.length > 0) {
    out.push(
      '## Awaiting triage',
      '',
      'Flagged by a signal but not yet judged — expected under `--dry-run`; otherwise the run did not finish.',
      '',
    );
    const ranked = [...awaitingTriage].sort((a, b) => signalShare(b) - signalShare(a));
    for (const f of ranked) {
      out.push(
        `### \`${f.cellKey}\` — ${f.grammarPointName}`,
        '',
        `- Signal: **${primarySignal(f)}**`,
        signalDetail(f),
        `- Approved: ${f.approved} / target ${f.target}`,
        '',
      );
    }
  }

  const variantDetail = (f: CellFinding, includeOverQuota: boolean): string[] => {
    const lines: string[] = [];
    for (const s of f.specShortfall?.shortfalls ?? []) {
      lines.push(`  - \`${s.axis}=${s.value}\`: ${s.actual}/${s.floor}`);
    }
    if (!f.variantSkew) return lines;
    if (f.variantSkew.unrecognizedSeedCount > 0) {
      lines.push(
        `  - **${f.variantSkew.unrecognizedSeedCount} rows carry no recognized variant id** — backfill \`content_json.seedWord\` before demoting, or the surplus recomputes against zero coverage.`,
      );
    }
    for (const id of f.variantSkew.underMin) {
      const v = f.variantSkew.perVariant.find((p) => p.id === id)!;
      lines.push(`  - variant \`${id}\`: ${v.count} (below MIN_PER_VARIANT)`);
    }
    if (includeOverQuota) {
      for (const id of f.variantSkew.overQuota) {
        const v = f.variantSkew.perVariant.find((p) => p.id === id)!;
        lines.push(`  - variant \`${id}\`: ${v.count} over quota ${v.quota.toFixed(1)}`);
      }
    }
    return lines;
  };

  if (unrealized.length > 0) {
    out.push(
      '## Declared-but-unrealized',
      '',
      'A declared mechanism the pool has NOT realized — a floor with nothing behind it, a variant too thin to rotate, or rows carrying no recognized variant id. Deterministic: the declared floor is ground truth, no triage involved.',
      '',
    );
    const atTarget = unrealized.filter((f) => f.approved >= f.target);
    const belowTarget = unrealized.filter((f) => f.approved < f.target);
    for (const [label, group, note] of [
      ['At target — stuck, needs a demote', atTarget, 'These will NOT self-heal.'],
      ['Below target — self-heals on resume', belowTarget, 'The scheduler will target these on the next batch.'],
    ] as const) {
      if (group.length === 0) continue;
      out.push(`### ${label}`, '', note, '');
      for (const f of group) {
        out.push(`- \`${f.cellKey}\` (${f.approved}/${f.target})`, ...variantDetail(f, true));
      }
      out.push('');
    }
  }

  if (imbalanced.length > 0) {
    out.push(
      '## Variant spread uneven (informational)',
      '',
      'The declared mechanism IS realized on these cells: every variant clears `MIN_PER_VARIANT` and every row carries a recognized variant id. Some variants simply hold more rows than their fair quota — which any split that is not exactly even will show. **No demote is indicated**; this is imbalance, not absence. The scheduler evens it out as the cell refills.',
      '',
    );
    for (const f of imbalanced) {
      out.push(`- \`${f.cellKey}\` (${f.approved}/${f.target})`, ...variantDetail(f, true));
    }
    out.push('');
  }

  if (monotony.length > 0) {
    out.push(
      '## Stem monotony (calibration-phase)',
      '',
      `A hint, not a verdict. The default cutoff (${MONOTONY_THRESHOLD_DEFAULT}) is calibrated, not loose — see \`MONOTONY_THRESHOLD_DEFAULT\` for why raising it further does not help — but a point that correctly drills its own target lexeme sits near 1.0 here by design. #617 may already have fixed part of this.`,
      '',
    );
    for (const f of monotony) {
      out.push(
        `- \`${f.cellKey}\`: \`${f.monotony!.topLemma}\` in ${pct(f.monotony!.share)} of stems (${f.monotony!.count}/${f.monotony!.total})`,
      );
    }
    out.push('');
  }

  if (dismissed.length > 0) {
    out.push('## Dismissed', '', 'Listed so this report is auditable, not a filtered view.', '');
    for (const f of dismissed) {
      // Print the ledger's own `reason` and `dismissedOn`: the bare word "ledger"
      // made a stale dismissal indistinguishable from a fresh one, and turned this
      // section into exactly the unauditable filtered view it exists to avoid.
      const why = f.ledgerNotes.map(
        (d) =>
          `ledger [${d.signal}, surface ${d.surface === null ? '*any*' : `\`${d.surface}\``}, ${d.dismissedOn}]: ${d.reason}`,
      );
      if (f.verdict?.verdict === 'legitimate-concentration' || f.verdict?.verdict === 'metric-artifact') {
        why.push(`triage: ${f.verdict.verdict} — ${f.verdict.rationale}`);
      }
      const alsoUnrealized = unrealized.includes(f)
        ? ' — **also has an unrealized declared mechanism; see above**'
        : '';
      out.push(`- \`${f.cellKey}\` — ${why.join(' · ')}${alsoUnrealized}`);
    }
    out.push('');
  }

  if (errors.length > 0) {
    out.push('## Triage errors', '');
    for (const f of errors) out.push(`- \`${f.cellKey}\` — ${f.triageError}`);
    out.push('');
  }

  return out.join('\n');
}

async function main(): Promise<void> {
  const filters = parseAuditArgs(process.argv.slice(2));
  const db = createDb(requireEnv('DATABASE_URL'));

  console.log('[audit-collapse] loading approved rows…');
  const rows = await loadApprovedRows(db, filters);
  let cells = groupRowsIntoCells(rows);
  if (filters.limit !== undefined) cells = cells.slice(0, filters.limit);
  console.log(`[audit-collapse] ${rows.length} rows → ${cells.length} cells`);

  const findings = cells.map((c) => analyzeCell(c, filters));

  let costUsd = 0;
  if (!filters.dryRun) {
    const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
    const cellByKey = new Map(cells.map((c) => [c.cellKey, c]));
    const queue = findings.filter((f) => f.needsTriage);
    console.log(`[audit-collapse] triaging ${queue.length} cells…`);

    for (const f of queue) {
      if (costUsd >= filters.maxCostUsd) {
        // Never silently truncate: an unspoken cap reads as "covered everything".
        f.triageError = `skipped — run hit --max-cost-usd ${filters.maxCostUsd}`;
        continue;
      }
      const cell = cellByKey.get(f.cellKey)!;
      try {
        const { verdict, usage } = await triageCell(client, {
          grammarPoint: cell.grammarPoint,
          exerciseType: cell.exerciseType,
          approved: f.approved,
          target: f.target,
          signal: primarySignal(f),
          surface: f.surface,
          monotony: f.monotony,
        });
        f.verdict = verdict;
        costUsd += estimateTriageCostUsd(usage);
      } catch (err) {
        f.triageError = err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    console.log('[audit-collapse] --dry-run: sweep only, no triage calls');
  }

  const report: AuditReport = { name: filters.name, scanned: cells.length, costUsd, findings };
  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${filters.name}.json`);
  const mdPath = path.join(outDir, `${filters.name}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf8');

  console.log(`[audit-collapse] wrote ${jsonPath}`);
  console.log(`[audit-collapse] wrote ${mdPath}`);
  console.log(`[audit-collapse] estimated cost $${costUsd.toFixed(2)}`);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[audit-collapse] unhandled failure:', err);
    process.exit(1);
  });
}
