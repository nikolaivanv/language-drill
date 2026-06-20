// ---------------------------------------------------------------------------
// build-vocab-lemma — join the frequency corpus (lemma, rank) with a
// Wiktextract dump (lemma -> PoS) into the per-language vocab-lemma seed
// artifact consumed by `pnpm --filter @language-drill/db seed:vocab`.
//
// Run with `pnpm --filter @language-drill/ai build:vocab-lemma`.
// Sources are NOT checked in:
//   packages/ai/scripts/sources/{es,de,tr}.tsv             (surface\tlemma\trank[\tcefr])
//   packages/ai/scripts/sources/wiktextract/{es,de,tr}.jsonl ({ "word":..., "pos":... } per line)
// Output (committed): packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

const SOURCES_DIR = path.join(__dirname, 'sources');
const WIKT_DIR = path.join(SOURCES_DIR, 'wiktextract');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'frequency', 'vocab-lemma');

export type CorpusRow = { lemma: string; rank: number };
export type WiktRow = { word: string; pos: string };
export type VocabLemmaSeedRow = {
  lemma: string;
  rank: number;
  posAll: string[];
  source: 'wiktextract' | 'llm' | 'unmatched';
};

// Wiktextract pos string -> UD upos. Unmapped values are uppercased verbatim
// (harmless — only 'VERB' is consulted by the verb filter).
export const POS_MAP: Record<string, string> = {
  verb: 'VERB',
  noun: 'NOUN',
  adj: 'ADJ',
  adv: 'ADV',
  name: 'PROPN',
  num: 'NUM',
  pron: 'PRON',
  adp: 'ADP',
  prep: 'ADP',
  conj: 'CCONJ',
  det: 'DET',
  intj: 'INTJ',
};

function toUpos(pos: string): string {
  return POS_MAP[pos.toLowerCase()] ?? pos.toUpperCase();
}

/**
 * Pure join. Dedupes the corpus by lemma (keeping the lowest rank), attaches
 * every attested PoS from the Wiktextract rows, and orders the result by rank
 * ascending (lemma tie-break). Unmatched lemmas keep their rank with an empty
 * `posAll` and `source: 'unmatched'`.
 */
export function joinLemmaPos(corpus: CorpusRow[], wikt: WiktRow[]): VocabLemmaSeedRow[] {
  // lemma -> sorted, deduped UD upos set
  const posByLemma = new Map<string, Set<string>>();
  for (const w of wikt) {
    const lemma = w.word.toLowerCase();
    if (!lemma) continue;
    const set = posByLemma.get(lemma) ?? new Set<string>();
    set.add(toUpos(w.pos));
    posByLemma.set(lemma, set);
  }

  // lemma -> lowest rank
  const rankByLemma = new Map<string, number>();
  for (const c of corpus) {
    const lemma = c.lemma.toLowerCase();
    if (!lemma) continue;
    const existing = rankByLemma.get(lemma);
    if (existing === undefined || c.rank < existing) rankByLemma.set(lemma, c.rank);
  }

  const rows: VocabLemmaSeedRow[] = [];
  for (const [lemma, rank] of rankByLemma) {
    const pos = posByLemma.get(lemma);
    if (pos === undefined) {
      rows.push({ lemma, rank, posAll: [], source: 'unmatched' });
    } else {
      rows.push({ lemma, rank, posAll: [...pos].sort(), source: 'wiktextract' });
    }
  }

  rows.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0,
  );
  return rows;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rewrites `unmatched` rows whose lemma appears in `resolved` to `source: 'llm'`
 * with the resolved PoS. `wiktextract` rows are never touched. Returns a new
 * array; ordering is preserved.
 */
export function applyGapFill(
  rows: VocabLemmaSeedRow[],
  resolved: Map<string, string[]>,
): VocabLemmaSeedRow[] {
  return rows.map((r) => {
    if (r.source !== 'unmatched') return r;
    const pos = resolved.get(r.lemma);
    if (pos === undefined || pos.length === 0) return r;
    return { ...r, posAll: [...new Set(pos)].sort(), source: 'llm' };
  });
}

/**
 * Asks Claude for the parts of speech of unmatched lemmas, in batches.
 * Returns lemma -> UD upos[]. Best-effort: any batch that fails to parse is
 * skipped (those lemmas stay 'unmatched'). Manual/dev-time only.
 */
async function gapFillPos(lang: Lang, lemmas: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (lemmas.length === 0) return out;
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  for (const batch of chunk(lemmas, 100)) {
    const prompt =
      `For each ${lang.toUpperCase()} word below, return its parts of speech as UD upos tags ` +
      `(VERB, NOUN, ADJ, ADV, PROPN, NUM, PRON, ADP, DET, INTJ, CCONJ). ` +
      `Reply ONLY with JSON: {"word": ["TAG", ...], ...}. Words:\n${batch.join('\n')}`;
    try {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = resp.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, string[]>;
      for (const [word, tags] of Object.entries(json)) {
        if (Array.isArray(tags)) out.set(word.toLowerCase(), tags.map((t) => t.toUpperCase()));
      }
    } catch {
      // skip this batch — its lemmas remain 'unmatched'
    }
  }
  return out;
}

function parseCorpus(raw: string): CorpusRow[] {
  const rows: CorpusRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') continue;
    const cols = trimmed.split('\t');
    const lemma = (cols[1] ?? '').toLowerCase();
    const rank = Number.parseInt(cols[2] ?? '', 10);
    if (!lemma || !Number.isFinite(rank) || rank < 1) continue;
    rows.push({ lemma, rank });
  }
  return rows;
}

function parseWiktextract(raw: string): WiktRow[] {
  const rows: WiktRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const obj = JSON.parse(trimmed) as { word?: unknown; pos?: unknown };
      if (typeof obj.word === 'string' && typeof obj.pos === 'string') {
        rows.push({ word: obj.word, pos: obj.pos });
      }
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

async function buildLanguage(lang: Lang): Promise<void> {
  const corpusRaw = await fs.readFile(path.join(SOURCES_DIR, `${lang}.tsv`), 'utf-8');
  const wiktRaw = await fs.readFile(path.join(WIKT_DIR, `${lang}.jsonl`), 'utf-8');
  const rows = joinLemmaPos(parseCorpus(corpusRaw), parseWiktextract(wiktRaw));

  // Gap-fill: recover PoS for unmatched lemmas via Claude (skipped unless
  // GAP_FILL=1 and ANTHROPIC_API_KEY is set — the join alone is a valid build).
  let finalRows = rows;
  if (process.env['GAP_FILL'] === '1') {
    const unmatched = rows.filter((r) => r.source === 'unmatched').map((r) => r.lemma);
    const resolved = await gapFillPos(lang, unmatched);
    finalRows = applyGapFill(rows, resolved);
    console.log(`[build-vocab-lemma] ${lang}: gap-filled ${resolved.size}/${unmatched.length}`);
  }

  const outPath = path.join(OUTPUT_DIR, `${lang}.json`);
  await fs.writeFile(outPath, JSON.stringify(finalRows) + '\n', 'utf-8');
  const matched = finalRows.filter((r) => r.source !== 'unmatched').length;
  console.log(
    `[build-vocab-lemma] ${lang}: ${finalRows.length} lemmas, ${matched} matched, ` +
      `${finalRows.length - matched} unmatched -> ${path.relative(process.cwd(), outPath)}`,
  );
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  for (const lang of LANGUAGES) await buildLanguage(lang);
}

// Only run when invoked directly, so the test can import the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
