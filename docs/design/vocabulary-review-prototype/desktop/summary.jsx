// End-of-session debrief — mastery movement + due-count burndown.
// No streaks, no XP. The spec is emphatic about this.

function ReviewSummary() {
  const S = window.RV.SESSION;
  const G = window.RV.GRAMMAR_DELTAS;

  return (
    <RvFrame current="review" lang="es">
      <div className="t-micro">session done · {S.duration} · español</div>
      <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>nine moved.</h1>
      <p className="t-body-l" style={{ marginTop: 8, maxWidth: 640 }}>
        <span className="hilite">{S.correct} of {S.total}</span> clean · {S.partial} partial · {S.missed} missed. that's mastery
        movement — the only metric we care about.
      </p>

      {/* The three things that moved */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 28 }}>
        <SummaryCard
          accent="var(--ok)"
          label="promoted to mature"
          n={S.promoted.length}
          chips={S.promoted.map((w) => ({ label: w, kind: 'mature' }))}
          note="2 consecutive clean reps."
        />
        <SummaryCard
          accent="var(--accent)"
          label="lapsed"
          n={S.lapsed.length}
          chips={S.lapsed.map((w) => ({ label: w, kind: 'leech' }))}
          note="surfacing in leech rescue tomorrow."
        />
        <SummaryCard
          accent="var(--ink-soft)"
          label="new cards added"
          n={S.newCards}
          chips={[{ label: 'echar de menos', kind: 'new' }, { label: 'hartar', kind: 'new' }]}
          note="from saved sentences this week."
        />
      </div>

      {/* Two-column lower half */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 28, marginTop: 32 }}>
        {/* Per-item table */}
        <div>
          <div className="rv-h" style={{ marginBottom: 10 }}>items, in order</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {S.items.map((it, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '22px 1.2fr 130px 90px 1fr',
                alignItems: 'center', gap: 14, padding: '12px 16px',
                borderBottom: i < S.items.length - 1 ? '1px solid var(--rule)' : 'none',
              }}>
                <span className={`rv-tick ${it.result === 'ok' ? 'ok' : it.result === 'partial' ? 'skip' : 'miss'}`}>
                  {it.result === 'ok' ? '✓' : it.result === 'partial' ? '~' : '✗'}
                </span>
                <div>
                  <div style={{ fontFamily: 'var(--t-display)', fontSize: 17 }}>{it.lemma}</div>
                  <div className="t-small" style={{ fontSize: 11, fontFamily: 'var(--t-mono)' }}>as <em>{it.surface}</em></div>
                </div>
                <ItemTypeChip kind={it.type} />
                <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{it.t}</span>
                <span className="t-small" style={{ fontSize: 12, fontStyle: it.note ? 'italic' : 'normal' }}>{it.note || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Grammar map deltas */}
        <div>
          <div className="rv-h" style={{ marginBottom: 10 }}>grammar points moved</div>
          <div className="card" style={{ padding: 18 }}>
            {G.map((g) => {
              const delta = g.to - g.from;
              const down = delta < 0;
              return (
                <div key={g.name} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px dashed var(--rule)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                    <span className="t-mono" style={{ fontSize: 12, color: down ? 'var(--accent)' : 'var(--ok)' }}>
                      {g.from}% → {g.to}% ({down ? '' : '+'}{delta})
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 6, background: 'var(--paper-3)', borderRadius: 999 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${g.from}%`, background: 'var(--ink-mute)', opacity: 0.4, borderRadius: 999 }} />
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${g.to}%`, background: down ? 'var(--accent)' : 'var(--ok)', borderRadius: 999 }} />
                  </div>
                  <div className="t-small" style={{ marginTop: 6, fontSize: 11, fontStyle: 'italic' }}>{g.evidence}</div>
                </div>
              );
            })}
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'space-between', marginTop: 4 }}>
              <span>see full radar</span><span>→</span>
            </button>
          </div>

          <div style={{ marginTop: 16, padding: 14, border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', fontSize: 12 }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>cost · this session</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span>3 claude-graded items</span>
              <span className="t-mono">{S.costClaude}</span>
            </div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 6 }}>local items free. you've used <span className="t-mono">$0.12 / $2.00</span> of this week's review budget.</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28, padding: 18, background: 'var(--paper-2)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div className="rv-avatar" style={{ width: 36, height: 36, fontSize: 15 }}>c</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>next batch surfaces in ~6 hours.</div>
          <div className="t-small">11 items due, mostly maintenance. the only urgent one is <em>imprescindible</em> — i'm switching item types on it tomorrow.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn">browse bank →</button>
          <button className="btn primary">done</button>
        </div>
      </div>
    </RvFrame>
  );
}

function SummaryCard({ accent, label, n, chips, note }) {
  return (
    <div className="card" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--t-display)', fontSize: 32, letterSpacing: -0.5, lineHeight: 1, color: accent }}>{n}</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {chips.map((c, i) => <StatusPill key={i} kind={c.kind}>{c.label}</StatusPill>)}
      </div>
      <div className="t-small" style={{ fontSize: 11 }}>{note}</div>
    </div>
  );
}

window.ReviewSummary = ReviewSummary;
