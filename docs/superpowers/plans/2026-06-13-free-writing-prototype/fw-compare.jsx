// Free-writing · G. Side-by-side — original vs. improved version.

function FwCompare() {
  const p = window.FW.prompt;
  return (
    <RvFrame current="drill" lang="es">
      <div className="t-micro" style={{ marginBottom: 4 }}>free writing · compare</div>
      <h1 className="t-display-l" style={{ margin: '2px 0 6px' }}>yours, then better.</h1>
      <p className="t-body" style={{ marginTop: 0, maxWidth: 660 }}>
        the same argument with corrections applied and the language lifted toward C1. <span className="fw-add">green</span> marks every upgrade — a sharper verb, a tighter connector, a more precise collocation.
      </p>

      <div className="fw-compare" style={{ marginTop: 20 }}>
        {/* original */}
        <div className="col">
          <div className="head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rv-h" style={{ marginBottom: 0 }}>your text</span>
              <CEFRBadge level="B2" />
            </div>
            <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>162 palabras</span>
          </div>
          <div className="body">
            <MarkedProse marked={window.FW.marked} fontSize={17} />
          </div>
        </div>

        {/* improved */}
        <div className="col improved">
          <div className="head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rv-h" style={{ marginBottom: 0, color: 'var(--ink)' }}>improved</span>
              <CEFRBadge level="C1" />
            </div>
            <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{window.FW.improvedWordCount} palabras</span>
          </div>
          <div className="body">
            <ImprovedProse improved={window.FW.improved} fontSize={17} />
          </div>
        </div>
      </div>

      {/* what changed + actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 18 }}>
        <ChangeCard title="precision" items={['tendría → tuviera (modo)', 'el transporte → los desplazamientos']} />
        <ChangeCard title="range" items={['piensa → sostiene', 'provoca → genera', 'pero → no obstante']} />
        <ChangeCard title="register" items={['organizan → organizaran', 'reuniones regulares → periódicas', 'creo → considero']} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
        <button className="btn primary lg">save improvements to notebook</button>
        <button className="btn lg">rewrite using these</button>
        <span className="t-small" style={{ marginLeft: 'auto' }}>improved version is a model, not a grade — your score stands on what you wrote.</span>
      </div>
    </RvFrame>
  );
}

function ChangeCard({ title, items }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="rv-h" style={{ marginBottom: 10 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((it) => (
          <li key={it} style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--ok)', flexShrink: 0 }}>↗</span>
            <span style={{ fontFamily: 'var(--t-mono)', fontSize: 11.5 }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

window.FwCompare = FwCompare;
