'use client';

// Practice-types carousel: one compact module that consolidates the five ways
// drill makes you produce — cloze, translation, dictation, free writing,
// reading. Ported from the design handoff (landing/practice-carousel.jsx).
// The multi-language switcher is kept so the "same structure, every language"
// point lands. Reading stays interactive (tap → save) and feeds the vocabulary
// deck below via the bank lifted in the landing root.

import { useEffect, useState, type ReactNode } from 'react';
import { DLangRail, type BankWord } from './landing-chrome';
import {
  D_CLOZE,
  D_LANGS,
  D_MODES,
  D_PASSAGES,
  D_PRACTICE,
  type LandingLang,
  type PracticeModeId,
  type Token,
} from './landing-data';

/* ── shared card chrome ── */
function ModeShell({
  meta,
  skill,
  live,
  children,
  foot,
}: {
  meta: LandingLang;
  skill: string;
  live: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="drill-card lift" key={skill}>
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
          {live}
        </span>
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
          {meta.tag} · {meta.cefr}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 11,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: 'var(--df-mute)',
          marginBottom: 14,
        }}
      >
        {skill}
      </div>
      {children}
      {foot && (
        <div className="df-coach" style={{ marginTop: 18 }}>
          <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
            c
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>{foot}</div>
        </div>
      )}
    </div>
  );
}

/* ── cloze (reuses D_CLOZE, shown in its solved state) ── */
function ModeCloze({ lang, meta }: { lang: string; meta: LandingLang }) {
  const item = D_CLOZE[lang];
  return (
    <ModeShell
      meta={meta}
      skill={item.skill}
      live="PRODUCTION · TYPED"
      foot={
        <>
          <strong style={{ color: '#a8d6a0' }}>Right.</strong> {item.explainOk}
        </>
      }
    >
      <div className="drill-stage" style={{ padding: '10px 2px' }}>
        {item.pre}
        <span className="drill-blank type ok">{item.blank}</span>
        {item.post}
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
        {item.en}
      </div>
      <div style={{ fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--df-mute)', marginTop: 12 }}>
        {item.helper}
      </div>
    </ModeShell>
  );
}

/* ── translation (produce the whole sentence from English) ── */
function ModeTranslation({ lang, meta }: { lang: string; meta: LandingLang }) {
  const item = D_PRACTICE.translation[lang];
  return (
    <ModeShell meta={meta} skill={item.skill} live="PRODUCTION · FREE" foot={item.note}>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 11,
          letterSpacing: '.5px',
          color: 'var(--df-mute)',
          marginBottom: 8,
        }}
      >
        RENDER IN {meta.label.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: 'var(--t-display)',
          fontSize: 20,
          color: 'var(--df-ink2)',
          fontStyle: 'italic',
          marginBottom: 16,
        }}
      >
        “{item.en}”
      </div>
      <div style={{ borderTop: '1px solid var(--df-line)', paddingTop: 16 }}>
        <div className="drill-stage" style={{ fontSize: 'clamp(20px,2.6vw,26px)', lineHeight: 1.5 }}>
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontFamily: 'var(--t-mono)',
            fontSize: 11,
            color: 'var(--ok)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--ok)' }} />
          graded word-by-word · idiom matched
        </div>
      </div>
    </ModeShell>
  );
}

/* ── dictation (hear it, spell it) ── */
function ModeDictation({ lang, meta }: { lang: string; meta: LandingLang }) {
  const item = D_PRACTICE.dictation[lang];
  const bars = [7, 13, 20, 15, 24, 30, 22, 14, 26, 19, 11, 23, 31, 18, 10, 16, 25, 13, 8, 20, 27, 15, 9, 14];
  return (
    <ModeShell meta={meta} skill={item.skill} live="DICTATION · AUDIO" foot={item.note}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 16px',
          background: '#1b1610',
          border: '1px solid var(--df-line)',
          borderRadius: 'var(--r-md)',
          marginBottom: 18,
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 15,
          }}
        >
          ▶
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1, height: 34 }}>
          {bars.map((h, i) => (
            <span
              key={i}
              style={{
                width: 3,
                height: h,
                borderRadius: 2,
                background: i < 12 ? 'var(--accent)' : 'var(--df-line)',
              }}
            />
          ))}
        </div>
        <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--df-mute)' }}>0:04</span>
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
        YOU TYPED WHAT YOU HEARD
      </div>
      <div className="drill-stage" style={{ fontSize: 'clamp(20px,2.6vw,26px)', lineHeight: 1.5 }}>
        <span style={{ borderBottom: '2px solid var(--ok)', paddingBottom: 1 }}>{item.heard}</span>
      </div>
      <div
        style={{
          fontFamily: 'var(--t-ui)',
          fontSize: 13,
          color: 'var(--df-mute)',
          marginTop: 10,
          fontStyle: 'italic',
        }}
      >
        {item.en}
      </div>
    </ModeShell>
  );
}

/* ── free writing (bounded prompt, corrected not rewritten) ── */
function ModeFreewrite({ lang, meta }: { lang: string; meta: LandingLang }) {
  const item = D_PRACTICE.freewrite[lang];
  const clean = item.fixes[0] && item.fixes[0][0] === item.fixes[0][1];
  return (
    <ModeShell meta={meta} skill={item.skill} live="FREE WRITING · OPEN" foot={item.note}>
      <div
        style={{
          fontFamily: 'var(--t-mono)',
          fontSize: 11,
          letterSpacing: '.5px',
          color: 'var(--df-mute)',
          marginBottom: 10,
        }}
      >
        PROMPT
      </div>
      <div style={{ fontFamily: 'var(--t-display)', fontSize: 19, color: 'var(--df-ink)', marginBottom: 16 }}>
        {item.prompt}
      </div>
      <div
        style={{
          padding: '14px 16px',
          background: '#1b1610',
          border: '1px solid var(--df-line)',
          borderRadius: 'var(--r-md)',
          fontFamily: 'var(--t-display)',
          fontSize: 17,
          lineHeight: 1.6,
          color: 'var(--df-ink2)',
        }}
      >
        {item.draft}
        <i className="df-caret" />
      </div>
      {item.fixes.map(([from, to, why], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14 }}>
          <span
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 12,
              color: clean ? 'var(--ok)' : 'var(--df-mute)',
              whiteSpace: 'nowrap',
              paddingTop: 1,
            }}
          >
            {clean ? '✓ clean' : 'fix'}
          </span>
          {!clean && (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
              <span style={{ textDecoration: 'line-through', color: '#f0a78c' }}>{from}</span>
              <span style={{ margin: '0 6px', color: 'var(--df-mute)' }}>→</span>
              <strong style={{ color: '#a8d6a0' }}>{to}</strong>
              <span style={{ color: 'var(--df-mute)' }}> — {why}</span>
            </div>
          )}
          {clean && <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>{why}</div>}
        </div>
      ))}
    </ModeShell>
  );
}

/* ── reading (interactive: tap a word → note → save to deck) ── */
function ModeReading({
  lang,
  meta,
  bank,
  onSave,
}: {
  lang: string;
  meta: LandingLang;
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
          READING · ANNOTATE
        </span>
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
          {meta.tag} · {meta.cefr}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          fontFamily: 'var(--t-mono)',
          fontSize: 11,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: 'var(--df-mute)',
        }}
      >
        {passage.title}
        <span style={{ width: 4, height: 4, borderRadius: 4, background: 'var(--df-line)' }} />
        {passage.source}
      </div>
      <div
        style={{
          borderLeft: '2px solid color-mix(in oklab, var(--accent) 40%, var(--df-line))',
          paddingLeft: 18,
        }}
      >
        <p className="df-passage swap" key={lang} style={{ fontSize: 'clamp(19px,2.2vw,23px)' }}>
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
      {selTok ? (
        <div
          className="swap"
          key={selTok.w}
          style={{
            marginTop: 18,
            padding: 16,
            background: '#1b1610',
            border: '1px solid var(--df-line)',
            borderRadius: 'var(--r-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--t-display)', fontSize: 22, fontWeight: 500, color: 'var(--df-ink)' }}>
              {selTok.w}
            </span>
            <span className="df-chip-dark">{selTok.pos}</span>
          </div>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, color: 'var(--df-ink)', marginTop: 8 }}>
            {selTok.gloss}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--df-ink2)', margin: '6px 0 0' }}>
            {selTok.note}
          </p>
          <button
            onClick={() => onSave({ w: selTok.w, lang: meta.tag, gloss: selTok.gloss })}
            disabled={savedSet.has(selTok.w)}
            className="btn-xl"
            style={{
              width: '100%',
              marginTop: 14,
              padding: '10px 12px',
              opacity: savedSet.has(selTok.w) ? 0.55 : 1,
              cursor: savedSet.has(selTok.w) ? 'default' : 'pointer',
            }}
          >
            {savedSet.has(selTok.w) ? '✓ saved to vocabulary' : '+ save to vocabulary'}
          </button>
        </div>
      ) : (
        <div
          style={{
            marginTop: 18,
            padding: '16px 18px',
            border: '1.5px dashed var(--df-line)',
            borderRadius: 'var(--r-md)',
            background: '#1b1610',
            fontSize: 13.5,
            color: 'var(--df-ink2)',
            lineHeight: 1.5,
          }}
        >
          Tap any <span style={{ color: 'var(--accent)', fontWeight: 500 }}>underlined word</span> — it
          explains itself, then saves to your deck with one tap.
        </div>
      )}
    </div>
  );
}

/* ── the carousel section ── */
export function PracticeCarousel({
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
  const idx = D_MODES.findIndex((m) => m.id === mode);
  const go = (d: number) => setMode(D_MODES[(idx + d + D_MODES.length) % D_MODES.length].id);

  const body =
    mode === 'cloze' ? (
      <ModeCloze lang={lang} meta={meta} />
    ) : mode === 'translation' ? (
      <ModeTranslation lang={lang} meta={meta} />
    ) : mode === 'dictation' ? (
      <ModeDictation lang={lang} meta={meta} />
    ) : mode === 'freewrite' ? (
      <ModeFreewrite lang={lang} meta={meta} />
    ) : (
      <ModeReading lang={lang} meta={meta} bank={bank} onSave={onSave} />
    );

  return (
    <section className="df-section">
      <div className="df-wrap">
        <div className="df-eyebrow2">One engine, five ways to produce</div>
        <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 760 }}>
          The same structure, whatever you’re drilling.
        </h2>
        <p style={{ color: 'var(--df-ink2)', fontSize: 17, lineHeight: 1.6, maxWidth: 580, marginTop: 16 }}>
          Cloze, translation, dictation, free writing, reading — every mode is tuned to your level,
          graded the same way, and logged to the same record. Variety without the chaos.
        </p>

        {/* tabs + language */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
            margin: '30px 0 8px',
            justifyContent: 'space-between',
          }}
        >
          <div className="mode-rail" role="tablist" aria-label="practice type">
            {D_MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={'mode-pill' + (mode === m.id ? ' on' : '')}
                onClick={() => setMode(m.id)}
              >
                {m.label}
                <span className="mode-tag">{m.tag}</span>
              </button>
            ))}
          </div>
          <DLangRail lang={lang} setLang={setLang} />
        </div>

        <div className="practice-frame">
          {body}
          <div className="practice-nav">
            <button className="pn-btn" onClick={() => go(-1)} aria-label="previous practice type">
              ←
            </button>
            <div className="pn-dots">
              {D_MODES.map((m) => (
                <button
                  key={m.id}
                  className={'pn-dot' + (mode === m.id ? ' on' : '')}
                  onClick={() => setMode(m.id)}
                  aria-label={m.label}
                />
              ))}
            </div>
            <button className="pn-btn" onClick={() => go(1)} aria-label="next practice type">
              →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
