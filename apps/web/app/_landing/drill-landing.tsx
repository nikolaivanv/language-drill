'use client';

// Dark marketing landing for "drill". Ported from the design handoff
// (landing/drill-landing.jsx). The hero plays a TYPED production demo (the real
// way to practise), then the page walks the loop: Read → Save → Review →
// Produce, via the five-mode practice carousel and the "why not ChatGPT?"
// positioning section. The design's dev-only "tweaks" panel is dropped; CTAs
// route into the Clerk sign-up / sign-in flows.

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';
import { DBrand, DeepAnnotationCard, type BankWord } from './landing-chrome';
import { PracticeCarousel } from './practice-carousel';
import { ChatGPTCompare } from './chatgpt-compare';
import {
  D_CLOZE,
  D_LANGS,
  D_READING,
  D_SOON,
  type ClozeItem,
  type DeepCard,
  type LandingLang,
} from './landing-data';
import { LegalLinks } from '../../components/legal/legal-links';

const DEFAULT_LANG = 'es';

type CoachKey = 'prompt' | 'no' | 'ok';
type DemoStatus = 'idle' | 'typing' | 'wrong' | 'clearing' | 'right';
interface Frame {
  typed: string;
  status: DemoStatus;
  coach: CoachKey;
}
interface Step extends Frame {
  dur: number;
}

// DBrand / DLangRail / ReadingNote / BankWord live in landing-chrome.tsx,
// shared with the carousel, the compare pieces and the mobile reflow.
export { DBrand, DLangRail, ReadingNote, type BankWord } from './landing-chrome';

/* ─────────────── hero: typed production demo ─────────────── */

function buildTimeline(item: ClozeItem): Step[] {
  const s: Step[] = [];
  const push = (o: Frame, dur: number) => s.push({ ...o, dur });
  push({ typed: '', status: 'idle', coach: 'prompt' }, 950);
  for (let i = 1; i <= item.wrongTyped.length; i++)
    push({ typed: item.wrongTyped.slice(0, i), status: 'typing', coach: 'prompt' }, 72);
  push({ typed: item.wrongTyped, status: 'typing', coach: 'prompt' }, 520);
  push({ typed: item.wrongTyped, status: 'wrong', coach: 'no' }, 2700);
  push({ typed: '', status: 'clearing', coach: 'prompt' }, 460);
  for (let i = 1; i <= item.blank.length; i++)
    push({ typed: item.blank.slice(0, i), status: 'typing', coach: 'prompt' }, 86);
  push({ typed: item.blank, status: 'typing', coach: 'prompt' }, 460);
  push({ typed: item.blank, status: 'right', coach: 'ok' }, 3100);
  return s;
}

export function ProductionDemo({ defaultLang }: { defaultLang: string }) {
  const order = ['es', 'de', 'tr'];
  const startIx = Math.max(0, order.indexOf(defaultLang));
  const [li, setLi] = useState(startIx);
  const lang = order[li];
  const item = D_CLOZE[lang];
  const meta = D_LANGS.find((l) => l.id === lang)!;
  // Initial render is identical on server and client (idle); a reduced-motion
  // visitor is snapped to the solved state inside the effect, post-hydration.
  const [frame, setFrame] = useState<Frame>({ typed: '', status: 'idle', coach: 'prompt' });
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setFrame({ typed: item.blank, status: 'right', coach: 'ok' });
      setStreak(1);
      return;
    }
    const steps = buildTimeline(item);
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = steps[idx];
      setFrame(s);
      if (s.status === 'right') setStreak((x) => x + 1);
      idx++;
      if (idx < steps.length) timer = setTimeout(tick, s.dur);
      else timer = setTimeout(() => setLi((v) => (v + 1) % order.length), s.dur);
    };
    timer = setTimeout(tick, 350);
    return () => clearTimeout(timer);
    // Intentionally keyed only on `li`: each language index restarts the demo
    // timeline; `item`/`order` are derived from `li` and stable per render.
  }, [li]);

  const blankCls =
    'drill-blank type' +
    (frame.status === 'wrong'
      ? ' no'
      : frame.status === 'right'
        ? ' ok'
        : frame.typed
          ? ' filled'
          : '');
  const showCaret =
    frame.status === 'typing' || frame.status === 'idle' || frame.status === 'clearing';

  return (
    <div className="drill-card lift">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span className="df-typedot">
          <b />
          PRODUCTION MODE · TYPED
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 7,
              background: 'var(--ok)',
              boxShadow: '0 0 0 3px color-mix(in oklab, var(--ok) 25%, transparent)',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              color: 'var(--df-mute)',
              letterSpacing: '0.5px',
            }}
          >
            LIVE DEMO
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--t-mono)',
            fontSize: 11,
            color: 'var(--df-ink2)',
            padding: '4px 10px',
            border: '1px solid var(--df-line)',
            borderRadius: 999,
          }}
        >
          {meta.tag} · {item.skill}
        </span>
        <span
          style={{
            fontFamily: 'var(--t-mono)',
            fontSize: 12,
            color: streak ? 'var(--accent)' : 'var(--df-mute)',
          }}
        >
          streak · {streak}
        </span>
      </div>

      {/* the sentence with a typed blank */}
      <div className="drill-stage" style={{ padding: '12px 2px 8px' }}>
        {item.pre}
        <span className={blankCls}>
          {frame.typed || (showCaret ? '' : ' ')}
          {showCaret && <i className="df-caret" />}
        </span>
        {item.post}
      </div>
      <div
        style={{
          fontFamily: 'var(--t-ui)',
          fontSize: 13,
          color: 'var(--df-mute)',
          marginTop: 6,
          marginBottom: 18,
          fontStyle: 'italic',
        }}
      >
        {item.en}
      </div>

      {/* coach line */}
      <div
        className="df-coach swap"
        key={frame.status + frame.typed}
        style={
          frame.status === 'wrong'
            ? { borderColor: 'color-mix(in oklab, var(--accent) 45%, var(--df-line))' }
            : frame.status === 'right'
              ? { borderColor: 'color-mix(in oklab, var(--ok) 45%, var(--df-line))' }
              : undefined
        }
      >
        <div
          className="df-coach-dot"
          style={frame.status === 'right' ? { background: 'var(--ok)' } : undefined}
        >
          c
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--df-ink)' }}>
          {frame.coach === 'no' && (
            <>
              <strong style={{ color: '#f0a78c' }}>Not quite.</strong> {item.explainNo}
            </>
          )}
          {frame.coach === 'ok' && (
            <>
              <strong style={{ color: '#a8d6a0' }}>Right.</strong> {item.explainOk}
            </>
          )}
          {frame.coach === 'prompt' && (
            <span style={{ color: 'var(--df-ink2)' }}>
              Type the form that fits — no options to lean on. drill grades it the moment you hit{' '}
              <span
                style={{
                  fontFamily: 'var(--t-mono)',
                  fontSize: 12,
                  border: '1px solid var(--df-line)',
                  borderRadius: 5,
                  padding: '1px 6px',
                }}
              >
                ↵
              </span>
            </span>
          )}
        </div>
      </div>

      {/* faux input footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 18,
        }}
      >
        <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--df-mute)' }}>
          {meta.label} · {meta.cefr} · {item.helper}
        </span>
        <span
          className="btn-xl"
          style={{
            padding: '10px 22px',
            opacity: frame.status === 'wrong' || frame.status === 'right' ? 0.5 : 1,
            pointerEvents: 'none',
          }}
        >
          {frame.status === 'right' ? 'Next →' : 'Check ↵'}
        </span>
      </div>
    </div>
  );
}

function DrillHero() {
  return (
    <header style={{ paddingTop: 60, paddingBottom: 74 }}>
      <div className="df-wrap df-hero">
        <div>
          <div className="df-eyebrow">Produce, don’t recognise</div>
          <h1 className="df-h1" style={{ marginTop: 18 }}>
            Stop reviewing&nbsp;words.
            <br />
            Start <span style={{ color: 'var(--accent)' }}>producing</span> them.
          </h1>
          <p className="df-sub" style={{ marginTop: 22 }}>
            Read real prose, save the words you trip on, and drill them back by <em>typing</em> the
            answer — not picking it. drill grades every keystroke and coaches the miss on the spot.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 30, flexWrap: 'wrap' }}>
            <Link href="/sign-up" className="btn-xl">
              Sign up free
            </Link>
          </div>
          <div
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              color: 'var(--df-mute)',
              marginTop: 18,
              letterSpacing: '.4px',
            }}
          >
            watch the demo type, miss, and self-correct — that’s production →
          </div>
          <div className="hero-langs">
            <span className="hero-langs-lbl">On the floor now</span>
            <div className="hero-langs-row">
              {D_LANGS.map((l) => (
                <span key={l.id} className="hero-lang-pill">
                  <b>{l.label}</b>
                  <span className="tag">{l.tag}</span>
                </span>
              ))}
              <span className="hero-langs-soon">soon</span>
              {D_SOON.map((l) => (
                <span key={l.tag} className="hero-lang-soon">
                  {l.tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <ProductionDemo defaultLang={DEFAULT_LANG} />
      </div>
    </header>
  );
}

/* ───────────── academic-rigour stat band ───────────── */

function DRigourBand() {
  const stats = [
    { big: <>3</>, l1: 'Languages', l2: 'Spanish · German · Turkish' },
    {
      big: (
        <>
          A1<span style={{ color: 'var(--accent)' }}>–</span>B2
        </>
      ),
      l1: 'CEFR levels,',
      l2: 'end to end',
    },
    { big: <>298</>, l1: 'Grammar lessons,', l2: 'one per point' },
    {
      big: (
        <>
          20,000<span style={{ color: 'var(--accent)' }}>+</span>
        </>
      ),
      l1: 'Production exercises',
      l2: 'in the pool',
    },
  ];
  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">Built on real grammar</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
          Every drill traces back to a grammar you can trust.
        </h2>
        <p
          style={{
            color: 'var(--df-ink2)',
            fontSize: 17,
            lineHeight: 1.6,
            maxWidth: 600,
            marginTop: 16,
          }}
        >
          Grounded in an authoritative curriculum, calibrated to your CEFR level, and rewritten the
          moment the data says an item fell short.
        </p>
        <div className="ar-stats" style={{ marginTop: 40 }}>
          {stats.map((s, i) => (
            <div key={i} className="ar-stat">
              <div className="ar-stat-big">{s.big}</div>
              <div className="ar-stat-lab">
                {s.l1}
                <br />
                {s.l2}
              </div>
            </div>
          ))}
        </div>
        <Link href="/academic-rigour" className="df-rigour-link">
          See how the material is made <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

/* ───────── reading: deep annotation (fed into the deck) ───────── */

function DeepAnnotationShowcase() {
  const tokens = D_READING.tokens;
  const wordIdx = tokens.reduce<number[]>(
    (acc, t, i) => (typeof t === 'object' ? [...acc, i] : acc),
    [],
  );
  // open on "limana", the case-marked example, like the app screenshot
  const [sel, setSel] = useState<number>(wordIdx[3] ?? wordIdx[0] ?? 0);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const selTok = tokens[sel];
  const selCard: DeepCard | null = typeof selTok === 'object' ? selTok : null;
  const toggle = (w: string) => setSaved((s) => ({ ...s, [w]: !s[w] }));
  const savedCount = Object.values(saved).filter(Boolean).length;

  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-read-grid" style={{ alignItems: 'start' }}>
          <div>
            <div className="df-eyebrow2">Where the words come from</div>
            <h2 className="df-h2" style={{ marginTop: 14 }}>
              Read real text. Tap any word for the full breakdown.
            </h2>
            <p
              style={{
                color: 'var(--df-ink2)',
                fontSize: 17,
                lineHeight: 1.6,
                maxWidth: 560,
                marginTop: 16,
              }}
            >
              No baby sentences. Every word in the passage is one tap from a deep note — meaning in
              context, a target-language definition, the morphology broken out — and one more into
              your deck. Your vocabulary builds itself from what you actually read.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '38px 0 16px' }}>
              <span
                style={{
                  fontFamily: 'var(--t-mono)',
                  fontSize: 11,
                  letterSpacing: '1.4px',
                  textTransform: 'uppercase',
                  color: 'var(--df-mute)',
                }}
              >
                {D_READING.title}
              </span>
              <span style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }} />
              <span style={{ fontSize: 12, color: 'var(--df-mute)' }}>{D_READING.source}</span>
              <span className="df-chip-dark" style={{ marginLeft: 'auto' }}>
                {D_READING.tag} · {D_READING.cefr}
              </span>
            </div>
            <div
              style={{
                borderLeft: '2px solid color-mix(in oklab, var(--accent) 40%, var(--df-line))',
                paddingLeft: 26,
              }}
            >
              <p className="df-passage">
                {tokens.map((tk, i) =>
                  typeof tk === 'string' ? (
                    <Fragment key={i}>{tk}</Fragment>
                  ) : (
                    <button
                      key={i}
                      className={'df-word' + (sel === i ? ' on' : '')}
                      onClick={() => setSel(i)}
                    >
                      {tk.surface}
                    </button>
                  ),
                )}
              </p>
            </div>
            <div
              style={{
                marginTop: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: 'var(--df-mute)',
              }}
            >
              <span
                style={{ width: 16, borderBottom: '2px dotted var(--accent)', display: 'inline-block' }}
              />
              {wordIdx.length} words annotated · tap to open
              {savedCount > 0 ? ' · ' + savedCount + ' saved' : ''}
            </div>
          </div>
          <aside className="df-rail">
            {selCard ? (
              <DeepAnnotationCard
                card={selCard}
                key={sel}
                saved={!!saved[selCard.surface]}
                onToggle={() => toggle(selCard.surface)}
              />
            ) : (
              <div className="df-hint">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ margin: '0 auto 12px', display: 'block' }}
                >
                  <path
                    d="M5 12h11M11 7l6 5-6 5"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div
                  style={{
                    fontSize: 15,
                    color: 'var(--df-ink2)',
                    maxWidth: 230,
                    margin: '0 auto',
                    lineHeight: 1.55,
                  }}
                >
                  Tap any{' '}
                  <span style={{ color: 'var(--accent)', fontWeight: 500 }}>underlined word</span>. It
                  explains itself right here — then save it with one tap.
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ───────── why production beats recognition ───────── */

function WhyProduce() {
  const rows: [string, string, string, boolean][] = [
    ['Recognition', 'Pick the right answer from four options', 'Feels good. Fades fast.', false],
    ['Production', 'Type the form yourself, from nothing', 'Harder. It’s the one that sticks.', true],
  ];
  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">Why typing, not tapping</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
          You don’t learn a language by recognising it.
        </h2>
        <p
          style={{
            color: 'var(--df-ink2)',
            fontSize: 17,
            lineHeight: 1.6,
            maxWidth: 560,
            marginTop: 16,
          }}
        >
          Multiple choice is a warm-up — the answer is already on screen. The real work is{' '}
          <em>retrieval</em>: pulling the conjugation, case or particle out of your own head and
          typing it. That’s the loop the demo above runs.
        </p>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 40 }}
          className="loop-grid"
        >
          {rows.map(([h, b, c, hot]) => (
            <div
              key={h}
              className="df-card"
              style={
                hot
                  ? { borderColor: 'color-mix(in oklab, var(--accent) 50%, var(--df-line))' }
                  : undefined
              }
            >
              <div
                style={{
                  fontFamily: 'var(--t-mono)',
                  fontSize: 12,
                  color: hot ? 'var(--accent)' : 'var(--df-mute)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}
              >
                {h}
              </div>
              <div
                style={{
                  fontFamily: 'var(--t-display)',
                  fontSize: 22,
                  color: 'var(--df-ink)',
                  marginTop: 12,
                  letterSpacing: '-0.3px',
                }}
              >
                {b}
              </div>
              <div style={{ color: hot ? '#e8b9a6' : 'var(--df-ink2)', fontSize: 15, marginTop: 8 }}>
                {c}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── languages + coming soon ───────────── */

function DLangBand() {
  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">Languages</div>
        <h2 className="df-h2" style={{ marginTop: 14 }}>
          Three on the floor. More on the way.
        </h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginTop: 36 }}
          className="loop-grid"
        >
          {D_LANGS.map((l: LandingLang) => (
            <div key={l.id} className="df-card">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: 'var(--t-display)', fontSize: 26, color: 'var(--df-ink)' }}>
                  {l.label}
                </div>
                <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--accent)' }}>
                  {l.tag}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--t-mono)',
                  fontSize: 11,
                  color: 'var(--df-mute)',
                  marginTop: 8,
                }}
              >
                {l.cefr} · {D_CLOZE[l.id].skill}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            marginTop: 22,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              color: 'var(--df-mute)',
            }}
          >
            Coming soon
          </span>
          {D_SOON.map((l) => (
            <span key={l.tag} className="df-chip-dark" style={{ padding: '6px 12px' }}>
              {l.label}{' '}
              <span style={{ fontFamily: 'var(--t-mono)', opacity: 0.6, marginLeft: 4 }}>
                {l.tag}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── CTA + footer ───────────── */

function DCTA() {
  return (
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
            Get on the floor.
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
            Read a passage, save a word, and feel the coaching kick in the moment you type your
            first answer.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              marginTop: 28,
              flexWrap: 'wrap',
            }}
          >
            <Link
              href="/sign-up"
              className="btn-xl"
              style={{ background: '#fff', color: 'var(--accent-2)', borderColor: '#fff' }}
            >
              Sign up free
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
  );
}

function DFooter() {
  return (
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
          © 2026 drill · type it, don’t tap it
        </div>
        <Link href="/sign-in" className="df-footlink">
          Sign in →
        </Link>
      </div>
      <div className="df-wrap">
        <LegalLinks className="mt-s-4 landing-legal-links" />
      </div>
    </footer>
  );
}

/* ───────────── root ───────────── */

export function DrillLanding() {
  const [bank, setBank] = useState<BankWord[]>([]);
  const onSave = (item: BankWord) =>
    setBank((b) => (b.some((x) => x.w === item.w) ? b : [...b, item]));

  return (
    <div className="df">
      <div className="df-top">
        <div className="df-wrap df-top-inner">
          <DBrand />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/academic-rigour" className="vs-navlink">
              Academic rigour
            </Link>
            <a href="#vs-chatgpt" className="vs-navlink">
              Why not ChatGPT?
            </a>
            <span style={{ width: 1, height: 20, background: 'var(--df-line)', margin: '0 2px' }} />
            <Link href="/sign-in" className="df-signin">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn-xl" style={{ padding: '8px 18px', fontSize: 13 }}>
              Sign up free
            </Link>
          </div>
        </div>
      </div>
      <DrillHero />
      <DRigourBand />
      <PracticeCarousel defaultLang={DEFAULT_LANG} bank={bank} onSave={onSave} />
      <DeepAnnotationShowcase />
      <WhyProduce />
      <ChatGPTCompare />
      <DLangBand />
      <DCTA />
      <DFooter />
    </div>
  );
}
