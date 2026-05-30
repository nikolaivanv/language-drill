// Mobile-web grading panels — shown after submit. drill variant.
// Same "one review nudges three things" idea, stacked for narrow width.

function MWRatingRow({ active }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {['Again', 'Hard', 'Good', 'Easy'].map((r) => (
        <div key={r} style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 6, fontSize: 11, background: r === active ? 'var(--ink)' : 'var(--paper-2)', color: r === active ? 'var(--paper)' : 'var(--ink-mute)', fontWeight: r === active ? 600 : 400 }}>{r}</div>
      ))}
    </div>
  );
}

function MWDelta({ label, from, to, note }) {
  const down = to < from;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 999, fontSize: 12 }}>
      <span>{label}</span>
      <span className="t-mono" style={{ color: 'var(--ink-mute)', fontSize: 10 }}>{from}%</span>
      <span style={{ color: down ? 'var(--accent)' : 'var(--ok)' }}>{down ? '↓' : '↑'}</span>
      <span className="t-mono" style={{ color: down ? 'var(--accent)' : 'var(--ok)', fontSize: 12, fontWeight: 600 }}>{to}%</span>
      {note && <span className="chip accent" style={{ fontSize: 9, padding: '1px 5px' }}>{note}</span>}
    </div>
  );
}

// ── Claude-graded (use-it) ──────────────────────────────────────
function MWGradingClaude({ onNav }) {
  const actionBar = (
    <>
      <div style={{ flex: 1 }}>
        <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>item 7 of 12</div>
        <div className="t-small" style={{ fontSize: 11 }}>graded in 1.2s</div>
      </div>
      <button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px' }}>next item →</button>
    </>
  );
  return (
    <MWShell variant="drill" lang="es" title="review · 7/12" onBack={() => onNav('review')} actionBar={actionBar}>
      <div className="mw-section" style={{ paddingTop: 16 }}>
        <div className="t-micro">graded · claude-eval · 1.2s</div>
        <h2 className="mw-h2" style={{ marginTop: 4 }}>natural — one small thing.</h2>
      </div>

      {/* their sentence */}
      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div className="card" style={{ padding: '16px 16px', borderColor: 'var(--ok)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div className="rv-h">your sentence</div>
            <span className="chip ok" style={{ fontSize: 10 }}>+0.85 · good</span>
          </div>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 19, lineHeight: 1.5 }}>
            Voy a <span style={{ background: 'var(--ok-soft)', padding: '0 4px', borderRadius: 3, borderBottom: '2px solid var(--ok)' }}>aprovechar</span> el sol antes de que <span style={{ background: 'var(--hilite-soft)', padding: '0 4px', borderRadius: 3, borderBottom: '2px dashed var(--hilite)' }}>llueva</span>.
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
            <MWGradeLine k="lemma" v="aprovechar · infinitive after voy a ✓" />
            <MWGradeLine k="grammar" v="antes de que + subjuntivo — nice touch ✓" />
            <MWGradeLine k="natural" v="9/10 · 'aprovechar el sol' is a real collocation" />
          </div>
        </div>
      </div>

      {/* mapping: rating + scheduler */}
      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="rv-h" style={{ marginBottom: 8 }}>eval → FSRS rating</div>
          <MWRatingRow active="Good" />
          <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>correctness ≥ 0.85 + uses_lemma → <strong>Good</strong>. perfect would be Easy.</div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)', display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--ink-mute)' }}>interval</span><span><span className="t-mono" style={{ color: 'var(--ink-mute)' }}>11d</span> → <strong className="t-mono">18d</strong></span>
            <span style={{ color: 'var(--ink-mute)' }}>stability</span><span><span className="t-mono">12.5</span> → <span className="t-mono" style={{ color: 'var(--ok)' }}>17.8</span></span>
            <span style={{ color: 'var(--ink-mute)' }}>status</span><span><StatusPill kind="mature" /></span>
          </div>
        </div>
      </div>

      {/* grammar deltas */}
      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--r-md)', padding: '14px 14px' }}>
          <div className="rv-h" style={{ marginBottom: 10 }}>also moved on the radar</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <MWDelta label="preterite -ar" from={78} to={80} />
            <MWDelta label="antes de que + subj." from={55} to={62} note="bonus" />
            <MWDelta label="vocab depth B2" from={62} to={63} />
          </div>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div style={{ background: 'var(--ok-soft)', border: '1px solid var(--ok)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="rv-tick ok">✓</span>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>promoted to mature</div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 2 }}>2 clean production reps → next in ~18d.</div>
          </div>
        </div>
      </div>
    </MWShell>
  );
}

function MWGradeLine({ k, v }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8 }}>
      <span className="rv-h" style={{ marginBottom: 0 }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}

// ── Local-graded (cloze) ────────────────────────────────────────
function MWGradingLocal({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');
  const occ = lemma.occurrences[0];
  const actionBar = (
    <>
      <div style={{ flex: 1 }}>
        <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>item 4 of 12</div>
        <div className="t-small" style={{ fontSize: 11 }}>graded in 12ms · free</div>
      </div>
      <button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px' }}>next item →</button>
    </>
  );
  return (
    <MWShell variant="drill" lang="tr" title="review · 4/12" onBack={() => onNav('review')} actionBar={actionBar}>
      <div className="mw-section" style={{ paddingTop: 16 }}>
        <div className="t-micro">graded · local · 12ms</div>
        <h2 className="mw-h2" style={{ marginTop: 4 }}>exact match.</h2>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div className="card" style={{ padding: '16px', borderColor: 'var(--ok)' }}>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.55 }}>
            Çocuklar okula gitmek için <span style={{ background: 'var(--ok-soft)', padding: '2px 7px', borderRadius: 4, borderBottom: '2px solid var(--ok)', fontFamily: 'var(--t-mono)', fontWeight: 600 }}>evlerinden</span> erkenden çıkarlar.
          </div>
          <div className="t-small" style={{ marginTop: 8, fontStyle: 'italic', fontSize: 12 }}>{occ.translation}</div>
          <div style={{ marginTop: 12, padding: 12, background: 'var(--paper-2)', borderRadius: 6 }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>you decoded</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {occ.morphology.map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: 'var(--ink-mute)' }}>+</span>}
                  <div style={{ padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 5, background: 'var(--card)' }}>
                    <div className="t-mono" style={{ fontSize: 12 }}>{m.p}</div>
                    <div className="t-small" style={{ fontSize: 9 }}>{m.r}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="rv-h" style={{ marginBottom: 8 }}>rating · scheduler</div>
          <MWRatingRow active="Good" />
          <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>local rule: exact → Good. no claude call.</div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)', display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--ink-mute)' }}>interval</span><span><span className="t-mono" style={{ color: 'var(--ink-mute)' }}>4d</span> → <strong className="t-mono">8d</strong></span>
            <span style={{ color: 'var(--ink-mute)' }}>stability</span><span><span className="t-mono">4.2</span> → <span className="t-mono" style={{ color: 'var(--ok)' }}>7.1</span></span>
            <span style={{ color: 'var(--ink-mute)' }}>state</span><span><StatusPill kind="learning" /></span>
          </div>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--r-md)', padding: '14px 14px' }}>
          <div className="rv-h" style={{ marginBottom: 10 }}>moved on the radar</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <MWDelta label="ablative case (-den)" from={62} to={71} />
            <MWDelta label="3p possessive (-i)" from={48} to={52} />
            <MWDelta label="plural -ler" from={71} to={73} />
          </div>
        </div>
      </div>
    </MWShell>
  );
}

Object.assign(window, { MWGradingClaude, MWGradingLocal, MWRatingRow, MWDelta });
