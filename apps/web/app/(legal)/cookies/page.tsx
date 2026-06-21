import { LEGAL } from '../_content/constants';

export const metadata = { title: 'Cookie Policy — drill' };

export default function CookiesPage() {
  return (
    <article>
      <h1>Cookie Policy</h1>

      <p>
        This page explains the cookies and similar local storage drill uses, and how you can
        control them.
      </p>

      <h2>Strictly necessary</h2>
      <p>These are required for drill to work and cannot be switched off:</p>
      <ul>
        <li><strong>Authentication cookies</strong> (Clerk) — keep you signed in.</li>
        <li><strong>Functional storage</strong> — your browser&rsquo;s session storage briefly holds drafts of typed answers so a refresh doesn&rsquo;t lose them.</li>
      </ul>

      <h2>Analytics</h2>
      <p>
        We use <strong>PostHog</strong> (EU region) for product analytics and session
        replay. It loads <strong>only after you opt in</strong> using the cookie banner,
        sets analytics cookies, and records masked session replays (your typed answers are
        masked). You can change your choice at any time via the &ldquo;Cookie
        preferences&rdquo; link in the footer.
      </p>

      <h2>Error monitoring</h2>
      <p>
        We use Sentry to detect crashes. Sentry sets no cookies and records only your user ID
        (never your answers), under our legitimate interest in keeping drill reliable.
      </p>

      <h2>Contact</h2>
      <p>Questions? Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</p>
    </article>
  );
}
