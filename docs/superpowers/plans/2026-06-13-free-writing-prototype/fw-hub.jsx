// Free-writing · A. Entry from the drill hub.
// The drill picker — Free writing is the new, featured drill type.

function FwHub() {
  const skills = ['all', 'writing', 'grammar', 'listening', 'reading', 'speaking'];
  return (
    <RvFrame current="drill" lang="es">
      <div className="t-micro">drill · español · B2</div>
      <h1 className="t-display-l" style={{ margin: '6px 0 4px' }}>pick a drill.</h1>
      <p className="t-body-l" style={{ marginTop: 0, maxWidth: 560 }}>
        each drill targets a macro-skill. <strong>free writing</strong> is new — one paragraph touches grammar, vocabulary, discourse and register at once.
      </p>

      {/* macro-skill filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '20px 0 22px' }}>
        {skills.map((s, i) => (
          <button key={s} className={`chip ${i === 0 ? 'solid' : ''}`} style={{ cursor: 'pointer', fontSize: 12, padding: '5px 12px' }}>{s}</button>
        ))}
      </div>

      {/* drill grid */}
      <div className="fw-drillgrid">
        {window.FW.drills.map((d) => (
          <div key={d.id} className={`fw-drillcard ${d.feature ? 'feature' : ''} ${d.soon ? 'soon' : ''}`}>
            {d.feature && <span className="chip accent fw-newchip" style={{ fontSize: 10 }}>new</span>}
            {d.soon && <span className="chip fw-newchip" style={{ fontSize: 10 }}>soon</span>}
            <div className="ico"><FwIcon kind={d.icon} size={18} /></div>
            <div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--ink)', marginBottom: 3 }}>{d.name}</div>
              <div className="t-small" style={{ fontSize: 12, lineHeight: 1.45 }}>{d.desc}</div>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className={`fw-skill ${d.skill}`}><span className="dot" />{d.skill}</span>
              {d.feature && <span className="t-mono" style={{ fontSize: 10, color: 'var(--accent-2)' }}>start →</span>}
            </div>
          </div>
        ))}
      </div>

      {/* featured strip */}
      <div className="card" style={{ marginTop: 24, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, borderColor: 'var(--accent)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <FwIcon kind="write" size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--t-display)', fontSize: 20 }}>free writing</span>
            <span className="fw-skill writing"><span className="dot" />writing macro-skill</span>
          </div>
          <p className="t-body" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            you get a prompt with constraints — topic, length, register, required structures. write freely, then Claude grades it on IELTS-style criteria and marks every error in place. <strong>the richest signal in the app.</strong>
          </p>
        </div>
        <button className="btn accent lg" style={{ flexShrink: 0 }}>start free writing →</button>
      </div>
    </RvFrame>
  );
}

window.FwHub = FwHub;
