// Mobile cloze drill — multi-choice and typed mode
// Shared shell: progress bar, prompt card, options/input, action bar, coach FAB

function MobileCloze({ mode = 'choice' }) {
  // mode: 'choice' (multi-choice graded) | 'typed' (graded after submit)

  const sentence_es = 'Cuando llegué a casa, mi hermana ya ___ la cena.';
  const blank_options = ['preparó', 'había preparado', 'preparaba', 'ha preparado'];
  const correct = 'había preparado';

  // for typed mode: show graded state
  const typedInput = 'había preparado';
  const typedGraded = true;

  const [selected, setSelected] = React.useState(correct);
  const [coachOpen, setCoachOpen] = React.useState(false);
  const [theoryOpen, setTheoryOpen] = React.useState(false);
  const graded = mode === 'choice' ? !!selected : typedGraded;

  return (
    <MScreen>
      {/* progress + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 6px' }}>
        <button style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <div style={{ flex: 1, height: 4, background: M.paper3, borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: M.ink, borderRadius: 2 }} />
        </div>
        <span style={{ ...T.mono(11), color: M.inkSoft }}>3/6</span>
      </div>

      {/* prompt section */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ ...T.micro }}>cloze · {mode === 'choice' ? 'multiple choice' : 'type the answer'}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Chip>perfect tenses</Chip>
          <Chip>B1</Chip>
          <Chip>past time</Chip>
        </div>
        <div style={{ ...T.display(20), marginTop: 14, lineHeight: 1.4 }}>
          fill the blank with the right form
        </div>
      </div>

      {/* sentence card */}
      <div style={{ padding: '14px 20px 0' }}>
        <MCard style={{ padding: 18 }}>
          <div style={{ ...T.display(20), color: M.ink, lineHeight: 1.5 }}>
            cuando llegué a casa, mi hermana ya{' '}
            {mode === 'choice' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'baseline',
                minWidth: 110, padding: '0 8px', margin: '0 2px',
                borderBottom: `2px solid ${selected ? (selected === correct ? M.ok : M.accent) : M.ink}`,
                color: selected ? (selected === correct ? M.ok : M.accent) : M.inkMute,
                fontStyle: selected ? 'normal' : 'italic',
                fontFamily: M.fontDisplay,
              }}>
                {selected || '____'}
              </span>
            ) : (
              <span style={{
                display: 'inline-flex', borderBottom: `2px solid ${M.ok}`,
                padding: '0 8px', color: M.ok, fontFamily: M.fontDisplay,
              }}>{typedInput}</span>
            )}
            {' '}la cena.
          </div>
          <div style={{ ...T.ui(13), color: M.inkSoft, marginTop: 10, fontStyle: 'italic' }}>
            "when i got home, my sister had already made dinner."
          </div>
        </MCard>
      </div>

      {/* answer area */}
      <div style={{ padding: '20px 20px 0', flex: 1 }}>
        {mode === 'choice' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...T.micro, marginBottom: 4 }}>tap the right form</div>
            {blank_options.map((opt) => {
              const isSel = selected === opt;
              const isCorrect = opt === correct;
              const showResult = !!selected;
              const bg = !showResult ? M.card
                : (isSel && isCorrect) ? M.okSoft
                : (isSel && !isCorrect) ? M.accentSoft
                : isCorrect ? M.okSoft
                : M.card;
              const border = !showResult ? M.rule
                : (isSel && isCorrect) ? M.ok
                : (isSel && !isCorrect) ? M.accent
                : isCorrect ? M.ok
                : M.rule;
              return (
                <button key={opt}
                  onClick={() => setSelected(opt)}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    padding: '14px 16px', borderRadius: M.r2,
                    background: bg, border: `1.5px solid ${border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  }}>
                  <span style={{ ...T.display(17), color: M.ink }}>{opt}</span>
                  {showResult && isCorrect && (
                    <span style={{ ...T.ui(11, 600), color: M.ok }}>✓ correct</span>
                  )}
                  {showResult && isSel && !isCorrect && (
                    <span style={{ ...T.ui(11, 600), color: M.accent }}>your pick</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            <div style={{ ...T.micro, marginBottom: 8 }}>your answer</div>
            <div style={{
              padding: '14px 16px', borderRadius: M.r2,
              background: M.okSoft, border: `1.5px solid ${M.ok}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 24, height: 24, borderRadius: 12, background: M.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
              <span style={{ ...T.display(18), flex: 1 }}>{typedInput}</span>
              <span style={{ ...T.ui(11, 600), color: M.ok }}>exact</span>
            </div>
          </div>
        )}

        {/* feedback panel after answering */}
        {graded && (
          <div className="m-fade-in" style={{
            marginTop: 16, padding: 14, borderRadius: M.r3,
            background: selected === correct || mode === 'typed' ? M.okSoft : M.accentSoft,
            border: `1px solid ${selected === correct || mode === 'typed' ? M.ok : M.accent}`,
          }}>
            <div style={{ ...T.display(15), marginBottom: 6, color: selected === correct || mode === 'typed' ? '#3d6a3c' : M.accent2 }}>
              {selected === correct || mode === 'typed' ? "right — pluscuamperfecto." : "close, but it's pluscuamperfecto here."}
            </div>
            <div style={{ ...T.ui(13), color: M.ink2, lineHeight: 1.5 }}>
              the cue word is <b>"ya"</b> + a past frame ("cuando llegué"). that signals "had already done" — past-before-past.
            </div>
            <button onClick={() => setTheoryOpen(true)} style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 999,
              background: 'rgba(255,255,255,0.6)', border: `1px solid ${M.rule}`,
              ...T.ui(12, 500), color: M.ink, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="5" /><path d="M6 3v3l2 1" /></svg>
              read more on this rule
            </button>
          </div>
        )}
      </div>

      {/* action bar */}
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${M.rule}`, display: 'flex', gap: 8, background: M.paper, flexShrink: 0 }}>
        <MBtn variant="ghost" size="lg" style={{ flex: 1 }}>hint</MBtn>
        <MBtn variant="primary" size="lg" style={{ flex: 2 }}>
          {graded ? 'next →' : 'check'}
        </MBtn>
      </div>

      <CoachFab onClick={() => setCoachOpen(true)} />
      <MSheet open={coachOpen} onClose={() => setCoachOpen(false)} title="your coach" height={0.55}>
        <div style={{ padding: '4px 20px 20px' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: M.ink, color: M.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', ...T.display(16), fontWeight: 600, flexShrink: 0 }}>c</div>
            <div style={{ flex: 1 }}>
              <div style={{ ...T.ui(13), color: M.ink, lineHeight: 1.5, padding: '8px 12px', background: M.paper2, borderRadius: 14, borderBottomLeftRadius: 4 }}>
                this batch is testing pluscuamperfecto. you got the first two — the trick is spotting "ya" + past frame as a cue. let's see how the next four go.
              </div>
            </div>
          </div>
          <div style={{ ...T.micro, marginTop: 16, marginBottom: 8 }}>session map</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{
                flex: 1, height: 6, borderRadius: 3,
                background: i <= 2 ? M.ok : i === 3 ? M.ink : M.paper3,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...T.ui(11), color: M.inkMute, marginTop: 6 }}>
            <span>2 right</span><span>item 3 — current</span><span>3 to go</span>
          </div>
          <MBtn variant="ghost" size="md" style={{ width: '100%', marginTop: 14 }}>pause session</MBtn>
        </div>
      </MSheet>

      <MSheet open={theoryOpen} onClose={() => setTheoryOpen(false)} title="pluscuamperfecto" height={0.78}>
        <TheoryContent />
      </MSheet>
    </MScreen>
  );
}

function TheoryContent() {
  return (
    <div style={{ padding: '4px 20px 24px' }}>
      <Chip bg={M.paper2}>past · perfect tenses · B1</Chip>
      <p style={{ ...T.ui(14), marginTop: 12, lineHeight: 1.6, color: M.ink2 }}>
        the <b>pluscuamperfecto</b> describes an action completed before another past action. english calls this "past perfect" — "had done."
      </p>
      <div style={{ ...T.micro, marginTop: 14, marginBottom: 6 }}>formula</div>
      <div style={{ padding: 14, background: M.paper2, borderRadius: M.r2 }}>
        <span style={{ ...T.display(16), color: M.accent2 }}>haber</span>
        <span style={{ ...T.ui(13), color: M.inkSoft }}> (in imperfect) + </span>
        <span style={{ ...T.display(16), color: M.accent2 }}>past participle</span>
      </div>
      <div style={{ ...T.micro, marginTop: 14, marginBottom: 6 }}>haber, imperfect</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[
          ['yo', 'había'], ['nosotros', 'habíamos'],
          ['tú', 'habías'], ['vosotros', 'habíais'],
          ['él / ella', 'había'], ['ellos / ellas', 'habían'],
        ].map(([p, c]) => (
          <div key={p} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: M.card, borderRadius: 8, border: `1px solid ${M.rule}` }}>
            <span style={{ ...T.ui(12), color: M.inkSoft }}>{p}</span>
            <span style={{ ...T.mono(13), color: M.ink, fontWeight: 600 }}>{c}</span>
          </div>
        ))}
      </div>
      <div style={{ ...T.micro, marginTop: 16, marginBottom: 6 }}>signal words</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {['ya', 'todavía no', 'cuando + pretérito', 'antes de que', 'nunca'].map(w => (
          <span key={w} style={{ ...T.ui(12, 500), padding: '4px 10px', borderRadius: 999, background: M.hiliteSoft, color: M.ink2 }}>{w}</span>
        ))}
      </div>
      <div style={{ ...T.micro, marginTop: 16, marginBottom: 6 }}>example</div>
      <div style={{ padding: 14, background: M.paper2, borderRadius: M.r2 }}>
        <div style={{ ...T.display(15) }}>cuando llegué, mi hermana ya <b style={{ color: M.accent }}>había preparado</b> la cena.</div>
        <div style={{ ...T.ui(12), color: M.inkSoft, fontStyle: 'italic', marginTop: 4 }}>when i arrived, my sister had already made dinner.</div>
      </div>
    </div>
  );
}

Object.assign(window, { MobileCloze, TheoryContent });
