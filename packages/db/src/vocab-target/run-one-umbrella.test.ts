import { describe, expect, it, vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import { runOneUmbrella } from './run-one-umbrella';

const umbrella = {
  key: 'es-a1-vocab-food-drink',
  kind: 'vocab',
  name: 'Food and drink (A1)',
  description: 'Core A1 food vocabulary.',
  cefrLevel: 'A1',
  language: 'ES',
} as unknown as GrammarPoint;

function mockClient(words: unknown[]) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ words }) }],
      }),
    },
  };
}

// db.select(...).from(...).where(...) resolving to vocab_lemma rank rows.
// The same mock also backs `loadFrequencyBand`'s internal query, which
// chains `.orderBy(...)` after `.where(...)` — so `.where()` returns a
// promise-like value that is directly awaitable AND exposes `.orderBy()`
// resolving to the same rows (ordering is irrelevant to these tests).
function mockDb(rankByLemma: Record<string, number>) {
  const rows = Object.entries(rankByLemma).map(([lemma, rank]) => ({ lemma, rank }));
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const result = Promise.resolve(rows) as Promise<typeof rows> & {
            orderBy: () => Promise<typeof rows>;
          };
          result.orderBy = () => Promise.resolve(rows);
          return result;
        },
      }),
    }),
  };
}

describe('runOneUmbrella', () => {
  it('drops invalid words, joins freq rank, sets tier + flagged status', async () => {
    const client = mockClient([
      { displayForm: 'la manzana', lemma: 'manzana', gloss: 'apple', exampleSentence: 'Como una manzana.' },
      { displayForm: 'buenos días', lemma: 'buenos días', gloss: 'hi', exampleSentence: 'Buenos días.' }, // multi-token → dropped
      { displayForm: 'el pan', lemma: 'pan', gloss: 'bread', exampleSentence: 'Compro pan.' },
    ]);
    const db = mockDb({ manzana: 800, pan: 300 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 3,
      avoidWords: [],
    });

    expect(out.rawCount).toBe(3);
    expect(out.keptCount).toBe(2);
    const byLemma = Object.fromEntries(out.rows.map((r) => [r.lemma, r]));
    expect(byLemma.manzana).toMatchObject({
      language: 'ES',
      umbrellaKey: 'es-a1-vocab-food-drink',
      cefrLevel: 'A1',
      freqRank: 800,
      tier: 'core',
      status: 'flagged',
      source: 'llm',
    });
    expect(byLemma.pan.tier).toBe('core');
  });

  it('leaves freqRank null (tier extended) for lemmas absent from vocab_lemma', async () => {
    const client = mockClient([
      { displayForm: 'el zumo', lemma: 'zumo', gloss: 'juice', exampleSentence: 'Bebo zumo.' },
    ]);
    const db = mockDb({}); // no matches
    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 1,
      avoidWords: [],
    });
    expect(out.rows[0]).toMatchObject({ freqRank: null, tier: 'extended' });
  });

  it('dedups a case-variant lemma and drops words matching the avoid-list case-insensitively', async () => {
    const client = mockClient([
      { displayForm: 'el pan', lemma: 'pan', gloss: 'bread', exampleSentence: 'Compro pan fresco.' },
      { displayForm: 'el Pan', lemma: 'Pan', gloss: 'bread', exampleSentence: 'Me gusta el Pan.' }, // case-variant dup → dropped
      { displayForm: 'la leche', lemma: 'leche', gloss: 'milk', exampleSentence: 'Bebo leche fría.' }, // avoid-listed → dropped
    ]);
    const db = mockDb({ pan: 400 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 3,
      avoidWords: ['LECHE'],
    });

    expect(out.rawCount).toBe(3);
    expect(out.keptCount).toBe(1);
    expect(out.rows.map((r) => r.lemma)).toEqual(['pan']);
  });

  it('parses words out of prose wrapped around the JSON payload', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: 'Here are the words:\n{"words":[{"displayForm":"el pan","lemma":"pan","gloss":"bread","exampleSentence":"Compro pan fresco."}]}\nHope that helps!',
            },
          ],
        }),
      },
    };
    const db = mockDb({ pan: 400 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 1,
      avoidWords: [],
    });

    expect(out.keptCount).toBe(1);
    expect(out.rows[0]).toMatchObject({ lemma: 'pan' });
  });
});
