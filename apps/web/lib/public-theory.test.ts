import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock(...) is hoisted above every other statement in this file, including
// `const` declarations — a plain `const notFound = vi.fn(...)` referenced
// directly in the factory below throws "Cannot access 'notFound' before
// initialization". `vi.hoisted` runs before that hoisted vi.mock, so the
// factory can see an already-initialized mock.
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

import { fetchPublicTopicList, fetchPublicTopic, countTopicWords } from './public-theory';

const TOPIC = {
  id: 'es-a2-ser-vs-estar',
  title: 'Ser vs estar',
  subtitle: 'Two verbs.',
  cefr: 'A2',
  sections: [
    { id: 'short', title: 'Short', body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Ser is essence.' }] }] },
  ],
  related: { buildsOn: [], leadsTo: [], siblings: [] },
  hasConjugationDrill: true,
  quickCheck: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test');
  vi.stubGlobal('fetch', vi.fn());
  // `notFound` is created via vi.hoisted, outside vi.restoreAllMocks' reach
  // (that only restores spies). Without this, a prior test's call to
  // notFound() leaks into a later "not called" assertion.
  notFound.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchPublicTopic', () => {
  it('returns a rendered topic and its envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    const { topic, envelope } = await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(topic.title).toBe('Ser vs estar');
    expect(topic.sections[0].id).toBe('short');
    expect(envelope.hasConjugationDrill).toBe(true);
  });

  it('calls notFound() on a 404', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'TOPIC_NOT_FOUND' }, 404));
    await expect(fetchPublicTopic('ES', 'a2-nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('calls notFound() on a 400 (a bad-shape slug), not a 500', async () => {
    // The API returns 400 VALIDATION_ERROR for a topicId outside
    // /^[a-z0-9-]+$/ — a mistyped, capitalised or scanner-generated path.
    // That must read as "not found", the same as a real 404, never a 500.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'VALIDATION_ERROR' }, 400));
    await expect(fetchPublicTopic('ES', 'A2-Ser-Vs-Estar')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('THROWS on a 500 instead of 404ing', async () => {
    // A transient outage must not teach Google that 312 URLs are gone.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'INTERNAL_ERROR' }, 500));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow(/500/);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('throws on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNRESET'));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('throws when the envelope fails validation', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...TOPIC, hasConjugationDrill: 'yes' }));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow();
  });

  it('requests the public endpoint with an hour of ISR', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.test/public/theory/ES/a2-ser-vs-estar',
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ next: { revalidate: 3600 } });
  });

  it('throws when no API base URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });
});

describe('fetchPublicTopicList', () => {
  it('returns the topics array', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'a2-ser-vs-estar', title: 'Ser vs estar', cefr: 'A2', subtitle: 'Two verbs.', category: 'pairs', order: 7, hasConjugationDrill: true },
        ],
      }),
    );
    const topics = await fetchPublicTopicList('ES');
    expect(topics).toHaveLength(1);
  });

  it('throws on a 500 so the hub does not render as empty', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'INTERNAL_ERROR' }, 500));
    await expect(fetchPublicTopicList('ES')).rejects.toThrow(/500/);
  });

  it('throws (not notFound()) on a 400 — lang comes from the route folder, not user input', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'VALIDATION_ERROR' }, 400));
    await expect(fetchPublicTopicList('ES')).rejects.toThrow(/400/);
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('countTopicWords', () => {
  const json = {
    id: 'es-a2-x', title: 'Ser vs estar', subtitle: 'Two verbs here',
    cefr: 'A2',
    sections: [
      {
        id: 'short', title: 'The short version',
        body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'one two three' }] }],
      },
    ],
  } as unknown as Parameters<typeof countTopicWords>[0];

  it('counts title, subtitle, section titles and paragraph text', () => {
    // 3 (title) + 3 (subtitle) + 3 (section title) + 3 (paragraph) = 12
    expect(countTopicWords(json)).toBe(12);
  });

  it('counts nested inline nodes', () => {
    const nested = {
      ...json,
      sections: [
        {
          id: 's', title: 'T',
          body: [
            {
              kind: 'paragraph',
              text: [
                { kind: 'text', text: 'plain' },
                { kind: 'strong', children: [{ kind: 'text', text: 'bold words here' }] },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof countTopicWords>[0];
    // 3 + 3 + 1 (title "T") + 1 + 3 = 11
    expect(countTopicWords(nested)).toBe(11);
  });

  it('counts a conjugation table by cells, not by prose', () => {
    const table = {
      ...json,
      sections: [
        {
          id: 's', title: 'T',
          body: [{ kind: 'conjugation-table', head: ['', 'Preterite'], rows: [['yo', 'hablé']] }],
        },
      ],
    } as unknown as Parameters<typeof countTopicWords>[0];
    // 3 + 3 + 1 + (2 head + 2 cells) = 11
    expect(countTopicWords(table)).toBe(11);
  });
});

describe('fetchPublicTopic reading time', () => {
  it('never reports less than a minute', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    const { readingMinutes } = await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(readingMinutes).toBe(1);
  });
});
