// Free-writing · C. Composer (writing in progress) + D. Getting unstuck.

const FW_DRAFT = `En mi opinión, el trabajo a distancia ofrece más ventajas que inconvenientes. Si las empresas confiaran más en sus empleados, muchas personas serían más productivas en casa. Además, se ahorra mucho tiempo que antes se perdía en el transporte.

Sin embargo, hay quien piensa que trabajar desde casa provoca aislamiento. Es verdad que algunos trabajadores se sienten solos, pero si se organizan reuniones regulares, este problema se podría resolver fácilmente.

Por otro lado, el trabajo a distancia permite conciliar mejor la vida laboral y personal. Si yo tendría la oportunidad, elegiría un modelo híbrido, porque combina lo mejor de los dos mundos.

En conclusión, aunque el trabajo remoto tiene algunos desafíos, creo que sus beneficios son mas importantes.`;

// Shared drill header strip (no item progress — a single piece of writing)
function FwDrillHead({ timer, saving }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div className="t-micro">free writing · español · B2</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {saving && <span className="t-small" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>guardado ·  borrador</span>}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ink-soft)' }}>
          <FwIcon kind="clock" size={13} /><span className="t-mono" style={{ fontSize: 11 }}>{timer}</span>
        </span>
        <button className="btn ghost sm" style={{ fontSize: 11 }}>save & exit</button>
      </div>
    </div>
  );
}

// ── C. Composer ────────────────────────────────────────────────
function FwComposer() {
  const p = window.FW.prompt;
  const [text, setText] = React.useState(FW_DRAFT);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <RvFrame current="drill" lang="es">
      <FwDrillHead timer="06:12" saving />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28 }}>
        {/* writing column */}
        <div>
          {/* compact prompt banner */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', marginBottom: 16 }}>
            <span style={{ color: 'var(--accent)', marginTop: 1 }}><FwIcon kind="write" size={16} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
              <div className="t-small" style={{ fontSize: 12 }}>{p.register} · {p.length.min}–{p.length.max} palabras · {p.task}</div>
            </div>
            <button className="btn ghost sm" style={{ fontSize: 11, flexShrink: 0 }}>see brief</button>
          </div>

          {/* the editor */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-1)' }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 360, border: 'none', outline: 'none', resize: 'none',
                padding: '26px 30px', background: 'transparent',
                fontFamily: 'var(--t-display)', fontSize: 19, lineHeight: 1.85, color: 'var(--ink)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
              <WordCounter count={words} min={p.length.min} max={p.length.max} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="t-small" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />ai-graded · ~$0.011
                </span>
                <button className="btn accent">grade my writing ↵</button>
              </div>
            </div>
          </div>

          {/* getting-unstuck buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <span className="t-micro" style={{ marginRight: 2 }}>stuck?</span>
            <button className="fw-helpbtn"><span className="ico"><FwIcon kind="list" size={14} /></span>brainstorm</button>
            <button className="fw-helpbtn"><span className="ico"><FwIcon kind="book" size={14} /></span>vocabulary boost</button>
            <button className="fw-helpbtn"><span className="ico"><FwIcon kind="write" size={14} /></span>start my paragraph</button>
            <span className="t-small" style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--ink-mute)' }}>helpers give ideas, not sentences — a provided opener counts less toward your score.</span>
          </div>
        </div>

        {/* right rail — live required checklist + counter */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>required elements · live</div>
            {p.required.map((r) => <ReqRow key={r.id} r={r} compact />)}
            <div className="t-small" style={{ fontSize: 11, marginTop: 10, color: 'var(--ok)' }}>all three present — checked as you type.</div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>length</div>
            <WordCounter count={words} min={p.length.min} max={p.length.max} />
            <div className="t-small" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
              inside the target band. going long won't add marks — concision is part of register.
            </div>
          </div>
          <Coach>
            i can see three <em>si</em>-clauses already. watch the third one — that's exactly where the imperfect-subjunctive trigger usually slips.
          </Coach>
        </aside>
      </div>
    </RvFrame>
  );
}

// ── D. Getting unstuck (helpers open) ──────────────────────────
function FwUnstuck() {
  const u = window.FW.unstuck;
  const p = window.FW.prompt;
  return (
    <RvFrame current="drill" lang="es">
      <FwDrillHead timer="01:48" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 28 }}>
        {/* a barely-started editor */}
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '26px 30px', minHeight: 150, fontFamily: 'var(--t-display)', fontSize: 19, lineHeight: 1.85, color: 'var(--ink-mute)' }}>
              <span style={{ color: 'var(--ink)' }}>{u.starter}</span>
              <span style={{ borderLeft: '2px solid var(--accent)', marginLeft: 2, animation: 'fade 1s steps(2) infinite' }} />
              <span style={{ fontStyle: 'italic', opacity: 0.5 }}> …continúa desde aquí.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
              <WordCounter count={12} min={p.length.min} max={p.length.max} />
              <button className="btn accent" style={{ opacity: 0.45 }} disabled>grade my writing ↵</button>
            </div>
          </div>

          {/* active helper buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <span className="t-micro" style={{ marginRight: 2 }}>stuck?</span>
            <button className="fw-helpbtn" style={{ borderColor: 'var(--ink)', color: 'var(--ink)', background: 'var(--paper-2)' }}><span className="ico"><FwIcon kind="list" size={14} /></span>brainstorm</button>
            <button className="fw-helpbtn" style={{ borderColor: 'var(--ink)', color: 'var(--ink)', background: 'var(--paper-2)' }}><span className="ico"><FwIcon kind="book" size={14} /></span>vocabulary boost</button>
            <button className="fw-helpbtn"><span className="ico"><FwIcon kind="write" size={14} /></span>start my paragraph <span className="chip ok" style={{ fontSize: 9, padding: '0 5px', marginLeft: 2 }}>used</span></button>
          </div>

          {/* brainstorm panel */}
          <div className="fw-helppanel" style={{ marginTop: 18 }}>
            <div className="head">
              <span style={{ color: 'var(--accent)' }}><FwIcon kind="list" size={15} /></span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>brainstorm</span>
              <span className="t-small" style={{ fontSize: 11, marginLeft: 'auto' }}>ideas, not sentences — you do the writing</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {u.brainstorm.map((b, i) => (
                <div key={b.side} style={{ padding: '14px 18px', borderRight: i === 0 ? '1px solid var(--rule)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.tone === 'ok' ? 'var(--ok)' : 'var(--accent)' }} />
                    <span className="rv-h" style={{ marginBottom: 0, color: 'var(--ink)' }}>{b.side}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)' }}>
                    {b.points.map((pt) => <li key={pt}>{pt}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right rail — vocabulary boost */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="fw-helppanel">
            <div className="head">
              <span style={{ color: 'var(--accent)' }}><FwIcon kind="book" size={15} /></span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>vocabulary boost</span>
            </div>
            <div style={{ padding: '6px 16px 12px' }}>
              <div className="t-small" style={{ fontSize: 11, padding: '8px 0 4px' }}>10 useful items for this topic at B2:</div>
              {u.vocab.map((v) => (
                <div key={v.w} className="fw-vocab-row">
                  <span className="w">{v.w}</span>
                  <span className="g">{v.g}</span>
                </div>
              ))}
            </div>
          </div>
          <Coach>
            use these as scaffolding, not a checklist. dropping in <em>no obstante</em> or <em>a largo plazo</em> shows range — but only if they fit your argument.
          </Coach>
        </aside>
      </div>
    </RvFrame>
  );
}

window.FwComposer = FwComposer;
window.FwUnstuck = FwUnstuck;
