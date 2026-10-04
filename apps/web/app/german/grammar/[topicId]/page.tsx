import type { Metadata } from 'next';
import { GrammarTopic } from '../../../../components/public/grammar/grammar-topic';
import { fetchPublicTopic } from '../../../../lib/public-theory';
import { grammarTopicHref } from '../../../../lib/public-paths';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topicId: string }>;
}): Promise<Metadata> {
  const { topicId } = await params;
  const slug = decodeURIComponent(topicId);
  const { topic } = await fetchPublicTopic('DE', slug);
  return {
    title: `${topic.title} in German: ${topic.cefr} grammar explained`,
    description: topic.subtitle,
    // The URL slug (`a2-perfekt`), NOT `topic.id` — that carries the full
    // grammar-point key (`de-a2-perfekt`) and would build a canonical URL
    // that 404s.
    alternates: { canonical: grammarTopicHref('DE', slug) },
  };
}

// `generateMetadata` and the page both call `fetchPublicTopic`; Next dedupes
// identical `fetch` calls within a render, so this is one request per visit.
export default async function GermanGrammarTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <GrammarTopic lang="DE" topicId={decodeURIComponent(topicId)} />;
}
