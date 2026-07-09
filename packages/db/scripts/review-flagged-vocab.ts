/**
 * `pnpm review:flagged-vocab` — review + promote authored vocab targets.
 * Default: list ES rows with status='flagged', grouped by umbrella.
 * `--approve-all`: promote every flagged ES row to approved.
 * `--approve <id>`: promote a single row.
 * Required env: DATABASE_URL.
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';

import { createDb } from '../src/client';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';

export type FlaggedRowView = {
  umbrellaKey: string;
  displayForm: string;
  lemma: string;
  gloss: string;
  tier: string;
  freqRank: number | null;
  exampleSentence: string;
};

export function formatFlaggedRow(row: FlaggedRowView): string {
  const rank = row.freqRank === null ? 'n/a' : String(row.freqRank);
  return `${row.umbrellaKey} | ${row.displayForm} (${row.lemma}) — ${row.gloss} [${row.tier}, ${rank}] :: ${row.exampleSentence}`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv('DATABASE_URL'));
  const argv = process.argv.slice(2);

  if (argv.includes('--approve-all')) {
    const res = await db
      .update(vocabTarget)
      .set({ status: 'approved' })
      .where(and(eq(vocabTarget.language, 'ES'), eq(vocabTarget.status, 'flagged')))
      .returning({ id: vocabTarget.id });
    process.stdout.write(`Approved ${res.length} row(s).\n`);
    return;
  }

  const approveIdx = argv.indexOf('--approve');
  if (approveIdx !== -1 && argv[approveIdx + 1]) {
    const id = argv[approveIdx + 1];
    const res = await db
      .update(vocabTarget)
      .set({ status: 'approved' })
      .where(eq(vocabTarget.id, id))
      .returning({ id: vocabTarget.id });
    process.stdout.write(`Approved ${res.length} row(s).\n`);
    return;
  }

  const rows = await db
    .select({
      id: vocabTarget.id,
      umbrellaKey: vocabTarget.umbrellaKey,
      displayForm: vocabTarget.displayForm,
      lemma: vocabTarget.lemma,
      gloss: vocabTarget.gloss,
      tier: vocabTarget.tier,
      freqRank: vocabTarget.freqRank,
      exampleSentence: vocabTarget.exampleSentence,
    })
    .from(vocabTarget)
    .where(and(eq(vocabTarget.language, 'ES'), eq(vocabTarget.status, 'flagged')))
    .orderBy(vocabTarget.umbrellaKey, vocabTarget.freqRank);

  process.stdout.write(`${rows.length} flagged ES vocab target(s):\n`);
  for (const r of rows) {
    process.stdout.write(`  [${r.id}] ${formatFlaggedRow(r)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
