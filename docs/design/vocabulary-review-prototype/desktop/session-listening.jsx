// Listening: Polly plays the sentence, user types it. Phonology rep.

function SessionListening() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-madrugada');
  const occ = lemma.occurrences[0];
  const [input, setInput] = React.useState('Llegamos a las tres de la');
  const [plays, setPlays] = React.useState(2);

  return (
    <RvFrame current="review" lang="es">
      <SessionHeader idx={9} total={12} lang="español" type="listen" timer="18s" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, marginTop: 24 }}>
        <div>
          <div className="t-micro">listening · transcribe the sentence</div>
          <h2 className="t-display-m" style={{ margin: '4px 0 26px' }}>type what you hear.</h2>

          {/* Audio player */}
          <div className="card" style={{ padding: '36px 32px', display: 'flex', alignItems: 'center', gap: 28 }}>
            <button className="rv-audio-bubble">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </button>

            {/* Waveform placeholder */}
            <div style={{ flex: 1 }}>
              <div className="rv-h" style={{ marginBottom: 8 }}>aws polly · neural · es-ES · lupe</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56 }}>
                {Array.from({ length: 64 }).map((_, i) => {
                  const h = 6 + Math.abs(Math.sin(i * 0.31) * 40) + Math.abs(Math.sin(i * 0.07) * 12);
                  const past = i < 24;
                  return <div key={i} style={{
                    width: 3, height: h,
                    background: past ? 'var(--ink)' : 'var(--ink-mute)',
                    opacity: past ? 1 : 0.35, borderRadius: 1,
                  }} />;
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'var(--t-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>
                <span>0:00.8</span>
                <span>played {plays}× · ↻ replay · ½ speed</span>
                <span>0:02.4</span>
              </div>
            </div>
          </div>

          {/* Transcript input */}
          <div style={{ marginTop: 22 }}>
            <div className="rv-h" style={{ marginBottom: 6 }}>your transcription</div>
            <textarea
              className="textarea"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={{ fontSize: 20, fontFamily: 'var(--t-display)', lineHeight: 1.5, padding: '16px 20px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div className="t-small">accents stripped for grading · graded locally</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost sm" onClick={() => setPlays(plays + 1)}>↻ replay</button>
                <button className="btn ghost sm">½ speed</button>
                <button className="btn primary">check ↵</button>
              </div>
            </div>
          </div>

          {/* Reveal-on-fail option */}
          <details style={{ marginTop: 22 }}>
            <summary className="t-small" style={{ cursor: 'pointer', color: 'var(--ink-soft)' }}>
              i can't make it out → reveal sentence (counts as <strong>Again</strong>)
            </summary>
          </details>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Coach>
            <strong>madrugada</strong>'s tricky in fast speech — the <em>-drug-</em> cluster gets swallowed. listening reps prevent the gap where you can <em>read</em> a word but not catch it in conversation.
          </Coach>
          <div className="card" style={{ padding: 16 }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>this card</div>
            <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusPill kind="mature" />
            </div>
            <div className="t-small" style={{ marginTop: 10, fontSize: 11 }}>
              listening reps don't change SR state alone — they feed the <em>listening competency</em> on your progress radar.
            </div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.SessionListening = SessionListening;
