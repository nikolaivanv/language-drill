// Mobile-web review hub — reflow of review/hub.jsx for ~402px.
// Scoped to the language picked in the shell (single source of truth — no in-page lang tabs).
// tabbar variant · "review" tab active.

function MWReviewHub({ onNav, empty }) {
  const Q = window.RV.QUEUE.es;
  const showEmpty = empty || Q.total === 0;
  const totalDue = Q.due + Q.new + Q.leech;
  const colors = { cloze: '#b15535', meaning: '#c8a13a', useit: '#5b8a5a', recog: '#8a8074', listen: '#3b6790' };
  const mixTotal = Object.values(Q.mix).reduce((a, b) => a + b, 0);

  return (
    <MWShell current="review" onNav={onNav} lang="es">
      {/* headline */}
      <div className="mw-section" style={{ paddingTop: 20 }}>
        <div className="t-micro">tue 9:14 · spaced review · español</div>
        <h1 className="mw-h1" style={{ marginTop: 6 }}>{showEmpty ? 'all caught up.' : 'time to review.'}</h1>
        <p className="t-body" style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
          {showEmpty
            ? <>nothing's due. the scheduler will <span className="hilite">surface words on their own schedule</span> — coming back too soon hurts retention.</>
            : <><span className="hilite">{totalDue}</span> items, scaled by FSRS maturity. switch languages from the picker above.</>}
        </p>
      </div>

      {!showEmpty && (
        <>
          {/* big primary CTA — the most important thing on mobile */}
          <div className="mw-section tight" style={{ paddingTop: 6 }}>
            <button className="btn primary lg" style={{ width: '100%', justifyContent: 'space-between', padding: '16px 18px', fontSize: 15 }}>
              <span>start review →</span>
              <span className="t-mono" style={{ fontSize: 11, opacity: 0.75 }}>{totalDue} items · ~12 min</span>
            </button>
          </div>

          {/* queue breakdown — 3 inline stats */}
          <div className="mw-section tight" style={{ paddingTop: 14 }}>
            <div className="card" style={{ padding: '16px 16px 14px' }}>
              <div className="t-micro" style={{ marginBottom: 10 }}>today's queue</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <MWStat n={Q.due} label="due" sub="scheduled" color="var(--ink)" />
                <div style={{ width: 1, background: 'var(--rule)' }} />
                <MWStat n={Q.new} label="new" sub="cap 5/day" color="var(--accent)" />
                <div style={{ width: 1, background: 'var(--rule)' }} />
                <MWStat n={Q.leech} label="leeches" sub={Q.leech ? 'lapsed ≥3' : 'none'} color={Q.leech ? 'var(--accent-2)' : 'var(--ink-mute)'} />
              </div>

              {/* item-type mix */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--rule)' }}>
                <div className="rv-h" style={{ marginBottom: 8 }}>item-type mix</div>
                <div style={{ display: 'flex', height: 9, borderRadius: 999, overflow: 'hidden', background: 'var(--paper-3)', marginBottom: 10 }}>
                  {Object.entries(Q.mix).map(([k, v]) => v > 0 && (
                    <div key={k} style={{ background: colors[k], width: `${(v / mixTotal) * 100}%` }} />
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(Q.mix).map(([k, v]) => v > 0 && (
                    <ItemTypeChip key={k} kind={k} label={`${k === 'recog' ? 'recognition' : k === 'useit' ? '"use it"' : k === 'meaning' ? 'meaning' : k} · ${v}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* coach */}
          <div className="mw-section tight" style={{ paddingTop: 14 }}>
            <MWCoachCard>
              your <strong>ablative case</strong> is at 62% — i seeded two cloze items to push it. <em>imprescindible</em> just hit four lapses; i'll switch its item type today before it fossilizes.
            </MWCoachCard>
          </div>

          {/* focused subsets */}
          <div className="mw-section tight" style={{ paddingTop: 16 }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>or start a focused subset</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MWSubsetRow icon="leech" label={`just leeches (${Q.leech})`} note="rescue mode · alt item types" disabled={!Q.leech} />
              <MWSubsetRow icon="passage" label="words from a saved passage" note="review only a reading's words" />
              <MWSubsetRow icon="grammar" label="by grammar point" note='e.g. "ablative case" · 6 words' />
              <MWSubsetRow icon="new" label="new intake only" note={`${Q.new} brand-new lemmas`} disabled={!Q.new} />
            </div>
          </div>

          {/* cost / meta */}
          <div className="mw-section tight" style={{ paddingTop: 16, paddingBottom: 24 }}>
            <div style={{ border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <MWMetaRow k="est. session length" v="~12 min" />
              <MWMetaRow k="claude-graded items" v="3 · ~$0.02" />
              <MWMetaRow k="grammar points likely to move" v="~6" />
            </div>
          </div>
        </>
      )}

      {showEmpty && (
        <>
          <div className="mw-section tight" style={{ paddingTop: 10 }}>
            <div className="card" style={{ padding: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 6 }}>𓊝</div>
              <div className="mw-h2" style={{ marginBottom: 6 }}>queue empty.</div>
              <div className="t-body" style={{ fontSize: 13, marginBottom: 16 }}>next batch surfaces in <strong>6 hours</strong>. don't force it — over-reviewing is the most common SRS mistake.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn" style={{ width: '100%', justifyContent: 'center' }}>browse vocabulary →</button>
                <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onNav && onNav('read')}>read something →</button>
              </div>
            </div>
          </div>
          <div className="mw-section tight" style={{ paddingTop: 16, paddingBottom: 24 }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>upcoming · next 72h</div>
            <div className="card" style={{ padding: '4px 14px' }}>
              {[
                { lemma: 'aprovechar', when: 'in 6h', type: 'useit' },
                { lemma: 'apenas', when: 'tmr 9am', type: 'meaning' },
                { lemma: 'madrugada', when: 'tmr 3pm', type: 'cloze' },
                { lemma: 'echar de menos', when: 'thu 9am', type: 'useit' },
              ].map((u, i, arr) => (
                <div key={u.lemma} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px dashed var(--rule)' : 'none' }}>
                  <span style={{ fontFamily: 'var(--t-display)', fontSize: 16, flex: 1 }}>{u.lemma}</span>
                  <ItemTypeChip kind={u.type} />
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', width: 56, textAlign: 'right' }}>{u.when}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </MWShell>
  );
}

function MWStat({ n, label, sub, color }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--t-display)', fontSize: 34, lineHeight: 1, color, letterSpacing: -0.5 }}>{n}</div>
      <div style={{ fontSize: 12, fontWeight: 500, marginTop: 4 }}>{label}</div>
      <div className="t-small" style={{ fontSize: 10, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function MWMetaRow({ k, v }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="t-small" style={{ fontSize: 12 }}>{k}</span>
      <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{v}</span>
    </div>
  );
}

function MWCoachCard({ children, avatar = 'c' }) {
  return (
    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: '11px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-display)', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{avatar}</div>
      <div className="t-body" style={{ flex: 1, fontSize: 12, lineHeight: 1.5, margin: 0, color: 'var(--ink-2)' }}>{children}</div>
    </div>
  );
}

function MWSubsetRow({ icon, label, note, disabled }) {
  const ic = {
    leech: <path d="M8 1.5l2 4 4.5.7-3.3 3.2.8 4.6L8 11.8 3.9 14l.8-4.6L1.5 6.2 6 5.5z" />,
    passage: <><path d="M2.5 3.5h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5h-4.5z" /><path d="M13.5 3.5h-4a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5h4.5z" /></>,
    grammar: <path d="M3 2.5h7a2 2 0 012 2v9l-2.5-1.5L7 13.5l-2.5-1.5L2 13.5v-9a2 2 0 011-1.5z" />,
    new: <><circle cx="8" cy="8" r="6" /><path d="M8 5v6M5 8h6" /></>,
  };
  return (
    <button disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px',
      border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', background: 'var(--card)',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, textAlign: 'left', width: '100%', color: 'var(--ink)',
    }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5">{ic[icon]}</svg>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 1 }}>{note}</div>
      </div>
      <span style={{ color: 'var(--ink-mute)' }}>→</span>
    </button>
  );
}

Object.assign(window, { MWReviewHub, MWCoachCard, MWStat, MWMetaRow });
