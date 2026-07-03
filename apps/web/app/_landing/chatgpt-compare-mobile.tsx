'use client';

// "Why not just ChatGPT?" — mobile pieces, ported from the design handoff
// (the MChatGPT section of landing/drill-landing-mobile.jsx and the shared
// stacked split from landing/why-not-chatgpt-mobile.jsx). The stacked
// chat-vs-drill split (MVsSplit) is reused by the mobile landing section and
// the standalone /why-not-chatgpt mobile page.

import Link from 'next/link';
import { D_BAD_CHAT, D_CHAT_PAINS, type ChatMsg } from './landing-data';

export function MChatBubble({ m }: { m: ChatMsg }) {
  const you = m.who === 'you';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: you ? 'flex-end' : 'flex-start', gap: 5 }}>
      <div
        style={{
          maxWidth: '88%',
          padding: '9px 13px',
          borderRadius: 13,
          borderBottomRightRadius: you ? 4 : 13,
          borderBottomLeftRadius: you ? 13 : 4,
          fontSize: 12.5,
          lineHeight: 1.5,
          background: you ? '#2c241b' : '#1b1610',
          border: '1px solid var(--df-line)',
          color: you ? 'var(--df-ink2)' : 'var(--df-ink)',
        }}
      >
        {m.text}
      </div>
      {m.flag && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            fontFamily: 'var(--t-mono)',
            fontSize: 10.5,
            color: '#f0a78c',
            maxWidth: '92%',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 14,
              height: 14,
              borderRadius: 4,
              border: '1px solid #f0a78c',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              marginTop: 1,
            }}
          >
            !
          </span>
          {m.flag}
        </div>
      )}
    </div>
  );
}

// The chat-vs-drill split, stacked for a phone.
export function MVsSplit() {
  return (
    <>
      <div className="dfm-vs-panel" style={{ marginTop: 22 }}>
        <div className="dfm-vs-head">
          <span className="vs-dot" style={{ background: '#8c8475' }} />
          THE CHAT · UNSTRUCTURED
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 15px' }}>
          {D_BAD_CHAT.map((m, i) => (
            <MChatBubble key={i} m={m} />
          ))}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--t-mono)',
              fontSize: 10.5,
              color: 'var(--df-mute)',
              paddingTop: 2,
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--df-line)' }} />
            and it forgets all of this tomorrow
          </div>
        </div>
      </div>

      <div className="dfm-vs-panel dfm-vs-drill" style={{ marginTop: 12 }}>
        <div className="dfm-vs-head" style={{ color: 'var(--accent)' }}>
          <span className="vs-dot" style={{ background: 'var(--ok)' }} />
          DRILL · STRUCTURED
        </div>
        <div style={{ padding: '16px 15px' }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 13 }}>
            <span className="df-chip-dark">A1 · locked</span>
            <span className="df-chip-dark">present tense</span>
            <span className="df-chip-dark">español only</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 10,
              letterSpacing: '.5px',
              color: 'var(--df-mute)',
              marginBottom: 7,
            }}
          >
            PRODUCTION · TYPED
          </div>
          <div className="drill-stage" style={{ fontSize: 19, lineHeight: 1.5 }}>
            Cada mañana <span className="drill-blank type ok">me levanto</span> a las seis.
          </div>
          <div
            style={{
              fontFamily: 'var(--t-ui)',
              fontSize: 12.5,
              color: 'var(--df-mute)',
              marginTop: 8,
              fontStyle: 'italic',
            }}
          >
            “Every morning I get up at six.”
          </div>
          <div className="df-coach" style={{ marginTop: 14 }}>
            <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
              c
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
              <strong style={{ color: '#a8d6a0' }}>Right.</strong> Reflexive <em>levantarse</em> →{' '}
              <em>me levanto</em>. Logged to your record; it’ll come back on schedule.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// The mobile landing section: intro copy, stacked split, pains as cards, and
// the link out to the standalone comparison page.
export function MChatGPT() {
  return (
    <section className="dfm-wrap dfm-section" id="vs-chatgpt" style={{ scrollMarginTop: 64 }}>
      <div className="dfm-eyebrow2">Why not just ChatGPT?</div>
      <h2 className="dfm-h2">
        We built drill because we got tired of{' '}
        <span style={{ color: 'var(--accent)' }}>managing</span> the chatbot.
      </h2>
      <p className="dfm-lead">
        ChatGPT <em>can</em> write exercises, grade them and explain the grammar — that’s what
        inspired this app. But practise every day and the cracks show: it drifts off your level,
        gives the answer away, repeats the same words, explains the fix in language you can’t yet
        read, and buries your results in an endless thread.
      </p>

      <MVsSplit />

      <div className="dfm-stack" style={{ marginTop: 20 }}>
        {D_CHAT_PAINS.map((p) => (
          <div key={p.id} className="dfm-card" style={{ padding: 16 }}>
            <div
              style={{
                fontFamily: 'var(--t-display)',
                fontSize: 17,
                fontWeight: 500,
                color: 'var(--df-ink)',
                marginBottom: 10,
              }}
            >
              {p.chatLabel}
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
              <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--df-ink2)' }}>{p.chat}</span>
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
              <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--df-ink)' }}>{p.drill}</span>
            </div>
          </div>
        ))}
      </div>

      <Link href="/why-not-chatgpt" className="dfm-btn" style={{ marginTop: 22, textDecoration: 'none' }}>
        See the full comparison →
      </Link>
    </section>
  );
}
