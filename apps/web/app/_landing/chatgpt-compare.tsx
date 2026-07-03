'use client';

// "Why not just ChatGPT?" — the origin-story / positioning section for the
// main landing, ported from the design handoff (landing/chatgpt-compare.jsx).
// Left: a stylised chat that drifts and over-reveals. Right: drill's locked,
// structured panel. Below: the four pains as chat-vs-drill rows. Links out to
// the standalone /why-not-chatgpt comparison page. The split visual (VsSplit)
// is shared with that page.

import Link from 'next/link';
import { D_BAD_CHAT, D_CHAT_PAINS, type ChatMsg } from './landing-data';

export function ChatBubble({ m }: { m: ChatMsg }) {
  const you = m.who === 'you';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: you ? 'flex-end' : 'flex-start', gap: 5 }}>
      <div
        style={{
          maxWidth: '86%',
          padding: '10px 14px',
          borderRadius: 14,
          borderBottomRightRadius: you ? 4 : 14,
          borderBottomLeftRadius: you ? 14 : 4,
          fontSize: 13.5,
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
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--t-mono)',
            fontSize: 11,
            color: '#f0a78c',
            maxWidth: '90%',
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

// The split: messy chat vs structured drill. Used by the landing section and
// the standalone /why-not-chatgpt page.
export function VsSplit() {
  return (
    <div className="vs-split">
      <div className="vs-panel">
        <div className="vs-head">
          <span className="vs-dot" style={{ background: '#8c8475' }} />
          <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--df-mute)' }}>
            THE CHAT · UNSTRUCTURED
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 18px' }}>
          {D_BAD_CHAT.map((m, i) => (
            <ChatBubble key={i} m={m} />
          ))}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              color: 'var(--df-mute)',
              paddingTop: 4,
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--df-line)' }} />
            and it forgets all of this tomorrow
          </div>
        </div>
      </div>

      <div className="vs-panel vs-panel--drill">
        <div className="vs-head">
          <span className="vs-dot" style={{ background: 'var(--ok)' }} />
          <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)' }}>
            DRILL · STRUCTURED
          </span>
        </div>
        <div style={{ padding: '20px 18px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <span className="df-chip-dark">A1 · locked</span>
            <span className="df-chip-dark">present tense</span>
            <span className="df-chip-dark">español only</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              letterSpacing: '.5px',
              color: 'var(--df-mute)',
              marginBottom: 8,
            }}
          >
            PRODUCTION · TYPED
          </div>
          <div className="drill-stage" style={{ fontSize: 22, lineHeight: 1.5 }}>
            Cada mañana <span className="drill-blank type ok">me levanto</span> a las seis.
          </div>
          <div
            style={{
              fontFamily: 'var(--t-ui)',
              fontSize: 13,
              color: 'var(--df-mute)',
              marginTop: 8,
              fontStyle: 'italic',
            }}
          >
            “Every morning I get up at six.”
          </div>
          <div className="df-coach" style={{ marginTop: 16 }}>
            <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
              c
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
              <strong style={{ color: '#a8d6a0' }}>Right.</strong> Reflexive <em>levantarse</em> →{' '}
              <em>me levanto</em>. Logged to your record; it’ll come back on schedule.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatGPTCompare() {
  return (
    <section className="df-section" id="vs-chatgpt" style={{ scrollMarginTop: 80 }}>
      <div className="df-wrap">
        <div className="df-eyebrow2">Why not just ChatGPT?</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 820 }}>
          We built drill because we got tired of{' '}
          <span style={{ color: 'var(--accent)' }}>managing</span> the chatbot.
        </h2>
        <p style={{ color: 'var(--df-ink2)', fontSize: 17, lineHeight: 1.6, maxWidth: 620, marginTop: 16 }}>
          ChatGPT <em>can</em> write exercises, grade them and explain the grammar — that’s exactly
          what inspired this app. But ask it to practise every day and the cracks show: it drifts off
          your level, gives the answer away, repeats the same words, explains the fix in language you
          can’t yet read, and buries your results in an endless thread. drill keeps the good part and
          removes the overhead.
        </p>

        <VsSplit />

        {/* the four pains → fixes */}
        <div className="vs-rows">
          {D_CHAT_PAINS.map((p) => (
            <div key={p.id} className="vs-row">
              <div className="vs-row-label">{p.chatLabel}</div>
              <div className="vs-row-chat">
                <span className="vs-row-tag" style={{ color: 'var(--df-mute)' }}>
                  ChatGPT
                </span>
                <span>{p.chat}</span>
              </div>
              <div className="vs-row-drill">
                <span className="vs-row-tag" style={{ color: 'var(--accent)' }}>
                  drill
                </span>
                <span>{p.drill}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginTop: 34 }}>
          <Link href="/why-not-chatgpt" className="btn-xl">
            See the full comparison →
          </Link>
          <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--df-mute)' }}>
            the good part of the chatbot, none of the overhead
          </span>
        </div>
      </div>
    </section>
  );
}
