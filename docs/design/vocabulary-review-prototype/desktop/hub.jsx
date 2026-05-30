// Review Hub — the new home behind the "review queue" nav item.
// Per-language queues (polyglot — never mixed), item-type mix preview,
// intake controls. Replaces the empty `/review` screen.

function ReviewHub({ empty }) {
  // Active language comes from the left nav — the single source of truth.
  // We never duplicate that switcher here; we just respect the spec's
  // polyglot rule (queues are per-language, never blended).
  const lang = 'es';
  const Q = window.RV.QUEUE[lang];
  const langName = 'español';

  // Empty state: pretend everything is caught up
  const showEmpty = empty || Q.total === 0;

  return (
    <RvFrame current="review" lang={lang}>
      <div className="t-micro">tuesday, 9:14am · spaced review · {langName}</div>
      <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>{showEmpty ? 'all caught up.' : 'time to review.'}</h1>
      <p className="t-body-l" style={{ marginTop: 8, maxWidth: 640 }}>
        {showEmpty ? (
          <>nothing's due in {langName}. the scheduler will <span className="hilite">surface words again on their own schedule</span> — coming back too soon hurts long-term retention.</>
        ) : (
          <>your queue is built per language so context doesn't bleed. <span className="hilite">{Q.due + Q.new + Q.leech}</span> items in this session, scaled by FSRS maturity.</>
        )}
      </p>

      {/* Queue breakdown */}
      {!showEmpty && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginTop: 32 }}>
          {/* Left: numerical breakdown + item-type mix */}
          <div className="card" style={{ padding: 24 }}>
            <div className="t-micro">today's queue · {langName}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 14, marginBottom: 22 }}>
              <BigStat n={Q.due}   label="due reviews"   color="var(--ink)" sub="scheduled by FSRS"/>
              <BigStat n={Q.new}   label="new intake"    color="var(--accent)" sub="cap = 5/day · per lang"/>
              <BigStat n={Q.leech} label="leech rescue"  color={Q.leech ? 'var(--accent-2)' : 'var(--ink-mute)'} sub={Q.leech ? 'lapsed ≥ 3×' : 'none'}/>
            </div>

            <div className="rv-h" style={{ marginBottom: 10 }}>item-type mix</div>
            {/* Stacked bar */}
            {(() => {
              const colors = { cloze: '#b15535', meaning: '#c8a13a', useit: '#5b8a5a', recog: '#8a8074', listen: '#3b6790' };
              const totalMix = Object.values(Q.mix).reduce((a, b) => a + b, 0);
              return (
                <>
                  <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--paper-3)', marginBottom: 14 }}>
                    {Object.entries(Q.mix).map(([k, v]) => v > 0 && (
                      <div key={k} style={{ background: colors[k], width: `${(v/totalMix)*100}%` }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(Q.mix).map(([k, v]) => v > 0 && (
                      <ItemTypeChip key={k} kind={k} label={`${k === 'recog' ? 'recognition' : k === 'useit' ? '"use it"' : k === 'meaning' ? 'meaning → word' : k} · ${v}`} />
                    ))}
                  </div>
                </>
              );
            })()}

            <div style={{ borderTop: '1px dashed var(--rule)', marginTop: 22, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="t-small" style={{ fontSize: 13 }}>est. session length</span>
                <span className="t-mono" style={{ fontSize: 12 }}>~12 min</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="t-small" style={{ fontSize: 13 }}>Claude-graded items</span>
                <span className="t-mono" style={{ fontSize: 12 }}>3 · metered (~$0.02)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="t-small" style={{ fontSize: 13 }}>grammar points likely to move</span>
                <span className="t-mono" style={{ fontSize: 12 }}>~6</span>
              </div>
            </div>
          </div>

          {/* Right: coach reasoning + actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Coach>
              your <strong>ablative case</strong> is at 62% — i seeded two <em>evlerinden</em>-style cloze items to push it. <em>imprescindible</em> just hit four lapses; i'll try a different item type today before it fossilizes.
            </Coach>

            <button className="btn primary lg" style={{ padding: '16px 22px', fontSize: 15, justifyContent: 'space-between' }}>
              <span>start review →</span>
              <span className="t-mono" style={{ fontSize: 11, opacity: 0.75 }}>{Q.due + Q.new + Q.leech} items</span>
            </button>

            <div className="card" style={{ padding: 16 }}>
              <div className="rv-h" style={{ marginBottom: 8 }}>start a focused subset</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SubsetRow icon="leech" label={`just leeches (${Q.leech})`} note="rescue mode · alt item types" disabled={!Q.leech} />
                <SubsetRow icon="passage" label="words from a saved passage" note="link a readEntry → review only its words" />
                <SubsetRow icon="grammar" label="by grammar point" note='e.g. "ablative case" · 6 words' />
                <SubsetRow icon="new" label="new intake only" note={`${Q.new} brand-new lemmas`} disabled={!Q.new} />
              </div>
            </div>

            <div className="t-small" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)' }}>
              <span className="kbd">space</span> start · <span className="kbd">⌘ k</span> jump
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {showEmpty && (
        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>𓊝</div>
            <div className="t-display-s" style={{ marginBottom: 6 }}>queue empty.</div>
            <div className="t-body" style={{ marginBottom: 18 }}>next batch surfaces in <strong>6 hours</strong>. don't force it — over-reviewing is the most common bug in SRS apps.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn">browse vocabulary →</button>
              <button className="btn ghost sm">read something →</button>
            </div>
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>upcoming · next 72h</div>
            {[
              { lemma: 'aprovechar', when: 'in 6h',  type: 'useit' },
              { lemma: 'apenas',     when: 'tomorrow 9am', type: 'meaning' },
              { lemma: 'madrugada',  when: 'tomorrow 3pm', type: 'cloze' },
              { lemma: 'ev',         when: 'wed 9am',  type: 'cloze' },
              { lemma: 'echar de menos', when: 'thu 9am', type: 'useit' },
            ].map((u) => (
              <div key={u.lemma} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px dashed var(--rule)' }}>
                <span style={{ fontFamily: 'var(--t-display)', fontSize: 17, flex: 1 }}>{u.lemma}</span>
                <ItemTypeChip kind={u.type} />
                <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', width: 110, textAlign: 'right' }}>{u.when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </RvFrame>
  );
}

function BigStat({ n, label, color, sub }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--t-display)', fontSize: 48, lineHeight: 1, color, letterSpacing: -1 }}>{n}</div>
      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>{label}</div>
      <div className="t-small" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function SubsetRow({ icon, label, note, disabled }) {
  const ic = {
    leech:    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5l2 4 4.5.7-3.3 3.2.8 4.6L8 11.8 3.9 14l.8-4.6L1.5 6.2 6 5.5z" /></svg>,
    passage:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 3.5h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5h-4.5z" /><path d="M13.5 3.5h-4a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5h4.5z" /></svg>,
    grammar:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2.5h7a2 2 0 012 2v9l-2.5-1.5L7 13.5l-2.5-1.5L2 13.5v-9a2 2 0 011-1.5z" /></svg>,
    new:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path d="M8 5v6M5 8h6" /></svg>,
  };
  return (
    <button disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', background: 'var(--card)',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, textAlign: 'left', width: '100%',
      color: 'var(--ink)',
    }}>
      <span style={{ color: 'var(--ink-soft)', display: 'flex' }}>{ic[icon]}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div className="t-small" style={{ fontSize: 11, marginTop: 1 }}>{note}</div>
      </div>
      <span style={{ color: 'var(--ink-mute)' }}>→</span>
    </button>
  );
}

window.ReviewHub = ReviewHub;
