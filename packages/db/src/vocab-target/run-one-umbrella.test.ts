import { describe, expect, it, vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import { runOneUmbrella } from './run-one-umbrella';
import { planFillMixRequest } from './mix';

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

// These cases exercise parse/validate/dedup/join only, on noun-only fixtures, so
// they run against a word-class group (no mix enforcement, single call).
const nounGroup = { ...umbrella, vocabGroup: { label: 'nouns', pos: ['noun'] } } as unknown as GrammarPoint;

describe('runOneUmbrella', () => {
  it('drops invalid words, joins freq rank, sets tier + flagged status', async () => {
    const client = mockClient([
      { displayForm: 'la manzana', lemma: 'manzana', gloss: 'apple', exampleSentence: 'Como una manzana.', pos: 'noun' },
      { displayForm: 'buenos días', lemma: 'buenos días', gloss: 'hi', exampleSentence: 'Buenos días.', pos: 'noun' }, // multi-token → dropped
      { displayForm: 'el pan', lemma: 'pan', gloss: 'bread', exampleSentence: 'Compro pan.', pos: 'noun' },
    ]);
    const db = mockDb({ manzana: 800, pan: 300 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella: nounGroup,
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
      { displayForm: 'el zumo', lemma: 'zumo', gloss: 'juice', exampleSentence: 'Bebo zumo.', pos: 'noun' },
    ]);
    const db = mockDb({}); // no matches
    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella: nounGroup,
      wordCount: 1,
      avoidWords: [],
    });
    expect(out.rows[0]).toMatchObject({ freqRank: null, tier: 'extended' });
  });

  it('dedups a case-variant lemma and drops words matching the avoid-list case-insensitively', async () => {
    const client = mockClient([
      { displayForm: 'el pan', lemma: 'pan', gloss: 'bread', exampleSentence: 'Compro pan fresco.', pos: 'noun' },
      { displayForm: 'el Pan', lemma: 'Pan', gloss: 'bread', exampleSentence: 'Me gusta el Pan.', pos: 'noun' }, // case-variant dup → dropped
      { displayForm: 'la leche', lemma: 'leche', gloss: 'milk', exampleSentence: 'Bebo leche fría.', pos: 'noun' }, // avoid-listed → dropped
    ]);
    const db = mockDb({ pan: 400 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella: nounGroup,
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
              text: 'Here are the words:\n{"words":[{"displayForm":"el pan","lemma":"pan","gloss":"bread","exampleSentence":"Compro pan fresco.","pos":"noun"}]}\nHope that helps!',
            },
          ],
        }),
      },
    };
    const db = mockDb({ pan: 400 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella: nounGroup,
      wordCount: 1,
      avoidWords: [],
    });

    expect(out.keptCount).toBe(1);
    expect(out.rows[0]).toMatchObject({ lemma: 'pan' });
  });
});

function mockClientSeq(...batches: unknown[][]) {
  const create = vi.fn();
  for (const words of batches) {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ words }) }] });
  }
  return { messages: { create } };
}

const noun = (l: string) => ({ displayForm: `el ${l}`, lemma: l, pos: 'noun', gloss: 'g', exampleSentence: `Veo el ${l}.` });
const verb = (l: string) => ({ displayForm: l, lemma: l, pos: 'verb', gloss: 'g', exampleSentence: `Quiero ${l}.` });
const adj = (l: string) => ({ displayForm: l, lemma: l, pos: 'adjective', gloss: 'g', exampleSentence: `Es ${l}.` });

describe('runOneUmbrella — word-class mix', () => {
  it('makes one follow-up for a shortfall and trims surplus nouns', async () => {
    const first = [...Array.from({ length: 10 }, (_, i) => noun(`n${i}`)), verb('v0')];
    const followUp = [verb('v1'), verb('v2'), adj('a0'), adj('a1'), noun('nX')];
    const client = mockClientSeq(first, followUp);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 10, avoidWords: [] });

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(out.followUp).toBe(true);
    const pos = out.rows.map((r) => r.pos);
    expect(pos.filter((p) => p === 'noun')).toHaveLength(7); // others 5 -> <= 7.5
    expect(pos).not.toContain(undefined);
    expect(out.rows.map((r) => r.lemma)).not.toContain('nX'); // follow-up noun dropped by allowedPos
    const secondUser = client.messages.create.mock.calls[1][0].messages[0].content as string;
    expect(secondUser).toContain('No nouns');
    expect(secondUser).toContain('n0'); // first batch joins the avoid-list
  });

  it('never makes a second follow-up', async () => {
    const client = mockClientSeq([verb('v0'), noun('n0'), noun('n1')], [noun('n2')]);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 10, avoidWords: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(out.remainingShortfall.adjectiveOrAdverb).toBeGreaterThan(0); // measured on the kept set (v0, n0)
  });

  it('restricts a word-class group and skips the mix', async () => {
    const group = { ...umbrella, key: 'es-a1-vocab-everyday-verbs', vocabGroup: { label: 'verbs', pos: ['verb'] } } as unknown as GrammarPoint;
    const client = mockClientSeq([verb('comer'), noun('pan'), adj('rápido')]);
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella: group, wordCount: 3, avoidWords: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(out.remainingShortfall).toEqual({ verb: 0, adjectiveOrAdverb: 0 });
    expect(out.rows.map((r) => r.lemma)).toEqual(['comer']);
    const user = client.messages.create.mock.calls[0][0].messages[0].content as string;
    expect(user).toContain('Every word MUST be one of: verb');
  });

  it('fill-mix asks for non-nouns only, counting existing rows', async () => {
    const existing = { noun: 26, verb: 2, adjective: 2, adverb: 0, phrase: 0, other: 0 };
    const client = mockClientSeq(
      [verb('v1'), verb('v2'), verb('v3'), verb('v4'), verb('v5'), verb('v6'), verb('v7'), adj('a1'), adj('a2'), adj('a3'), adj('a4'), adj('a5'), noun('nZ'),
        { displayForm: 'por favor', lemma: 'por favor', pos: 'phrase', gloss: 'g', exampleSentence: 'Agua, por favor.' }],
    );
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 12, avoidWords: [], existing, fillMix: true });
    const user = client.messages.create.mock.calls[0][0].messages[0].content as string;
    expect(user).toContain('exactly 7 verbs and 5 adjectives or adverbs');
    expect(out.rows).toHaveLength(13); // 12 verbs/adjectives + the phrase; the noun is dropped
    expect(out.rows.map((r) => r.lemma)).not.toContain('nZ');
    expect(out.rows.map((r) => r.pos)).toContain('phrase');
    expect(out.followUp).toBe(false);
    expect(out.requestedNothing).toBe(false);
  });

  it('fill-mix asks for the plan total in both prompts when it exceeds wordCount', async () => {
    const existing = { noun: 40, verb: 0, adjective: 0, adverb: 0, phrase: 0, other: 0 };
    const plan = planFillMixRequest(existing, 12);
    const total = plan.verb + plan.adjectiveOrAdverb;
    expect(total).toBeGreaterThan(12);
    const client = mockClientSeq([], []); // empty first batch also triggers the one follow-up
    await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 12, avoidWords: [], existing, fillMix: true });
    const call = client.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain(`Propose ${total} words`);
    expect(call.messages[0].content).toContain(`exactly ${plan.verb} verbs`);
    expect(call.system).toContain(`exactly ${total} `);
    expect(call.system).not.toContain('exactly 12 ');
  });

  it('fill-mix makes no model call when the plan requests nothing', async () => {
    const existing = { noun: 0, verb: 10, adjective: 10, adverb: 0, phrase: 0, other: 0 };
    const client = mockClientSeq();
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 0, avoidWords: [], existing, fillMix: true });
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(out.rows).toEqual([]);
    expect(out.followUp).toBe(false);
    expect(out.requestedNothing).toBe(true);
  });

  it('requestedNothing is false when a real plan gets an empty reply', async () => {
    const existing = { noun: 40, verb: 0, adjective: 0, adverb: 0, phrase: 0, other: 0 };
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '' }] }) },
    };
    const out = await runOneUmbrella({ db: mockDb({}) as never, client: client as never, umbrella, wordCount: 12, avoidWords: [], existing, fillMix: true });
    expect(client.messages.create).toHaveBeenCalled();
    expect(out.rows).toEqual([]);
    expect(out.rawCount).toBe(0);
    expect(out.requestedNothing).toBe(false);
  });
});
