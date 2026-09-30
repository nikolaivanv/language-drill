import type { Metadata } from 'next';
import { LanguageLanding } from '../../components/public/language-landing';

export const metadata: Metadata = {
  title: 'Turkish forms practice — tenses, cases and possessive suffixes',
  description:
    'Free Turkish practice: present continuous, aorist, definite and evidential past, causative, plus case and possessive suffixes. You type the form and it is graded instantly. No signup, nothing saved.',
  alternates: { canonical: '/turkish' },
};

// Three explicit routes rather than one `[language]` segment at the app root:
// a root-level dynamic segment would capture every otherwise-unmatched path and
// turn 404s into this page, and it would have to coexist with the Clerk
// middleware's public-route matcher. Explicit is cheaper to reason about than
// clever here, and each language gets its own metadata anyway.
export default function TrLandingPage() {
  return <LanguageLanding lang="TR" />;
}
