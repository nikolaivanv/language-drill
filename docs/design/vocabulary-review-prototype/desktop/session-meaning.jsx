// Meaning → production: definition / contextualSense shown, user produces the word.
// Local-gradable when matched against lemma + accepted inflections.

function SessionMeaning() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-apenas');
  const occ = lemma.occurrences[0];
  const [input, setInput] = React.useState('apen');
  const [hint, setHint] = React.useState(0); // 0 none, 1 first letter, 2 syllable count, 3 example w/ blank
  return (
    <RvFrame current="review" lang="es">
      <SessionHeader idx={3} total={12} lang="español" type="meaning" timer="6s" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        <div>
          <div className="t-micro">meaning → production · saved {lemma.fsrs.lastReview} ago</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 18px' }}>what's the word that means…</h2>

          <div className="card" style={{ padding: '32px 34px' }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>contextual sense · from your saved card</div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 30, lineHeight: 1.3, color: 'var(--ink)', fontWeight: 400 }}>
              “{occ.contextualSense}”
            </div>
            <div className="t-body" style={{ marginTop: 10, color: 'var(--ink-soft)' }}>
              {lemma.pos} · {lemma.cefr} · freq #{lemma.freqRank}
            </div>

            {hint >= 1 && (
              <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px dashed var(--rule)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <span className="rv-h">first letter</span>
                  <span style={{ fontFamily: 'var(--t-mono)', fontSize: 22, fontWeight: 600, color: 'var(--accent)' }}>{lemma.lemma[0]}</span>
                  <span style={{ fontFamily: 'var(--t-mono)', color: 'var(--ink-mute)', fontSize: 14 }}>{'·'.repeat(lemma.lemma.length - 1)}</span>
                  <span className="t-mono" style={{ fontSize: 11, marginLeft: 'auto' }}>{lemma.lemma.length} letters</span>
                </div>
                {hint >= 2 && (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span className="rv-h">syllables</span>
                    <span style={{ fontFamily: 'var(--t-mono)', fontSize: 13, color: 'var(--ink-soft)' }}>a · pe · nas</span>
                    <span className="t-mono" style={{ fontSize: 11, marginLeft: 'auto' }}>3 syllables</span>
                  </div>
                )}
                {hint >= 3 && (
                  <div style={{ padding: 12, background: 'var(--paper-2)', borderRadius: 6, marginTop: 4 }}>
                    <div className="rv-h" style={{ marginBottom: 4 }}>blanked example</div>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 16 }}>
                      ___ podía oírlo sobre el ruido.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>your word</div>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="escribe la palabra…"
              style={{ fontSize: 22, fontFamily: 'var(--t-display)', padding: '14px 18px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['á','é','í','ó','ú','ñ'].map((c) => (
                  <button key={c} style={{ width: 26, height: 26, border: '1px solid var(--rule)', background: 'var(--card)', borderRadius: 5, fontFamily: 'var(--t-mono)', fontSize: 12, cursor: 'pointer' }}>{c}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {hint < 3 && (
                  <button className="btn ghost sm" onClick={() => setHint(hint + 1)}>
                    {hint === 0 ? 'hint · first letter' : hint === 1 ? 'hint · syllables' : 'hint · blanked example'}
                  </button>
                )}
                <button className="btn primary">check ↵</button>
              </div>
            </div>
            <div className="t-small" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-mute)' }}>
              hints used taint the rating: 0 → Good/Easy, 1+ → capped at Hard. local-graded.
            </div>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            you saw <strong>apenas</strong> 20 days ago and nailed it 12× in a row — this one's drifting into <em>mature</em>. one more clean rep and i'll stretch the interval to ~6 weeks.
          </Coach>
          <div className="card" style={{ padding: 16 }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>this card</div>
            <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusPill kind="mature" />
              <span className="t-small" style={{ fontSize: 11 }}>22-day stability · next ~32d</span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)' }}>
              <div className="rv-h" style={{ marginBottom: 4 }}>review history</div>
              <Spark history={lemma.history} />
            </div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.SessionMeaning = SessionMeaning;
