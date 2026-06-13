// Free-writing · B. Prompt / brief screen.
// Topic, target length, register, required elements, timer toggle → Begin.

function FwBrief() {
  const p = window.FW.prompt;
  const [exam, setExam] = React.useState(false);

  const SpecRow = ({ icon, k, children }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 0', borderBottom: '1px dashed var(--rule)' }}>
      <span style={{ color: 'var(--ink-soft)', marginTop: 1, flexShrink: 0 }}><FwIcon kind={icon} size={16} /></span>
      <div style={{ flex: 1 }}>
        <div className="rv-h" style={{ marginBottom: 3 }}>{k}</div>
        <div className="t-body" style={{ fontSize: 14, color: 'var(--ink)' }}>{children}</div>
      </div>
    </div>
  );

  return (
    <RvFrame current="drill" lang="es">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <button className="btn ghost sm" style={{ paddingLeft: 8 }}>← drill</button>
        <span className="fw-skill writing"><span className="dot" />writing</span>
      </div>
      <div className="t-micro" style={{ marginTop: 6 }}>free writing · your prompt</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 32, marginTop: 12 }}>
        {/* Left — the brief */}
        <div>
          <h1 className="t-display-l" style={{ margin: '2px 0 8px', maxWidth: 600 }}>{p.title}</h1>
          <p className="t-body-l" style={{ marginTop: 0, maxWidth: 600 }}>{p.task}</p>

          <div className="card" style={{ marginTop: 20, padding: '6px 22px' }}>
            <SpecRow icon="list" k="tema">{p.domain}</SpecRow>
            <SpecRow icon="write" k="registro">
              <span style={{ textTransform: 'capitalize' }}>{p.register}</span>
              <span className="t-small" style={{ marginLeft: 8 }}>— dirígete a un lector general; evita coloquialismos.</span>
            </SpecRow>
            <SpecRow icon="book" k="longitud">
              <span className="t-mono">{p.length.min}–{p.length.max}</span> palabras
            </SpecRow>
            <SpecRow icon="check" k="elementos obligatorios">
              <div style={{ marginTop: 2 }}>
                {p.required.map((r) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
                    <span style={{ color: 'var(--accent)', fontSize: 13 }}>•</span>
                    <span style={{ fontSize: 13.5 }}>{r.label}
                      {r.detail && <span className="t-small" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-mute)' }}>{r.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </SpecRow>
          </div>

          {/* exam mode toggle */}
          <div className="card" style={{ marginTop: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, background: exam ? 'var(--accent-soft)' : 'var(--card)', borderColor: exam ? 'var(--accent)' : 'var(--rule)' }}>
            <span style={{ color: exam ? 'var(--accent-2)' : 'var(--ink-soft)' }}><FwIcon kind="clock" size={18} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>exam simulation</div>
              <div className="t-small" style={{ fontSize: 12 }}>{p.minutes}-minute countdown · helpers hidden · mirrors DELE Expresión Escrita timing.</div>
            </div>
            <button onClick={() => setExam(!exam)} aria-label="toggle exam mode"
              style={{ width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', background: exam ? 'var(--accent)' : 'var(--paper-3)', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 3, left: exam ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: 'var(--shadow-1)' }} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn accent lg">begin writing →</button>
            <button className="btn lg">shuffle prompt</button>
            <span className="t-small" style={{ marginLeft: 'auto' }}>{exam ? `timer on · ${p.minutes} min` : 'untimed · helpers available'}</span>
          </div>
        </div>

        {/* Right rail — coach + what's graded */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            this prompt is calibrated to your <strong>B2</strong>. the conditional requirement is deliberate — you've used <em>si</em>-clauses, but the imperfect-subjunctive trigger is still shaky. let's stress-test it.
          </Coach>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>graded on · IELTS-style</div>
            {['Task achievement', 'Coherence & cohesion', 'Lexical resource', 'Grammatical range & accuracy'].map((c) => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px dashed var(--rule)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                <span style={{ fontSize: 13 }}>{c}</span>
                <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginLeft: 'auto' }}>0–1 · CEFR</span>
              </div>
            ))}
            <div className="t-small" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
              each criterion returns a score and a CEFR estimate. errors are located in your text; an improved version is provided to compare.
            </div>
          </div>
          <div className="card" style={{ padding: 14, background: 'var(--paper-2)' }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>feeds</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Writing CEFR', 'grammar radar', 'vocab depth', 'pragmatics', 'IELTS / DELE readiness'].map((t) => (
                <span key={t} className="chip" style={{ fontSize: 11 }}>{t}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.FwBrief = FwBrief;
