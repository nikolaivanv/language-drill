/**
 * `pnpm backfill:vocab-target-pos` — one-off tag of `vocab_target.pos` for the
 * rows authored before the column existed (2026-10-17 vocab expansion).
 * Resolution: an ES/DE article display form → noun; one unambiguous corpus
 * class from vocab_lemma.pos_all → that class; anything else → a batched
 * Claude classification (skip with --no-llm). Dry-run by default (the Claude
 * step still runs); --apply writes `pos` only where it is still null;
 * --revert <artifact> --apply nulls exactly the rows an applied run wrote.
 * Required env: DATABASE_URL; ANTHROPIC_API_KEY unless --no-llm.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { VOCAB_POS, parseVocabPos, type VocabPos } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { vocabLemma, vocabTarget } from '../src/schema';
import { requireEnv } from '../src/lib/env';

const CLASSIFIER_MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 40;
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'der', 'die', 'das', 'ein', 'eine']);
const UD_TO_POS: Record<string, VocabPos> = {
  NOUN: 'noun',
  PROPN: 'noun',
  VERB: 'verb',
  AUX: 'verb',
  ADJ: 'adjective',
  ADV: 'adverb',
  INTJ: 'other',
  CCONJ: 'other',
  SCONJ: 'other',
  ADP: 'other',
  PRON: 'other',
  DET: 'other',
  NUM: 'other',
  PART: 'other',
  CLASSIFIER: 'other',
};

export interface Args {
  apply: boolean;
  noLlm: boolean;
  revert: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { apply: false, noLlm: false, revert: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--no-llm') args.noLlm = true;
    else if (a === '--revert') {
      const v = argv[++i];
      if (!v) throw new Error('--revert requires an artifact path');
      args.revert = v;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

export function posFromUd(
  language: string,
  displayForm: string,
  posAll: readonly string[] | null,
): VocabPos | null {
  const tokens = displayForm.trim().split(/\s+/);
  if ((language === 'ES' || language === 'DE') && tokens.length > 1 && ARTICLES.has(tokens[0].toLowerCase())) {
    return 'noun';
  }
  if (tokens.length > 1 || !posAll || posAll.length === 0) return null;
  const classes = new Set(posAll.map((t) => UD_TO_POS[t]).filter((p): p is VocabPos => p !== undefined));
  return classes.size === 1 ? [...classes][0] : null;
}

interface Row {
  id: string;
  language: string;
  lemma: string;
  displayForm: string;
  gloss: string;
  posAll: string[] | null;
}

export type PlannedPos = {
  id: string;
  lemma: string;
  pos: VocabPos;
  source: 'article' | 'corpus' | 'llm';
};

async function loadRows(db: Db): Promise<Row[]> {
  return db
    .select({
      id: vocabTarget.id,
      language: vocabTarget.language,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
      gloss: vocabTarget.gloss,
      posAll: vocabLemma.posAll,
    })
    .from(vocabTarget)
    .leftJoin(
      vocabLemma,
      and(eq(vocabLemma.language, vocabTarget.language), eq(vocabLemma.lemma, sql`lower(${vocabTarget.lemma})`)),
    )
    .where(isNull(vocabTarget.pos));
}

async function classifyBatch(
  client: Anthropic,
  language: string,
  batch: readonly { id: string; lemma: string; displayForm: string; gloss: string }[],
): Promise<Map<string, VocabPos | null>> {
  const lines = batch.map((r, i) => `${i}. "${r.displayForm}" — meaning: "${r.gloss}"`).join('\n');
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4000,
    tools: [
      {
        name: 'record_word_classes',
        description: 'Record the word class of each item.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { index: { type: 'integer' }, pos: { type: 'string', enum: [...VOCAB_POS] } },
                required: ['index', 'pos'],
              },
            },
          },
          required: ['items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_word_classes' },
    messages: [
      {
        role: 'user',
        content: `Language: ${language === 'ES' ? 'Spanish' : language === 'DE' ? 'German' : 'Turkish'}. Classify each vocabulary item, as used with the given meaning, as noun, verb, adjective, adverb, phrase (a fixed multi-word expression that is not a single verb), or other (conjunction, interjection, pronoun, …). A verb with its reflexive pronoun or governed preposition ("acordarse de", "sich freuen auf") is a verb; a Turkish noun + light verb ("futbol oynamak") is a verb.\n\n${lines}`,
      },
    ],
  });
  const out = new Map<string, VocabPos | null>();
  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return out;
  const items = (block.input as { items?: { index: number; pos: string }[] }).items ?? [];
  for (const it of items) {
    const row = batch[it.index];
    if (row) out.set(row.id, parseVocabPos(it.pos));
  }
  return out;
}

async function plan(db: Db, noLlm: boolean): Promise<{ planned: PlannedPos[]; unresolved: Row[] }> {
  const rows = await loadRows(db);
  const planned: PlannedPos[] = [];
  const needsLlm: Row[] = [];
  for (const r of rows) {
    const pos = posFromUd(r.language, r.displayForm, r.posAll);
    if (pos) {
      const source = posFromUd(r.language, r.displayForm, null) === 'noun' ? 'article' : 'corpus';
      planned.push({ id: r.id, lemma: r.lemma, pos, source });
    } else needsLlm.push(r);
  }
  if (noLlm) return { planned, unresolved: needsLlm };

  const unresolved: Row[] = [];
  const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  for (const language of ['ES', 'DE', 'TR']) {
    const rowsForLang = needsLlm.filter((r) => r.language === language);
    for (let i = 0; i < rowsForLang.length; i += BATCH_SIZE) {
      const batch = rowsForLang.slice(i, i + BATCH_SIZE);
      const result = await classifyBatch(client, language, batch);
      for (const r of batch) {
        const pos = result.get(r.id) ?? null;
        if (pos) planned.push({ id: r.id, lemma: r.lemma, pos, source: 'llm' });
        else unresolved.push(r);
      }
    }
  }
  // Rows in a language outside ES/DE/TR never reach a batch; keep them visible.
  const handled = new Set(['ES', 'DE', 'TR']);
  unresolved.push(...needsLlm.filter((r) => !handled.has(r.language)));
  return { planned, unresolved };
}

async function applyPlanned(db: Db, planned: readonly PlannedPos[]): Promise<number> {
  let n = 0;
  for (const p of planned) {
    const res = await db
      .update(vocabTarget)
      .set({ pos: p.pos })
      .where(and(eq(vocabTarget.id, p.id), isNull(vocabTarget.pos)))
      .returning({ id: vocabTarget.id });
    n += res.length;
  }
  return n;
}

async function revert(db: Db, artifactPath: string, apply: boolean): Promise<void> {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { applied: boolean; planned: PlannedPos[] };
  if (!artifact.applied) throw new Error(`${artifactPath} is a dry-run artifact; nothing to revert`);
  const ids = artifact.planned.map((p) => p.id);
  console.log(`revert: ${ids.length} rows listed in ${artifactPath}`);
  if (!apply) {
    console.log('dry-run — pass --apply to null pos on these rows');
    return;
  }
  let n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const res = await db
      .update(vocabTarget)
      .set({ pos: null })
      .where(inArray(vocabTarget.id, ids.slice(i, i + 500)))
      .returning({ id: vocabTarget.id });
    n += res.length;
  }
  console.log(`reverted ${n} rows`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = createDb(requireEnv('DATABASE_URL'));

  if (args.revert) {
    await revert(db, args.revert, args.apply);
    return;
  }

  const { planned, unresolved } = await plan(db, args.noLlm);
  const bySource = planned.reduce<Record<string, number>>((acc, p) => {
    acc[p.source] = (acc[p.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`planned: ${planned.length}`, bySource);
  console.log(`unresolved: ${unresolved.length}`);
  for (const p of planned.filter((x) => x.source === 'llm').slice(0, 20)) {
    console.log(`  llm  ${p.lemma} → ${p.pos}`);
  }
  for (const r of unresolved.slice(0, 20)) console.log(`  none ${r.language} ${r.displayForm}`);

  const written = args.apply ? await applyPlanned(db, planned) : 0;
  const dir = path.resolve('backfill-runs');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vocab-target-pos-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ applied: args.apply, written, planned, unresolved }, null, 2));
  console.log(args.apply ? `wrote ${written} rows` : 'dry-run — pass --apply to write');
  console.log(`artifact: ${file}`);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
