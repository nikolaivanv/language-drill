// Dashboard hi-fi — B layout (today's lesson plan, editorial) + A's skill meters strip below

function DashHiFi({ onStartDrill, onNav }) {
  const startTrans = () => onNav('translation');
  const startVocab = () => onNav('vocab');
  return (
    <AppShell current="dashboard" onNav={onNav}>
      <div className="main-inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
          <div className="t-micro">tuesday · week 6 · español</div>
          <div className="t-small" style={{ fontFamily: 'var(--t-mono)' }}>~22 min planned</div>
        </div>

        <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>good morning, juno.</h1>
        <div style={{ marginTop: 6 }}>
          <span className="t-display-l" style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontWeight: 400 }}>here's today's plan.</span>
        </div>

        <p className="t-body-l" style={{ marginTop: 22, maxWidth: 640 }}>
          your <span className="hilite">subjunctive</span> recall stalled last week. we'll push it today with production, not recognition — and sneak in a listening rep on rapid speech.
        </p>

        {/* lesson plan — vertical timeline */}
        <div style={{ marginTop: 32 }}>
          {[
            { n: '01', t: 'warm-up · cloze', d: 'pronoun placement · 4 items', min: 3, status: 'done' },
            { n: '02', t: 'core · subjunctive cloze', d: 'doubt clauses — 6 items in context', min: 9, status: 'next', primary: true },
            { n: '03', t: 'production · en→es translation', d: 'phrases + sentences · ai-graded, multiple correct accepted', min: 8, status: 'queued', secondary: true },
            { n: '04', t: 'vocabulary recall', d: '6 words from your B1–B2 frequency band · type from definition', min: 5, status: 'queued', tertiary: true },
            { n: '05', t: 'cool-down · writing', d: 'summarize today in 3 sentences', min: 4, status: 'queued' },
          ].map((s, i, arr) => (
            <div key={i} style={{ display: 'flex', gap: 18, position: 'relative' }}>
              {/* rail */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  border: '1.5px solid var(--ink)',
                  background: s.status === 'done' ? 'var(--ok)' : s.primary ? 'var(--accent)' : 'var(--card)',
                  color: s.status === 'done' || s.primary ? '#fff' : 'var(--ink)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--t-mono)', fontSize: 12, fontWeight: 600,
                  borderColor: s.status === 'done' ? 'var(--ok)' : s.primary ? 'var(--accent)' : 'var(--ink)',
                  boxShadow: s.primary ? '0 0 0 4px var(--accent-soft)' : 'none',
                }}>{s.status === 'done' ? '✓' : s.n}</div>
                {i < arr.length - 1 && <div style={{ width: 1.5, flex: 1, background: 'var(--rule)', margin: '4px 0', minHeight: 28 }} />}
              </div>

              <div style={{
                flex: 1, paddingBottom: 24,
                opacity: s.status === 'done' ? 0.55 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h3 className="t-display-s" style={{ margin: 0, textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.t}</h3>
                      {s.primary && <span className="chip accent">next up</span>}
                      {s.status === 'done' && <span className="chip ok">done</span>}
                    </div>
                    <div className="t-body" style={{ marginTop: 4 }}>{s.d}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div className="t-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{s.min} min</div>
                    {s.primary && <button className="btn primary" onClick={onStartDrill}>start →</button>}
                    {s.secondary && <button className="btn ghost sm" onClick={startTrans}>preview →</button>}
                    {s.tertiary && <button className="btn ghost sm" onClick={startVocab}>preview →</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* divider */}
        <div style={{ borderTop: '1px solid var(--rule)', margin: '12px 0 28px' }} />

        {/* skill meters from A */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div>
            <div className="t-micro">your spanish · weakest first</div>
            <h2 className="t-display-m" style={{ marginTop: 4 }}>skill snapshot</h2>
          </div>
          <button className="btn ghost sm" onClick={() => onNav('progress')}>see full progress →</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
          {[
            { name: 'conditional perfect', pct: 44, delta: '+7', warn: true },
            { name: 'preterite vs imperfect', pct: 58, delta: '−2', warn: true },
            { name: 'object pronouns', pct: 66, delta: '+6' },
            { name: 'subjunctive recall', pct: 71, delta: '+4' },
            { name: 'ser / estar', pct: 83, delta: '+1' },
            { name: 'articles & gender', pct: 92, delta: '—' },
          ].map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <span className="t-mono" style={{ fontSize: 12, color: s.warn ? 'var(--accent)' : 'var(--ink-soft)' }}>{s.pct}%</span>
                </div>
                <div className="bar"><i className={s.warn ? 'accent' : ''} style={{ width: `${s.pct}%` }} /></div>
              </div>
              <span className="t-mono" style={{ fontSize: 11, width: 28, textAlign: 'right', color: s.delta.startsWith('−') ? 'var(--accent)' : s.delta === '—' ? 'var(--ink-mute)' : 'var(--ok)' }}>{s.delta}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: 18, background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 26 }}>🔥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>12-day streak — but no pressure.</div>
            <div className="t-small" style={{ marginTop: 2 }}>missing a day won't reset anything. consistency is the only metric we care about.</div>
          </div>
        </div>

        {/* Read entry-point — connects external reading to the drill pipeline */}
        <div style={{
          marginTop: 14, padding: '20px 22px',
          background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)',
          display: 'flex', alignItems: 'center', gap: 18, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 'var(--r-md)',
            background: 'var(--accent-soft)', color: 'var(--accent-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3z" /><path d="M21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span className="t-display-s" style={{ fontSize: 18 }}>reading something this week?</span>
              <span className="chip accent" style={{ fontSize: 10 }}>new</span>
            </div>
            <div className="t-small">paste a paragraph — i'll mark words above your level and weave them into your next session.</div>
          </div>
          <button className="btn primary" onClick={() => onNav('read')}>open reader →</button>
        </div>
      </div>
    </AppShell>
  );
}

Object.assign(window, { DashHiFi });
