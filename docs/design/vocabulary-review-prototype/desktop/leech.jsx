// Leech intervention — shown when a card lapses ≥ 3 times.
// Offers a different item type or a mnemonic prompt before the user fossilizes the wrong form.

function LeechModal() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-imprescindible');
  return (
    <RvFrame current="review" lang="es">
      {/* Faded background of the session it sits on top of */}
      <div style={{ opacity: 0.35, pointerEvents: 'none', filter: 'blur(0.5px)' }}>
        <SessionHeader idx={4} total={12} lang="español" type="cloze" timer="32s" />
        <div style={{ marginTop: 24 }}>
          <div className="t-micro">cloze-in-context</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 18px' }}>type the form that fits.</h2>
          <div className="card" style={{ padding: '28px 32px' }}>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 26, lineHeight: 1.4 }}>
              Un buen diccionario es <span style={{ borderBottom: '2px solid var(--ink)', minWidth: 120, display: 'inline-block', padding: '0 6px' }}>&nbsp;</span> para aprender una lengua.
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      <div className="rv-modal-scrim" style={{ position: 'absolute' }}>
        <div className="rv-modal">
          {/* Top warning band */}
          <div style={{ background: 'var(--accent-soft)', padding: '14px 22px', borderBottom: '1px solid var(--accent-soft)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="var(--accent-2)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
              <path d="M8 1.5l2 4 4.5.7-3.3 3.2.8 4.6L8 11.8 3.9 14l.8-4.6L1.5 6.2 6 5.5z" />
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent-2)' }}>leech detected</div>
              <div className="t-small" style={{ fontSize: 11, color: 'var(--accent-2)' }}>4th lapse in a row. let's try something different before this fossilizes.</div>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
              <h2 className="t-display-m" style={{ margin: 0 }}>imprescindible</h2>
              <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>4 lapses · stability 0.4d</span>
            </div>
            <div className="t-small" style={{ fontSize: 13, marginBottom: 18 }}>essential, indispensable · B2 adj. · saved 12d ago</div>

            <div className="rv-h" style={{ marginBottom: 8 }}>pick a rescue path</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <RescueOption
                tag="alt item type"
                title="recognition first — passive before active"
                desc='show "imprescindible → essential" as a 4-way recognition. lower bar, rebuild the link, then we go back to production tomorrow.'
                recommended
              />
              <RescueOption
                tag="mnemonic"
                title="generate a mnemonic"
                desc='claude builds a 1-line memory hook from cognates: "imprescindible = im-PRES(s)-IND-ible · sounds like indispensable · same root, opposite of prescindir (to do without)".'
              />
              <RescueOption
                tag="reset & relearn"
                title="reset SR state · start over"
                desc='wipe FSRS state and re-introduce as new. nuclear option — only if the others fail.'
              />
              <RescueOption
                tag="park it"
                title="suspend for 30 days"
                desc="some words aren't ready. we'll re-surface in a month or when you encounter it while reading."
              />
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button className="btn ghost sm" style={{ color: 'var(--ink-mute)' }}>continue with cloze anyway</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn">do this for all my leeches →</button>
                <button className="btn accent">start recognition rescue</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RvFrame>
  );
}

function RescueOption({ tag, title, desc, recommended }) {
  return (
    <button style={{
      width: '100%', textAlign: 'left', background: recommended ? 'var(--hilite-soft)' : 'var(--card)',
      border: `1px solid ${recommended ? 'var(--hilite)' : 'var(--rule)'}`,
      borderRadius: 'var(--r-md)', padding: '12px 14px',
      display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
      color: 'var(--ink)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span className="rv-h" style={{ marginBottom: 0, color: recommended ? 'var(--accent-2)' : 'var(--ink-mute)' }}>{tag}</span>
          {recommended && <span className="chip accent" style={{ fontSize: 9, padding: '1px 6px' }}>recommended</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 3 }}>{desc}</div>
      </div>
      <span style={{ color: 'var(--ink-mute)', fontSize: 18 }}>›</span>
    </button>
  );
}

window.LeechModal = LeechModal;
