/**
 * `pnpm backfill:vocab-article-form` — one-off stamp of `content_json.articleForm`
 * on the approved ES/DE vocab_recall pool, so the article rule (2026-10-17,
 * `packages/shared/src/vocab-article.ts`) covers rows generated before the
 * generation path started writing it.
 *
 * Resolution per row, same helper as the insert path (`articleFormFor`):
 *   1. the curated vocab_target display form for the row's word ("la espalda")
 *   2. an article the generator already put on `expectedWord` ("die Küche")
 *   3. otherwise — a bare word with no curated target — one batched Claude
 *      call per ~40 rows classifies it: a noun gets its article form, anything
 *      else (verb, adjective, adverb) gets null and stays article-free.
 * A row with no resolvable article is left untouched (no requirement), which is
 * the pre-change behavior.
 *
 * Writes are keyed on the row's primary key and only ADD the key, so the
 * rollback is `--revert <artifact> --apply`, which strips `articleForm` from
 * exactly the rows the artifact lists. Every run writes the artifact to
 * `./backfill-runs/vocab-article-form-<timestamp>.json`.
 *
 * Dry-run by default (step 3 still calls Claude — pass --no-llm to skip it);
 * --apply writes. Idempotent: rows already carrying `articleForm` are skipped.
 *
 * Required env: DATABASE_URL; ANTHROPIC_API_KEY unless --no-llm.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import {
  articleFormFor,
  matchTargetDisplayForm,
} from '../src/generation/vocab-article-form';
import { exercises, vocabTarget } from '../src/schema';
import { requireEnv } from '../src/lib/env';

const CLASSIFIER_MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 40;
const DEFINITE: Record<string, readonly string[]> = {
  ES: ['el', 'la', 'los', 'las'],
  DE: ['der', 'die', 'das'],
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

interface Row {
  id: string;
  language: string;
  umbrellaKey: string;
  expectedWord: string;
  prompt: string;
}

export interface Planned {
  id: string;
  expectedWord: string;
  articleForm: string;
  source: 'target' | 'expected-word' | 'llm';
}

/**
 * Validate a classifier answer: it must be one definite article of the row's
 * language followed by the row's own (bare) word, so the model can choose a
 * gender but never rewrite the word.
 */
export function acceptClassified(
  language: string,
  expectedWord: string,
  answer: string | null,
): string | null {
  if (!answer) return null;
  const trimmed = answer.trim().replace(/\s+/g, ' ');
  const space = trimmed.indexOf(' ');
  if (space <= 0) return null;
  const article = trimmed.slice(0, space).toLowerCase();
  const word = trimmed.slice(space + 1);
  if (!(DEFINITE[language] ?? []).includes(article)) return null;
  if (word.toLowerCase() !== expectedWord.trim().toLowerCase()) return null;
  return `${article} ${word}`;
}

async function loadRows(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      id: exercises.id,
      language: exercises.language,
      umbrellaKey: exercises.grammarPointKey,
      expectedWord: sql<string>`${exercises.contentJson}->>'expectedWord'`,
      prompt: sql<string>`${exercises.contentJson}->>'prompt'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.type, 'vocab_recall'),
        inArray(exercises.language, ['ES', 'DE']),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
        sql`not (${exercises.contentJson} ? 'articleForm')`,
      ),
    );
  return rows.filter(
    (r): r is Row => !!r.language && !!r.umbrellaKey && !!r.expectedWord,
  );
}

async function loadTargets(db: Db) {
  const rows = await db
    .select({
      language: vocabTarget.language,
      umbrellaKey: vocabTarget.umbrellaKey,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
    })
    .from(vocabTarget)
    .where(eq(vocabTarget.status, 'approved'));
  const byUmbrella = new Map<string, { lemma: string; displayForm: string }[]>();
  for (const r of rows) {
    const key = `${r.language}|${r.umbrellaKey}`;
    const list = byUmbrella.get(key) ?? [];
    list.push({ lemma: r.lemma, displayForm: r.displayForm });
    byUmbrella.set(key, list);
  }
  return byUmbrella;
}

async function classifyBatch(
  client: Anthropic,
  language: string,
  batch: readonly Row[],
): Promise<Map<string, string | null>> {
  const articles = (DEFINITE[language] ?? []).join(', ');
  const lines = batch
    .map((r, i) => `${i}. word: "${r.expectedWord}" — definition shown to the learner: "${r.prompt}"`)
    .join('\n');
  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 4000,
    tools: [
      {
        name: 'record_article_forms',
        description: 'Record the article form of each word.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  articleForm: {
                    type: ['string', 'null'],
                    description: `For a NOUN: the definite article (${articles}) followed by the word exactly as given. For any other part of speech: null.`,
                  },
                },
                required: ['index', 'articleForm'],
              },
            },
          },
          required: ['items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_article_forms' },
    messages: [
      {
        role: 'user',
        content: `Language: ${language === 'ES' ? 'Spanish' : 'German'}. For each word below, decide whether it is used as a noun given its definition. If it is a noun, give its standard definite article in the citation (nominative singular, or plural for plural-only nouns) followed by the word exactly as written. Otherwise return null.\n\n${lines}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === 'tool_use');
  const out = new Map<string, string | null>();
  if (!block || block.type !== 'tool_use') return out;
  const items = (block.input as { items?: { index: number; articleForm: string | null }[] }).items ?? [];
  for (const it of items) {
    const row = batch[it.index];
    if (!row) continue;
    out.set(row.id, acceptClassified(language, row.expectedWord, it.articleForm));
  }
  return out;
}

async function plan(db: Db, noLlm: boolean): Promise<{ planned: Planned[]; unresolved: Row[] }> {
  const [rows, targets] = await Promise.all([loadRows(db), loadTargets(db)]);
  const planned: Planned[] = [];
  const needsLlm: Row[] = [];
  for (const r of rows) {
    const displayForm = matchTargetDisplayForm(
      targets.get(`${r.language}|${r.umbrellaKey}`) ?? [],
      r.expectedWord,
    );
    const form = articleFormFor(r.expectedWord, displayForm);
    if (form) {
      planned.push({
        id: r.id,
        expectedWord: r.expectedWord,
        articleForm: form,
        source: displayForm && articleFormFor('', displayForm) ? 'target' : 'expected-word',
      });
    } else if (displayForm === null) {
      needsLlm.push(r);
    }
    // else: a curated target with an article-free display form (verb,
    // adjective) — authoritative "no article", nothing to write.
  }

  const unresolved: Row[] = [];
  if (noLlm) return { planned, unresolved: needsLlm };

  const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  for (const language of ['ES', 'DE']) {
    const rowsForLang = needsLlm.filter((r) => r.language === language);
    for (let i = 0; i < rowsForLang.length; i += BATCH_SIZE) {
      const batch = rowsForLang.slice(i, i + BATCH_SIZE);
      const result = await classifyBatch(client, language, batch);
      for (const r of batch) {
        const form = result.get(r.id) ?? null;
        if (form) planned.push({ id: r.id, expectedWord: r.expectedWord, articleForm: form, source: 'llm' });
        else unresolved.push(r);
      }
    }
  }
  return { planned, unresolved };
}

async function applyPlanned(db: Db, planned: readonly Planned[]): Promise<number> {
  let n = 0;
  for (const p of planned) {
    const res = await db
      .update(exercises)
      .set({
        contentJson: sql`${exercises.contentJson} || jsonb_build_object('articleForm', ${p.articleForm}::text)`,
      })
      .where(and(eq(exercises.id, p.id), sql`not (${exercises.contentJson} ? 'articleForm')`))
      .returning({ id: exercises.id });
    n += res.length;
  }
  return n;
}

async function revert(db: Db, artifactPath: string, apply: boolean): Promise<void> {
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { applied: boolean; planned: Planned[] };
  if (!artifact.applied) throw new Error(`${artifactPath} is a dry-run artifact; nothing to revert`);
  const ids = artifact.planned.map((p) => p.id);
  console.log(`revert: ${ids.length} rows listed in ${artifactPath}`);
  if (!apply) {
    console.log('dry-run — pass --apply to strip articleForm from these rows');
    return;
  }
  let n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const res = await db
      .update(exercises)
      .set({ contentJson: sql`${exercises.contentJson} - 'articleForm'` })
      .where(inArray(exercises.id, ids.slice(i, i + 500)))
      .returning({ id: exercises.id });
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
  console.log(`left without an article (non-nouns / unresolved): ${unresolved.length}`);
  for (const p of planned.filter((x) => x.source === 'llm').slice(0, 20)) {
    console.log(`  llm  ${p.expectedWord} → ${p.articleForm}`);
  }
  for (const r of unresolved.slice(0, 20)) console.log(`  none ${r.language} ${r.expectedWord}`);

  const written = args.apply ? await applyPlanned(db, planned) : 0;
  const dir = path.resolve('backfill-runs');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vocab-article-form-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
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
