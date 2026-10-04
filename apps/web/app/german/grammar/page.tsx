import type { Metadata } from 'next';
import { GrammarIndex } from '../../../components/public/grammar/grammar-index';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'German grammar explained — every topic, A1 to B2',
  description:
    'Clear explanations of German grammar, ordered the way a course teaches it: '
    + 'cases, verb forms, word order and adjective endings, each with examples. Free, no signup.',
  alternates: { canonical: '/german/grammar' },
};

export default function GermanGrammarIndexPage() {
  return <GrammarIndex lang="DE" />;
}
