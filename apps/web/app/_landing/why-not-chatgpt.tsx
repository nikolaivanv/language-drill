'use client';

// Standalone deep-dive: "Why not just ChatGPT?" — the considered-reader page
// linked from the main landing. Ported from the design handoff
// (landing/why-not-chatgpt.jsx). Origin story → the split visual → full
// comparison table → an honest "keep the chatbot for this" note → CTA.
// Reuses the shared VsSplit visual and the WN_ROWS / WN_KEEP data.

import Link from 'next/link';
import './landing.css';
import { DBrand } from './landing-chrome';
import { VsSplit } from './chatgpt-compare';
import { WN_KEEP, WN_ROWS } from './landing-data';
import { LegalLinks } from '../../components/legal/legal-links';

export function WhyNotPage() {
  return (
    <div className="df">
      <div className="df-top">
        <div className="df-wrap df-top-inner">
          <DBrand />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/" className="vs-navlink">
              ← Back to home
            </Link>
            <Link href="/sign-up" className="btn-xl" style={{ padding: '8px 18px', fontSize: 13 }}>
              Sign up free
            </Link>
          </div>
        </div>
      </div>

      {/* hero / origin story */}
      <header style={{ paddingTop: 72, paddingBottom: 20 }}>
        <div className="df-wrap" style={{ maxWidth: 900 }}>
          <div className="df-eyebrow">Positioning · the honest version</div>
          <h1 className="df-h1" style={{ marginTop: 18, fontSize: 'clamp(38px,5.6vw,68px)' }}>
            Why not just use <span style={{ color: 'var(--accent)' }}>ChatGPT</span>?
          </h1>
          <p className="df-sub" style={{ marginTop: 22, maxWidth: 640, fontSize: 19 }}>
            Fair question — a chatbot is what inspired drill in the first place. It can invent
            exercises, grade them and explain the grammar. For a while that felt like enough. Then we
            tried to practise <em>every day</em>, and the overhead piled up.
          </p>
          <p className="df-sub" style={{ marginTop: 16, maxWidth: 640 }}>
            drill keeps the part that worked — instant, generated, graded practice with a coach — and
            engineers away the part that didn’t: the drift, the repetition, the mental load, the
            results scattered across a thread you’ll never scroll back through.
          </p>
        </div>
      </header>

      {/* the split visual */}
      <section className="df-section" style={{ borderTop: 'none', paddingTop: 40 }}>
        <div className="df-wrap">
          <div className="df-eyebrow2">The same request, two experiences</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
            You ask for a simple exercise. Watch what happens.
          </h2>
          <VsSplit />
        </div>
      </section>

      {/* full comparison table */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">Point by point</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
            Everything the structure buys you.
          </h2>
          <div className="wn-table" style={{ marginTop: 36 }}>
            <div className="wn-thead">
              <div>Dimension</div>
              <div>ChatGPT</div>
              <div style={{ color: 'var(--accent)' }}>drill</div>
            </div>
            {WN_ROWS.map(([dim, chat, drill]) => (
              <div key={dim} className="wn-trow">
                <div className="wn-dim">{dim}</div>
                <div className="wn-chat">{chat}</div>
                <div className="wn-drill">
                  <span className="wn-check">✓</span>
                  {drill}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* honest note — keep ChatGPT for this */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">We’re not anti-chatbot</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
            Keep the chatbot. Just not for daily reps.
          </h2>
          <p style={{ color: 'var(--df-ink2)', fontSize: 17, lineHeight: 1.6, maxWidth: 620, marginTop: 16 }}>
            ChatGPT is genuinely great at some things — and drill won’t replace those.
          </p>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginTop: 32 }}
            className="loop-grid"
          >
            {WN_KEEP.map(([h, b]) => (
              <div key={h} className="df-card">
                <div style={{ fontFamily: 'var(--t-display)', fontSize: 20, color: 'var(--df-ink)' }}>
                  {h}
                </div>
                <p
                  style={{
                    color: 'var(--df-ink2)',
                    fontSize: 14,
                    lineHeight: 1.55,
                    marginTop: 8,
                    marginBottom: 0,
                  }}
                >
                  {b}
                </p>
              </div>
            ))}
          </div>
          <p style={{ color: 'var(--df-ink2)', fontSize: 17, lineHeight: 1.6, maxWidth: 620, marginTop: 28 }}>
            But for <strong style={{ color: 'var(--df-ink)' }}>structured, consistent, tracked daily
            practice</strong>{' '}
            at exactly your level — that’s the job drill was built for.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="df-section">
        <div className="df-wrap">
          <div
            style={{
              background: 'var(--accent)',
              borderRadius: 'var(--r-xl)',
              padding: '64px 48px',
              textAlign: 'center',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--t-display)',
                fontWeight: 500,
                fontSize: 'clamp(32px,4.6vw,52px)',
                letterSpacing: '-0.9px',
                margin: 0,
                color: '#fff',
                lineHeight: 1.04,
              }}
            >
              Less managing. More learning.
            </h2>
            <p
              style={{
                color: 'rgba(255,255,255,.86)',
                fontSize: 17,
                marginTop: 14,
                maxWidth: 460,
                marginInline: 'auto',
              }}
            >
              Open drill, pick a language, and start producing — no prompt to write, no level to
              police.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
              <Link
                href="/sign-up"
                className="btn-xl"
                style={{ background: '#fff', color: 'var(--accent-2)', borderColor: '#fff' }}
              >
                Sign up free
              </Link>
              <Link href="/" className="btn-xl ghost-light">
                Back to home
              </Link>
            </div>
            <div
              style={{
                fontFamily: 'var(--t-mono)',
                fontSize: 11,
                color: 'rgba(255,255,255,.7)',
                marginTop: 18,
              }}
            >
              free to start · no card
            </div>
          </div>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--df-line)', padding: '32px 0' }}>
        <div
          className="df-wrap"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <DBrand />
          <div style={{ fontSize: 12, color: 'var(--df-mute)' }}>
            © 2026 drill · read, save, produce
          </div>
          <Link href="/" className="df-footlink">
            ← back to home
          </Link>
        </div>
        <div className="df-wrap">
          <LegalLinks className="mt-s-4 landing-legal-links" />
        </div>
      </footer>
    </div>
  );
}
