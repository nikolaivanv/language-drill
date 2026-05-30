// Mobile-web leech intervention — bottom sheet over a faded cloze session.
// On phone the desktop modal becomes a bottom sheet (MWSheet pattern).

function MWLeechSheet({ onNav }) {
  return (
    <MWShell variant="drill" lang="es" title="review · 4/12" onBack={() => onNav('review')}
      actionBar={<><div style={{ flex: 1 }}><div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>item 4 of 12</div></div><button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px', opacity: 0.4 }} disabled>check ↵</button></>}>
      {/* faded session behind */}
      <div style={{ opacity: 0.32, pointerEvents: 'none' }}>
        <div className="mw-section tight" style={{ paddingTop: 14 }}>
          <ItemTypeChip kind="cloze" />
          <h2 className="mw-h2" style={{ marginTop: 10 }}>type the form that fits.</h2>
        </div>
        <div className="mw-section tight" style={{ paddingTop: 8 }}>
          <div className="card" style={{ padding: '18px 16px' }}>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.5 }}>
              Un buen diccionario es <span style={{ borderBottom: '2px solid var(--ink)', minWidth: 80, display: 'inline-block', padding: '0 6px' }}>&nbsp;</span> para aprender una lengua.
            </div>
          </div>
        </div>
      </div>

      {/* sheet */}
      <MWSheet onClose={() => {}}>
        {/* warning band */}
        <div style={{ background: 'var(--accent-soft)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--accent-2)" strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M8 1.5l2 4 4.5.7-3.3 3.2.8 4.6L8 11.8 3.9 14l.8-4.6L1.5 6.2 6 5.5z" /></svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent-2)' }}>leech detected</div>
            <div className="t-small" style={{ fontSize: 11, color: 'var(--accent-2)' }}>4th lapse in a row. let's try something different.</div>
          </div>
        </div>

        <div style={{ padding: '18px 18px 22px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
            <h2 className="mw-h2">imprescindible</h2>
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>4 lapses · 0.4d</span>
          </div>
          <div className="t-small" style={{ fontSize: 12, marginBottom: 16 }}>essential, indispensable · B2 adj.</div>

          <div className="rv-h" style={{ marginBottom: 8 }}>pick a rescue path</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <MWRescueOption tag="alt item type" title="recognition first" desc='4-way recognition — lower the bar, rebuild the link, return to production tomorrow.' recommended />
            <MWRescueOption tag="mnemonic" title="generate a mnemonic" desc='claude builds a memory hook from the root "prescindir" (to do without).' />
            <MWRescueOption tag="reset" title="reset SR state · relearn" desc='wipe FSRS state, re-introduce as new. nuclear option.' />
            <MWRescueOption tag="park it" title="suspend for 30 days" desc="re-surface in a month or when you read it next." />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
            <button className="btn accent lg" style={{ width: '100%', justifyContent: 'center', padding: '13px' }}>start recognition rescue</button>
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'center', color: 'var(--ink-mute)' }}>continue with cloze anyway</button>
          </div>
        </div>
      </MWSheet>
    </MWShell>
  );
}

function MWRescueOption({ tag, title, desc, recommended }) {
  return (
    <button style={{ width: '100%', textAlign: 'left', background: recommended ? 'var(--hilite-soft)' : 'var(--card)', border: `1px solid ${recommended ? 'var(--hilite)' : 'var(--rule)'}`, borderRadius: 'var(--r-md)', padding: '12px 13px', display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer', color: 'var(--ink)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span className="rv-h" style={{ marginBottom: 0, color: recommended ? 'var(--accent-2)' : 'var(--ink-mute)' }}>{tag}</span>
          {recommended && <span className="chip accent" style={{ fontSize: 9, padding: '1px 5px' }}>recommended</span>}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div>
      </div>
      <span style={{ color: 'var(--ink-mute)', fontSize: 16 }}>›</span>
    </button>
  );
}

Object.assign(window, { MWLeechSheet });
