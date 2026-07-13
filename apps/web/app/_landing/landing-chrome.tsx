'use client';

// Shared chrome for the dark marketing pages: the brand mark, the language
// rail, and the reading annotation note. Extracted from drill-landing.tsx so
// the practice carousel, ChatGPT-compare pieces and the standalone
// /why-not-chatgpt page can import them without a circular dependency on the
// landing root.

import { Fragment } from 'react';
import Link from 'next/link';
import { D_LANGS, type Token, type DeepCard } from './landing-data';

export interface BankWord {
  w: string;
  lang: string;
  gloss: string;
}

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

// The full DeepWordCard the reading-annotation showcase renders: surface form,
// contextual sense, target-language definition, morphology breakdown, extras.
// When `onToggle` is provided the card is savable; otherwise it reads as already
// in the deck. Shared by the desktop showcase and the mobile reflow.
export function DeepAnnotationCard({
  card,
  onToggle,
  saved,
}: {
  card: DeepCard;
  onToggle?: () => void;
  saved?: boolean;
}) {
  return (
    <div className="da-card">
      <div className="da-head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="da-surface">{card.surface}</span>
          <span className="da-pos">{card.pos}</span>
          <span style={{ marginLeft: 'auto' }} />
          <span className="da-cefr">{card.cefr}</span>
        </div>
        <p className="da-gloss">{card.gloss}</p>
        <div className="da-freq">
          #{card.freq.toLocaleString('en-US')}
          {card.lemma !== card.surface ? ' · ' + card.lemma : ''}
        </div>
        {card.inflection && <div className="da-infl">{card.inflection}</div>}
      </div>
      <div className="da-body">
        <div>
          <span className="da-micro">here</span>
          <p className="da-here">“{card.here}”</p>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="da-micro">{card.defLabel}</div>
          <p className="da-def">{card.def}</p>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="da-micro" style={{ marginBottom: 6 }}>
            morphology
          </div>
          <div className="da-root">
            root <span style={{ fontWeight: 600, color: 'var(--df-ink)' }}>{card.morph.root}</span>
            {card.morph.rootGloss && (
              <span style={{ color: 'var(--df-mute)' }}> — {card.morph.rootGloss}</span>
            )}
          </div>
          <div className="da-segs">
            {card.morph.segments.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span className="da-plus" aria-hidden="true">
                    +
                  </span>
                )}
                <div className="da-seg">
                  <div className="da-seg-m">{s.morph}</div>
                  <div className="da-seg-f">{s.function}</div>
                </div>
              </Fragment>
            ))}
          </div>
          <p className="da-why">
            <span className="da-why-tag">why this form</span>
            {card.morph.why}
          </p>
        </div>
        {(card.synonyms || card.register) && (
          <div className="da-extras">
            {card.synonyms && (
              <div className="da-extra">
                <span className="da-micro">synonyms</span>
                <div className="da-syn">
                  {card.synonyms.map((s, i) => (
                    <span key={i}>
                      <b>{s.word}</b> — {s.note}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {card.register && (
              <div className="da-extra">
                <span className="da-micro">register</span>
                <p className="da-reg">{card.register}</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="da-foot">
        {onToggle ? (
          <>
            <span className="da-foot-note">one more tap → your deck</span>
            <button className={'da-save-btn' + (saved ? ' on' : '')} onClick={onToggle}>
              {saved ? '✓ saved · remove' : '+ save to vocabulary'}
            </button>
          </>
        ) : (
          <>
            <span className="da-foot-note">saved from your reading</span>
            <span className="da-saved">✓ in vocabulary</span>
          </>
        )}
      </div>
    </div>
  );
}
