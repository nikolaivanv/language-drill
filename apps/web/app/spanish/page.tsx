import type { Metadata } from 'next';
import { LanguageLanding } from '../../components/public/language-landing';

export const metadata: Metadata = {
  title: "Spanish verb forms practice — type them, don't tap them",
  description:
    'Free Spanish conjugation practice: preterite, imperfect, conditional, future and present subjunctive. You type the form and it is graded instantly. No signup, nothing saved.',
  alternates: { canonical: '/spanish' },
};

// Three explicit routes rather than one `[language]` segment at the app root:
// a root-level dynamic segment would capture every otherwise-unmatched path and
// turn 404s into this page, and it would have to coexist with the Clerk
// middleware's public-route matcher. Explicit is cheaper to reason about than
// clever here, and each language gets its own metadata anyway.
export default function EsLandingPage() {
  return <LanguageLanding lang="ES" />;
}
