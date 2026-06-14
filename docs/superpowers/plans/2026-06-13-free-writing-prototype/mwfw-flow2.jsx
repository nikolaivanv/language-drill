// Free-writing · mobile web — flow part 2: results, corrections, compare.

// ── E. Grading results ─────────────────────────────────────────
function MWFwResults({ onNav }) {
  const r = window.FW.result;
  const actionBar = (
    <>
      <button className="btn lg" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }} onClick={() => onNav('compare')}>improved</button>
      <button className="btn primary lg" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }} onClick={() => onNav('corrections')}>corrections →</button>
    </>
  );
  return (
    <MWFwShell onNav={onNav} title="results" actionBar={actionBar}>
      <div className="mw-section">
        <div className="t-micro">graded · claude-eval · {r.gradedMs}ms</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="t-micro" style={{ fontSize: 10 }}>estimated writing level</div>
            <h1 className="mw-h1" style={{ fontSize: 26, marginTop: 4 }}>{r.headline}</h1>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0, paddingTop: 14 }}>
            <CEFRBadge level={r.overallCefr} lg />
          </div>
        </div>
        <p className="t-body" style={{ fontSize: 13.5, marginTop: 12 }}>{r.summary}</p>
      </div>

      {/* criteria */}
      <div className="mw-section tight" style={{ paddingTop: 8 }}>
        <div className="card" style={{ padding: '4px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0 2px' }}>
            <span className="rv-h">criteria · IELTS-style</span>
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>0–1 · CEFR</span>
          </div>
          {r.criteria.map((c) => <CriterionRow key={c.id} c={c} />)}
        </div>
      </div>

      {/* progress impact */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="rv-h" style={{ marginBottom: 10 }}>progress impact</div>
          {[['Writing macro-skill', 'B2−', 'B2', true], ['condicional · si-clause', '58%', '54%', false], ['conectores de contraste', '71%', '78%', true], ['vocab depth · B2', '63%', '64%', true]].map(([l, f, t, up]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 0' }}>
              <span style={{ flex: 1, color: 'var(--ink-2)' }}>{l}</span>
              <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{f}</span>
              <span style={{ color: up ? 'var(--ok)' : 'var(--accent)' }}>{up ? '↑' : '↓'}</span>
              <span className="t-mono" style={{ fontSize: 12, fontWeight: 600, color: up ? 'var(--ok)' : 'var(--accent)' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* exam readiness */}
      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 22 }}>
        <div className="card" style={{ padding: '14px 16px', background: 'var(--hilite-soft)', borderColor: 'var(--hilite)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span className="rv-h" style={{ color: 'var(--ink)' }}>DELE B2 · escrita</span>
            <span className="t-mono" style={{ fontWeight: 600 }}>72%</span>
          </div>
          <div className="bar" style={{ marginTop: 8 }}><i className="accent" style={{ width: '72%' }} /></div>
        </div>
      </div>
    </MWFwShell>
  );
}

// ── F. Inline error markup ─────────────────────────────────────
function MWFwCorrections({ onNav }) {
  const [active, setActive] = React.useState(1);
  const errs = window.FW.errors;
  const actionBar = <button className="btn primary lg" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onNav('compare')}>compare improved →</button>;
  return (
    <MWFwShell onNav={onNav} title="corrections" actionBar={actionBar}>
      <div className="mw-section">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <h1 className="mw-h1" style={{ fontSize: 28 }}>3 to fix.</h1>
          <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
            <span className="fw-sev high">1 alta</span><span className="fw-sev med">1 media</span><span className="fw-sev low">1 baja</span>
          </div>
        </div>
        <p className="t-small" style={{ fontSize: 12, marginTop: 6 }}>
          located in your text. <span className="fw-good">highlighted</span> = done well; <span style={{ color: 'var(--ink-mute)', textDecoration: 'line-through', textDecorationColor: 'var(--accent)' }}>struck</span> <span style={{ color: 'var(--ok)', fontWeight: 500 }}>green</span> = the fix.
        </p>
      </div>

      {/* annotated text */}
      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div className="card" style={{ padding: '18px 18px' }}>
          <div className="rv-h" style={{ marginBottom: 12 }}>your text · annotated</div>
          <MarkedProse marked={window.FW.marked} activeErr={active} onErr={setActive} fontSize={16} />
        </div>
      </div>

      {/* error list */}
      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {errs.map((e) => (
          <div key={e.n} className="card" onClick={() => setActive(e.n)} style={{ padding: '13px 15px', borderColor: active === e.n ? 'var(--hilite)' : 'var(--rule)', background: active === e.n ? 'var(--hilite-soft)' : 'var(--card)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span className={`fw-errrow ${e.sev}`} style={{ display: 'contents' }}><span className="num" style={{ width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-mono)', fontSize: 11, fontWeight: 600, color: '#fff', background: e.sev === 'high' ? 'var(--accent)' : e.sev === 'med' ? '#c8a13a' : 'var(--ink-mute)' }}>{e.n}</span></span>
              <span className="fw-etype">{e.type}</span>
              <SevTag sev={e.sev} />
              <span className="t-small" style={{ fontSize: 10, marginLeft: 'auto' }}>{e.where}</span>
            </div>
            <div style={{ fontSize: 15, fontFamily: 'var(--t-display)', marginBottom: 4 }}>
              <span style={{ color: 'var(--ink-mute)', textDecoration: 'line-through', textDecorationColor: 'var(--accent)' }}>{e.old}</span>
              <span style={{ color: 'var(--ink-mute)', margin: '0 6px' }}>→</span>
              <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{e.new}</span>
            </div>
            <div className="t-small" style={{ fontSize: 12, lineHeight: 1.5 }}>{e.note}</div>
          </div>
        ))}
      </div>
    </MWFwShell>
  );
}

// ── G. Compare (stacked: yours, then improved) ─────────────────
function MWFwCompare({ onNav }) {
  const actionBar = <button className="btn primary lg" style={{ flex: 1, justifyContent: 'center' }}>save improvements</button>;
  return (
    <MWFwShell onNav={onNav} title="compare" actionBar={actionBar}>
      <div className="mw-section">
        <h1 className="mw-h1" style={{ fontSize: 28 }}>yours, then better.</h1>
        <p className="t-small" style={{ fontSize: 12.5, marginTop: 6 }}>same argument, lifted toward C1. <span className="fw-add">green</span> marks every upgrade.</p>
      </div>

      {/* yours */}
      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="rv-h">your text</span><CEFRBadge level="B2" /></span>
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>162 palabras</span>
          </div>
          <div style={{ padding: '16px 18px' }}><MarkedProse marked={window.FW.marked} fontSize={15} /></div>
        </div>
      </div>

      {/* improved */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <div className="card" style={{ overflow: 'hidden', borderColor: 'var(--ok)' }}>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--rule)', background: 'var(--ok-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="rv-h" style={{ color: 'var(--ink)' }}>improved</span><CEFRBadge level="C1" /></span>
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-soft)' }}>{window.FW.improvedWordCount} palabras</span>
          </div>
          <div style={{ padding: '16px 18px' }}><ImprovedProse improved={window.FW.improved} fontSize={15} /></div>
        </div>
      </div>

      {/* what changed */}
      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[['precision', ['tendría → tuviera (modo)', 'el transporte → los desplazamientos']], ['range', ['piensa → sostiene', 'provoca → genera', 'pero → no obstante']], ['register', ['organizan → organizaran', 'creo → considero']]].map(([title, items]) => (
          <div key={title} className="card" style={{ padding: '13px 16px' }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>{title}</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it) => (
                <li key={it} style={{ fontSize: 12, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--ok)' }}>↗</span><span style={{ fontFamily: 'var(--t-mono)', fontSize: 11.5, color: 'var(--ink-2)' }}>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </MWFwShell>
  );
}

Object.assign(window, { MWFwResults, MWFwCorrections, MWFwCompare });
