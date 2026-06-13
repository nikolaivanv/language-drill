// Free-writing · mobile web — flow part 1: hub, brief, composer, unstuck.
// Reuses MWShell + window.FW data + fw-shared helpers (CEFRBadge, ReqRow, etc.)

// Shared drill shell for the free-writing flow (back + sticky action bar, no item progress)
function MWFwShell({ onNav, title, actionBar, children, timer }) {
  return (
    <MWShell variant="drill" lang="es"
      title={title}
      onBack={() => onNav('drill')}
      topRight={timer
        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-soft)', fontSize: 11, paddingRight: 6 }}><MWIcon kind="close" size={14} /></span>
        : <button className="icon-btn" title="save & exit"><MWIcon kind="close" size={16} /></button>}
      actionBar={actionBar}
    >
      {children}
    </MWShell>
  );
}

// ── A. Drill hub ───────────────────────────────────────────────
function MWFwHub({ onNav }) {
  const skills = ['all', 'writing', 'grammar', 'listening', 'reading', 'speaking'];
  return (
    <MWShell current="drill" onNav={onNav} lang="es">
      <div className="mw-section">
        <div className="t-micro">drill · español · B2</div>
        <h1 className="mw-h1" style={{ marginTop: 6 }}>pick a drill.</h1>
        <p className="t-small" style={{ fontSize: 12.5, marginTop: 6 }}>each drill targets a macro-skill. <strong>free writing</strong> is new.</p>
      </div>

      {/* filter chips — horizontal scroll */}
      <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '10px 18px 4px', WebkitOverflowScrolling: 'touch' }}>
        {skills.map((s, i) => (
          <button key={s} className={`chip ${i === 0 ? 'solid' : ''}`} style={{ flexShrink: 0, cursor: 'pointer', fontSize: 12, padding: '5px 12px' }}>{s}</button>
        ))}
      </div>

      {/* featured free-writing card */}
      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div className="fw-drillcard feature" style={{ minHeight: 0 }} onClick={() => onNav('brief')}>
          <span className="chip accent fw-newchip" style={{ fontSize: 10 }}>new</span>
          <div className="ico"><FwIcon kind="write" size={18} /></div>
          <div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 19, marginBottom: 3 }}>Free writing</div>
            <div className="t-small" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Redacta con consigna y restricciones; corrección IELTS de Claude.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span className="fw-skill writing"><span className="dot" />writing macro-skill</span>
            <span className="t-mono" style={{ fontSize: 11, color: 'var(--accent-2)' }}>start →</span>
          </div>
        </div>
      </div>

      {/* the rest, stacked */}
      <div className="mw-section tight" style={{ paddingTop: 6, paddingBottom: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {window.FW.drills.filter(d => !d.feature).map((d) => (
          <div key={d.id} className={`fw-drillcard ${d.soon ? 'soon' : ''}`} style={{ minHeight: 0, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {d.soon && <span className="chip fw-newchip" style={{ fontSize: 10 }}>soon</span>}
            <div className="ico" style={{ flexShrink: 0 }}><FwIcon kind={d.icon} size={18} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 16 }}>{d.name}</div>
              <span className={`fw-skill ${d.skill}`} style={{ fontSize: 10.5 }}><span className="dot" />{d.skill}</span>
            </div>
          </div>
        ))}
      </div>
    </MWShell>
  );
}

// ── B. Prompt brief ────────────────────────────────────────────
function MWFwBrief({ onNav }) {
  const p = window.FW.prompt;
  const [exam, setExam] = React.useState(false);
  const actionBar = (
    <>
      <div style={{ flex: 1 }}>
        <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{exam ? `timed · ${p.minutes} min` : 'untimed'}</div>
        <div className="t-small" style={{ fontSize: 11 }}>{p.length.min}–{p.length.max} palabras</div>
      </div>
      <button className="btn accent lg" style={{ flex: '0 0 52%', justifyContent: 'center', padding: '12px 14px' }} onClick={() => onNav('composer')}>begin →</button>
    </>
  );
  const SpecRow = ({ icon, k, children }) => (
    <div style={{ display: 'flex', gap: 11, padding: '11px 0', borderBottom: '1px dashed var(--rule)' }}>
      <span style={{ color: 'var(--ink-soft)', marginTop: 1, flexShrink: 0 }}><FwIcon kind={icon} size={15} /></span>
      <div style={{ flex: 1 }}>
        <div className="rv-h" style={{ marginBottom: 2, fontSize: 10 }}>{k}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{children}</div>
      </div>
    </div>
  );
  return (
    <MWFwShell onNav={onNav} title="free writing" actionBar={actionBar}>
      <div className="mw-section">
        <span className="fw-skill writing"><span className="dot" />writing</span>
        <h1 className="mw-h1" style={{ fontSize: 28, marginTop: 8 }}>{p.title}</h1>
        <p className="t-body" style={{ fontSize: 13.5, marginTop: 8 }}>{p.task}</p>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div className="card" style={{ padding: '4px 16px' }}>
          <SpecRow icon="list" k="tema">{p.domain}</SpecRow>
          <SpecRow icon="write" k="registro"><span style={{ textTransform: 'capitalize' }}>{p.register}</span> · lector general</SpecRow>
          <SpecRow icon="book" k="longitud"><span className="t-mono">{p.length.min}–{p.length.max}</span> palabras</SpecRow>
          <SpecRow icon="check" k="elementos obligatorios">
            <div style={{ marginTop: 2 }}>
              {p.required.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: 7, padding: '3px 0', alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--accent)' }}>•</span><span style={{ fontSize: 13 }}>{r.label}</span>
                </div>
              ))}
            </div>
          </SpecRow>
        </div>
      </div>

      {/* exam toggle */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: exam ? 'var(--accent-soft)' : 'var(--card)', borderColor: exam ? 'var(--accent)' : 'var(--rule)' }}>
          <span style={{ color: exam ? 'var(--accent-2)' : 'var(--ink-soft)' }}><FwIcon kind="clock" size={17} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>exam simulation</div>
            <div className="t-small" style={{ fontSize: 11.5 }}>{p.minutes}-min countdown · helpers hidden</div>
          </div>
          <button onClick={() => setExam(!exam)} aria-label="toggle exam"
            style={{ width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', background: exam ? 'var(--accent)' : 'var(--paper-3)', position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 3, left: exam ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: 'var(--shadow-1)' }} />
          </button>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 22 }}>
        <Coach>this prompt targets your <strong>B2</strong>. the conditional requirement is deliberate — your <em>si</em>-clauses are still shaky.</Coach>
      </div>
    </MWFwShell>
  );
}

// ── C. Composer ────────────────────────────────────────────────
function MWFwComposer({ onNav }) {
  const p = window.FW.prompt;
  const [text, setText] = React.useState(window.FW_DRAFT_MW);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const actionBar = (
    <>
      <div style={{ flex: 1 }}><WordCounter count={words} min={p.length.min} max={p.length.max} showBar={false} /></div>
      <button className="btn accent lg" style={{ flex: '0 0 46%', justifyContent: 'center', padding: '12px 12px', fontSize: 13 }} onClick={() => onNav('results')}>grade ↵</button>
    </>
  );
  return (
    <MWFwShell onNav={onNav} title="free writing" actionBar={actionBar} timer>
      {/* compact prompt */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, padding: '11px 13px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)' }}>
          <span style={{ color: 'var(--accent)', marginTop: 1 }}><FwIcon kind="write" size={15} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
            <div className="t-small" style={{ fontSize: 11.5 }}>{p.register} · {p.length.min}–{p.length.max} palabras</div>
          </div>
        </div>
      </div>

      {/* editor */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={11}
          style={{ width: '100%', padding: '16px', border: '1.5px solid var(--ink)', borderRadius: 'var(--r-md)', outline: 'none', resize: 'none', background: 'var(--card)', fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.7, color: 'var(--ink)', boxShadow: '0 0 0 3px rgba(26,22,18,0.06)' }} />
      </div>

      {/* required + counter */}
      <div className="mw-section tight" style={{ paddingTop: 10 }}>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="rv-h">required · live</span>
            <span className="chip ok" style={{ fontSize: 10 }}>3 / 3 ✓</span>
          </div>
          {p.required.map((r) => <ReqRow key={r.id} r={r} compact />)}
        </div>
      </div>

      {/* helpers */}
      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 22 }}>
        <div className="t-micro" style={{ marginBottom: 8 }}>stuck?</div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
          <button className="fw-helpbtn" style={{ flexShrink: 0 }} onClick={() => onNav('unstuck')}><span className="ico"><FwIcon kind="list" size={14} /></span>brainstorm</button>
          <button className="fw-helpbtn" style={{ flexShrink: 0 }} onClick={() => onNav('unstuck')}><span className="ico"><FwIcon kind="book" size={14} /></span>vocab boost</button>
          <button className="fw-helpbtn" style={{ flexShrink: 0 }}><span className="ico"><FwIcon kind="write" size={14} /></span>start my paragraph</button>
        </div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 8, color: 'var(--ink-mute)' }}>helpers give ideas, not sentences — a provided opener counts less toward your score.</div>
      </div>
    </MWFwShell>
  );
}

// ── D. Getting unstuck (bottom sheet over composer) ────────────
function MWFwUnstuck({ onNav }) {
  const u = window.FW.unstuck;
  const p = window.FW.prompt;
  const [tab, setTab] = React.useState('brainstorm');
  return (
    <MWFwShell onNav={onNav} title="free writing" timer
      actionBar={<><div style={{ flex: 1 }}><WordCounter count={12} min={p.length.min} max={p.length.max} showBar={false} /></div><button className="btn lg" style={{ flex: '0 0 46%', justifyContent: 'center', opacity: 0.45 }} disabled>grade ↵</button></>}>
      {/* faded composer behind */}
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <div style={{ padding: '16px', border: '1.5px solid var(--rule)', borderRadius: 'var(--r-md)', background: 'var(--card)', minHeight: 120, fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.7, color: 'var(--ink-mute)' }}>
          <span style={{ color: 'var(--ink)' }}>{u.starter}</span><span style={{ fontStyle: 'italic', opacity: 0.5 }}> …continúa.</span>
        </div>
      </div>

      {/* bottom sheet */}
      <MWSheet onClose={() => onNav('composer')} maxHeight="72%">
        <div style={{ padding: '4px 18px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ color: 'var(--accent)' }}><FwIcon kind="spark" size={16} /></span>
            <span className="mw-h3">getting unstuck</span>
            <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => onNav('composer')}><MWIcon kind="close" size={16} /></button>
          </div>

          {/* segmented */}
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--paper-2)', borderRadius: 10, marginBottom: 14 }}>
            {[['brainstorm', 'brainstorm'], ['vocab', 'vocab boost'], ['starter', 'start me off']].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500, background: tab === k ? 'var(--ink)' : 'transparent', color: tab === k ? 'var(--paper)' : 'var(--ink-soft)' }}>{l}</button>
            ))}
          </div>

          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {tab === 'brainstorm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="t-small" style={{ fontSize: 11 }}>ideas, not sentences — you do the writing.</div>
                {u.brainstorm.map((b) => (
                  <div key={b.side}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.tone === 'ok' ? 'var(--ok)' : 'var(--accent)' }} />
                      <span className="rv-h" style={{ marginBottom: 0, color: 'var(--ink)' }}>{b.side}</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-2)' }}>
                      {b.points.map((pt) => <li key={pt}>{pt}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {tab === 'vocab' && (
              <div>
                <div className="t-small" style={{ fontSize: 11, marginBottom: 4 }}>10 useful items for this topic at B2:</div>
                {u.vocab.map((v) => (
                  <div key={v.w} className="fw-vocab-row"><span className="w">{v.w}</span><span className="g">{v.g}</span></div>
                ))}
              </div>
            )}
            {tab === 'starter' && (
              <div>
                <div className="t-small" style={{ fontSize: 11, marginBottom: 10 }}>an opening sentence to continue (counts less toward your score):</div>
                <div className="card" style={{ padding: '16px 18px', fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.6 }}>{u.starter}</div>
                <button className="btn primary lg" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} onClick={() => onNav('composer')}>insert &amp; continue</button>
              </div>
            )}
          </div>
        </div>
      </MWSheet>
    </MWFwShell>
  );
}

// reconstruct the plain draft for the mobile composer
window.FW_DRAFT_MW = `En mi opinión, el trabajo a distancia ofrece más ventajas que inconvenientes. Si las empresas confiaran más en sus empleados, muchas personas serían más productivas en casa. Además, se ahorra mucho tiempo que antes se perdía en el transporte.

Sin embargo, hay quien piensa que trabajar desde casa provoca aislamiento. Es verdad que algunos trabajadores se sienten solos, pero si se organizan reuniones regulares, este problema se podría resolver fácilmente.

Por otro lado, el trabajo a distancia permite conciliar mejor la vida laboral y personal. Si yo tendría la oportunidad, elegiría un modelo híbrido, porque combina lo mejor de los dos mundos.

En conclusión, aunque el trabajo remoto tiene algunos desafíos, creo que sus beneficios son mas importantes.`;

Object.assign(window, { MWFwShell, MWFwHub, MWFwBrief, MWFwComposer, MWFwUnstuck });
