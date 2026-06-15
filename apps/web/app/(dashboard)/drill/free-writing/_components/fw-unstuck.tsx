'use client';

import React from 'react';
import {
  useBrainstorm,
  useVocabBoost,
  useStartMyParagraph,
  type AuthenticatedFetch,
  type BrainstormResponse,
  type VocabBoostResponse,
} from '@language-drill/api-client';
import { FwIcon } from './fw-atoms';

type Kind = 'brainstorm' | 'vocab';

export interface FwUnstuckProps {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  value: string;
  onChange: (next: string) => void;
}

function BrainstormView({ groups }: { groups: BrainstormResponse['groups'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {groups.map((g, gi) => (
        <div key={`${g.label}-${gi}`}>
          <div className="rv-h" style={{ marginBottom: 6 }}>{g.label}</div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {g.points.map((p, pi) => (
              <li key={`${gi}-${pi}`} style={{ fontSize: 13, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--color-accent)', flexShrink: 0 }}>•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VocabView({ items }: { items: VocabBoostResponse['items'] }) {
  return (
    <div>
      {items.map((it, i) => (
        <div key={`${it.term}-${i}`} className="fw-vocab-row">
          <span className="w">{it.term}</span>
          <span className="g">{it.gloss}</span>
        </div>
      ))}
    </div>
  );
}

export function FwUnstuck({ exerciseId, fetchFn, value, onChange }: FwUnstuckProps) {
  const [openKind, setOpenKind] = React.useState<Kind | null>(null);

  const brainstorm = useBrainstorm({ exerciseId, fetchFn, enabled: openKind === 'brainstorm' });
  const vocab = useVocabBoost({ exerciseId, fetchFn, enabled: openKind === 'vocab' });
  const active = openKind === 'brainstorm' ? brainstorm : openKind === 'vocab' ? vocab : null;

  const toggle = (k: Kind) => setOpenKind((cur) => (cur === k ? null : k));

  // Start my paragraph — one-click insert of a target-language opener.
  const startPara = useStartMyParagraph({ exerciseId, fetchFn });
  const [insertedOpener, setInsertedOpener] = React.useState<string | null>(null);
  const [addFailed, setAddFailed] = React.useState(false);

  // Strip the currently-inserted opener prefix from `text`, if it is still there.
  const stripOpener = (text: string): string => {
    if (!insertedOpener) return text;
    const withBreak = `${insertedOpener}\n\n`;
    if (text.startsWith(withBreak)) return text.slice(withBreak.length);
    if (text.startsWith(insertedOpener)) return text.slice(insertedOpener.length);
    return text;
  };

  // Fetch an opener and prepend it. On regenerate, the prior opener is stripped
  // first so we replace rather than stack. An empty result is treated as an error.
  const handleStart = async () => {
    setAddFailed(false);
    const body = stripOpener(value);
    try {
      const res = await startPara.mutateAsync();
      if (res.opener) {
        onChange(`${res.opener}\n\n${body}`);
        setInsertedOpener(res.opener);
      } else {
        setAddFailed(true);
      }
    } catch {
      // react-query exposes the rejection via startPara.isError; nothing to insert.
    }
  };

  const handleRemove = () => {
    onChange(stripOpener(value));
    setInsertedOpener(null);
    setAddFailed(false);
    startPara.reset();
  };

  const showOpenerError = startPara.isError || addFailed;
  const showChip = startPara.isPending || showOpenerError || insertedOpener !== null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="t-micro" style={{ marginRight: 2 }}>stuck?</span>
        <button
          className={`fw-helpbtn${openKind === 'brainstorm' ? ' active' : ''}`}
          onClick={() => toggle('brainstorm')}
        >
          <span className="ico"><FwIcon kind="list" size={14} /></span>
          brainstorm
        </button>
        <button
          className={`fw-helpbtn${openKind === 'vocab' ? ' active' : ''}`}
          onClick={() => toggle('vocab')}
        >
          <span className="ico"><FwIcon kind="book" size={14} /></span>
          vocabulary boost
        </button>
        <button
          className="fw-helpbtn"
          onClick={handleStart}
          disabled={startPara.isPending}
        >
          <span className="ico"><FwIcon kind="write" size={14} /></span>
          start my paragraph
        </button>
        <span className="t-small" style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--color-ink-mute)' }}>
          helpers give you a nudge — the ideas and words are yours to shape.
        </span>
      </div>

      {showChip && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            border: '1px solid var(--color-rule)',
            borderRadius: 'var(--radius-r-md)',
            background: 'var(--color-paper-2)',
          }}
        >
          {startPara.isPending ? (
            <span className="t-small">thinking…</span>
          ) : showOpenerError ? (
            <span className="t-small" style={{ color: 'var(--color-accent-2)' }}>
              couldn't add an opener —{' '}
              <button type="button" className="btn ghost sm" onClick={handleStart}>try again</button>
            </span>
          ) : (
            <span className="t-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              opener added
              <button type="button" className="btn ghost sm" onClick={handleStart}>regenerate</button>
              <button type="button" className="btn ghost sm" onClick={handleRemove}>remove</button>
            </span>
          )}
        </div>
      )}

      {openKind && active && (
        <div className="fw-helppanel" style={{ marginTop: 12 }}>
          <div className="head">
            <span>
              {openKind === 'brainstorm' ? 'ideas to get you started' : 'useful words for this prompt'}
            </span>
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
              <button
                className="btn ghost sm"
                onClick={() => active.refetch()}
                disabled={active.isFetching}
              >
                regenerate
              </button>
              <button className="btn ghost sm" onClick={() => setOpenKind(null)}>close</button>
            </span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            {active.isFetching ? (
              <div className="t-small">thinking…</div>
            ) : active.isError ? (
              <div className="t-small" style={{ color: 'var(--color-accent-2)' }}>
                couldn't load —{' '}
                <button className="btn ghost sm" onClick={() => active.refetch()}>try again</button>
              </div>
            ) : openKind === 'brainstorm' && brainstorm.data ? (
              <BrainstormView groups={brainstorm.data.groups} />
            ) : openKind === 'vocab' && vocab.data ? (
              <VocabView items={vocab.data.items} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
