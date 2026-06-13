// Free-writing · E. Grading results — 4 IELTS-style criteria + CEFR estimates.

function FwResults() {
  const r = window.FW.result;
  const avg = (r.criteria.reduce((s, c) => s + c.score, 0) / r.criteria.length);

  return (
    <RvFrame current="drill" lang="es">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="t-micro">free writing · graded · claude-eval · {r.gradedMs}ms</div>
        <span className="t-small" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>cost {r.cost}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 32 }}>
        {/* left — scorecard */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="t-micro">overall · estimated writing level</div>
              <h1 className="t-display-l" style={{ margin: '4px 0 0', maxWidth: 560 }}>{r.headline}</h1>
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <CEFRBadge level={r.overallCefr} lg />
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6 }}>{avg.toFixed(2)} avg</div>
            </div>
          </div>

          <p className="t-body-l" style={{ marginTop: 14, maxWidth: 620 }}>{r.summary}</p>

          {/* the four criteria */}
          <div className="card" style={{ marginTop: 22, padding: '8px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 4px' }}>
              <div className="rv-h">criteria · IELTS-style · 0–1 + CEFR</div>
              <span className="t-small" style={{ fontSize: 11 }}>adapted for español</span>
            </div>
            {r.criteria.map((c) => <CriterionRow key={c.id} c={c} />)}
          </div>

          {/* next actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn primary lg">see corrections →</button>
            <button className="btn lg">compare improved version</button>
            <button className="btn ghost lg" style={{ marginLeft: 'auto' }}>write another</button>
          </div>
        </div>

        {/* right — coach + progress impact + readiness */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            this is a real B2 text — clear thesis, a rebutted counterargument, varied connectors. the gap between you and C1 right now is <em>accuracy under pressure</em>, not range. one grammar slip, and it's a familiar one.
          </Coach>

          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>progress impact</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ImpactRow label="Writing macro-skill" from="B2−" to="B2" up />
              <ImpactRow label="condicional · si-clause" from="58%" to="54%" />
              <ImpactRow label="conectores de contraste" from="71%" to="78%" up />
              <ImpactRow label="vocab depth · B2" from="63%" to="64%" up />
            </div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5, paddingTop: 10, borderTop: '1px dashed var(--rule)' }}>
              structures used correctly move up; the missed <em>si</em>-clause nudged the conditional point <span style={{ color: 'var(--accent-2)' }}>down</span>. structures you avoided don't change.
            </div>
          </div>

          <div className="card" style={{ padding: 16, background: 'var(--hilite-soft)', borderColor: 'var(--hilite)' }}>
            <div className="rv-h" style={{ marginBottom: 8, color: 'var(--ink)' }}>exam readiness</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span>DELE B2 · Expresión Escrita</span>
              <span className="t-mono" style={{ fontWeight: 600 }}>72%</span>
            </div>
            <div className="bar" style={{ marginTop: 8 }}><i className="accent" style={{ width: '72%' }} /></div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>exam-style prompts calibrate this prediction directly.</div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

function ImpactRow({ label, from, to, up }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{ flex: 1, color: 'var(--ink-2)' }}>{label}</span>
      <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{from}</span>
      <span style={{ color: up ? 'var(--ok)' : 'var(--accent)' }}>{up ? '↑' : '↓'}</span>
      <span className="t-mono" style={{ fontSize: 12, fontWeight: 600, color: up ? 'var(--ok)' : 'var(--accent)' }}>{to}</span>
    </div>
  );
}

window.FwResults = FwResults;
