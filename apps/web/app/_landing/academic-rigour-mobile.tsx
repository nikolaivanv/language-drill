'use client';

// "Academic rigour" — Mobile Web reflow. Ported from the design handoff
// (landing/academic-rigour-mobile.jsx). Same story as the desktop standalone
// page reflowed for a phone: hero → stat band (2×2) → provenance (stacked) →
// per-language curriculum → quality principles → produce-don't-recognise modes →
// continuous-improvement demo → CTA. Scoped to .dfm.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import './landing.css';
import { DBrand } from './landing-chrome';

const ARM_STATS: [ReactNode, string, string][] = [
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

const ARM_FLOW: [string, string, string][] = [
  [
    'A',
    'The authoritative sources',
    'Each language is grounded in its official curriculum framework and the single most comprehensive grammar reference for that language.',
  ],
  [
    'B',
    'Mapped to the CEFR ladder',
    'Every rule, tense and construction is placed on the A1–B2 scale, so items pull at exactly the right level.',
  ],
  [
    'C',
    'The item you practise',
    'Calibrated a notch above your level, answer hidden — real production, drawn straight from the sources above.',
  ],
];

const ARM_CURRIC: [string, string, string][] = [
  [
    'Spanish',
    '#cc7a3c',
    'Grounded in the Plan Curricular del Instituto Cervantes — the syllabus behind the DELE exams — and cross-checked against the most comprehensive Spanish grammar.',
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

const ARM_PRINCIPLES: [string, string][] = [
  [
    'Source-grounded',
    'Every rule, exception and explanation is lifted from a definitive reference — never improvised.',
  ],
  [
    'Calibrated to level',
    'Locked to your CEFR band. Items sit one notch above — challenging, never over your head.',
  ],
  [
    'Reads like a person',
    'Sentences are checked to sound natural, not like textbook filler. Real prose, not robotic drills.',
  ],
  [
    'Deliberate coverage',
    'Curated, level-tuned lists with real spread — no looping on a handful of favourites.',
  ],
];

const ARM_MODES: [string, string, string][] = [
  [
    'Translation',
    'Richest signal',
    'Produce a whole sentence from meaning alone — the openest task, revealing the most about grammar and vocabulary.',
  ],
  ['Cloze', 'Precision', 'One grammar point, isolated in real context — filled in by hand, not chosen from a list.'],
  [
    'Sentence construction',
    'Spontaneous',
    'Build a target structure from a prompt and nothing else. Syntax under load, like real speech.',
  ],
  [
    'Free writing',
    'Exam-style',
    'Open paragraphs graded on the criteria the DELE and IELTS use — the richest source of signal.',
  ],
  [
    'Vocabulary recall',
    'Active',
    'Retrieve the word from its meaning or context, monolingual at higher levels — recall, never recognition.',
  ],
  [
    'Contextual paraphrase',
    'Flexibility',
    'Say the same thing another way — so you own the idea, not one memorised phrasing.',
  ],
  [
    'Dictation',
    'Listening',
    'Neural-voice audio couples the ear to spelling and production — you write down what you hear.',
  ],
  ['Conjugation drill', 'Repair', 'A targeted morphology drill, used as remediation to make inflection automatic.'],
];

function ARMTop() {
  return (
    <div className="dfm-top">
      <DBrand />
      <div className="dfm-actions">
        <Link href="/" className="dfm-signin">
          ← Home
        </Link>
        <Link href="/sign-up" className="dfm-signup">
          Sign up
        </Link>
      </div>
    </div>
  );
}

function ARMReview() {
  const [fixed, setFixed] = useState(false);
  return (
    <div className="ar-case-card dfm-card">
      <div className="ar-case-top">
        <span className="ar-case-badge">
          <span className="ar-case-badge-dot" style={{ background: '#e0b25a' }} />
          Only 34% got this right
        </span>
        <span className="df-chip-dark">DE · B2</span>
      </div>
      {!fixed ? (
        <div className="swap" key="b">
          <div className="ar-quote">A rate that low usually means the item, not the learner, is off.</div>
          <div className="drill-stage" style={{ fontSize: 19, lineHeight: 1.5 }}>
            Er wartete, <span className="drill-blank type no">bis</span> der Regen aufhörte.
          </div>
          <div className="df-coach ar-coach-flaw">
            <div className="df-coach-dot" style={{ background: '#8c8475' }}>
              !
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
              <strong style={{ color: '#f0a78c' }}>The problem.</strong> The gap gave no hint which
              conjunction was wanted; most learners were guessing.
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
        <div className="swap" key="a">
          <div className="ar-quote ar-quote--fixed">
            Rewritten and re-released to everyone practising this skill.
          </div>
          <div className="drill-stage" style={{ fontSize: 19, lineHeight: 1.5 }}>
            Er wartete so lange, <span className="drill-blank type ok">bis</span> der Regen aufhörte.
          </div>
          <div className="df-coach ar-coach-fix">
            <div className="df-coach-dot" style={{ background: 'var(--ok)' }}>
              c
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--df-ink2)' }}>
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
              ← Original
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AcademicRigourMobile() {
  return (
    <div className="df dfm">
      <ARMTop />

      {/* hero */}
      <header className="dfm-wrap" style={{ paddingTop: 28, paddingBottom: 8 }}>
        <div className="dfm-eyebrow">Academic rigour · how it’s made</div>
        <h1 className="dfm-h1" style={{ marginTop: 12 }}>
          Practice you can actually <span style={{ color: 'var(--accent)' }}>trust</span>.
        </h1>
        <p className="dfm-sub">
          A drill is only worth doing if it’s correct. So every item is grounded in an authoritative
          curriculum and grammar, calibrated to your CEFR level — and rewritten the moment the data
          says it fell short.
        </p>
        <div className="dfm-stats">
          {ARM_STATS.map(([big, l1, l2], i) => (
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
      </header>

      {/* provenance */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">Where the exercises come from</div>
        <h2 className="dfm-h2">Nothing here is improvised.</h2>
        <p className="dfm-lead">
          Behind every gap, translation and dictation is the same short pipeline — from a reference
          you could look the rule up in, to the item on your screen.
        </p>
        <div className="dfm-stack">
          {ARM_FLOW.map(([n, h, b]) => (
            <div key={n} className="dfm-card">
              <div className="dfm-flow-badge">{n}</div>
              <div
                style={{
                  fontFamily: 'var(--t-display)',
                  fontSize: 18,
                  color: 'var(--df-ink)',
                  marginTop: 13,
                }}
              >
                {h}
              </div>
              <p style={{ color: 'var(--df-ink2)', fontSize: 13.5, lineHeight: 1.55, margin: '8px 0 0' }}>
                {b}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* per-language curriculum */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">Language by language</div>
        <h2 className="dfm-h2">Each course sits on an official curriculum.</h2>
        <p className="dfm-lead">
          We don’t invent a syllabus. Each language follows the framework its own standards body
          publishes — the same one behind its official exams.
        </p>
        <div className="dfm-stack">
          {ARM_CURRIC.map(([lang, color, body]) => (
            <div key={lang} className="dfm-card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span
                  style={{
                    fontFamily: 'var(--t-display)',
                    fontSize: 24,
                    fontWeight: 500,
                    color: 'var(--df-ink)',
                    letterSpacing: '-0.3px',
                  }}
                >
                  {lang}
                </span>
                <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--df-mute)' }}>
                  A1–B2
                </span>
              </div>
              <div className="dfm-curric-under" style={{ background: color }} />
              <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--df-ink2)', margin: '14px 0 0' }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* principles */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">What “rigorous” means here</div>
        <h2 className="dfm-h2">Four things we don’t compromise on.</h2>
        <div className="dfm-stack">
          {ARM_PRINCIPLES.map(([h, b]) => (
            <div key={h} className="dfm-card">
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--df-ink)' }}>
                {h}
              </div>
              <p style={{ color: 'var(--df-ink2)', fontSize: 13.5, lineHeight: 1.55, margin: '7px 0 0' }}>
                {b}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* produce, don't recognise */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">Produce, don’t recognise</div>
        <h2 className="dfm-h2">The plateau doesn’t break by tapping the right answer.</h2>
        <p className="dfm-lead">
          Every drill has to pass one test: does the learner{' '}
          <strong style={{ color: 'var(--df-ink)' }}>construct</strong> the language, or merely
          recognise it? So there’s no multiple-choice main mode — you write, and an AI examiner grades
          what you wrote across grammar, vocabulary and discourse.
        </p>
        <div className="dfm-stack">
          {ARM_MODES.map(([h, tag, b]) => (
            <div key={h} className="dfm-card">
              <div className="dfm-mode-head">
                <span style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--df-ink)' }}>
                  {h}
                </span>
                <span className="dfm-mode-tag">{tag}</span>
              </div>
              <p style={{ color: 'var(--df-ink2)', fontSize: 13.5, lineHeight: 1.55, margin: '10px 0 0' }}>
                {b}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* continuous improvement */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-eyebrow2">And it keeps getting better</div>
        <h2 className="dfm-h2">The material improves every week.</h2>
        <p className="dfm-lead">
          Every attempt is scored, so when an item’s{' '}
          <strong style={{ color: 'var(--df-ink)' }}>
            success rate drops below what a well-pitched exercise should hit
          </strong>
          , it’s surfaced for review. Learners can also flag any item directly. Either way, we rewrite
          it and ship the fix to everyone.
        </p>
        <div style={{ marginTop: 22 }}>
          <ARMReview />
        </div>
      </section>

      {/* CTA */}
      <section className="dfm-wrap dfm-section">
        <div className="dfm-ctaband">
          <h2>Rigorous, and never finished.</h2>
          <p>
            Practise on material that’s grounded in the grammar and sharpened every week by real
            results.
          </p>
          <Link
            href="/sign-up"
            className="dfm-btn"
            style={{ background: '#fff', color: 'var(--accent-2)', borderColor: '#fff', marginTop: 20 }}
          >
            Sign up free
          </Link>
          <div
            style={{
              fontFamily: 'var(--t-mono)',
              fontSize: 10.5,
              color: 'rgba(255,255,255,.72)',
              marginTop: 16,
            }}
          >
            free to start · no card
          </div>
        </div>
      </section>

      <footer className="dfm-footer">
        <DBrand />
        <div className="meta">© 2026 drill · type it, don’t tap it</div>
        <Link href="/">← back to home</Link>
      </footer>
    </div>
  );
}
