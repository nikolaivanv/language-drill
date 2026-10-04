import { notFound } from 'next/navigation';
import {
  PublicTopicListResponseSchema,
  PublicTopicEnvelopeSchema,
  type PublicTopicSummary,
  type PublicTopicEnvelope,
} from '@language-drill/api-client';
import {
  parseTheoryTopicJson,
  type PublicLanguage,
  type TheoryTopicJson,
  type TheoryBlockJson,
  type TheoryInlineJson,
} from '@language-drill/shared';
import { renderTheoryTopicJson } from '../components/theory/render-json';
import type { TheoryTopic } from '../components/theory/types';

/**
 * Server-side reads for the public theory surface.
 *
 * The error policy is the whole point of this module, and it differs from
 * `language-landing.tsx` on purpose. That page degrades to an empty points list
 * because the list is an enhancement; here the content IS the page, so:
 *
 *   - a 404 from the API means the topic genuinely does not exist → notFound()
 *   - anything else (5xx, non-JSON, network failure, schema violation) THROWS
 *
 * A thrown error renders Next's error boundary and is not cached. Returning a
 * 404 for a transient outage would teach a crawler that 312 live URLs are gone,
 * and that is expensive to undo.
 */

const REVALIDATE_SECONDS = 3600;

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error(
      'public theory: NEXT_PUBLIC_API_URL is not set, so no topic can be fetched server-side',
    );
  }
  return base;
}

async function getJson(path: string, onNotFound: 'notFound' | 'throw'): Promise<unknown> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });

  if (res.status === 404) {
    if (onNotFound === 'notFound') notFound();
    throw new Error(`public theory: ${url} returned 404`);
  }
  if (!res.ok) {
    throw new Error(`public theory: ${url} returned ${res.status}`);
  }
  return res.json();
}

export async function fetchPublicTopicList(
  lang: PublicLanguage,
): Promise<PublicTopicSummary[]> {
  const body = await getJson(`/public/theory/${lang}`, 'throw');
  return PublicTopicListResponseSchema.parse(body).topics;
}

export async function fetchPublicTopic(
  lang: PublicLanguage,
  topicId: string,
): Promise<{
  topic: TheoryTopic;
  envelope: PublicTopicEnvelope;
  readingMinutes: number;
}> {
  const body = await getJson(
    `/public/theory/${lang}/${encodeURIComponent(topicId)}`,
    'notFound',
  );
  // Envelope first (cheap, and it is what this surface added), then the article
  // through its one canonical validator.
  const envelope = PublicTopicEnvelopeSchema.parse(body);
  const json = parseTheoryTopicJson(body);
  return {
    topic: renderTheoryTopicJson(json),
    envelope,
    readingMinutes: Math.max(1, Math.round(countTopicWords(json) / 200)),
  };
}

/**
 * Word count over the article JSON, not the rendered tree: `TheorySection.body`
 * is a `ReactNode` by the time `renderTheoryTopicJson` is done, and walking
 * React children to count words is both fragile and unnecessary when the source
 * data is right here.
 *
 * Conjugation-table cells are counted as one word each — they are forms, not
 * prose, and a six-row table is not 40 words of reading.
 */
function countInlineWords(nodes: TheoryInlineJson[]): number {
  let words = 0;
  for (const node of nodes) {
    if (node.kind === 'text') {
      words += node.text.split(/\s+/).filter(Boolean).length;
    } else {
      words += countInlineWords(node.children);
    }
  }
  return words;
}

function countBlockWords(block: TheoryBlockJson): number {
  switch (block.kind) {
    case 'paragraph':
      return countInlineWords(block.text);
    case 'callout':
      return block.children.reduce((n, b) => n + countBlockWords(b), 0);
    case 'example':
      return (
        countInlineWords(block.target) +
        block.en.split(/\s+/).filter(Boolean).length +
        (block.note ? countInlineWords(block.note) : 0)
      );
    case 'list':
      return block.items.reduce(
        (n, item) => n + item.reduce((m, b) => m + countBlockWords(b), 0),
        0,
      );
    case 'conjugation-table':
      return block.head.length + block.rows.reduce((n, row) => n + row.length, 0);
  }
}

export function countTopicWords(json: TheoryTopicJson): number {
  return json.sections.reduce(
    (n, section) =>
      n +
      section.title.split(/\s+/).filter(Boolean).length +
      section.body.reduce((m, block) => m + countBlockWords(block), 0),
    json.title.split(/\s+/).filter(Boolean).length +
      json.subtitle.split(/\s+/).filter(Boolean).length,
  );
}
