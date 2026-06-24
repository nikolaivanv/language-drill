// Mobile translation drill — typing-heavy, with virtual keyboard visible

function MobileTranslation({ state = 'typing' }) {
  // states: 'typing' | 'graded'

  return (
    <MScreen>
      {/* progress + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 6px' }}>
        <button style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        </button>
        <div style={{ flex: 1, height: 4, background: M.paper3, borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '33%', background: M.ink, borderRadius: 2 }} />
        </div>
        <span style={{ ...T.mono(11), color: M.inkSoft }}>2/6</span>
      </div>

      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ ...T.micro }}>translate · en → es</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Chip>sentence</Chip>
          <Chip>B1</Chip>
        </div>
        <div style={{ ...T.display(20), marginTop: 14, lineHeight: 1.4 }}>
          translate this into spanish
        </div>
      </div>

      {/* source card */}
      <div style={{ padding: '14px 20px 0' }}>
        <MCard style={{ padding: 18 }}>
          <div style={{ ...T.micro, marginBottom: 6 }}>english</div>
          <div style={{ ...T.display(20), color: M.ink, lineHeight: 1.4 }}>
            i would have called you, but i didn't have my phone.
          </div>
          <button style={{
            marginTop: 10, padding: '6px 10px', borderRadius: 999,
            background: 'transparent', border: `1px solid ${M.rule}`,
            ...T.ui(11), color: M.inkSoft, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 4v4l-1.5-1.5h-1v-1h1l1.5-1.5zm2 .5l3 1.5-3 1.5z" /></svg>
            hear it
          </button>
        </MCard>
      </div>

      {state === 'typing' ? (
        <>
          {/* input */}
          <div style={{ padding: '16px 20px 0', flex: 1 }}>
            <div style={{ ...T.micro, marginBottom: 6 }}>your translation</div>
            <div style={{
              padding: 14, borderRadius: M.r2,
              background: M.card, border: `1.5px solid ${M.ink}`,
              minHeight: 110,
              ...T.display(18), color: M.ink, lineHeight: 1.5,
            }}>
              te habría llamado, pero no tenía mi tel
              <span style={{ display: 'inline-block', width: 2, height: 22, background: M.ink, verticalAlign: 'middle', marginLeft: 1, animation: 'mfade 0.6s infinite alternate' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ ...T.ui(11), color: M.inkMute }}>long-press a vowel for accent (á é í ó ú ñ)</span>
              <span style={{ ...T.mono(11), color: M.inkMute }}>32 chars</span>
            </div>
          </div>

          {/* keyboard */}
          <MobileKeyboardSnap accentHeld={'i'} />
        </>
      ) : (
        <>
          {/* graded view */}
          <div style={{ padding: '16px 20px 16px', flex: 1, overflowY: 'auto' }}>
            <div style={{ ...T.micro, marginBottom: 6 }}>your translation</div>
            <div style={{
              padding: 14, borderRadius: M.r2, background: M.paper2,
              border: `1px solid ${M.rule}`, ...T.display(17), color: M.ink, lineHeight: 1.5,
            }}>
              te <span style={{ background: M.hiliteSoft, padding: '0 2px', borderRadius: 3 }}>habria</span> llamado, pero no <span style={{ background: M.hiliteSoft, padding: '0 2px', borderRadius: 3 }}>tenía mi tel</span>.
            </div>

            <div style={{ marginTop: 14, padding: 14, borderRadius: M.r3, background: M.okSoft, border: `1.5px solid ${M.ok}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 12, background: M.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
                <div style={{ ...T.display(15), color: '#3d6a3c', flex: 1 }}>core meaning preserved · 90%</div>
              </div>
              <p style={{ ...T.ui(13), color: M.ink2, margin: '8px 0 0', lineHeight: 1.5 }}>
                grammar nailed (conditional perfect + imperfecto). two small things:
              </p>
              <ul style={{ ...T.ui(13), margin: '6px 0 0', paddingLeft: 18, color: M.ink2, lineHeight: 1.6 }}>
                <li><b>habría</b> needs the accent — same word, just spelled right.</li>
                <li><b>tel</b> → "<b>teléfono</b>" or colloquial "<b>móvil</b>". "tel" reads as a fragment.</li>
              </ul>
            </div>

            <div style={{ ...T.micro, marginTop: 14, marginBottom: 6 }}>natural rendering</div>
            <div style={{ padding: 14, background: M.card, border: `1px solid ${M.rule}`, borderRadius: M.r2 }}>
              <div style={{ ...T.display(16), color: M.ink }}>
                te habría llamado, pero no tenía el móvil.
              </div>
              <div style={{ ...T.ui(11), color: M.inkMute, marginTop: 6, fontStyle: 'italic' }}>
                also accepted: "te hubiera llamado…" (hubiera/habría are interchangeable here)
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderTop: `1px solid ${M.rule}`, display: 'flex', gap: 8, background: M.paper, flexShrink: 0 }}>
            <MBtn variant="secondary" size="lg" style={{ flex: 1 }}>save phrase</MBtn>
            <MBtn variant="primary" size="lg" style={{ flex: 2 }}>next →</MBtn>
          </div>
        </>
      )}

      {state === 'typing' && (
        <div style={{ padding: '10px 16px 14px', display: 'flex', gap: 8, background: M.paper, flexShrink: 0, borderTop: `1px solid ${M.rule}` }}>
          <MBtn variant="ghost" size="lg" style={{ flex: 1 }}>hint</MBtn>
          <MBtn variant="primary" size="lg" style={{ flex: 2 }}>check</MBtn>
        </div>
      )}

      <CoachFab onClick={() => {}} />
    </MScreen>
  );
}

// Compact gboard with one vowel "long-pressed" showing accent picker
function MobileKeyboardSnap({ accentHeld }) {
  const row1 = ['q','w','e','r','t','y','u','i','o','p'];
  const row2 = ['a','s','d','f','g','h','j','k','l'];
  const row3 = ['z','x','c','v','b','n','m'];
  const accents = { a:['á','à','ä'], e:['é','è','ë'], i:['í','ì','ï'], o:['ó','ò','ö'], u:['ú','ù','ü'], n:['ñ'] };
  const popups = accentHeld && accents[accentHeld];

  const Key = ({ ch, w, bg, isHeld }) => (
    <div style={{
      flex: w || 1, minWidth: 0, height: 38, borderRadius: 6,
      background: bg || M.card,
      border: isHeld ? `1.5px solid ${M.accent}` : `1px solid ${M.rule}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...T.ui(15), color: M.ink2, position: 'relative',
    }}>
      {ch}
      {isHeld && popups && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)',
          background: M.ink, borderRadius: 8, padding: '4px 4px',
          display: 'flex', gap: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          zIndex: 5,
        }}>
          {popups.map((a, i) => (
            <div key={a} style={{
              width: 32, height: 36, borderRadius: 5,
              background: i === 0 ? M.accent : 'transparent',
              color: i === 0 ? '#fff' : M.paper,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              ...T.ui(16),
            }}>{a}</div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div style={{ background: M.paper3, padding: '8px 5px 6px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {row1.map(c => <Key key={c} ch={c} isHeld={c === accentHeld} />)}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: '0 18px' }}>
        {row2.map(c => <Key key={c} ch={c} />)}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Key ch="⇧" w={1.4} bg={M.paper2} />
        {row3.map(c => <Key key={c} ch={c} />)}
        <Key ch="⌫" w={1.4} bg={M.paper2} />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Key ch="?123" w={1.5} bg={M.paper2} />
        <Key ch="," />
        <Key ch="space" w={5} />
        <Key ch="." />
        <Key ch="↵" w={1.5} bg={M.ink} />
      </div>
    </div>
  );
}

Object.assign(window, { MobileTranslation });
