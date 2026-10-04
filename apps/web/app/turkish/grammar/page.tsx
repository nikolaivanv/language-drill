import type { Metadata } from 'next';
import { GrammarIndex } from '../../../components/public/grammar/grammar-index';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Turkish grammar explained — every topic, A1 to B2',
  description:
    'Clear explanations of Turkish grammar, ordered the way a course teaches it: '
    + 'vowel harmony, cases, suffixes and tenses, each with examples. Free, no signup.',
  alternates: { canonical: '/turkish/grammar' },
};

export default function TurkishGrammarIndexPage() {
  return <GrammarIndex lang="TR" />;
}
