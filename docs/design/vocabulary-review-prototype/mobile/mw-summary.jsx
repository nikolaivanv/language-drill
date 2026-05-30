// Mobile-web session debrief — reflow of review/summary.jsx.
// Stat cards → horizontal snap row. Grammar deltas + items list stacked.
// No streaks, no XP.

function MWReviewSummary({ onNav }) {
  const S = window.RV.SESSION;
  const G = window.RV.GRAMMAR_DELTAS;
  const actionBar = (
    <>
      <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onNav('review')}>one more set</button>
      <button className="btn primary lg" style={{ flex: 1, justifyContent: 'center', padding: '12px 18px' }} onClick={() => onNav('dashboard')}>done</button>
    </>
  );
  return (
    <MWShell variant="drill" lang="es" title="session debrief" onBack={() => onNav('review')} actionBar={actionBar}>
      <div className="mw-section" style={{ paddingTop: 18 }}>
        <div className="t-micro">session done · {S.duration} · español</div>
        <h1 className="mw-h1" style={{ marginTop: 6 }}>nine moved.</h1>
        <p className="t-body" style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
          <span className="hilite">{S.correct} of {S.total}</span> clean · {S.partial} partial · {S.missed} missed. mastery movement — the only metric that matters.
        </p>
      </div>

      {/* horizontal snap row of the three movements */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '4px 18px 6px', scrollSnapType: 'x mandatory' }}>
        <MWMoveCard accent="var(--ok)" n={S.promoted.length} label="promoted" chips={S.promoted} kind="mature" note="2 clean reps." />
        <MWMoveCard accent="var(--accent)" n={S.lapsed.length} label="lapsed" chips={S.lapsed} kind="leech" note="leech rescue tmr." />
        <MWMoveCard accent="var(--ink-soft)" n={S.newCards} label="new cards" chips={['echar de menos', 'hartar']} kind="new" note="from saved sentences." />
      </div>

      {/* grammar deltas */}
      <div className="mw-section tight" style={{ paddingTop: 16 }}>
        <div className="rv-h" style={{ marginBottom: 8 }}>grammar points moved</div>
        <div className="card" style={{ padding: '14px 16px' }}>
          {G.map((g, i) => {
            const delta = g.to - g.from; const down = delta < 0;
            return (
              <div key={g.name} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: i < G.length - 1 ? '1px dashed var(--rule)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                  <span className="t-mono" style={{ fontSize: 11, color: down ? 'var(--accent)' : 'var(--ok)' }}>{g.from}→{g.to}% ({down ? '' : '+'}{delta})</span>
                </div>
                <div style={{ position: 'relative', height: 6, background: 'var(--paper-3)', borderRadius: 999 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${g.from}%`, background: 'var(--ink-mute)', opacity: 0.4, borderRadius: 999 }} />
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${g.to}%`, background: down ? 'var(--accent)' : 'var(--ok)', borderRadius: 999 }} />
                </div>
                <div className="t-small" style={{ marginTop: 5, fontSize: 11, fontStyle: 'italic' }}>{g.evidence}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* items list */}
      <div className="mw-section tight" style={{ paddingTop: 16 }}>
        <div className="rv-h" style={{ marginBottom: 8 }}>items, in order</div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {S.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: i < S.items.length - 1 ? '1px solid var(--rule)' : 'none' }}>
              <span className={`rv-tick ${it.result === 'ok' ? 'ok' : it.result === 'partial' ? 'skip' : 'miss'}`}>{it.result === 'ok' ? '✓' : it.result === 'partial' ? '~' : '✗'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--t-display)', fontSize: 15 }}>{it.lemma}</div>
                {it.note && <div className="t-small" style={{ fontSize: 10, fontStyle: 'italic' }}>{it.note}</div>}
              </div>
              <ItemTypeChip kind={it.type} />
              <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', width: 44, textAlign: 'right' }}>{it.t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* cost + next */}
      <div className="mw-section tight" style={{ paddingTop: 16 }}>
        <div style={{ border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', padding: 14 }}>
          <div className="rv-h" style={{ marginBottom: 8 }}>cost · this session</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>3 claude-graded items</span><span className="t-mono">{S.costClaude}</span>
          </div>
          <div className="t-small" style={{ fontSize: 11, marginTop: 6 }}>local items free · <span className="t-mono">$0.12 / $2.00</span> of this week's budget.</div>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 24 }}>
        <MWCoachCard>
          next batch surfaces in ~6 hours — 11 items, mostly maintenance. the only urgent one is <em>imprescindible</em>; i'm switching its item type tomorrow.
        </MWCoachCard>
      </div>
    </MWShell>
  );
}

function MWMoveCard({ accent, n, label, chips, kind, note }) {
  return (
    <div style={{ flex: '0 0 78%', scrollSnapAlign: 'start', background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--t-display)', fontSize: 30, lineHeight: 1, color: accent, letterSpacing: -0.5 }}>{n}</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {chips.map((c) => <StatusPill key={c} kind={kind}>{c}</StatusPill>)}
      </div>
      <div className="t-small" style={{ fontSize: 11 }}>{note}</div>
    </div>
  );
}

Object.assign(window, { MWReviewSummary, MWMoveCard });
