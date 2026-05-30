// "Use it" — produce a FRESH sentence using the lemma. Most productive item.
// Claude-graded (metered). Eval JSON → FSRS Rating.

function SessionUseIt() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-aprovechar');
  const [input, setInput] = React.useState('Aprovecho la mañana para correr.');

  return (
    <RvFrame current="review" lang="es">
      <SessionHeader idx={7} total={12} lang="español" type="useit" timer="42s" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        <div>
          <div className="t-micro">"use it" · free production · claude-graded</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 14px' }}>write a new sentence with <em style={{ fontFamily: 'var(--t-display)', fontStyle: 'italic' }}>{lemma.lemma}</em>.</h2>
          <p className="t-body" style={{ marginBottom: 18, maxWidth: 620 }}>
            don't recycle the sentence we saved it from. correctness + naturalness both count.
          </p>

          {/* Reference: contextual sense & one example */}
          <div className="card" style={{ padding: 18, background: 'var(--paper-2)', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div className="rv-h" style={{ marginBottom: 4 }}>reminder</div>
                <div style={{ fontFamily: 'var(--t-display)', fontSize: 20 }}>{lemma.lemma}</div>
                <div className="t-small" style={{ fontSize: 12, marginTop: 2 }}>{lemma.gloss} · {lemma.pos}</div>
              </div>
              <div style={{ flex: 1.4, borderLeft: '1px solid var(--rule)', paddingLeft: 16 }}>
                <div className="rv-h" style={{ marginBottom: 4 }}>seen as</div>
                <div className="t-body" style={{ fontSize: 13, fontStyle: 'italic' }}>"{lemma.occurrences[0].sentence}"</div>
              </div>
            </div>
          </div>

          {/* Free-text area */}
          <div className="rv-h" style={{ marginBottom: 6 }}>your sentence</div>
          <textarea
            className="textarea"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              fontSize: 22, fontFamily: 'var(--t-display)', lineHeight: 1.4, padding: '18px 22px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <div className="t-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
              <span>uses your lemma · ai-graded · ~$0.006</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost sm">need a prompt?</button>
              <button className="btn primary">grade my sentence ↵</button>
            </div>
          </div>

          {/* Why "use it" matters */}
          <div style={{ marginTop: 28, padding: 16, border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--ink-soft)', flexShrink: 0, marginTop: 2 }}>
              <circle cx="8" cy="8" r="6.5" /><path d="M8 5v4M8 11h.01" />
            </svg>
            <div className="t-small" style={{ fontSize: 12 }}>
              <strong>production over recognition.</strong> reading the word is recognition; <em>using</em> it builds the retrieval path. this item type only appears once a card hits <span className="t-mono" style={{ color: 'var(--ink)' }}>stability ≥ 7d</span> — too early and you'll just fail.
            </div>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            <strong>aprovechar</strong> is mature for you, but you've only ever <em>read</em> it. let's see if you can produce it cold. naturalness matters as much as grammar here.
          </Coach>
          <div className="card" style={{ padding: 16 }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>this card</div>
            <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusPill kind="mature" />
              <span className="t-small" style={{ fontSize: 11 }}>ready for production</span>
            </div>
          </div>
          <div className="card" style={{ padding: 14, background: 'var(--hilite-soft)', borderColor: 'var(--hilite)' }}>
            <div className="rv-h" style={{ marginBottom: 6, color: 'var(--ink)' }}>grading rubric</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
              <li>uses the lemma (any inflection)</li>
              <li>grammatical correctness</li>
              <li>natural register & collocation</li>
              <li>preserves the lemma's meaning</li>
            </ul>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.SessionUseIt = SessionUseIt;
