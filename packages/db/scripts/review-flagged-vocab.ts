/**
 * `pnpm review:flagged-vocab` — review + promote authored vocab targets.
 * Default: list rows with status='flagged' for the selected language
 * (`--language`, default ES), grouped by umbrella.
 * `--approve-all`: promote every flagged row for that language to approved.
 * `--approve <id>`: promote a single row (language filter not applied).
 * Required env: DATABASE_URL.
 * Usage: pnpm --filter @language-drill/db review:flagged-vocab \
 *          [--language ES] [--approve-all | --approve <id>]
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { Language, type LearningLanguage } from '@language-drill/shared';

import { createDb } from '../src/client';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';

const DEFAULT_LANGUAGE: LearningLanguage = Language.ES;

export function parseLanguage(argv: readonly string[]): LearningLanguage {
  const i = argv.indexOf('--language');
  const raw = i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
  if (raw === undefined) return DEFAULT_LANGUAGE;
  const upper = raw.toUpperCase();
  const valid = (Object.values(Language) as string[]).filter((l) => l !== Language.EN);
  if (!valid.includes(upper)) {
    throw new Error(`--language must be one of ${valid.join(', ')} (got "${raw}")`);
  }
  return upper as LearningLanguage;
}

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
  const language = parseLanguage(argv);

  if (argv.includes('--approve-all')) {
    const res = await db
      .update(vocabTarget)
      .set({ status: 'approved' })
      .where(and(eq(vocabTarget.language, language), eq(vocabTarget.status, 'flagged')))
      .returning({ id: vocabTarget.id });
    process.stdout.write(`Approved ${res.length} ${language} row(s).\n`);
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
    .where(and(eq(vocabTarget.language, language), eq(vocabTarget.status, 'flagged')))
    .orderBy(vocabTarget.umbrellaKey, vocabTarget.freqRank);

  process.stdout.write(`${rows.length} flagged ${language} vocab target(s):\n`);
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
