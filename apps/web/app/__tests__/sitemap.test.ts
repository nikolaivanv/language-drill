import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/public-theory', () => ({
  fetchPublicTopicList: vi.fn(),
}));

import { fetchPublicTopicList } from '../../lib/public-theory';
import sitemap from '../sitemap';

const topic = (id: string) => ({
  id, title: id, cefr: 'A2', subtitle: 's', category: 'tenses', order: 1,
  hasConjugationDrill: false,
});

beforeEach(() => vi.clearAllMocks());

describe('sitemap', () => {
  it('lists the three hubs and every topic', async () => {
    vi.mocked(fetchPublicTopicList).mockImplementation(async (lang) =>
      lang === 'ES' ? [topic('a2-ser-vs-estar')] : [],
    );
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/spanish/grammar');
    expect(urls).toContain('https://www.langdrill.app/german/grammar');
    expect(urls).toContain('https://www.langdrill.app/turkish/grammar');
    expect(urls).toContain('https://www.langdrill.app/spanish/grammar/a2-ser-vs-estar');
  });

  it('keeps the pre-existing entries', async () => {
    vi.mocked(fetchPublicTopicList).mockResolvedValue([]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/');
    expect(urls).toContain('https://www.langdrill.app/try/forms');
  });

  it('still returns the static entries when a language list fails', async () => {
    // A sitemap that throws is a sitemap Google cannot read at all. Losing one
    // language's topics is strictly better than losing every URL.
    vi.mocked(fetchPublicTopicList).mockRejectedValue(new Error('500'));
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/');
    expect(urls).not.toContain('https://www.langdrill.app/spanish/grammar/a2-ser-vs-estar');
  });

  it('emits no duplicate URLs', async () => {
    vi.mocked(fetchPublicTopicList).mockResolvedValue([topic('a2-x')]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('carries no lastModified, since a per-request timestamp would be false', async () => {
    vi.mocked(fetchPublicTopicList).mockResolvedValue([topic('a2-x')]);
    for (const entry of await sitemap()) expect(entry.lastModified).toBeUndefined();
  });
});
