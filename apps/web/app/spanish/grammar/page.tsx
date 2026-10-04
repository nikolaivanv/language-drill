import type { Metadata } from 'next';
import { GrammarIndex } from '../../../components/public/grammar/grammar-index';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Spanish grammar explained — every topic, A1 to B2',
  description:
    'Clear explanations of Spanish grammar, ordered the way a course teaches it: '
    + 'tenses, moods, pronouns and word forms, each with examples. Free, no signup.',
  alternates: { canonical: '/spanish/grammar' },
};

export default function SpanishGrammarIndexPage() {
  return <GrammarIndex lang="ES" />;
}
