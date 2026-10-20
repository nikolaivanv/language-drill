import type { Metadata } from 'next';
import { GrammarTopic } from '../../../../components/public/grammar/grammar-topic';
import { fetchPublicTopic } from '../../../../lib/public-theory';
import { grammarTopicHref } from '../../../../lib/public-paths';
import { publicPageMetadata } from '../../../../lib/public-metadata';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topicId: string }>;
}): Promise<Metadata> {
  const { topicId } = await params;
  const slug = decodeURIComponent(topicId);
  const { topic, metaDescription } = await fetchPublicTopic('ES', slug);
  return publicPageMetadata({
    title: `${topic.title} in Spanish (${topic.cefr})`,
    description: metaDescription,
    // The URL slug (`a2-ser-vs-estar`), NOT `topic.id` — that carries the full
    // grammar-point key (`es-a2-ser-vs-estar`) and would build a canonical URL
    // that 404s.
    path: grammarTopicHref('ES', slug),
  });
}

// `generateMetadata` and the page both call `fetchPublicTopic`; Next dedupes
// identical `fetch` calls within a render, so this is one request per visit.
export default async function SpanishGrammarTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <GrammarTopic lang="ES" topicId={decodeURIComponent(topicId)} />;
}
