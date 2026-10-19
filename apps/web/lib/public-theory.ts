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

  // A 404 is a genuine "this topic does not exist." A 400 VALIDATION_ERROR
  // means the topicId failed the API's slug-shape check — reachable from a
  // mistyped, capitalised or scanner-generated path — and for the topic
  // fetch that is the SAME outcome a reader should see: not found, not a
  // 500. The list fetch is excluded (onNotFound === 'throw' for it): its
  // `lang` comes from the route folder, not user input, so a 400 there is a
  // real bug and must keep throwing.
  if (res.status === 404 || (res.status === 400 && onNotFound === 'notFound')) {
    if (onNotFound === 'notFound') notFound();
    throw new Error(`public theory: ${url} returned ${res.status}`);
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
  metaDescription: string;
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
    metaDescription: topicMetaDescription(json),
  };
}

const META_DESCRIPTION_MAX = 160;
// A subtitle at least this long is a real sentence and reads well as a
// snippet; shorter ones are taglines ("buen, gran, algún…", "as / in the
// capacity of") that tell a searcher nothing.
const SUBTITLE_AS_DESCRIPTION_MIN = 100;

function inlineText(nodes: TheoryInlineJson[]): string {
  return nodes.map((n) => (n.kind === 'text' ? n.text : inlineText(n.children))).join('');
}

// Whole sentences shorter than this leave too much of the snippet unused
// ("Turkish has no prepositions."), so the text is cut mid-sentence instead.
const WHOLE_SENTENCES_MIN = 100;

/**
 * Whole sentences of `text` up to the snippet limit when they fill it well
 * enough; otherwise the text cut at a word boundary with an ellipsis.
 */
export function clampToSnippet(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let out = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= WHOLE_SENTENCES_MIN) return out;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '')}…`;
}

/**
 * The topic page's `<meta name="description">`. The subtitle when it is a
 * full sentence, otherwise the opening paragraph of the article — its "what
 * is it?" definition, which is what a searcher wants from the snippet.
 */
export function topicMetaDescription(json: TheoryTopicJson): string {
  if (json.subtitle.length >= SUBTITLE_AS_DESCRIPTION_MIN) return clampToSnippet(json.subtitle);
  for (const section of json.sections) {
    const lead = section.body.find((b) => b.kind === 'paragraph');
    if (lead) return clampToSnippet(inlineText(lead.text));
  }
  return clampToSnippet(json.subtitle);
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
