import type { Metadata } from 'next';
import { GrammarIndex } from '../../../components/public/grammar/grammar-index';

// `next build` must not call the live API — see `GrammarIndex` / F2 in the
// final-fix findings. `force-dynamic` forces every fetch in this page to
// `{ cache: 'no-store' }`, which supersedes (and makes misleading) a
// page-level `revalidate` export, so that is intentionally absent here: the
// per-fetch `next: { revalidate: 3600 }` in `lib/public-theory.ts` is dead
// under this setting, not a second cache layer.
export const dynamic = 'force-dynamic';

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
