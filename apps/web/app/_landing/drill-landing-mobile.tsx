'use client';

// drill — canonical landing, Mobile Web reflow. Ported from the design handoff
// (landing/drill-landing-mobile.jsx). The dark "read · save · review · produce"
// landing reflowed for a ~390px phone. Reuses the real interactive pieces
// (ProductionDemo from drill-landing.tsx; DBrand / DLangRail / ReadingNote from
// landing-chrome.tsx) plus the shared data, so the typed demo, the five-mode
// practice carousel, and the review deck behave exactly like desktop. Styling
// lives in landing.css (the `.dfm` block). State (the saved word bank) is
// lifted here so saving in the carousel's Reading mode feeds the Review deck.
// CTAs route into the Clerk sign-up / sign-in flows (the design's dev-only
// "compare directions" footer link is dropped).

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import './landing.css';
import { ProductionDemo } from './drill-landing';
import { DBrand, DLangRail, DeepAnnotationCard, ReadingNote, type BankWord } from './landing-chrome';
import { MChatGPT } from './chatgpt-compare-mobile';
import {
  D_CLOZE,
  D_LANGS,
  D_MODES,
  D_PASSAGES,
  D_PRACTICE,
  D_READING,
  D_SOON,
  type DeepCard,
  type LandingLang,
  type PracticeMode,
  type PracticeModeId,
  type Token,
} from './landing-data';
import { LegalLinks } from '../../components/legal/legal-links';

const DEFAULT_LANG = 'es';

/* ── chrome ── */
function MTopBar() {
  return (
    <div className="dfm-top">
      <DBrand />
      <div className="dfm-actions">
        <Link href="/sign-in" className="dfm-signin-btn">
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
      <div className="dfm-eyebrow">Produce, don’t recognise</div>
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
      <ProductionDemo defaultLang={DEFAULT_LANG} />
    </header>
  );
}

/* ── academic-rigour stat band ── */
function MRigourBand() {
  const stats: [ReactNode, string, string][] = [
    [<>3</>, 'Languages', 'ES · DE · TR'],
    [
      <>
        A1<span style={{ color: 'var(--accent)' }}>–</span>B2
      </>,
      'CEFR levels',
      'end to end',
    ],
    [<>298</>, 'Grammar lessons', 'one per point'],
    [
      <>
        20,000<span style={{ color: 'var(--accent)' }}>+</span>
      </>,
      'Production exercises',
      'in the pool',
    ],
  ];
  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Built on real grammar</div>
      <h2 className="dfm-h2">Every drill traces back to a grammar you can trust.</h2>
      <p className="dfm-lead">
        Grounded in an authoritative curriculum, calibrated to your CEFR level, and rewritten the
        moment the data says an item fell short.
      </p>
      <div className="dfm-stats">
        {stats.map(([big, l1, l2], i) => (
          <div key={i} className="dfm-stat">
            <div className="dfm-stat-big">{big}</div>
            <div className="dfm-stat-lab">
              {l1}
              <br />
              {l2}
            </div>
          </div>
        ))}
      </div>
      <Link href="/academic-rigour" className="dfm-rigour-link">
        See how the material is made →
      </Link>
    </section>
  );
}

/* ── practice types: mobile carousel (cloze · translation · dictation · free writing · reading) ── */
function MModeShell({
  meta,
  skill,
  live,
  tag,
  children,
  foot,
}: {
  meta: LandingLang;
  skill: string;
  live: string;
  tag: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="dfm-card lift" style={{ padding: 17 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span className="df-typedot" style={{ fontSize: 10.5 }}>
          <b />
          {live}
        </span>
        <span
          style={{
            fontFamily: 'var(--t-mono)',
            fontSize: 10,
            color: 'var(--df-ink2)',
            padding: '3px 8px',
            border: '1px solid var(--df-line)',
            borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          {tag} · {meta.cefr}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 10,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: 'var(--df-mute)',
          marginBottom: 12,
        }}
      >
        {skill}
      </div>
      {children}
      {foot && (
        <div className="df-coach" style={{ marginTop: 14 }}>
          <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
            c
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>{foot}</div>
        </div>
      )}
    </div>
  );
}

function MModeCloze({ lang, meta, mode }: { lang: string; meta: LandingLang; mode: PracticeMode }) {
  const item = D_CLOZE[lang];
  return (
    <MModeShell
      meta={meta}
      skill={item.skill}
      live="PRODUCTION · TYPED"
      tag={mode.tag}
      foot={
        <>
          <strong style={{ color: '#a8d6a0' }}>Right.</strong> {item.explainOk}
        </>
      }
    >
      <div className="drill-stage" style={{ padding: '6px 0', fontSize: 19 }}>
        {item.pre}
        <span className="drill-blank type ok">{item.blank}</span>
        {item.post}
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
        {item.en}
      </div>
    </MModeShell>
  );
}

function MModeTranslation({ lang, meta, mode }: { lang: string; meta: LandingLang; mode: PracticeMode }) {
  const item = D_PRACTICE.translation[lang];
  return (
    <MModeShell meta={meta} skill={item.skill} live="PRODUCTION · FREE" tag={mode.tag} foot={item.note}>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 10,
          letterSpacing: '.5px',
          color: 'var(--df-mute)',
          marginBottom: 7,
        }}
      >
        RENDER IN {meta.label.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: 'var(--t-display)',
          fontSize: 17,
          color: 'var(--df-ink2)',
          fontStyle: 'italic',
          marginBottom: 14,
        }}
      >
        “{item.en}”
      </div>
      <div style={{ borderTop: '1px solid var(--df-line)', paddingTop: 14 }}>
        <div className="drill-stage" style={{ fontSize: 20, lineHeight: 1.5 }}>
          {item.chunks.map(([txt, hot], i) =>
            hot ? (
              <span
                key={i}
                style={{ color: 'var(--df-ink)', borderBottom: '2px solid var(--ok)', paddingBottom: 1 }}
              >
                {txt}
              </span>
            ) : (
              <span key={i} style={{ color: 'var(--df-ink2)' }}>
                {txt}
              </span>
            )
          )}
        </div>
      </div>
    </MModeShell>
  );
}

function MModeDictation({ lang, meta, mode }: { lang: string; meta: LandingLang; mode: PracticeMode }) {
  const item = D_PRACTICE.dictation[lang];
  const bars = [7, 13, 20, 15, 24, 30, 22, 14, 26, 19, 11, 23, 31, 18, 10, 16, 25, 13];
  return (
    <MModeShell meta={meta} skill={item.skill} live="DICTATION · AUDIO" tag={mode.tag} foot={item.note}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '11px 13px',
          background: '#1b1610',
          border: '1px solid var(--df-line)',
          borderRadius: 'var(--r-md)',
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 13,
          }}
        >
          ▶
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, flex: 1, height: 30 }}>
          {bars.map((h, i) => (
            <span
              key={i}
              style={{
                width: 2.5,
                height: h,
                borderRadius: 2,
                background: i < 9 ? 'var(--accent)' : 'var(--df-line)',
              }}
            />
          ))}
        </div>
        <span style={{ fontFamily: 'var(--t-mono)', fontSize: 10, color: 'var(--df-mute)' }}>0:04</span>
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
        YOU TYPED WHAT YOU HEARD
      </div>
      <div className="drill-stage" style={{ fontSize: 20, lineHeight: 1.5 }}>
        <span style={{ borderBottom: '2px solid var(--ok)', paddingBottom: 1 }}>{item.heard}</span>
      </div>
      <div
        style={{
          fontFamily: 'var(--t-ui)',
          fontSize: 12.5,
          color: 'var(--df-mute)',
          marginTop: 9,
          fontStyle: 'italic',
        }}
      >
        {item.en}
      </div>
    </MModeShell>
  );
}

function MModeFreewrite({ lang, meta, mode }: { lang: string; meta: LandingLang; mode: PracticeMode }) {
  const item = D_PRACTICE.freewrite[lang];
  const clean = item.fixes[0] && item.fixes[0][0] === item.fixes[0][1];
  return (
    <MModeShell meta={meta} skill={item.skill} live="FREE WRITING · OPEN" tag={mode.tag} foot={item.note}>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 10,
          letterSpacing: '.5px',
          color: 'var(--df-mute)',
          marginBottom: 8,
        }}
      >
        PROMPT
      </div>
      <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, color: 'var(--df-ink)', marginBottom: 13 }}>
        {item.prompt}
      </div>
      <div
        style={{
          padding: '12px 13px',
          background: '#1b1610',
          border: '1px solid var(--df-line)',
          borderRadius: 'var(--r-md)',
          fontFamily: 'var(--t-display)',
          fontSize: 15.5,
          lineHeight: 1.6,
          color: 'var(--df-ink2)',
        }}
      >
        {item.draft}
        <i className="df-caret" />
      </div>
      {item.fixes.map(([from, to, why], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 12 }}>
          <span
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 11,
              color: clean ? 'var(--ok)' : 'var(--df-mute)',
              whiteSpace: 'nowrap',
              paddingTop: 1,
            }}
          >
            {clean ? '✓ clean' : 'fix'}
          </span>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
            {clean ? (
              why
            ) : (
              <>
                <span style={{ textDecoration: 'line-through', color: '#f0a78c' }}>{from}</span>
                <span style={{ margin: '0 5px', color: 'var(--df-mute)' }}>→</span>
                <strong style={{ color: '#a8d6a0' }}>{to}</strong>
                <span style={{ color: 'var(--df-mute)' }}> — {why}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </MModeShell>
  );
}

function MModeReading({
  lang,
  meta,
  mode,
  bank,
  onSave,
}: {
  lang: string;
  meta: LandingLang;
  mode: PracticeMode;
  bank: BankWord[];
  onSave: (item: BankWord) => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    setSel(null);
  }, [lang]);
  const passage = D_PASSAGES[lang];
  const tokens = passage.tokens;
  const selTok = sel != null && typeof tokens[sel] === 'object' ? (tokens[sel] as Token) : null;
  const savedSet = new Set(bank.map((b) => b.w));
  return (
    <div className="dfm-card lift" style={{ padding: 17 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span className="df-typedot" style={{ fontSize: 10.5 }}>
          <b />
          READING · ANNOTATE
        </span>
        <span
          style={{
            fontFamily: 'var(--t-mono)',
            fontSize: 10,
            color: 'var(--df-ink2)',
            padding: '3px 8px',
            border: '1px solid var(--df-line)',
            borderRadius: 999,
            whiteSpace: 'nowrap',
          }}
        >
          {mode.tag} · {meta.cefr}
        </span>
      </div>
      <div className="dfm-read-meta" style={{ marginBottom: 12 }}>
        <span className="ttl">{passage.title}</span>
        <span style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }} />
        <span className="src">{passage.source}</span>
      </div>
      <div className="dfm-passage">
        <p className="df-passage swap" key={lang} style={{ fontSize: 18 }}>
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
      <div className="dfm-note-wrap">
        {selTok ? (
          <ReadingNote
            tok={selTok}
            saved={savedSet.has(selTok.w)}
            onSave={() => onSave({ w: selTok.w, lang: meta.tag, gloss: selTok.gloss })}
          />
        ) : (
          <div className="df-hint" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 13.5, color: 'var(--df-ink2)', lineHeight: 1.5 }}>
              Tap any <span style={{ color: 'var(--accent)', fontWeight: 500 }}>underlined word</span>{' '}
              — it explains itself, then saves to your deck with one tap.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MPractice({
  defaultLang,
  bank,
  onSave,
}: {
  defaultLang: string;
  bank: BankWord[];
  onSave: (item: BankWord) => void;
}) {
  const [mode, setMode] = useState<PracticeModeId>('cloze');
  const [lang, setLang] = useState(D_PASSAGES[defaultLang] ? defaultLang : 'es');
  const meta = D_LANGS.find((l) => l.id === lang)!;
  const modeMeta = D_MODES.find((m) => m.id === mode)!;
  const idx = D_MODES.findIndex((m) => m.id === mode);
  const go = (d: number) => setMode(D_MODES[(idx + d + D_MODES.length) % D_MODES.length].id);

  const body =
    mode === 'cloze' ? (
      <MModeCloze lang={lang} meta={meta} mode={modeMeta} />
    ) : mode === 'translation' ? (
      <MModeTranslation lang={lang} meta={meta} mode={modeMeta} />
    ) : mode === 'dictation' ? (
      <MModeDictation lang={lang} meta={meta} mode={modeMeta} />
    ) : mode === 'freewrite' ? (
      <MModeFreewrite lang={lang} meta={meta} mode={modeMeta} />
    ) : (
      <MModeReading lang={lang} meta={meta} mode={modeMeta} bank={bank} onSave={onSave} />
    );

  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">One engine, five ways to produce</div>
      <h2 className="dfm-h2">The same structure, whatever you’re drilling.</h2>
      <p className="dfm-lead">
        Cloze, translation, dictation, free writing, reading — every mode is tuned to your level,
        graded the same way, logged to the same record. Variety without the chaos.
      </p>

      <div className="dfm-mode-rail">
        {D_MODES.map((m) => (
          <button
            key={m.id}
            className={'dfm-mode-pill' + (mode === m.id ? ' on' : '')}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ margin: '14px 0 0' }}>
        <DLangRail lang={lang} setLang={setLang} />
      </div>

      <div style={{ marginTop: 16 }}>{body}</div>

      <div className="dfm-pnav">
        <button className="dfm-pn-btn" onClick={() => go(-1)} aria-label="previous">
          ←
        </button>
        <div className="dfm-pn-dots">
          {D_MODES.map((m) => (
            <button
              key={m.id}
              className={'dfm-pn-dot' + (mode === m.id ? ' on' : '')}
              onClick={() => setMode(m.id)}
              aria-label={m.label}
            />
          ))}
        </div>
        <button className="dfm-pn-btn" onClick={() => go(1)} aria-label="next">
          →
        </button>
      </div>
    </section>
  );
}

/* ── reading: deep annotation, note stacks below the passage ── */
function MDeepAnno() {
  const tokens = D_READING.tokens;
  const wordIdx = tokens.reduce<number[]>(
    (acc, t, i) => (typeof t === 'object' ? [...acc, i] : acc),
    [],
  );
  const [sel, setSel] = useState<number>(wordIdx[3] ?? wordIdx[0] ?? 0);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const selTok = tokens[sel];
  const selCard: DeepCard | null = typeof selTok === 'object' ? selTok : null;
  const toggle = (w: string) => setSaved((s) => ({ ...s, [w]: !s[w] }));

  return (
    <section className="dfm-wrap dfm-section">
      <div className="dfm-eyebrow2">Where the words come from</div>
      <h2 className="dfm-h2">Read real text. Tap any word.</h2>
      <p className="dfm-lead">
        Every word in the passage is one tap from a deep note — meaning in context, a target-language
        definition, the morphology broken out — and one more into your deck.
      </p>

      <div className="dfm-read-meta" style={{ marginTop: 22 }}>
        <span className="ttl">{D_READING.title}</span>
        <span style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }} />
        <span className="src">{D_READING.source}</span>
        <span className="df-chip-dark" style={{ marginLeft: 'auto' }}>
          {D_READING.tag} · {D_READING.cefr}
        </span>
      </div>

      <div className="dfm-passage">
        <p className="df-passage" style={{ fontSize: 20 }}>
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
      <div className="dfm-read-foot">
        <span className="dash" /> {wordIdx.length} words annotated · tap to open
      </div>

      <div className="dfm-note-wrap">
        {selCard && (
          <DeepAnnotationCard
            card={selCard}
            key={sel}
            saved={!!saved[selCard.surface]}
            onToggle={() => toggle(selCard.surface)}
          />
        )}
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
      <div className="meta">© 2026 drill · type it, don’t tap it</div>
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
      <MRigourBand />
      <MPractice defaultLang={DEFAULT_LANG} bank={bank} onSave={onSave} />
      <MDeepAnno />
      <MWhy />
      <MChatGPT />
      <MLangBand />
      <MCTA />
      <MFooter />
    </div>
  );
}
