/**
 * GET /admin/diversity — the declared diversity mechanisms of every grammar
 * point, joined to what the approved pool actually realizes.
 *
 * Read-only and deterministic: three cell-grouped SQL aggregates, then the
 * same pure metric cores `audit:collapse` uses. No LLM calls.
 *
 * The three aggregates deliberately include the DENOMINATORS (`untaggedRows`,
 * `unlabelledRows`). Without them a zero is ambiguous — an axis at 0 across a
 * whole cell usually means missing TAGS, not missing content — and acting on
 * the wrong reading demotes sound rows.
 *
 * Scoping only (`language`/`level`/`kind`): the sole consumer is the
 * `/admin/pool` table, which needs a mechanism chip on EVERY row in scope and
 * so filters by mechanism client-side. Narrowing here would silently blank the
 * chips on the rows that didn't match rather than hide those rows.
 */
import {
  ALL_CURRICULA,
  enumerateCurriculumCells,
  resolveCellMechanisms,
  type DeclaredSeed,
  type DiversityMechanisms,
} from '@language-drill/db';
import {
  computeSpecShortfallFromCounts,
  computeVariantSkewFromCounts,
} from '@language-drill/ai';
import type { Cell } from '@language-drill/db';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db';
import type { Bindings, Variables } from '../middleware/auth';

const DiversityQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  kind: z.string().optional(),
});

export const adminDiversity = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

type BuiltAxis = {
  name: string;
  role: 'controlled' | 'monitored';
  values: Array<{ value: string; count: number; floor: number | null }>;
  untagged: number;
};

type BuiltSeed =
  | {
      kind: 'construction-variants';
      variants: Array<{ id: string; directive: string; share: number; count: number; quota: number }>;
      unlabelledRows: number;
    }
  | { kind: 'curated'; source: string; poolSize: number; usedCount: number; unused: string[] }
  | { kind: 'frequency-band'; band: string; rankMax: number; distinctSeeds: number; unlabelledRows: number }
  | { kind: 'vocab-target' }
  | { kind: 'none' };

type BuiltCell = {
  cellKey: string;
  type: string;
  level: string;
  approved: number;
  target: number;
  atTarget: boolean;
  axes: BuiltAxis[];
  seed: BuiltSeed;
  shortfalls: Array<{ axis: string; value: string; floor: number; actual: number }>;
  /** Deficiencies this cell's own denominators PROVE (see `countCellIssues`). */
  provenIssues: number;
  /** Deficiencies that may be measurement gaps rather than missing content. */
  unknowns: number;
};

/**
 * The four deficiencies a cell's own numbers can expose, split into what its
 * denominators PROVE and what is merely UNMEASURED. Same rules, same
 * arithmetic as before they moved here from the point loop — a point's counts
 * are now the sum over its cells, which is what the pool table renders per row.
 *
 * The proven/unknown split is load-bearing, not cosmetic: a below-floor value
 * far more often means missing TAGS than missing content, and demoting on an
 * unknown destroys sound rows. See docs/admin-panel.md → "Reading a zero".
 */
function countCellIssues(
  cell: Omit<BuiltCell, 'provenIssues' | 'unknowns'>,
): { provenIssues: number; unknowns: number } {
  let provenIssues = 0;
  let unknowns = 0;

  if (cell.seed.kind === 'construction-variants') {
    for (const v of cell.seed.variants) {
      if (v.count > 0) continue;
      if (cell.seed.unlabelledRows === 0) provenIssues += 1;
      else unknowns += 1;
    }
  }
  if (
    cell.seed.kind === 'curated' &&
    cell.seed.poolSize > 0 &&
    cell.seed.usedCount >= cell.seed.poolSize &&
    !cell.atTarget
  ) {
    // Bounded pool fully covered — pickSeeds returns nulls and the cell
    // silently stops generating. A cell already at target isn't trying to
    // generate anyway, so exhaustion there isn't a live issue.
    provenIssues += 1;
  }
  for (const s of cell.shortfalls) {
    const axis = cell.axes.find((a) => a.name === s.axis);
    if ((axis?.untagged ?? 0) > 0) unknowns += 1;
    else provenIssues += 1;
  }
  // At target with unmet floors: no deficit, so the scheduler never revisits
  // the cell and the floors never fire. Needs demote:pool.
  if (cell.atTarget && cell.shortfalls.length > 0) provenIssues += 1;

  return { provenIssues, unknowns };
}

adminDiversity.get('/admin/diversity', async (c) => {
  const parsed = DiversityQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const { language, level, kind } = parsed.data;

  const APPROVED = sql`review_status IN ('auto-approved', 'manual-approved')`;
  // MUST be lowercased. `buildCellKey` lowercases every part, so the canonical
  // key is `es:a1:cloze:<point>`, while `exercises.language` and `difficulty`
  // store 'ES' and 'A1'. Concatenating raw yields `ES:A1:cloze:<point>`, which
  // matches no cell in the curriculum map — every cell would silently report
  // zero approved rows, zero coverage, and zero realized variants.
  const CELL_KEY = sql`LOWER(language || ':' || difficulty || ':' || type || ':' || grammar_point_key)`;

  const [tagResult, seedResult, totalResult] = await Promise.all([
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             tag.key AS axis, tag.value AS value, COUNT(*)::int AS n
      FROM exercises
      CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
      WHERE ${APPROVED} AND coverage_tags IS NOT NULL
        AND grammar_point_key IS NOT NULL
      GROUP BY 1, 2, 3
    `),
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             content_json->>'seedWord' AS seed, COUNT(*)::int AS n
      FROM exercises
      WHERE ${APPROVED} AND grammar_point_key IS NOT NULL
        AND content_json->>'seedWord' IS NOT NULL
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             COUNT(*)::int AS approved,
             COUNT(*) FILTER (WHERE coverage_tags IS NULL)::int AS "untaggedRows",
             COUNT(*) FILTER (WHERE content_json->>'seedWord' IS NULL)::int AS "unlabelledRows"
      FROM exercises
      WHERE ${APPROVED} AND grammar_point_key IS NOT NULL
      GROUP BY 1
    `),
  ]);

  const tagRows = tagResult.rows as unknown as Array<{
    cellKey: string; axis: string; value: string; n: number;
  }>;
  const seedRows = seedResult.rows as unknown as Array<{
    cellKey: string; seed: string; n: number;
  }>;
  const totalRows = totalResult.rows as unknown as Array<{
    cellKey: string; approved: number; untaggedRows: number; unlabelledRows: number;
  }>;

  const tagsByCell = new Map<string, Record<string, Record<string, number>>>();
  for (const r of tagRows) {
    const byAxis = tagsByCell.get(r.cellKey) ?? {};
    const byValue = byAxis[r.axis] ?? {};
    byValue[r.value] = r.n;
    byAxis[r.axis] = byValue;
    tagsByCell.set(r.cellKey, byAxis);
  }

  const seedsByCell = new Map<string, Record<string, number>>();
  for (const r of seedRows) {
    const counts = seedsByCell.get(r.cellKey) ?? {};
    counts[r.seed] = r.n;
    seedsByCell.set(r.cellKey, counts);
  }

  const totalsByCell = new Map<
    string,
    { approved: number; untaggedRows: number; unlabelledRows: number }
  >();
  for (const r of totalRows) {
    totalsByCell.set(r.cellKey, {
      approved: r.approved,
      untaggedRows: r.untaggedRows,
      unlabelledRows: r.unlabelledRows,
    });
  }

  function buildSeed(
    cell: Cell,
    seed: DeclaredSeed,
    seedCounts: Record<string, number>,
    unlabelledRows: number,
  ): BuiltSeed {
    if (seed.kind === 'construction-variants') {
      const declared = new Set(seed.variants.map((v) => v.id));
      const declaredCounts: Record<string, number> = {};
      let unrecognized = unlabelledRows;
      for (const [id, n] of Object.entries(seedCounts)) {
        if (declared.has(id)) declaredCounts[id] = n;
        else unrecognized += n;
      }
      const skew = computeVariantSkewFromCounts(
        cell.grammarPoint, declaredCounts, unrecognized,
      );
      const byId = new Map(skew?.perVariant.map((v) => [v.id, v]) ?? []);
      return {
        kind: 'construction-variants' as const,
        variants: seed.variants.map((v) => ({
          ...v,
          count: byId.get(v.id)?.count ?? 0,
          quota: byId.get(v.id)?.quota ?? 0,
        })),
        unlabelledRows: skew?.unrecognizedSeedCount ?? unrecognized,
      };
    }
    if (seed.kind === 'curated') {
      const used = seed.values.filter((v) => (seedCounts[v] ?? 0) > 0);
      return {
        kind: 'curated' as const,
        source: seed.source,
        poolSize: seed.values.length,
        usedCount: used.length,
        unused: seed.values.filter((v) => !(seedCounts[v] ?? 0)),
      };
    }
    if (seed.kind === 'frequency-band') {
      return {
        kind: 'frequency-band' as const,
        band: seed.band,
        rankMax: seed.rankMax,
        distinctSeeds: Object.keys(seedCounts).length,
        unlabelledRows,
      };
    }
    return seed;
  }

  function buildCell(cell: Cell): BuiltCell {
    const key = cell.cellKey;
    const mech: DiversityMechanisms = resolveCellMechanisms(cell);
    const totals = totalsByCell.get(key) ?? {
      approved: 0, untaggedRows: 0, unlabelledRows: 0,
    };
    const tagCounts = tagsByCell.get(key) ?? {};
    const seedCounts = seedsByCell.get(key) ?? {};

    const shortfall = computeSpecShortfallFromCounts(
      cell.grammarPoint, tagCounts, totals.approved, mech.target,
    );

    const axes: BuiltAxis[] = mech.axes.map((axis) => {
      const counts = tagCounts[axis.name] ?? {};
      const values = Array.from(
        new Set([...Object.keys(counts), ...Object.keys(axis.floors ?? {})]),
      )
        .sort()
        .map((value) => ({
          value,
          count: counts[value] ?? 0,
          floor: axis.floors?.[value] ?? null,
        }));
      // Rows carrying SOME tag but not this axis are untagged for it too.
      const tagged = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        name: axis.name,
        role: axis.role,
        values,
        untagged: Math.max(0, totals.approved - tagged),
      };
    });

    const built: Omit<BuiltCell, 'provenIssues' | 'unknowns'> = {
      cellKey: key,
      type: cell.exerciseType,
      level: cell.cefrLevel,
      approved: totals.approved,
      target: mech.target,
      atTarget: totals.approved >= mech.target,
      axes,
      seed: buildSeed(cell, mech.seed, seedCounts, totals.unlabelledRows),
      shortfalls: shortfall?.shortfalls ?? [],
    };

    return { ...built, ...countCellIssues(built) };
  }

  const cellsByPoint = new Map<string, BuiltCell[]>();
  for (const cell of enumerateCurriculumCells(ALL_CURRICULA)) {
    if (language && cell.language !== language) continue;
    if (level && cell.cefrLevel !== level) continue;
    if (kind && cell.grammarPoint.kind !== kind) continue;
    const list = cellsByPoint.get(cell.grammarPoint.key) ?? [];
    list.push(buildCell(cell));
    cellsByPoint.set(cell.grammarPoint.key, list);
  }

  const items: Array<{
    key: string; name: string; language: string; cefrLevel: string; kind: string;
    targetOverride: number | null; provenIssues: number; unknowns: number; cells: BuiltCell[];
  }> = [];

  for (const point of ALL_CURRICULA) {
    const cells = cellsByPoint.get(point.key);
    if (!cells || cells.length === 0) continue;

    // The point-level counts are exactly the sum of its cells' — the same
    // numbers as before this became per-cell, just no longer recomputed here.
    const provenIssues = cells.reduce((n, c) => n + c.provenIssues, 0);
    const unknowns = cells.reduce((n, c) => n + c.unknowns, 0);

    items.push({
      key: point.key,
      name: point.name,
      language: point.language,
      cefrLevel: point.cefrLevel,
      kind: point.kind,
      targetOverride: point.targetOverride ?? null,
      provenIssues,
      unknowns,
      cells,
    });
  }

  return c.json({ items });
});
