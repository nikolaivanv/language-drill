'use client';

// "Why not just ChatGPT?" — Mobile Web reflow, ported from the design handoff
// (landing/why-not-chatgpt-mobile.jsx). Same story as the desktop standalone
// page reflowed for a ~390px phone: origin hero → the split chat-vs-drill
// visual (stacked) → full point-by-point comparison as cards → "not
// anti-chatbot" → CTA. Scoped to .dfm; reuses MVsSplit and the shared data.

import Link from 'next/link';
import './landing.css';
import { DBrand } from './landing-chrome';
import { MVsSplit } from './chatgpt-compare-mobile';
import { WN_KEEP, WN_ROWS } from './landing-data';
import { LegalLinks } from '../../components/legal/legal-links';

function WNMTop() {
  return (
    <div className="dfm-top">
      <DBrand />
      <div className="dfm-actions">
        <Link href="/" className="dfm-signin">
          ← Home
        </Link>
        <Link href="/sign-up" className="dfm-signup">
          Sign up
        </Link>
      </div>
    </div>
  );
}

export function WhyNotMobile() {
  return (
    <div className="df dfm">
      <WNMTop />

      {/* hero / origin story */}
      <header className="dfm-wrap" style={{ paddingTop: 28, paddingBottom: 8 }}>
        <div className="dfm-eyebrow">Positioning · the honest version</div>
        <h1 className="dfm-h1" style={{ marginTop: 12 }}>
          Why not just use <span style={{ color: 'var(--accent)' }}>ChatGPT</span>?
        </h1>
        <p className="dfm-sub">
          Fair question — a chatbot is what inspired drill in the first place. It can invent
          exercises, grade them and explain the grammar. Then we tried to practise <em>every day</em>,
          and the overhead piled up.
        </p>
        <p className="dfm-sub" style={{ marginTop: 12 }}>
          drill keeps the part that worked — instant, generated, graded practice with a coach — and
          engineers away the part that didn’t: the drift, the repetition, the mental load, the
          results scattered across a thread you’ll never scroll back through.
        </p>
      </header>

      {/* the split visual, stacked */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">The same request, two experiences</div>
        <h2 className="dfm-h2">You ask for a simple exercise. Watch what happens.</h2>
        <MVsSplit />
      </section>

      {/* point-by-point comparison as cards */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">Point by point</div>
        <h2 className="dfm-h2">Everything the structure buys you.</h2>
        <div className="dfm-stack">
          {WN_ROWS.map(([dim, chat, drill]) => (
            <div key={dim} className="dfm-card" style={{ padding: 16 }}>
              <div
                style={{
                  fontFamily: 'var(--t-display)',
                  fontSize: 18,
                  fontWeight: 500,
                  color: 'var(--df-ink)',
                  marginBottom: 11,
                }}
              >
                {dim}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  paddingBottom: 11,
                  borderBottom: '1px solid var(--df-line)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--t-mono)',
                    fontSize: 10,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    color: 'var(--df-mute)',
                  }}
                >
                  ChatGPT
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--df-ink2)' }}>{chat}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 11 }}>
                <span
                  style={{
                    fontFamily: 'var(--t-mono)',
                    fontSize: 10,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                  }}
                >
                  drill
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--df-ink)' }}>
                  <span style={{ color: 'var(--ok)', fontFamily: 'var(--t-mono)', marginRight: 6 }}>✓</span>
                  {drill}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* not anti-chatbot */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">We’re not anti-chatbot</div>
        <h2 className="dfm-h2">Keep the chatbot. Just not for daily reps.</h2>
        <p className="dfm-lead">ChatGPT is genuinely great at some things — and drill won’t replace those.</p>
        <div className="dfm-stack">
          {WN_KEEP.map(([h, b]) => (
            <div key={h} className="dfm-card" style={{ padding: 16 }}>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--df-ink)' }}>{h}</div>
              <p style={{ color: 'var(--df-ink2)', fontSize: 13.5, lineHeight: 1.55, margin: '7px 0 0' }}>
                {b}
              </p>
            </div>
          ))}
        </div>
        <p className="dfm-lead" style={{ marginTop: 20 }}>
          But for <strong style={{ color: 'var(--df-ink)' }}>structured, consistent, tracked daily
          practice</strong>{' '}
          at exactly your level — that’s the job drill was built for.
        </p>
      </section>

      {/* CTA */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-ctaband">
          <h2>Less managing. More learning.</h2>
          <p>Open drill, pick a language, and start producing — no prompt to write, no level to police.</p>
          <Link
            href="/sign-up"
            className="dfm-btn"
            style={{ background: '#fff', color: 'var(--accent-2)', borderColor: '#fff', marginTop: 20 }}
          >
            Sign up free
          </Link>
          <div
            style={{ fontFamily: 'var(--t-mono)', fontSize: 10.5, color: 'rgba(255,255,255,.72)', marginTop: 16 }}
          >
            free to start · no card
          </div>
        </div>
      </section>

      <footer className="dfm-footer">
        <DBrand />
        <div className="meta">© 2026 drill · type it, don’t tap it</div>
        <Link href="/">← back to home</Link>
        <LegalLinks className="mt-s-3 landing-legal-links" />
      </footer>
    </div>
  );
}
