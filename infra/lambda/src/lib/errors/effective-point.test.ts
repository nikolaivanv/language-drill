import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  GRAMMAR_ERROR_TYPE,
  effectiveGrammarPointKey,
  effectiveGrammarPointKeySql,
  errorSampleOrderSql,
} from './effective-point';

const obs = (
  over: Partial<Parameters<typeof effectiveGrammarPointKey>[0]> = {},
): Parameters<typeof effectiveGrammarPointKey>[0] => ({
  errorGrammarPointKey: null,
  hostGrammarPointKey: 'es-b1-imperative-negative-pronouns',
  errorType: 'grammar',
  ...over,
});

describe('effectiveGrammarPointKey', () => {
  it('prefers the per-error attribution over the host point', () => {
    expect(effectiveGrammarPointKey(obs({ errorGrammarPointKey: 'es-a1-gender-agreement' }))).toBe(
      'es-a1-gender-agreement',
    );
  });

  it('falls back to the host point for an unattributed GRAMMAR error', () => {
    expect(effectiveGrammarPointKey(obs())).toBe('es-b1-imperative-negative-pronouns');
  });

  // The evaluator prompt instructs "omit grammarPointKey when the error ... is a
  // vocabulary/spelling slip", so a null on those types means "not about any
  // grammar point" — NOT missing data. Falling back files a lexical-choice slip
  // (el tamaño más barato → una talla más barata) under the point being drilled.
  it('does NOT fall back to the host point for an unattributed vocabulary error', () => {
    expect(effectiveGrammarPointKey(obs({ errorType: 'vocabulary' }))).toBeNull();
  });

  it('does NOT fall back to the host point for an unattributed spelling error', () => {
    expect(effectiveGrammarPointKey(obs({ errorType: 'spelling' }))).toBeNull();
  });

  it('does NOT fall back to the host point for an unattributed pragmatics error', () => {
    expect(effectiveGrammarPointKey(obs({ errorType: 'pragmatics' }))).toBeNull();
  });

  it('still honors an EXPLICIT attribution on a non-grammar error', () => {
    // A spelling slip the evaluator DID tie to the point (Muestramelo →
    // Muéstramelo — the accent shift clitic stacking forces) stays attributed.
    expect(
      effectiveGrammarPointKey({
        errorGrammarPointKey: 'es-b1-imperative-negative-pronouns',
        hostGrammarPointKey: 'es-b1-imperative-negative-pronouns',
        errorType: 'spelling',
      }),
    ).toBe('es-b1-imperative-negative-pronouns');
  });

  it('returns null when neither key is present', () => {
    expect(effectiveGrammarPointKey(obs({ hostGrammarPointKey: null }))).toBeNull();
  });
});

describe('effectiveGrammarPointKeySql', () => {
  // The SQL twin must encode the same rule as the JS resolver: a CASE guard on
  // error_type, not a bare COALESCE. Four call sites are documented as
  // byte-identical twins, so the expression lives in exactly one place.
  it('guards the host fallback on error_type = grammar', () => {
    const { sql } = new PgDialect().sqlToQuery(effectiveGrammarPointKeySql());
    expect(sql).toMatch(/COALESCE/i);
    expect(sql).toMatch(/CASE\s+WHEN/i);
    expect(sql).toContain('"error_grammar_point_key"');
    expect(sql).toContain('"error_type"');
    expect(sql).toContain('"host_grammar_point_key"');
    // Pinned to the constant: the SQL inlines the literal (no bind param), so
    // this is what keeps the two representations of the rule in sync.
    expect(sql).toContain(`'${GRAMMAR_ERROR_TYPE}'`);
  });

  it('binds no parameters, so SELECT and GROUP BY stay structurally identical', () => {
    // Postgres matches a GROUP BY expression to the SELECT list structurally,
    // and two Param nodes with different paramids are NOT equal. Building the
    // expression twice (once per clause) with a bound literal therefore fails
    // with `column "error_observations.error_grammar_point_key" must appear in
    // the GROUP BY clause` — verified against Postgres 17. The comparison
    // literal must be inlined.
    expect(new PgDialect().sqlToQuery(effectiveGrammarPointKeySql()).params).toEqual([]);
  });

  it('renders no bare COALESCE of the two key columns', () => {
    // Guards the exact regression: COALESCE(error_grammar_point_key,
    // host_grammar_point_key) with nothing between them.
    const { sql } = new PgDialect().sqlToQuery(effectiveGrammarPointKeySql());
    expect(sql).not.toMatch(/"error_grammar_point_key",\s*"[a-z_]*"\."host_grammar_point_key"/i);
  });
});

describe('errorSampleOrderSql', () => {
  const rendered = () => new PgDialect().sqlToQuery(errorSampleOrderSql()).sql;

  it('prefers an explicitly attributed error over a host-fallback one', () => {
    expect(rendered()).toMatch(/"error_grammar_point_key"\s+IS\s+NOT\s+NULL.*DESC/i);
  });

  it('orders by recency after attribution', () => {
    const sql = rendered();
    expect(sql).toMatch(/"occurred_at"\s+DESC/i);
    expect(sql.indexOf('error_grammar_point_key')).toBeLessThan(sql.indexOf('occurred_at'));
  });

  it('breaks a same-instant tie totally, so the pick is reproducible', () => {
    // Every error from one submission shares occurred_at to the millisecond;
    // without these, array_agg picked the winner arbitrarily.
    const sql = rendered();
    expect(sql).toMatch(/"severity"\s*=/i);
    expect(sql).toMatch(/"id"\s+DESC/i);
  });

  it('binds no parameters', () => {
    // Same reason as the key expression: it is emitted twice per query (once
    // per array_agg) and must not introduce per-call Param nodes.
    expect(new PgDialect().sqlToQuery(errorSampleOrderSql()).params).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Twin-drift guard
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'dist' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('no call site reintroduces the bare host fallback', () => {
  // Four per-point error surfaces are documented as byte-identical twins
  // (routes/progress.ts, routes/sessions.ts, routes/insights.ts,
  // lib/mastery/rank-context.ts). Each must resolve the effective point through
  // the helper above; a bare COALESCE / ?? of the two key columns silently
  // refiles vocabulary and spelling slips under the point being drilled.
  const SRC = join(__dirname, '..', '..');
  const SELF = join('errors', 'effective-point.ts');

  it('has no bare SQL COALESCE of errorGrammarPointKey and hostGrammarPointKey', () => {
    const offenders = sourceFiles(SRC).filter((f) => {
      if (f.endsWith(SELF)) return false;
      const body = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
      return /COALESCE\(\s*\$\{[^}]*errorGrammarPointKey\}\s*,\s*\$\{[^}]*hostGrammarPointKey\}/i.test(
        body,
      );
    });
    expect(offenders).toEqual([]);
  });

  it('has no bare JS ?? fallback from errorGrammarPointKey to hostGrammarPointKey', () => {
    const offenders = sourceFiles(SRC).filter((f) => {
      if (f.endsWith(SELF)) return false;
      const body = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
      return /errorGrammarPointKey\s*\?\?\s*[\w.]*hostGrammarPointKey/.test(body);
    });
    expect(offenders).toEqual([]);
  });
});
