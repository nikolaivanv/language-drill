import { LEGAL } from '../_content/constants';

export const metadata = { title: 'Privacy Policy — drill' };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>

      <h2>Who we are</h2>
      <p>
        drill (&ldquo;the Service&rdquo;) is operated by {LEGAL.controller}, an individual
        based in {LEGAL.basedIn}, who is the data controller for your personal data. You can
        reach us at <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li><strong>Account data</strong> — your email address, managed on our behalf by Clerk, to create and secure your account.</li>
        <li><strong>Learning data</strong> — your exercises, written answers, evaluations, vocabulary, reading entries, practice sessions, spaced-repetition state, and grammar-mastery scores, to provide the Service and track your progress.</li>
        <li><strong>Usage data</strong> — counts of AI requests per day, to enforce fair-use limits.</li>
        <li><strong>Diagnostics</strong> — error reports (your user ID only, no answer content) via Sentry, to keep the Service working.</li>
      </ul>

      <h2>Legal bases (GDPR Article 6)</h2>
      <ul>
        <li><strong>Performance of a contract</strong> — to provide the learning features you sign up for.</li>
        <li><strong>Legitimate interests</strong> — security, abuse prevention, and error monitoring.</li>
        <li><strong>Consent</strong> — for optional product analytics, which are off unless you opt in. We do not run analytics today.</li>
      </ul>

      <h2>Who processes your data (sub-processors)</h2>
      <p>We share data only with the service providers we rely on to run drill:</p>
      <ul>
        {LEGAL.subProcessors.map((p) => (
          <li key={p.name}><strong>{p.name}</strong> — {p.purpose}.</li>
        ))}
      </ul>
      <p>
        Some of these providers process data outside the European Economic Area; where they
        do, they rely on appropriate safeguards such as the EU Standard Contractual Clauses.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account is active. When you delete your account, all of
        your personal data is deleted from our database.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li><strong>Access &amp; portability</strong> — download a machine-readable copy of your data from <em>Settings → privacy &amp; data → Download my data</em>.</li>
        <li><strong>Erasure</strong> — delete your account and all associated data from <em>Settings → account → Security → Delete account</em>.</li>
        <li><strong>Rectification &amp; objection</strong> — contact us at <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</li>
        <li>
          You may also lodge a complaint with your local supervisory authority — in {LEGAL.basedIn},
          the Hungarian National Authority for Data Protection and Freedom of Information (NAIH).
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use only strictly-necessary cookies today. See our <a href="/cookies">Cookie Policy</a> for details.
      </p>
    </article>
  );
}
