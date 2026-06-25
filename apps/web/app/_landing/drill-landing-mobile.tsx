'use client';

// drill — canonical landing, Mobile Web reflow. Ported from the design handoff
// (landing/drill-landing-mobile.jsx). The dark "read · save · review · produce"
// landing reflowed for a ~390px phone. Reuses the real interactive pieces from
// drill-landing.tsx (ProductionDemo, DLangRail, ReadingNote, DBrand) plus the
// shared data, so the typed demo, tap-to-save reading, and review deck behave
// exactly like desktop. Styling lives in landing.css (the `.dfm` block). State
// (the saved word bank) is lifted here so saving in Read feeds the Review deck.
// CTAs route into the Clerk sign-up / sign-in flows (the design's dev-only
// "compare directions" footer link is dropped).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import './landing.css';
import {
  DBrand,
  DLangRail,
  ProductionDemo,
  ReadingNote,
  type BankWord,
} from './drill-landing';
import { D_CLOZE, D_LANGS, D_PASSAGES, D_SEED_VOCAB, D_SOON, type Token } from './landing-data';
import { LegalLinks } from '../../components/legal/legal-links';

const DEFAULT_LANG = 'es';

/* ── chrome ── */
function MTopBar() {
  return (
    <div className="dfm-top">
      <DBrand />
      <div className="dfm-actions">
        <Link href="/sign-in" className="dfm-signin">
          Sign in
        </Link>
        <Link href="/sign-up" className="dfm-signup">
          Sign up free
        </Link>
      </div>
    </div>
  );
}

/* ── hero: typed-production demo ── */
function MHero() {
  return (
    <header className="dfm-wrap dfm-hero">
      <div className="dfm-eyebrow">Read · Save · Review · Produce</div>
      <h1 className="dfm-h1">
        Stop reviewing&nbsp;words. Start{' '}
        <span style={{ color: 'var(--accent)' }}>producing</span> them.
      </h1>
      <p className="dfm-sub">
        Read real prose, save the words you trip on, and drill them back by <em>typing</em> the
        answer — not picking it. drill grades every keystroke and coaches the miss on the spot.
      </p>
      <div className="dfm-cta-col">
        <Link href="/sign-up" className="dfm-btn">
          Sign up free
        </Link>
      </div>
      <div className="dfm-demo-hint">
        <span className="ln" /> <span style={{ flexShrink: 0 }}>watch it type, miss & self-correct</span>{' '}
        <span className="ln" />
      </div>
      <ProductionDemo defaultLang={DEFAULT_LANG} />
    </header>
  );
}

/* ── one loop: Read → Save → Review → Produce ── */
function MLoop() {
  const steps: [string, string, string][] = [
    ['01', 'Read', 'Real text, a notch above your level.'],
    ['02', 'Save', 'Tap a word → it lands in your bank.'],
    ['03', 'Review', 'Saved words come back, spaced.'],
    ['04', 'Produce', 'Type the form. No multiple choice.'],
  ];
  return (
    <section className="dfm-wrap dfm-section" id="how" style={{ scrollMarginTop: 64 }}>
      <div className="dfm-eyebrow2">One loop</div>
      <h2 className="dfm-h2">Four moves, then again.</h2>
      <div className="dfm-stack">
        {steps.map(([n, h, b]) => (
          <div key={n} className="dfm-loop-row">
            <div className="dfm-loop-n">{n}</div>
            <div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--df-ink)' }}>
                {h}
              </div>
              <p style={{ color: 'var(--df-ink2)', fontSize: 14, lineHeight: 1.5, margin: '6px 0 0' }}>
                {b}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── reading: deep annotation, note stacks below passage ── */
function MReading({
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
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Where the words come from</div>
      <h2 className="dfm-h2">Read above your level. Tap anything you don’t know.</h2>
      <p className="dfm-lead">
        No baby sentences. Every underlined word is one tap from a deep note — meaning, grammar,
        etymology — and one more from your own deck.
      </p>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '22px 0 20px' }}
      >
        <DLangRail lang={lang} setLang={setLang} />
        <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--df-mute)' }}>
          vocab · <strong style={{ color: 'var(--accent)' }}>{bank.length}</strong> saved
        </span>
      </div>

      <div className="dfm-read-meta">
        <span className="ttl">{passage.title}</span>
        <span style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }} />
        <span className="src">{passage.source}</span>
        <span className="df-chip-dark" style={{ marginLeft: 'auto' }}>
          {meta.cefr}
        </span>
      </div>

      <div className="dfm-passage">
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

      <div className="dfm-read-foot">
        <span className="dash" /> {annotated} words annotated · tap to open
      </div>

      <div className="dfm-note-wrap">
        {selTok ? (
          <ReadingNote
            tok={selTok}
            saved={savedSet.has(selTok.w)}
            onSave={() => onSave({ w: selTok.w, lang: meta.tag, gloss: selTok.gloss })}
          />
        ) : (
          <div className="df-hint">
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              style={{ margin: '0 auto 10px', display: 'block' }}
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
              style={{ fontSize: 14.5, color: 'var(--df-ink2)', maxWidth: 250, margin: '0 auto', lineHeight: 1.55 }}
            >
              Tap any <span style={{ color: 'var(--accent)', fontWeight: 500 }}>underlined word</span>{' '}
              above. It explains itself right here — then save it with one tap.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── vocabulary review, fed by the bank ── */
interface Review {
  w: string;
  lang: string;
  gloss: string;
  due: string;
  isNew?: boolean;
}

function MVocab({ bank }: { bank: BankWord[] }) {
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
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Saved words become reviews</div>
      <h2 className="dfm-h2">Your deck builds itself from what you read.</h2>
      <p className="dfm-lead">
        Every word you save drops into a spaced queue. Grade your recall and drill schedules it —
        misses come back sooner, wins drift later.
      </p>

      <div className="dfm-stack">
        {bank.length === 0 && (
          <div
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 12,
              color: 'var(--df-mute)',
              padding: '0 2px 2px',
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
            <div key={key} className={'dfm-vocab' + (v.isNew && !g ? ' is-new' : '')}>
              <div className="dfm-vocab-head">
                <span className="dfm-vocab-flag">{v.lang}</span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--t-display)',
                      fontSize: 20,
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
                        marginLeft: 8,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {g ? '✓ ' + nextDue : v.isNew ? '● ' + v.due : nextDue}
                    </span>
                  </div>
                </div>
              </div>
              <div className="dfm-vocab-grade">
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
    </section>
  );
}

/* ── why typing, not tapping ── */
function MWhy() {
  const rows: [string, string, string, boolean][] = [
    ['Recognition', 'Pick the right answer from four options', 'Feels good. Fades fast.', false],
    ['Production', 'Type the form yourself, from nothing', 'Harder. It’s the one that sticks.', true],
  ];
  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Why typing, not tapping</div>
      <h2 className="dfm-h2">You don’t learn a language by recognising it.</h2>
      <p className="dfm-lead">
        Multiple choice is a warm-up — the answer is already on screen. The real work is{' '}
        <em>retrieval</em>: pulling the conjugation, case or particle out of your own head and typing
        it. That’s the loop the demo above runs.
      </p>
      <div className="dfm-stack">
        {rows.map(([h, b, c, hot]) => (
          <div
            key={h}
            className="dfm-card"
            style={
              hot
                ? { borderColor: 'color-mix(in oklab, var(--accent) 50%, var(--df-line))' }
                : undefined
            }
          >
            <div
              style={{
                fontFamily: 'var(--t-mono)',
                fontSize: 11,
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
                fontSize: 19,
                color: 'var(--df-ink)',
                marginTop: 10,
                letterSpacing: '-0.3px',
                lineHeight: 1.2,
              }}
            >
              {b}
            </div>
            <div style={{ color: hot ? '#e8b9a6' : 'var(--df-ink2)', fontSize: 14, marginTop: 8 }}>
              {c}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── languages + coming soon ── */
function MLangBand() {
  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Languages</div>
      <h2 className="dfm-h2">Three on the floor. More on the way.</h2>
      <div className="dfm-stack">
        {D_LANGS.map((l) => (
          <div key={l.id} className="dfm-card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 23, color: 'var(--df-ink)' }}>
                {l.label}
              </div>
              <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--accent)' }}>
                {l.tag}
              </span>
            </div>
            <div
              style={{
                fontFamily: 'var(--t-mono)',
                fontSize: 10.5,
                color: 'var(--df-mute)',
                marginTop: 8,
              }}
            >
              {l.cefr} · {D_CLOZE[l.id].skill}
            </div>
          </div>
        ))}
      </div>
      <div className="dfm-soon">
        <span className="lbl">Coming soon</span>
        {D_SOON.map((l) => (
          <span key={l.tag} className="df-chip-dark" style={{ padding: '6px 12px' }}>
            {l.label}{' '}
            <span style={{ fontFamily: 'var(--t-mono)', opacity: 0.6, marginLeft: 4 }}>{l.tag}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ── CTA + footer ── */
function MCTA() {
  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-ctaband">
        <h2>Get on the floor.</h2>
        <p>
          Read a passage, save a word, and feel the coaching kick in the moment you type your first
          answer.
        </p>
        <Link
          href="/sign-up"
          className="dfm-btn"
          style={{ background: '#fff', color: 'var(--accent-2)', borderColor: '#fff', marginTop: 22 }}
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
  );
}

function MFooter() {
  return (
    <footer className="dfm-footer">
      <DBrand />
      <div className="meta">© 2026 drill · read, save, produce</div>
      <Link href="/sign-in">Sign in →</Link>
      <LegalLinks className="mt-s-3 landing-legal-links" />
    </footer>
  );
}

/* ── root ── */
export function DrillLandingMobile() {
  const [bank, setBank] = useState<BankWord[]>([]);
  const onSave = (item: BankWord) =>
    setBank((b) => (b.some((x) => x.w === item.w) ? b : [...b, item]));
  return (
    <div className="df dfm">
      <MTopBar />
      <MHero />
      <MLoop />
      <MReading defaultLang={DEFAULT_LANG} bank={bank} onSave={onSave} />
      <MVocab bank={bank} />
      <MWhy />
      <MLangBand />
      <MCTA />
      <MFooter />
    </div>
  );
}
