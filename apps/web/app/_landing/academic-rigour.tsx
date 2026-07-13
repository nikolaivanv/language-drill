'use client';

// Standalone deep-dive: "Academic rigour" — how drill's material is made and
// kept honest. Ported from the design handoff (landing/academic-rigour.jsx).
// Stat band → provenance pipeline → per-language curriculum → quality principles
// → production-over-recognition → continuous improvement (a live before/after
// review demo) → CTA. Dark "Drill Floor" aesthetic, shared with the landing.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import './landing.css';
import { DBrand } from './landing-chrome';

/* ───────────────── stat band ───────────────── */

function StatBand() {
  const stats: { big: ReactNode; l1: string; l2: string }[] = [
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
    <div className="ar-stats">
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
  );
}

/* ───────────────── provenance pipeline ───────────────── */

const AR_FLOW: [string, string, string][] = [
  [
    'A',
    'The authoritative sources',
    'Each language is grounded in its official curriculum framework and the single most comprehensive grammar reference for that language — the volume linguists and serious learners treat as canonical.',
  ],
  [
    'B',
    'Mapped to the CEFR ladder',
    'Every rule, tense and construction is placed on the A1–B2 scale, so an item can be pulled at exactly the level a learner is ready for.',
  ],
  [
    'C',
    'The item you practise',
    'Each exercise is calibrated a notch above your level, with the answer hidden — real production, drawn straight from the sources above.',
  ],
];

function ProvenanceFlow() {
  return (
    <div className="ar-flow">
      {AR_FLOW.map(([n, h, b], i) => (
        <div key={n} style={{ display: 'contents' }}>
          <div className="df-card ar-flow-card">
            <div className="ar-flow-badge">{n}</div>
            <div
              style={{
                fontFamily: 'var(--t-display)',
                fontSize: 21,
                color: 'var(--df-ink)',
                marginTop: 16,
                letterSpacing: '-0.3px',
              }}
            >
              {h}
            </div>
            <p
              style={{
                color: 'var(--df-ink2)',
                fontSize: 14,
                lineHeight: 1.6,
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              {b}
            </p>
          </div>
          {i < AR_FLOW.length - 1 && (
            <div className="ar-flow-arrow" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12h15M13 6l6 6-6 6"
                  stroke="var(--accent)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ───────────────── per-language curriculum ───────────────── */

const AR_CURRIC: [string, string, string][] = [
  [
    'Spanish',
    '#cc7a3c',
    'Grounded in the Plan Curricular del Instituto Cervantes — the reference syllabus behind the DELE exams — and cross-checked against the most comprehensive Spanish grammar.',
  ],
  [
    'German',
    '#6c97cb',
    'Aligned to the Goethe-Institut exam track and the official CEFR course sequence, cross-checked against the most comprehensive German grammar.',
  ],
  [
    'Turkish',
    '#5b8a5a',
    'Built on the Yunus Emre Institute’s official curriculum (YDS / TÖMER track), cross-checked against the most comprehensive Turkish grammar.',
  ],
];

function LanguageCurriculum() {
  return (
    <div className="ar-curric">
      {AR_CURRIC.map(([lang, color, body]) => (
        <div key={lang} className="ar-curric-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span
                style={{
                  fontFamily: 'var(--t-display)',
                  fontSize: 30,
                  fontWeight: 500,
                  color: 'var(--df-ink)',
                  letterSpacing: '-0.4px',
                }}
              >
                {lang}
              </span>
              <span style={{ fontFamily: 'var(--t-mono)', fontSize: 12, color: 'var(--df-mute)' }}>
                A1–B2
              </span>
            </div>
            <div style={{ width: 42, height: 3, borderRadius: 2, background: color, marginTop: 14 }} />
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--t-mono)',
                fontSize: 11,
                letterSpacing: '1.6px',
                textTransform: 'uppercase',
                color: 'var(--df-mute)',
                marginBottom: 12,
              }}
            >
              Scope & level
            </div>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: 'var(--df-ink2)',
                margin: 0,
                maxWidth: 520,
              }}
            >
              {body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────── quality principles ───────────────── */

const AR_PRINCIPLES: [string, string, string][] = [
  [
    'Source-grounded',
    'M4 19V5a1 1 0 0 1 1-1h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM8 9h6M8 13h8',
    'Every rule, exception and explanation is lifted from a definitive reference — never improvised on the spot.',
  ],
  [
    'Calibrated to level',
    'M3 17l6-6 4 4 8-8M17 7h4v4',
    'Locked to your CEFR band. Items sit one notch above where you are — challenging, never over your head.',
  ],
  [
    'Reads like a person',
    'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z',
    'Sentences are checked to sound natural, not like textbook filler. Real prose, not robotic drills.',
  ],
  [
    'Deliberate coverage',
    'M4 6h16M4 12h16M4 18h10',
    'Curated, level-tuned lists of words and structures with real spread — no looping on a handful of favourites.',
  ],
];

function Principles() {
  return (
    <div className="ar-principles">
      {AR_PRINCIPLES.map(([h, d, b]) => (
        <div key={h} className="df-card">
          <div className="ar-principle-ico">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
              <path
                d={d}
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            style={{
              fontFamily: 'var(--t-display)',
              fontSize: 20,
              color: 'var(--df-ink)',
              marginTop: 16,
            }}
          >
            {h}
          </div>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 14,
              lineHeight: 1.6,
              marginTop: 8,
              marginBottom: 0,
            }}
          >
            {b}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ───────────── production over recognition ───────────── */

const AR_MODES: [string, string, string][] = [
  [
    'Translation',
    'Richest signal',
    'Produce a whole sentence from meaning alone — the openest task, so it reveals the most about grammar range and vocabulary.',
  ],
  [
    'Cloze',
    'Precision',
    'One grammar point, isolated inside real context — tense, agreement, case, mood — filled in by hand, not chosen from a list.',
  ],
  [
    'Sentence construction',
    'Spontaneous',
    'Build a target structure from a prompt and nothing else. Syntax under load, the way it happens in real speech.',
  ],
  [
    'Free writing',
    'Exam-style',
    'Open paragraphs graded on the criteria the DELE and IELTS use — the richest source of signal in the whole app.',
  ],
  [
    'Vocabulary recall',
    'Active',
    'Retrieve the word from its meaning or context, monolingual at higher levels — recall, never recognition.',
  ],
  [
    'Contextual paraphrase',
    'Flexibility',
    'Say the same thing another way — synonyms, register shifts — so you own the idea, not one memorised phrasing.',
  ],
  [
    'Dictation',
    'Listening',
    'Neural-voice audio couples the ear to spelling and production — you write down what you hear.',
  ],
  [
    'Conjugation drill',
    'Repair',
    'The deliberate exception: a targeted morphology drill, used as remediation to make inflection automatic.',
  ],
];

function ProductionModes() {
  return (
    <div className="ar-modes">
      {AR_MODES.map(([h, tag, b]) => (
        <div key={h} className="df-card">
          <div className="ar-mode-head">
            <span style={{ fontFamily: 'var(--t-display)', fontSize: 20, color: 'var(--df-ink)' }}>
              {h}
            </span>
            <span className="ar-mode-tag">{tag}</span>
          </div>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 14,
              lineHeight: 1.6,
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            {b}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ───────────── continuous-improvement demo ───────────── */

function CaseStage({ parts, answer, tone }: { parts: string[]; answer: string; tone: 'ok' | 'no' }) {
  return (
    <div className="drill-stage" style={{ fontSize: 22, lineHeight: 1.55 }}>
      {parts.map((p, i) =>
        p === 'blank' ? (
          <span key={i} className={'drill-blank type ' + (tone === 'ok' ? 'ok' : 'no')}>
            {answer}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

function ReviewLoop() {
  const [fixed, setFixed] = useState(false);
  return (
    <div className="ar-case-card df-card">
      <div className="ar-case-top">
        <span className="ar-case-badge">
          <span
            className="ar-case-badge-dot"
            style={{
              background: '#e0b25a',
              boxShadow: '0 0 0 3px color-mix(in oklab, #e0b25a 22%, transparent)',
            }}
          />
          Only 34% of learners got this right
        </span>
        <span className="df-chip-dark">DE · B2 · cloze</span>
      </div>

      {!fixed ? (
        <div className="swap" key="before">
          <div className="ar-quote">
            A success rate that low usually means the item, not the learner, is off.
          </div>
          <CaseStage parts={['Er wartete, ', 'blank', ' der Regen aufhörte.']} answer="bis" tone="no" />
          <div className="df-coach ar-coach-flaw">
            <div className="df-coach-dot" style={{ background: '#8c8475' }}>
              !
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--df-ink2)' }}>
              <strong style={{ color: '#f0a78c' }}>The problem.</strong> The gap gave no hint which
              conjunction was wanted; several felt plausible, so most learners were guessing.
            </div>
          </div>
          <div className="ar-case-actions">
            <span className="ar-status ar-status--review">
              <span className="ar-status-dot" style={{ background: '#e0b25a' }} />
              In review
            </span>
            <button className="btn-xl ar-fix-btn" onClick={() => setFixed(true)}>
              See the rewrite →
            </button>
          </div>
        </div>
      ) : (
        <div className="swap" key="after">
          <div className="ar-quote ar-quote--fixed">
            Rewritten and re-released to everyone practising this skill.
          </div>
          <CaseStage
            parts={['Er wartete so lange, ', 'blank', ' der Regen aufhörte.']}
            answer="bis"
            tone="ok"
          />
          <div className="df-coach ar-coach-fix">
            <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
              c
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--df-ink2)' }}>
              <strong style={{ color: '#a8d6a0' }}>The fix.</strong> Adding “so lange” cues the
              temporal sense, so “bis” is clearly the fit. Success rate climbed to 71%.
            </div>
          </div>
          <div className="ar-case-actions">
            <span className="ar-status ar-status--live">
              <span className="ar-status-dot" style={{ background: 'var(--ok)' }} />
              Shipped
            </span>
            <button className="btn-xl ghost-light ar-fix-btn" onClick={() => setFixed(false)}>
              ← See the original
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────── page ───────────────── */

export function AcademicRigourPage() {
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

      {/* hero */}
      <header style={{ paddingTop: 72, paddingBottom: 20 }}>
        <div className="df-wrap" style={{ maxWidth: 900 }}>
          <div className="df-eyebrow">Academic rigour · how the material is made</div>
          <h1 className="df-h1" style={{ marginTop: 18, fontSize: 'clamp(38px,5.6vw,68px)' }}>
            Practice you can actually <span style={{ color: 'var(--accent)' }}>trust</span>.
          </h1>
          <p className="df-sub" style={{ marginTop: 22, maxWidth: 660, fontSize: 19 }}>
            A drill is only worth doing if it’s correct. So every item on drill is grounded in an
            authoritative curriculum and grammar, calibrated to your CEFR level — and rewritten the
            moment the data says it fell short.
          </p>
        </div>
      </header>

      {/* stat band */}
      <section style={{ paddingBottom: 8 }}>
        <div className="df-wrap">
          <StatBand />
        </div>
      </section>

      {/* provenance */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">Where the exercises come from</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 760 }}>
            Nothing here is improvised.
          </h2>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: 620,
              marginTop: 16,
            }}
          >
            Behind every gap, translation and dictation is the same short pipeline — from a reference
            you could look the rule up in, to the item on your screen.
          </p>
          <ProvenanceFlow />
        </div>
      </section>

      {/* per-language curriculum */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">Language by language</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 760 }}>
            Each course sits on an official curriculum.
          </h2>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: 620,
              marginTop: 16,
              marginBottom: 44,
            }}
          >
            We don’t invent a syllabus. Each language follows the framework its own standards body
            publishes — the same one behind its official exams.
          </p>
          <LanguageCurriculum />
        </div>
      </section>

      {/* principles */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">What “rigorous” means here</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 760 }}>
            Four things we don’t compromise on.
          </h2>
          <Principles />
        </div>
      </section>

      {/* production over recognition */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">Produce, don’t recognise</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 820 }}>
            The plateau doesn’t break by tapping the right answer.
          </h2>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: 700,
              marginTop: 16,
            }}
          >
            Every drill has to pass one test: does the learner{' '}
            <strong style={{ color: 'var(--df-ink)' }}>construct</strong> the language, or merely
            recognise it? Recognition is what leaves intermediate learners understanding everything
            and freezing when it’s their turn to speak. So there’s no multiple-choice main mode — you
            write, and an AI examiner grades what you wrote across grammar, vocabulary and discourse.
          </p>
          <ProductionModes />
        </div>
      </section>

      {/* continuous improvement */}
      <section className="df-section">
        <div className="df-wrap">
          <div className="df-eyebrow2">And it keeps getting better</div>
          <h2 className="df-h2" style={{ marginTop: 14, maxWidth: 760 }}>
            The material improves every week.
          </h2>
          <p
            style={{
              color: 'var(--df-ink2)',
              fontSize: 17,
              lineHeight: 1.6,
              maxWidth: 660,
              marginTop: 16,
            }}
          >
            Rigour isn’t a launch-day checkbox. Every attempt is scored, so when an item’s{' '}
            <strong style={{ color: 'var(--df-ink)' }}>
              success rate drops below what a well-pitched exercise should hit
            </strong>
            , it’s surfaced for review. Learners can also flag any item directly. Either way, we
            rewrite it and release the fix to everyone.
          </p>
          <div style={{ maxWidth: 720, marginTop: 40 }}>
            <ReviewLoop />
          </div>
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
              Rigorous, and never finished.
            </h2>
            <p
              style={{
                color: 'rgba(255,255,255,.86)',
                fontSize: 17,
                marginTop: 14,
                maxWidth: 480,
                marginInline: 'auto',
              }}
            >
              Practise on material that’s grounded in the grammar and sharpened every week by real
              results.
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
          <span style={{ fontSize: 12, color: 'var(--df-mute)' }}>
            © 2026 drill · type it, don’t tap it
          </span>
          <Link href="/" className="df-footlink">
            ← back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
