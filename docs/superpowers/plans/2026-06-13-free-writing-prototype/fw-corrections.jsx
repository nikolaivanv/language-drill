// Free-writing · F. Inline error markup — errors located in the text,
// each with type, severity, and correction. Click an error to focus it.

function FwCorrections() {
  const [active, setActive] = React.useState(1);
  const errs = window.FW.errors;
  const counts = { high: errs.filter(e => e.sev === 'high').length, med: errs.filter(e => e.sev === 'med').length, low: errs.filter(e => e.sev === 'low').length };

  return (
    <RvFrame current="drill" lang="es">
      <div className="t-micro" style={{ marginBottom: 4 }}>free writing · corrections</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <h1 className="t-display-l" style={{ margin: '2px 0 0' }}>3 things to fix.</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="fw-sev high">{counts.high} alta</span>
          <span className="fw-sev med" style={{ marginLeft: 6 }}>{counts.med} media</span>
          <span className="fw-sev low" style={{ marginLeft: 6 }}>{counts.low} baja</span>
        </div>
      </div>
      <p className="t-body" style={{ marginTop: 8, maxWidth: 640 }}>
        every error is located in your own text. <span className="fw-good">highlighted</span> spans are things you did well; <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: 'var(--ink-mute)', textDecoration: 'line-through', textDecorationColor: 'var(--accent)' }}>struck</span> <span style={{ color: 'var(--ok)', fontWeight: 500 }}>green</span></span> shows the fix in place.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 32, marginTop: 18 }}>
        {/* marked-up text */}
        <div className="card" style={{ padding: '30px 36px' }}>
          <div className="rv-h" style={{ marginBottom: 14 }}>your text · annotated</div>
          <MarkedProse marked={window.FW.marked} activeErr={active} onErr={setActive} />
        </div>

        {/* error list */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '6px 18px' }}>
            {errs.map((e) => (
              <div key={e.n} className={`fw-errrow ${e.sev}`} onClick={() => setActive(e.n)} style={active === e.n ? { background: 'var(--hilite-soft)', borderRadius: 8, margin: '0 -10px', padding: '13px 10px' } : null}>
                <span className="num">{e.n}</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <span className="fw-etype">{e.type}</span>
                    <SevTag sev={e.sev} />
                    <span className="t-small" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{e.where}</span>
                  </div>
                  <div style={{ fontSize: 14, fontFamily: 'var(--t-display)', marginBottom: 4 }}>
                    <span style={{ color: 'var(--ink-mute)', textDecoration: 'line-through', textDecorationColor: 'var(--accent)' }}>{e.old}</span>
                    <span style={{ color: 'var(--ink-mute)', margin: '0 6px' }}>→</span>
                    <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{e.new}</span>
                  </div>
                  <div className="t-small" style={{ fontSize: 12, lineHeight: 1.5 }}>{e.note}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 14, background: 'var(--paper-2)' }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>what moved on the radar</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className="chip" style={{ fontSize: 11 }}>condicional <span style={{ color: 'var(--accent-2)', marginLeft: 4 }}>↓</span></span>
              <span className="chip" style={{ fontSize: 11 }}>ortografía <span style={{ color: 'var(--ink-mute)', marginLeft: 4 }}>·</span></span>
              <span className="chip" style={{ fontSize: 11 }}>colocación <span style={{ color: 'var(--ink-mute)', marginLeft: 4 }}>·</span></span>
            </div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>only the <em>high</em>-severity mood error changed a mastery score. low/medium are logged but don't move the radar.</div>
          </div>

          <button className="btn primary lg" style={{ width: '100%' }}>compare improved version →</button>
        </aside>
      </div>
    </RvFrame>
  );
}

window.FwCorrections = FwCorrections;
