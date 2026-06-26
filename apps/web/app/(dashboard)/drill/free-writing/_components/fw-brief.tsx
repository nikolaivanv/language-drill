'use client';

import type { FreeWritingContent } from '@language-drill/shared';
import { FwIcon } from './fw-atoms';

export interface FwBriefProps {
  content: FreeWritingContent;
  examMode: boolean;
  onToggleExam: () => void;
  onBegin: () => void;
}

// ── SpecRow: a labelled row in the spec card ─────────────────────────────────
function SpecRow({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '13px 0',
        borderBottom: '1px dashed var(--color-rule)',
      }}
    >
      <span style={{ color: 'var(--color-ink-soft)', marginTop: 1, flexShrink: 0 }}>
        <FwIcon kind={icon} size={16} />
      </span>
      <div style={{ flex: 1 }}>
        <div className="rv-h" style={{ marginBottom: 3 }}>
          {label}
        </div>
        <div className="t-body" style={{ fontSize: 14, color: 'var(--color-ink)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── FwBrief ──────────────────────────────────────────────────────────────────
// Surface B: displays the writing brief, spec, exam toggle, grading criteria.
// Pure presentational — all state lives in the parent (free-writing page).
export function FwBrief({ content, examMode, onToggleExam, onBegin }: FwBriefProps) {
  const minutes = content.suggestedMinutes ?? 20;

  return (
    <div>
      {/* Header microcopy */}
      <div className="t-micro" style={{ marginTop: 6 }}>
        free writing · your prompt
      </div>

      {/* Two-column layout: brief (left) + right rail */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: 32,
          marginTop: 12,
        }}
        className="fw-brief-grid"
      >
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div>
          <h1
            className="t-display-l"
            style={{ margin: '2px 0 8px', maxWidth: 600 }}
          >
            {content.title}
          </h1>
          <p className="t-body-l" style={{ marginTop: 0, maxWidth: 600 }}>
            {content.task}
          </p>

          {/* Spec card */}
          <div className="card" style={{ marginTop: 20, padding: '6px 22px' }}>
            <SpecRow icon="list" label="topic">
              {content.domain}
            </SpecRow>
            <SpecRow icon="write" label="register">
              <span style={{ textTransform: 'capitalize' }}>{content.register}</span>
              <span className="t-small" style={{ marginLeft: 8 }}>
                — address a general reader; avoid colloquialisms.
              </span>
            </SpecRow>
            <SpecRow icon="book" label="length">
              <span className="t-mono">
                {content.minWords}–{content.maxWords}
              </span>{' '}
              words
            </SpecRow>
            <SpecRow icon="check" label="required elements">
              <div style={{ marginTop: 2 }}>
                {content.requiredElements.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      padding: '3px 0',
                    }}
                  >
                    <span style={{ color: 'var(--color-accent)', fontSize: 13 }}>•</span>
                    <span style={{ fontSize: 13.5 }}>
                      {r.label}
                      {r.detail && (
                        <span
                          className="t-small"
                          style={{
                            display: 'block',
                            fontSize: 11.5,
                            color: 'var(--color-ink-mute)',
                          }}
                        >
                          {r.detail}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </SpecRow>
          </div>

          {/* Exam-simulation toggle */}
          <div
            className="card"
            style={{
              marginTop: 16,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: examMode ? 'var(--color-accent-soft)' : 'var(--color-card)',
              borderColor: examMode ? 'var(--color-accent)' : 'var(--color-rule)',
            }}
          >
            <span style={{ color: examMode ? 'var(--color-accent-2)' : 'var(--color-ink-soft)' }}>
              <FwIcon kind="clock" size={18} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>exam simulation</div>
              <div className="t-small" style={{ fontSize: 12 }}>
                {minutes}-minute countdown · helpers hidden · mirrors DELE Expresión Escrita timing.
              </div>
            </div>
            <button
              onClick={onToggleExam}
              aria-label="toggle exam mode"
              style={{
                width: 46,
                height: 26,
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: examMode ? 'var(--color-accent)' : 'var(--color-paper-3)',
                position: 'relative',
                transition: 'background .2s',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: examMode ? 23 : 3,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left .2s',
                  boxShadow: 'var(--shadow-1)',
                }}
              />
            </button>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn primary lg" onClick={onBegin}>
              begin writing →
            </button>
            <span className="t-small" style={{ marginLeft: 'auto' }}>
              {examMode ? `timer on · ${minutes} min` : 'untimed · helpers available'}
            </span>
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────────── */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Graded-on card */}
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>
              graded on · IELTS-style
            </div>
            {[
              'Task achievement',
              'Coherence & cohesion',
              'Lexical resource',
              'Grammatical range & accuracy',
            ].map((c) => (
              <div
                key={c}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px dashed var(--color-rule)',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--color-accent)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13 }}>{c}</span>
                <span
                  className="t-mono"
                  style={{ fontSize: 10, color: 'var(--color-ink-mute)', marginLeft: 'auto' }}
                >
                  0–1 · CEFR
                </span>
              </div>
            ))}
            <div
              className="t-small"
              style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}
            >
              each criterion returns a score and a CEFR estimate. errors are located in your text;
              an improved version is provided to compare.
            </div>
          </div>

          {/* Feeds card */}
          <div className="card" style={{ padding: 14, background: 'var(--color-paper-2)' }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>
              feeds
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                'Writing CEFR',
                'grammar radar',
                'vocab depth',
                'pragmatics',
                'IELTS / DELE readiness',
              ].map((t) => (
                <span key={t} className="chip" style={{ fontSize: 11 }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
