// Cloze-in-context: blank the word in its saved source sentence.
// "Gold for Turkish — tests morphology, not just the lemma." (per spec)
// We pick one of the lemma's occurrences at random; user types the inflected form.

function SessionCloze() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');
  const occ = lemma.occurrences[0]; // evlerinden
  const [input, setInput] = React.useState('evler');
  const [showMorph, setShowMorph] = React.useState(true);

  const blanked = occ.sentence.replace(occ.surface, '___');

  return (
    <RvFrame current="review" lang="tr">
      {/* Top progress strip */}
      <SessionHeader idx={4} total={12} lang="türkçe" type="cloze" timer="11s" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        {/* Main card */}
        <div>
          <div className="t-micro">cloze-in-context · from your saved sentence</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 18px' }}>type the form that fits.</h2>

          {/* The blanked sentence */}
          <div className="card" style={{ padding: '34px 36px' }}>
            <div className="t-micro" style={{ marginBottom: 6 }}>source · {occ.source}</div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 28, lineHeight: 1.5, color: 'var(--ink)' }}>
              Çocuklar okula gitmek için
              {' '}
              <span className={`rv-cloze-blank ${!input ? 'empty' : ''}`}>{input || ' '}</span>
              {' '}
              erkenden çıkarlar.
            </div>
            <div className="t-small" style={{ marginTop: 8, fontStyle: 'italic' }}>{occ.translation}</div>

            {/* Inline hint: morphology breakdown of the target slot */}
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px dashed var(--rule)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: showMorph ? 12 : 0 }}>
                <div className="rv-h">slot</div>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  lemma <strong style={{ fontFamily: 'var(--t-display)', fontSize: 14 }}>ev</strong> · needs <strong>ablative · plural · 3p-poss</strong>
                </span>
                <span style={{ flex: 1 }} />
                <button className="btn ghost sm" onClick={() => setShowMorph(!showMorph)} style={{ fontSize: 11 }}>
                  {showMorph ? 'hide morphology' : 'show morphology'}
                </button>
              </div>
              {showMorph && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {occ.morphology.map((m, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span style={{ color: 'var(--ink-mute)' }}>+</span>}
                      <div style={{
                        padding: '5px 10px', border: '1px solid var(--rule)', borderRadius: 6,
                        background: i === 0 ? 'var(--paper-2)' : 'var(--card)',
                      }}>
                        <div className="t-mono" style={{ fontSize: 13, color: i === 0 ? 'var(--ink)' : 'var(--accent-2)' }}>{m.p}</div>
                        <div className="t-small" style={{ fontSize: 10, marginTop: 1 }}>{m.r}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Answer input */}
          <div style={{ marginTop: 20 }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>your answer</div>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="type the inflected form…"
              style={{ fontSize: 22, fontFamily: 'var(--t-mono)', padding: '14px 18px', letterSpacing: 0.5 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div className="t-small">
                local-graded · exact match → <strong>Good</strong>, mismatched → <strong>Again</strong>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost sm">i don't know · reveal</button>
                <button className="btn primary">check ↵</button>
              </div>
            </div>
          </div>
        </div>

        {/* Coach rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            this is the cloze-in-context type — you're seeing the <em>exact sentence</em> you saved <strong>ev</strong> from. the lemma we're tracking is <strong>ev</strong>; the form we're testing is whatever the random occurrence demands.
          </Coach>

          <div className="card" style={{ padding: 16 }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>this card · scheduler state</div>
            <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12, color: 'var(--ink-soft)' }}>
              <span>reps {lemma.fsrs.reps}</span>
              <span>lapses {lemma.fsrs.lapses}</span>
              <span>last {lemma.fsrs.lastReview} ago</span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)' }}>
              <div className="rv-h" style={{ marginBottom: 6 }}>also seen as</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {lemma.occurrences.slice(1).map((o) => (
                  <span key={o.surface} className="chip" style={{ fontFamily: 'var(--t-mono)', fontSize: 11 }}>{o.surface}</span>
                ))}
              </div>
              <div className="t-small" style={{ marginTop: 8, fontSize: 11 }}>3 occurrences pooled · cloze picks one per session</div>
            </div>
          </div>

          <div className="card" style={{ padding: 14, background: 'var(--paper-2)' }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>will move</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1 }}>ablative case</span>
              <span className="t-mono" style={{ color: 'var(--ink-mute)' }}>62%</span>
              <span style={{ color: 'var(--ok)' }}>→</span>
              <span className="t-mono" style={{ color: 'var(--ok)' }}>~71%</span>
            </div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 6 }}>correct here bumps your ablative grammar-point.</div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

// Header strip shared by all session item types
function SessionHeader({ idx, total, lang, type, timer }) {
  const typeLabel = { cloze: 'cloze-in-context', meaning: 'meaning → production', useit: '"use it" · free production', listen: 'listening', recog: 'recognition' }[type];
  return (
    <>
      <div style={{ height: 3, background: 'var(--paper-3)', position: 'relative', margin: '-32px -44px 0', marginBottom: 12 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(idx / total) * 100}%`, background: 'var(--accent)', transition: 'width .35s' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <div className="t-micro">review · {lang} · item {idx} of {total}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ItemTypeChip kind={type} />
          <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{timer}</span>
          <button className="btn ghost sm" style={{ fontSize: 11 }}>pause</button>
        </div>
      </div>
    </>
  );
}

window.SessionCloze = SessionCloze;
window.SessionHeader = SessionHeader;
