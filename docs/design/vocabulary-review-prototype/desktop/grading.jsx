// Inline grading panels — shown after the learner submits.
// One nudges three things: scheduler, vocab depth, grammar-point map.

function GradingClaude() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-aprovechar');
  return (
    <RvFrame current="review" lang="es">
      <SessionHeader idx={7} total={12} lang="español" type="useit" timer="1m 12s" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        <div>
          <div className="t-micro">graded · claude-eval pipeline · 1.2s</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 14px' }}>natural — with one small thing.</h2>

          {/* Their answer with inline annotations */}
          <div className="card" style={{ padding: '24px 28px', borderColor: 'var(--ok)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="rv-h">your sentence</div>
              <span className="chip ok">+0.85 · good</span>
            </div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 24, lineHeight: 1.5, marginTop: 8 }}>
              Voy a <span style={{ background: 'var(--ok-soft)', padding: '0 4px', borderRadius: 3, borderBottom: '2px solid var(--ok)' }}>aprovechar</span> el sol antes de que <span style={{ background: 'var(--hilite-soft)', padding: '0 4px', borderRadius: 3, borderBottom: '2px dashed var(--hilite)' }}>llueva</span>.
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--rule)', display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 12 }}>
              <span className="rv-h">lemma used</span>
              <span>aprovechar (infinitive after <code style={{ fontFamily: 'var(--t-mono)' }}>voy a</code>) ✓</span>
              <span className="rv-h">grammar</span>
              <span>correct. <em>antes de que + subjuntivo</em> — nice touch.</span>
              <span className="rv-h">naturalness</span>
              <span>9/10. native-sounding. "aprovechar el sol" is a real collocation.</span>
              <span className="rv-h">register</span>
              <span>neutral · ok.</span>
            </div>
          </div>

          {/* The mapping — made visible */}
          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <MappingCard
              title="eval JSON"
              body={
                <pre style={{ margin: 0, fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{`{
  "correctness": 1.0,
  "naturalness": 0.9,
  "uses_lemma": true,
  "errors": [],
  "notes": "minor:
   no errors"
}`}</pre>
              }
            />
            <MappingCard
              title="FSRS rating"
              body={
                <div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {[
                      { l: 'Again', a: false },
                      { l: 'Hard',  a: false },
                      { l: 'Good',  a: true },
                      { l: 'Easy',  a: false },
                    ].map((r) => (
                      <div key={r.l} style={{
                        flex: 1, textAlign: 'center', padding: '8px 0',
                        borderRadius: 6, fontSize: 11,
                        background: r.a ? 'var(--ink)' : 'var(--paper-2)',
                        color: r.a ? 'var(--paper)' : 'var(--ink-mute)',
                        fontWeight: r.a ? 600 : 400,
                      }}>{r.l}</div>
                    ))}
                  </div>
                  <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>
                    correctness ≥ 0.85 + uses_lemma → <strong>Good</strong>. perfect would be Easy.
                  </div>
                </div>
              }
            />
            <MappingCard
              title="scheduler delta"
              body={
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', rowGap: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--ink-mute)' }}>interval</span>
                    <span><span className="t-mono" style={{ color: 'var(--ink-mute)' }}>11d</span> → <strong className="t-mono">18d</strong></span>
                    <span style={{ color: 'var(--ink-mute)' }}>stability</span>
                    <span><span className="t-mono">12.5</span> → <span className="t-mono" style={{ color: 'var(--ok)' }}>17.8</span></span>
                    <span style={{ color: 'var(--ink-mute)' }}>difficulty</span>
                    <span><span className="t-mono">4.2</span> → <span className="t-mono">4.1</span></span>
                    <span style={{ color: 'var(--ink-mute)' }}>status</span>
                    <span><StatusPill kind="mature" /></span>
                  </div>
                </div>
              }
            />
          </div>

          {/* Grammar point + competency movement */}
          <div style={{ marginTop: 22, padding: 18, background: 'var(--paper-2)', borderRadius: 'var(--r-md)' }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>also moved · review advances the radar</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <DeltaPill label="preterite (regular -ar)" from={78} to={80} />
              <DeltaPill label="antes de que + subj." from={55} to={62} note="bonus" />
              <DeltaPill label="vocabulary depth · B2" from={62} to={63} small />
            </div>
            <div className="t-small" style={{ marginTop: 12, fontSize: 11 }}>
              error annotations from the eval are the signal — perfect production bumps the points <em>used</em>; flaws bump them down.
            </div>
          </div>

          <Kbar
            left={<><span className="kbd">↵</span> next · <span className="kbd">esc</span> save & exit</>}
            right={<button className="btn primary lg">next item →</button>}
          />
        </div>

        {/* Right rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            this is the production rep i wanted from you. the only thing i'd nudge: register-wise, "voy a aprovechar" is fine but more native sounds like "voy a aprovechar que…" — that's a B2.5 trick. saving that pattern for next month.
          </Coach>
          <div className="card" style={{ padding: 14, background: 'var(--ok-soft)', borderColor: 'var(--ok)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rv-tick ok">✓</span>
              <span style={{ fontWeight: 500 }}>promoted to mature</span>
            </div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 6 }}>2 clean production reps → <em>aprovechar</em> moves out of learning. you'll see it again in ~18d.</div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

function MappingCard({ title, body }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="rv-h" style={{ marginBottom: 8 }}>{title}</div>
      {body}
    </div>
  );
}

function DeltaPill({ label, from, to, small, note }) {
  const down = to < from;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: small ? '4px 10px' : '6px 12px',
      background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 999, fontSize: 12,
    }}>
      <span>{label}</span>
      <span className="t-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>{from}%</span>
      <span style={{ color: down ? 'var(--accent)' : 'var(--ok)' }}>{down ? '↓' : '↑'}</span>
      <span className="t-mono" style={{ color: down ? 'var(--accent)' : 'var(--ok)', fontSize: 12, fontWeight: 600 }}>{to}%</span>
      {note && <span className="chip accent" style={{ fontSize: 10, padding: '1px 6px' }}>{note}</span>}
    </div>
  );
}

// ─── Local grading (cloze) — instant, free path ─────────────────
function GradingLocal() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');
  const occ = lemma.occurrences[0];
  return (
    <RvFrame current="review" lang="tr">
      <SessionHeader idx={4} total={12} lang="türkçe" type="cloze" timer="19s" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        <div>
          <div className="t-micro">graded · local · 12ms</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 14px' }}>exact match.</h2>

          <div className="card" style={{ padding: '28px 32px', borderColor: 'var(--ok)' }}>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 26, lineHeight: 1.5 }}>
              Çocuklar okula gitmek için <span style={{ background: 'var(--ok-soft)', padding: '2px 8px', borderRadius: 4, borderBottom: '2px solid var(--ok)', fontFamily: 'var(--t-mono)', fontWeight: 600 }}>evlerinden</span> erkenden çıkarlar.
            </div>
            <div className="t-small" style={{ marginTop: 10, fontStyle: 'italic' }}>{occ.translation}</div>

            <div style={{ marginTop: 18, padding: 14, background: 'var(--paper-2)', borderRadius: 6 }}>
              <div className="rv-h" style={{ marginBottom: 8 }}>you decoded</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {occ.morphology.map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span style={{ color: 'var(--ink-mute)' }}>+</span>}
                    <div style={{ padding: '4px 9px', border: '1px solid var(--rule)', borderRadius: 5, background: 'var(--card)' }}>
                      <div className="t-mono" style={{ fontSize: 12 }}>{m.p}</div>
                      <div className="t-small" style={{ fontSize: 10 }}>{m.r}</div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* Mapping row */}
          <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <MappingCard
              title="rating"
              body={
                <div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[
                      { l: 'Again', a: false },
                      { l: 'Hard',  a: false },
                      { l: 'Good',  a: true },
                      { l: 'Easy',  a: false },
                    ].map((r) => (
                      <div key={r.l} style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 6, fontSize: 11, background: r.a ? 'var(--ink)' : 'var(--paper-2)', color: r.a ? 'var(--paper)' : 'var(--ink-mute)', fontWeight: r.a ? 600 : 400 }}>{r.l}</div>
                    ))}
                  </div>
                  <div className="t-small" style={{ fontSize: 11, marginTop: 8 }}>local rule: exact → Good. no claude call.</div>
                </div>
              }
            />
            <MappingCard
              title="scheduler delta"
              body={
                <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', rowGap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--ink-mute)' }}>interval</span>
                  <span><span className="t-mono" style={{ color: 'var(--ink-mute)' }}>4d</span> → <strong className="t-mono">8d</strong></span>
                  <span style={{ color: 'var(--ink-mute)' }}>stability</span>
                  <span><span className="t-mono">4.2</span> → <span className="t-mono" style={{ color: 'var(--ok)' }}>7.1</span></span>
                  <span style={{ color: 'var(--ink-mute)' }}>state</span>
                  <span><StatusPill kind="learning" /> → <StatusPill kind="learning" /></span>
                </div>
              }
            />
          </div>

          <div style={{ marginTop: 22, padding: 18, background: 'var(--paper-2)', borderRadius: 'var(--r-md)' }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>moved on the radar</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <DeltaPill label="ablative case (-den)" from={62} to={71} />
              <DeltaPill label="3p possessive (-i)"  from={48} to={52} />
              <DeltaPill label="plural -ler"          from={71} to={73} small />
            </div>
          </div>

          <Kbar
            left={<><span className="kbd">↵</span> next</>}
            right={<button className="btn primary lg">next item →</button>}
          />
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            you nailed all five morphemes in one shot. that's the difference between knowing <em>ev</em> and knowing <em>evlerinden</em>.
          </Coach>
          <div className="card" style={{ padding: 14, background: 'var(--hilite-soft)' }}>
            <div className="rv-h" style={{ marginBottom: 6, color: 'var(--ink)' }}>fork in the road</div>
            <div className="t-small" style={{ fontSize: 12 }}>
              this card stays in <strong>learning</strong> — needs one more clean cycle before going mature. next session you'll likely see <em>eve</em> or <em>evler</em> instead, same lemma, different occurrence.
            </div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.GradingClaude = GradingClaude;
window.GradingLocal = GradingLocal;
