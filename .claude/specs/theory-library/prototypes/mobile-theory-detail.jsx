// Mobile-web theory — full-screen sheet from bottom. TOC becomes a top tab strip.
// Content is condensed for narrow viewport. Re-uses window.THEORY from hifi/theory.jsx.

function MWTheory({ onNav, topic = 'subjunctive', sectionId = null }) {
  const T = window.THEORY || {};
  const t = T[topic] || T['subjunctive'] || {
    title: 'el subjuntivo', subtitle: '', cefr: 'B1–B2',
    sections: [{ id: 'stub', title: 'overview', body: <p>(loading…)</p> }],
  };
  const [active, setActive] = React.useState(sectionId || t.sections[0]?.id || 'stub');

  // We're presenting this AS a full-screen sheet; the screen itself is the panel.
  return (
    <div className="mw-root" style={{ background: 'var(--paper)' }}>
      {/* header bar */}
      <header className="mw-topbar" style={{ flexDirection: 'column', alignItems: 'stretch', height: 'auto', padding: '10px 14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-btn" onClick={() => onNav && onNav('dashboard')} title="close">
            <MWIcon kind="close" size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="t-micro" style={{ fontSize: 9 }}>theory · reference</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, fontWeight: 500, letterSpacing: '-0.3px' }}>{t.title}</div>
              <span className="chip" style={{ fontSize: 9, padding: '1px 6px' }}>{t.cefr}</span>
            </div>
          </div>
          <button className="icon-btn" title="topic list" onClick={() => {}}>
            <MWIcon kind="menu" size={18} />
          </button>
        </div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 4, marginLeft: 44, marginBottom: 10, color: 'var(--ink-soft)' }}>{t.subtitle}</div>

        {/* TOC tab strip — horizontal scroll */}
        <div style={{
          display: 'flex', gap: 0, overflowX: 'auto', borderTop: '1px solid var(--rule)',
          margin: '0 -14px', padding: '0 14px', WebkitOverflowScrolling: 'touch',
        }}>
          {t.sections.map((s) => (
            <button key={s.id} onClick={() => setActive(s.id)} style={{
              padding: '10px 12px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${active === s.id ? 'var(--ink)' : 'transparent'}`,
              color: active === s.id ? 'var(--ink)' : 'var(--ink-soft)',
              fontSize: 12, fontWeight: active === s.id ? 500 : 400, whiteSpace: 'nowrap', cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
            }}>{s.title}</button>
          ))}
        </div>
      </header>

      <main className="mw-body" style={{ scrollBehavior: 'smooth' }}>
        <div style={{ padding: '18px 18px 100px' }}>
          {/* Render only the active section to keep things readable on phone */}
          {t.sections.filter((s) => s.id === active).map((s) => (
            <section key={s.id} className="mw-theory-section">
              <h2 className="mw-h2" style={{ marginBottom: 14 }}>{s.title}</h2>
              <div className="mw-theory-content">{s.body}</div>
            </section>
          ))}

          {/* other topics */}
          <div style={{ marginTop: 32, paddingTop: 18, borderTop: '1px dashed var(--rule)' }}>
            <div className="t-micro">other topics</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {Object.entries(T).filter(([k]) => k !== topic).map(([k, v]) => (
                <button key={k} style={{
                  padding: '12px 14px', textAlign: 'left',
                  border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
                  background: 'var(--card)', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{v.title}</div>
                    <div className="t-small" style={{ fontSize: 11 }}>{v.subtitle}</div>
                  </div>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{v.cefr}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* sticky bottom CTA */}
      <div className="mw-actionbar">
        <div className="t-small" style={{ flex: 1, fontSize: 11, color: 'var(--ink-mute)' }}>feel ready?</div>
        <button className="btn primary" style={{ flex: '0 0 60%', justifyContent: 'center', padding: '12px 18px' }} onClick={() => onNav('cloze')}>back to drill →</button>
      </div>

      <style>{`
        .mw-theory-content { font-size: 14px; line-height: 1.6; color: var(--ink-2); }
        .mw-theory-content p { margin: 0 0 12px; }
        .mw-theory-content p:last-child { margin-bottom: 0; }
        .mw-theory-content strong { color: var(--ink); }
        .mw-theory-content em { color: var(--ink); }
        .mw-theory-content .theory-list { padding-left: 18px; margin: 8px 0 14px; }
        .mw-theory-content .theory-list li { margin: 6px 0; font-size: 13px; }
        .mw-theory-content .callout {
          background: var(--paper-2); border-left: 3px solid var(--accent);
          padding: 10px 12px; border-radius: 0 var(--r-sm) var(--r-sm) 0; margin: 14px 0;
          font-size: 13px; color: var(--ink);
        }
        .mw-theory-content .callout.warn { border-color: var(--hilite); background: var(--hilite-soft); }
        .mw-theory-content .theory-table {
          width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px;
          font-family: var(--t-mono);
        }
        .mw-theory-content .theory-table th,
        .mw-theory-content .theory-table td {
          padding: 6px 6px; border-bottom: 1px solid var(--rule); text-align: left;
        }
        .mw-theory-content .theory-table th {
          font-size: 10px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.6px;
          font-family: 'Inter', sans-serif; font-weight: 500;
        }
        .mw-theory-content .theory-table tr:last-child td { border-bottom: none; }
        .mw-theory-content .example {
          background: var(--card); border: 1px solid var(--rule); border-radius: var(--r-md);
          padding: 12px; margin: 10px 0;
        }
        .mw-theory-content .example-es {
          font-family: var(--t-display); font-size: 15px; line-height: 1.5; color: var(--ink); margin-bottom: 4px;
        }
        .mw-theory-content .example-en {
          font-size: 12px; color: var(--ink-soft); font-style: italic; margin-bottom: 6px;
        }
        .mw-theory-content .example-note {
          font-size: 11px; color: var(--ink-mute); padding-top: 6px; border-top: 1px dashed var(--rule); margin-top: 4px;
        }
        .mw-theory-content .t-mono { font-family: var(--t-mono); }
      `}</style>
    </div>
  );
}

// Convenience wrapper for the design canvas — opens MWTheory at a specific section.
function MWTheoryAt({ onNav, topic, sectionId }) {
  return <MWTheory onNav={onNav} topic={topic} sectionId={sectionId} />;
}

Object.assign(window, { MWTheory, MWTheoryAt });
