// ---------------------------------------------------------------------------
// build-frequency — convert maintainer-supplied corpus TSVs into the per-
// language frequency dictionaries consumed by `@language-drill/ai/frequency`.
// ---------------------------------------------------------------------------
//
// Run with `pnpm --filter @language-drill/ai build:frequency`.
// Source TSVs are NOT checked in — they live on the maintainer's machine at
// `packages/ai/scripts/sources/{es,de,tr}.tsv`. See docs/data-sources.md for
// where each corpus is sourced from and licensing terms.
//
// TSV format (tab-delimited, no header row):
//   surface_form<TAB>lemma<TAB>rank[<TAB>cefr]
//
// Behavior:
//   - skip rows where `surface_form` is empty or contains whitespace
//   - lowercase keys (so the runtime lookup can match the lowercased
//     `TokenSpan.key` produced by `packages/shared/src/tokenize.ts`)
//   - validate `rank` is a positive integer; skip otherwise
//   - validate `cefr` against `CefrLevel`; drop the column if it's anything
//     else, but keep the row
//   - dedupe by surface form, keeping the row with the lowest rank
//   - cap each language at the top 50_000 entries by rank ascending
//
// Output: `packages/ai/src/frequency/{es,de,tr}.json` in the shape
// `Record<surface_form, { lemma: string; rank: number; cefr?: CefrLevel }>`.
// JSON is compact (no indentation) to keep the bundled size under the 2 MB
// cap from Req 1.2.
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CefrLevel } from '@language-drill/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

// Lowered from 50_000 after the first build produced 2.0-2.2 MB per language
// (Req 1.2: ≤ 2 MB per language). 42k gives ~1.8 MB headroom across ES/DE/TR.
const MAX_ENTRIES_PER_LANGUAGE = 42_000;

const SOURCES_DIR = path.join(__dirname, 'sources');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'frequency');

const VALID_CEFR = new Set<string>(Object.values(CefrLevel));

type FrequencyEntry = { lemma: string; rank: number; cefr?: CefrLevel };
type FrequencyFile = Record<string, FrequencyEntry>;

type ParsedRow = { surfaceForm: string; lemma: string; rank: number; cefr?: CefrLevel };

function parseRow(line: string): ParsedRow | null {
  const cols = line.split('\t');
  if (cols.length < 3) return null;
  const surfaceFormRaw = cols[0] ?? '';
  const lemma = cols[1] ?? '';
  const rankRaw = cols[2] ?? '';
  const cefrRaw = cols[3];

  if (surfaceFormRaw === '' || /\s/u.test(surfaceFormRaw)) return null;
  if (lemma === '') return null;

  const rank = Number.parseInt(rankRaw, 10);
  if (!Number.isFinite(rank) || rank < 1 || String(rank) !== rankRaw.trim()) return null;

  const surfaceForm = surfaceFormRaw.toLowerCase();
  const cefr = cefrRaw && VALID_CEFR.has(cefrRaw) ? (cefrRaw as CefrLevel) : undefined;
  return { surfaceForm, lemma, rank, cefr };
}

async function buildLanguage(lang: Lang): Promise<void> {
  const tsvPath = path.join(SOURCES_DIR, `${lang}.tsv`);
  let raw: string;
  try {
    raw = await fs.readFile(tsvPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `[build-frequency] Source TSV not found: ${tsvPath}\n` +
          `Source it per docs/data-sources.md, drop it at packages/ai/scripts/sources/${lang}.tsv, and re-run.`,
      );
    }
    throw err;
  }

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') continue;
    const parsed = parseRow(trimmed);
    if (parsed === null) {
      skipped++;
      continue;
    }
    rows.push(parsed);
  }

  // Sort by rank ascending so first-seen-wins dedupe keeps the rarest-known
  // entry for each surface form, and the 50k cap drops the least-frequent
  // tail.
  rows.sort((a, b) => a.rank - b.rank);

  const output: FrequencyFile = {};
  let kept = 0;
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(output, row.surfaceForm)) continue;
    output[row.surfaceForm] =
      row.cefr === undefined
        ? { lemma: row.lemma, rank: row.rank }
        : { lemma: row.lemma, rank: row.rank, cefr: row.cefr };
    kept++;
    if (kept >= MAX_ENTRIES_PER_LANGUAGE) break;
  }

  const outputPath = path.join(OUTPUT_DIR, `${lang}.json`);
  await fs.writeFile(outputPath, JSON.stringify(output) + '\n', 'utf-8');
  console.log(
    `[build-frequency] ${lang}: wrote ${kept} entries to ${path.relative(process.cwd(), outputPath)} (skipped ${skipped} malformed rows)`,
  );
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  for (const lang of LANGUAGES) {
    await buildLanguage(lang);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
