// ---------------------------------------------------------------------------
// build-vocab-lemma — join the frequency corpus (lemma, rank) with a
// Wiktextract dump (lemma -> PoS) into the per-language vocab-lemma seed
// artifact consumed by `pnpm --filter @language-drill/db seed:vocab`.
//
// Run with `pnpm --filter @language-drill/ai build:vocab-lemma`.
// Sources are NOT checked in. Input dirs are overridable via env so the large
// (uncommitted) sources can live anywhere:
//   CORPUS_DIR (default scripts/sources)            holds `<lang>.tsv`  (surface\tlemma\trank[\tcefr])
//   WIKTEXTRACT_DIR (default CORPUS_DIR/wiktextract) holds the wiktextract JSONL,
//     either `<lang>.jsonl` or the raw kaikki.org per-language file
//     `kaikki.org-dictionary-<Name>.jsonl` (one JSON object per line w/ `word`+`pos`).
// The JSONL is streamed line-by-line (handles multi-GB raw kaikki dumps).
// Output (committed): packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json
// ---------------------------------------------------------------------------

import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

// English-Wiktionary kaikki.org per-language filenames — used as a fallback
// when `<lang>.jsonl` is absent, so the raw downloads work without renaming.
const KAIKKI_LANG_NAME: Record<Lang, string> = { es: 'Spanish', de: 'German', tr: 'Turkish' };

const SOURCES_DIR = process.env['CORPUS_DIR'] ?? path.join(__dirname, 'sources');
const WIKT_DIR = process.env['WIKTEXTRACT_DIR'] ?? path.join(SOURCES_DIR, 'wiktextract');
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
/** lemma -> lowest corpus rank. Lowercased; blank lemmas dropped. */
function rankByLemmaFromCorpus(corpus: CorpusRow[]): Map<string, number> {
  const rankByLemma = new Map<string, number>();
  for (const c of corpus) {
    const lemma = c.lemma.toLowerCase();
    if (!lemma) continue;
    const existing = rankByLemma.get(lemma);
    if (existing === undefined || c.rank < existing) rankByLemma.set(lemma, c.rank);
  }
  return rankByLemma;
}

/**
 * Builds the seed rows from the corpus rank map + a lemma->PoS map: attaches
 * every attested PoS (sorted, deduped), marks lemmas absent from `posByLemma`
 * as `unmatched` with empty `posAll`, and orders by rank asc (lemma tie-break).
 */
function joinFromMaps(
  rankByLemma: Map<string, number>,
  posByLemma: Map<string, Set<string>>,
): VocabLemmaSeedRow[] {
  const rows: VocabLemmaSeedRow[] = [];
  for (const [lemma, rank] of rankByLemma) {
    const pos = posByLemma.get(lemma);
    if (pos === undefined || pos.size === 0) {
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

/**
 * Pure in-memory join (used by unit tests). Dedupes the corpus by lemma
 * (lowest rank), attaches every attested PoS from the Wiktextract rows, marks
 * unmatched lemmas `source: 'unmatched'`, orders by rank then lemma.
 */
export function joinLemmaPos(corpus: CorpusRow[], wikt: WiktRow[]): VocabLemmaSeedRow[] {
  const posByLemma = new Map<string, Set<string>>();
  for (const w of wikt) {
    const lemma = w.word.toLowerCase();
    if (!lemma) continue;
    const set = posByLemma.get(lemma) ?? new Set<string>();
    set.add(toUpos(w.pos));
    posByLemma.set(lemma, set);
  }
  return joinFromMaps(rankByLemmaFromCorpus(corpus), posByLemma);
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
    } catch (err) {
      console.warn(`[build-vocab-lemma] ${lang}: gap-fill batch failed, skipping ${batch.length} lemmas:`, err);
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

/** Resolve the wiktextract file for a language: `<lang>.jsonl` if present, else the raw kaikki name. */
function resolveWiktPath(lang: Lang): string {
  const direct = path.join(WIKT_DIR, `${lang}.jsonl`);
  if (existsSync(direct)) return direct;
  return path.join(WIKT_DIR, `kaikki.org-dictionary-${KAIKKI_LANG_NAME[lang]}.jsonl`);
}

/**
 * Streams a (possibly multi-GB) wiktextract JSONL line-by-line, recording the
 * attested UD upos tags only for lemmas in `wanted` (the corpus lemma set) so
 * memory stays bounded regardless of dump size. Malformed lines are skipped.
 */
async function streamPosByLemma(
  filePath: string,
  wanted: ReadonlySet<string>,
): Promise<Map<string, Set<string>>> {
  const posByLemma = new Map<string, Set<string>>();
  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line === '') continue;
    let obj: { word?: unknown; pos?: unknown };
    try {
      obj = JSON.parse(line) as { word?: unknown; pos?: unknown };
    } catch {
      continue; // skip malformed line
    }
    if (typeof obj.word !== 'string' || typeof obj.pos !== 'string') continue;
    const lemma = obj.word.toLowerCase();
    if (!wanted.has(lemma)) continue;
    const set = posByLemma.get(lemma) ?? new Set<string>();
    set.add(toUpos(obj.pos));
    posByLemma.set(lemma, set);
  }
  return posByLemma;
}

async function buildLanguage(lang: Lang): Promise<void> {
  const corpusRaw = await fs.readFile(path.join(SOURCES_DIR, `${lang}.tsv`), 'utf-8');
  const rankByLemma = rankByLemmaFromCorpus(parseCorpus(corpusRaw));
  const wanted = new Set(rankByLemma.keys());

  const wiktPath = resolveWiktPath(lang);
  if (!existsSync(wiktPath)) {
    throw new Error(
      `[build-vocab-lemma] ${lang}: wiktextract file not found. Looked for ` +
        `${path.join(WIKT_DIR, `${lang}.jsonl`)} and ${wiktPath}. ` +
        `Set WIKTEXTRACT_DIR to the dir containing the kaikki JSONL.`,
    );
  }
  const posByLemma = await streamPosByLemma(wiktPath, wanted);
  const rows = joinFromMaps(rankByLemma, posByLemma);

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
  const pct = finalRows.length === 0 ? '0' : ((matched / finalRows.length) * 100).toFixed(1);
  console.log(
    `[build-vocab-lemma] ${lang}: ${finalRows.length} lemmas, ${matched} matched (${pct}%), ` +
      `${finalRows.length - matched} unmatched [src: ${path.basename(wiktPath)}] -> ${path.relative(process.cwd(), outPath)}`,
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
