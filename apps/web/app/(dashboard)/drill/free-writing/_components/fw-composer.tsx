'use client';

import React from 'react';
import {
  type FreeWritingContent,
  type LearningLanguage,
  EXERCISE_ANSWER_MAX_CHARS,
} from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { AccentPicker } from '../../../../../components/ui';
import { FwIcon, WordCounter, ReqRow } from './fw-atoms';
import { FwUnstuck } from './fw-unstuck';

export interface FwComposerProps {
  content: FreeWritingContent;
  language: LearningLanguage;
  value: string;
  onChange: (next: string) => void;
  examMode: boolean;
  submitting: boolean;
  onGrade: () => void;
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
}

// Mirrors the quick-drill exercises: only ES/DE/TR have a special-character
// keyboard; the AccentPicker itself no-ops for any other language.
function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function FwComposer({ content, language, value, onChange, examMode, submitting, onGrade, exerciseId, fetchFn }: FwComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const canGrade = words >= content.minWords && !submitting;

  // Exam timer — seeded from suggestedMinutes; counts down to 0; display-only
  const initialSeconds =
    examMode && content.suggestedMinutes != null ? content.suggestedMinutes * 60 : 0;
  const [secondsLeft, setSecondsLeft] = React.useState(initialSeconds);

  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    // Clean up any prior interval
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (!examMode || content.suggestedMinutes == null) return;

    // Reset the counter and start ticking
    const total = content.suggestedMinutes * 60;
    setSecondsLeft(total);

    tickRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [examMode, content.suggestedMinutes]);

  return (
    <div>
      {/* Drill header strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="t-micro">free writing</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-ink-soft)' }}>
            <FwIcon kind="clock" size={13} />
            <span className="t-mono" style={{ fontSize: 11 }}>
              {examMode && content.suggestedMinutes != null
                ? formatTime(secondsLeft)
                : '—'}
            </span>
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28 }}>
        {/* Writing column */}
        <div>
          {/* Compact prompt banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px 16px',
              background: 'var(--color-paper-2)',
              border: '1px solid var(--color-rule)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 16,
            }}
          >
            <span style={{ color: 'var(--color-accent)', marginTop: 1 }}>
              <FwIcon kind="write" size={16} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{content.title}</div>
              <div className="t-small" style={{ fontSize: 12 }}>
                {content.register} · {content.minWords}–{content.maxWords} words · {content.task}
              </div>
            </div>
          </div>

          {/* The editor */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              maxLength={EXERCISE_ANSWER_MAX_CHARS}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 360,
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '26px 30px',
                background: 'transparent',
                fontFamily: 'var(--font-display)',
                fontSize: 19,
                lineHeight: 1.85,
                color: 'var(--color-ink)',
              }}
            />
            {isAccentLanguage(language) && (
              <div
                style={{
                  padding: '10px 18px',
                  borderTop: '1px solid var(--color-rule)',
                  background: 'var(--color-paper-2)',
                }}
              >
                <AccentPicker language={language} targetRef={textareaRef} />
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderTop: '1px solid var(--color-rule)',
                background: 'var(--color-paper-2)',
              }}
            >
              <WordCounter count={words} min={content.minWords} max={content.maxWords} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="t-small"
                  style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4 }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)' }}
                  />
                  ai-graded
                </span>
                <button
                  className="btn accent"
                  disabled={!canGrade}
                  onClick={onGrade}
                >
                  {submitting ? 'grading…' : 'grade my writing ↵'}
                </button>
              </div>
            </div>
          </div>

          {/* Getting-unstuck helpers — hidden in exam mode */}
          {!examMode && <FwUnstuck exerciseId={exerciseId} fetchFn={fetchFn} value={value} onChange={onChange} />}
        </div>

        {/* Right rail — required elements checklist + length counter */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>required elements · live</div>
            {content.requiredElements.length > 0 ? (
              content.requiredElements.map((r) => (
                <ReqRow key={r.id} r={r} compact />
              ))
            ) : (
              <div className="t-small" style={{ fontSize: 11, color: 'var(--color-ink-soft)' }}>
                no required elements for this prompt.
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>length</div>
            <WordCounter count={words} min={content.minWords} max={content.maxWords} />
            <div className="t-small" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
              stay inside the target band — concision is part of register.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
