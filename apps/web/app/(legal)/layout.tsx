import Link from 'next/link';
import { LEGAL } from './_content/constants';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[760px] px-s-5 py-s-7">
      <Link href="/" className="t-small text-ink-soft hover:text-ink">← back to drill</Link>
      <div className="mt-s-5 prose-legal">
        {children}
      </div>
      <p className="mt-s-7 t-small text-ink-mute border-t border-dashed border-rule pt-s-4">
        Last updated: {LEGAL.lastUpdated}. This is a plain-language summary written in good
        faith — it is not legal advice.
      </p>
    </main>
  );
}
