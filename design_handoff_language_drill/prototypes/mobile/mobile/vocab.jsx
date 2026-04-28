// Mobile vocab recall — definition prompt → type the word
// Shows hint progression and graded state.

function MobileVocab({ state = 'hint' }) {
  // states: 'fresh' | 'hint' | 'graded'

  return (
    <MScreen>
      {/* progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 6px' }}>
        <button style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <div style={{ flex: 1, height: 4, background: M.paper3, borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', background: M.ink, borderRadius: 2 }} />
        </div>
        <span style={{ ...T.mono(11), color: M.inkSoft }}>3/6</span>
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ ...T.micro }}>vocabulary recall</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Chip>verb</Chip>
          <Chip>freq #842</Chip>
          <Chip>B1</Chip>
        </div>
        <div style={{ ...T.display(20), marginTop: 14, lineHeight: 1.4 }}>
          type the word that means…
        </div>
      </div>

      {/* definition card */}
      <div style={{ padding: '14px 20px 0' }}>
        <MCard style={{ padding: 18 }}>
          <div style={{ ...T.micro, marginBottom: 8 }}>definition</div>
          <div style={{ ...T.display(19), color: M.ink, lineHeight: 1.45 }}>
            to take advantage of (an opportunity, time, etc.) — to make good use of
          </div>

          {state !== 'fresh' && (
            <div className="m-fade-in" style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${M.rule}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ ...T.micro }}>first letter</span>
                <span style={{ ...T.mono(20), fontWeight: 700, color: M.accent }}>a</span>
                <span style={{ ...T.mono(13), color: M.inkMute, letterSpacing: 2 }}>· · · · · · · · ·</span>
                <span style={{ ...T.mono(11), color: M.inkMute, marginLeft: 'auto' }}>10 letters</span>
              </div>
              {state === 'graded' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ ...T.micro }}>syllables</span>
                  <span style={{ ...T.mono(13), color: M.inkSoft }}>a · pro · ve · char</span>
                </div>
              )}
            </div>
          )}
        </MCard>
      </div>

      {/* answer */}
      <div style={{ padding: '16px 20px 0', flex: 1 }}>
        <div style={{ ...T.micro, marginBottom: 6 }}>your word</div>
        {state !== 'graded' ? (
          <div style={{
            padding: 14, borderRadius: M.r2,
            background: M.card, border: `1.5px solid ${M.ink}`,
            ...T.display(20), color: M.ink, minHeight: 50,
          }}>
            apro
            <span style={{ display: 'inline-block', width: 2, height: 22, background: M.ink, verticalAlign: 'middle', marginLeft: 1, animation: 'mfade 0.6s infinite alternate' }} />
          </div>
        ) : (
          <div style={{
            padding: 14, borderRadius: M.r2,
            background: M.okSoft, border: `1.5px solid ${M.ok}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 12, background: M.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
            <span style={{ ...T.display(20), flex: 1 }}>aprovechar</span>
            <span style={{ ...T.ui(11, 600), color: M.ok }}>+100% mastery</span>
          </div>
        )}

        {state !== 'graded' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <button style={{
              padding: '6px 12px', borderRadius: 999, background: M.paper2,
              border: `1px solid ${M.rule}`, ...T.ui(12, 500), color: M.ink, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2v4l2.5 1.5" /><circle cx="6" cy="6" r="5" /></svg>
              {state === 'hint' ? 'next hint · syllables' : 'hint · first letter'}
            </button>
            <span style={{ ...T.ui(11), color: M.inkMute }}>{state === 'hint' ? '1 hint used' : 'no hints'}</span>
          </div>
        )}

        {state === 'graded' && (
          <div className="m-fade-in" style={{ marginTop: 14, padding: 14, borderRadius: M.r3, background: M.card, border: `1px solid ${M.rule}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span style={{ ...T.display(22), fontWeight: 500 }}>aprovechar</span>
              <span style={{ ...T.mono(11), color: M.inkSoft }}>/aprobetʃar/</span>
              <span style={{ ...T.ui(11), color: M.inkMute, marginLeft: 'auto', fontStyle: 'italic' }}>verb</span>
            </div>
            <div style={{ ...T.micro, marginBottom: 6 }}>in context</div>
            <div style={{ ...T.ui(13), color: M.ink2, lineHeight: 1.5 }}>
              voy a <b>aprovechar</b> el fin de semana para descansar.
              <div style={{ ...T.ui(11), color: M.inkMute, fontStyle: 'italic' }}>i'll take advantage of the weekend to rest.</div>
            </div>
            <div style={{ ...T.micro, marginTop: 12, marginBottom: 6 }}>commonly confused with</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip>aprobar (to approve)</Chip>
              <Chip>aprovecharse (reflexive)</Chip>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, ...T.ui(12), color: M.inkSoft }}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 4v4l2.5 2" /></svg>
              <span>review in 4 days</span>
            </div>
          </div>
        )}
      </div>

      {/* action bar */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${M.rule}`, display: 'flex', gap: 8, background: M.paper, flexShrink: 0 }}>
        {state !== 'graded' ? (
          <>
            <MBtn variant="bare" size="lg" style={{ flex: 1, color: M.inkMute }}>reveal</MBtn>
            <MBtn variant="primary" size="lg" style={{ flex: 2 }}>check</MBtn>
          </>
        ) : (
          <MBtn variant="primary" size="lg" style={{ width: '100%' }}>next word →</MBtn>
        )}
      </div>

      <CoachFab onClick={() => {}} />
    </MScreen>
  );
}

Object.assign(window, { MobileVocab });
