'use client';

// Dark marketing landing for "drill". Ported from the design handoff
// (landing/drill-landing.jsx). The hero plays a TYPED production demo (the real
// way to practise), then the page walks the loop: Read (deep annotation) →
// Save → Review (vocabulary) → Produce. The design's dev-only "tweaks" panel is
// dropped; CTAs route into the Clerk sign-up / sign-in flows.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';
import {
  D_CLOZE,
  D_LANGS,
  D_PASSAGES,
  D_SEED_VOCAB,
  D_SOON,
  type ClozeItem,
  type LandingLang,
  type Token,
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

export interface BankWord {
  w: string;
  lang: string;
  gloss: string;
}

/* ───────────────────────── chrome ───────────────────────── */

export function DBrand() {
  return (
    <Link href="/" style={{ textDecoration: 'none' }} aria-label="drill — home">
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: '0.06em',
          lineHeight: 1,
          fontSize: 23,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--t-display)',
            fontWeight: 600,
            fontSize: '1em',
            letterSpacing: '-0.025em',
            lineHeight: 1,
            color: '#f3ece0',
            borderBottom: '0.1em solid var(--accent)',
            paddingBottom: '0.12em',
          }}
        >
          drill
        </span>
        <span
          style={{
            width: '0.07em',
            height: '0.62em',
            background: 'var(--accent)',
            borderRadius: '0.04em',
            marginBottom: '0.16em',
          }}
        />
      </span>
    </Link>
  );
}

export function DLangRail({
  lang,
  setLang,
  full,
}: {
  lang: string;
  setLang: (id: string) => void;
  full?: boolean;
}) {
  return (
    <div className="lang-rail" role="tablist" aria-label="language">
      {D_LANGS.map((l) => (
        <button
          key={l.id}
          role="tab"
          aria-selected={lang === l.id}
          className={'lang-pill' + (lang === l.id ? ' on' : '')}
          onClick={() => setLang(l.id)}
        >
          {full ? l.label : null}
          <span className={full ? 'tag' : ''}>{l.tag}</span>
        </button>
      ))}
    </div>
  );
}

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
          <div className="df-eyebrow">Read · Save · Review · Produce</div>
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
        </div>
        <ProductionDemo defaultLang={DEFAULT_LANG} />
      </div>
    </header>
  );
}

/* ───────────────── connective loop strip ───────────────── */

function LoopStrip() {
  const steps: [string, string, string][] = [
    ['01', 'Read', 'Real text, a notch above your level.'],
    ['02', 'Save', 'Tap a word → it lands in your bank.'],
    ['03', 'Review', 'Saved words come back, spaced.'],
    ['04', 'Produce', 'Type the form. No multiple choice.'],
  ];
  return (
    <section className="df-section" id="how" style={{ scrollMarginTop: 80 }}>
      <div className="df-wrap">
        <div className="df-eyebrow2">One loop</div>
        <h2 className="df-h2" style={{ marginTop: 14 }}>
          Four moves, then again.
        </h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginTop: 40 }}
          className="loop-grid"
        >
          {steps.map(([n, h, b]) => (
            <div key={n} className="df-card">
              <div className="df-mono-num">{n}</div>
              <div
                style={{
                  fontFamily: 'var(--t-display)',
                  fontSize: 21,
                  color: 'var(--df-ink)',
                  marginTop: 10,
                }}
              >
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
      </div>
    </section>
  );
}

/* ───────────── reading: deep annotation (dark) ───────────── */

export function ReadingNote({
  tok,
  onSave,
  saved,
}: {
  tok: Token;
  onSave: () => void;
  saved: boolean;
}) {
  return (
    <div className="df-note swap" key={tok.w}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--t-display)',
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: '-0.4px',
            color: 'var(--df-ink)',
          }}
        >
          {tok.w}
        </div>
        <span className="df-chip-dark">{tok.pos}</span>
      </div>
      {tok.lemma && tok.lemma !== '—' && (
        <div className="t-mono" style={{ fontSize: 12, color: 'var(--df-mute)', marginTop: 4 }}>
          {tok.lemma}
        </div>
      )}
      <div style={{ height: 1, background: 'var(--df-line)', margin: '15px 0' }} />
      <div
        style={{
          fontFamily: 'var(--t-display)',
          fontSize: 20,
          fontWeight: 500,
          color: 'var(--df-ink)',
          letterSpacing: '-0.3px',
        }}
      >
        {tok.gloss}
      </div>
      <p
        style={{
          marginTop: 9,
          marginBottom: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--df-ink2)',
        }}
      >
        {tok.note}
      </p>
      <button
        onClick={onSave}
        disabled={saved}
        className="btn-xl"
        style={{
          width: '100%',
          marginTop: 18,
          padding: '11px 12px',
          opacity: saved ? 0.55 : 1,
          cursor: saved ? 'default' : 'pointer',
        }}
      >
        {saved ? '✓ saved to vocabulary' : '+ save to vocabulary'}
      </button>
    </div>
  );
}

function ReadingShowcase({
  defaultLang,
  bank,
  onSave,
}: {
  defaultLang: string;
  bank: BankWord[];
  onSave: (item: BankWord) => void;
}) {
  const [lang, setLang] = useState(D_PASSAGES[defaultLang] ? defaultLang : 'es');
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    setSel(null);
  }, [lang]);
  const passage = D_PASSAGES[lang];
  const meta = D_LANGS.find((l) => l.id === lang)!;
  const tokens = passage.tokens;
  const selTok = sel != null && typeof tokens[sel] === 'object' ? (tokens[sel] as Token) : null;
  const savedSet = new Set(bank.map((b) => b.w));
  const annotated = tokens.filter((x) => typeof x === 'object').length;

  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">Where the words come from</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
          Read above your level. Tap anything you don’t know.
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
          No baby sentences. Every underlined word is one tap from a deep note — meaning, grammar,
          etymology — and one more from your own deck.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            margin: '30px 0 26px',
          }}
        >
          <DLangRail lang={lang} setLang={setLang} />
          <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--df-mute)' }}>
            vocabulary · <strong style={{ color: 'var(--accent)' }}>{bank.length}</strong> saved
          </span>
        </div>

        <div className="df-read-grid">
          <div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}
            >
              <span
                style={{
                  fontFamily: 'var(--t-mono)',
                  fontSize: 11,
                  letterSpacing: '1.4px',
                  textTransform: 'uppercase',
                  color: 'var(--df-mute)',
                }}
              >
                {passage.title}
              </span>
              <span
                style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }}
              />
              <span style={{ fontSize: 12, color: 'var(--df-mute)' }}>{passage.source}</span>
              <span className="df-chip-dark" style={{ marginLeft: 'auto' }}>
                {meta.cefr}
              </span>
            </div>
            <div
              style={{
                borderLeft: '2px solid color-mix(in oklab, var(--accent) 40%, var(--df-line))',
                paddingLeft: 26,
              }}
            >
              <p className="df-passage swap" key={lang}>
                {tokens.map((tk, i) =>
                  typeof tk === 'string' ? (
                    <span key={lang + i}>{tk}</span>
                  ) : (
                    <button
                      key={lang + i}
                      className={'df-word' + (sel === i ? ' on' : '')}
                      onClick={() => setSel(sel === i ? null : i)}
                    >
                      {tk.w}
                    </button>
                  )
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
                style={{
                  width: 16,
                  borderBottom: '2px dotted var(--accent)',
                  display: 'inline-block',
                }}
              />
              {annotated} words annotated · tap to open
            </div>
          </div>

          <aside className="df-rail">
            {selTok ? (
              <ReadingNote
                tok={selTok}
                saved={savedSet.has(selTok.w)}
                onSave={() => onSave({ w: selTok.w, lang: meta.tag, gloss: selTok.gloss })}
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
                  <span style={{ color: 'var(--accent)', fontWeight: 500 }}>underlined word</span>.
                  It explains itself right here — then save it with one tap.
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ───────────── vocabulary review (fed by bank) ───────────── */

interface Review {
  w: string;
  lang: string;
  gloss: string;
  due: string;
  isNew?: boolean;
}

function VocabReview({ bank }: { bank: BankWord[] }) {
  const [graded, setGraded] = useState<Record<string, string>>({});
  const fromBank: Review[] = bank.map((b) => ({
    w: b.w,
    lang: b.lang,
    gloss: b.gloss,
    due: 'just added',
    isNew: true,
  }));
  const list: Review[] = [...fromBank.slice().reverse(), ...D_SEED_VOCAB];
  const grade = (key: string, label: string) => setGraded((g) => ({ ...g, [key]: label }));

  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">Saved words become reviews</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 720 }}>
          Your deck builds itself from what you actually read.
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
          Every word you save drops into a spaced queue. Grade your recall and drill schedules it —
          misses come back sooner, wins drift later.
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 36, maxWidth: 720 }}>
          {bank.length === 0 && (
            <div
              style={{
                fontFamily: 'var(--t-mono)',
                fontSize: 12,
                color: 'var(--df-mute)',
                padding: '2px 2px 8px',
              }}
            >
              ↑ save a word from the passage above and watch it appear here.
            </div>
          )}
          {list.map((v, i) => {
            const key = v.w + '-' + i;
            const g = graded[key];
            const nextDue =
              g === 'Again'
                ? 'back in 1 min'
                : g === 'Good'
                  ? 'in 3 days'
                  : g === 'Easy'
                    ? 'in 8 days'
                    : v.due;
            return (
              <div key={key} className={'vocab-card' + (v.isNew && !g ? ' vocab-new' : '')}>
                <span className="vocab-flag">{v.lang}</span>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--t-display)',
                      fontSize: 21,
                      fontWeight: 500,
                      color: 'var(--df-ink)',
                      letterSpacing: '-0.3px',
                    }}
                  >
                    {v.w}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--df-ink2)', marginTop: 2 }}>
                    {v.gloss}
                    <span
                      style={{
                        fontFamily: 'var(--t-mono)',
                        fontSize: 11,
                        color: g ? 'var(--ok)' : v.isNew ? 'var(--accent)' : 'var(--df-mute)',
                        marginLeft: 10,
                      }}
                    >
                      {g ? '✓ ' + nextDue : v.isNew ? '● ' + v.due : nextDue}
                    </span>
                  </div>
                </div>
                <div className="vocab-grade">
                  <button className="again" onClick={() => grade(key, 'Again')}>
                    Again
                  </button>
                  <button onClick={() => grade(key, 'Good')}>Good</button>
                  <button className="easy" onClick={() => grade(key, 'Easy')}>
                    Easy
                  </button>
                </div>
              </div>
            );
          })}
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
          © 2026 drill · read, save, produce
        </div>
        <Link href="/sign-in" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
          Sign in →
        </Link>
      </div>
      <div className="df-wrap">
        <LegalLinks className="mt-s-4" />
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
            <Link
              href="/sign-in"
              style={{
                color: 'var(--df-ink2)',
                fontSize: 13,
                fontFamily: 'var(--t-ui)',
                textDecoration: 'none',
              }}
            >
              Sign in
            </Link>
            <Link href="/sign-up" className="btn-xl" style={{ padding: '8px 18px', fontSize: 13 }}>
              Sign up free
            </Link>
          </div>
        </div>
      </div>
      <DrillHero />
      <LoopStrip />
      <ReadingShowcase defaultLang={DEFAULT_LANG} bank={bank} onSave={onSave} />
      <VocabReview bank={bank} />
      <WhyProduce />
      <DLangBand />
      <DCTA />
      <DFooter />
    </div>
  );
}
