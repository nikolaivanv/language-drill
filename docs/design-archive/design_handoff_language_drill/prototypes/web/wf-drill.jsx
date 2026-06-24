// Drill session — 3 core metaphors
// A · Mixed circuit (workout-like, sets & reps across exercise types)
// B · Coach-guided (AI explains, picks next)
// C · Timed rally (rapid-fire under pressure)

function DrillA() {
  return (
    <WShell title="drill · circuit" lang="es">
      {/* progress bar across top */}
      <div style={{ height: 4, background: WF.paperAlt, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40%', background: WF.accent }} />
      </div>

      <div style={{ padding: '16px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>circuit 2 of 5</WText>
          <WSquiggle w={32} color={WF.ink} />
        </div>
        <WText size={11} color={WF.inkSoft}><WMono size={11}>04:21</WMono> · ⏸ pause</WText>
      </div>

      {/* stations pill row — shows the set */}
      <div style={{ padding: '14px 28px', display: 'flex', gap: 6, overflow: 'hidden' }}>
        {[
          ['cloze', true, false],
          ['writing', true, false],
          ['cloze', false, true],   // current
          ['listen', false, false],
          ['writing', false, false],
          ['speak', false, false],
        ].map(([kind, done, cur], i) => (
          <div key={i} style={{
            flex: 1,
            padding: '6px 0',
            border: `1.3px solid ${WF.ink}`,
            borderRadius: 4,
            background: cur ? WF.ink : done ? WF.paperAlt : 'transparent',
            color: cur ? WF.paper : WF.ink,
            textAlign: 'center',
            fontFamily: WF.uiFont, fontSize: 10,
            opacity: done ? 0.6 : 1,
            position: 'relative',
          }}>
            {done ? '✓ ' : ''}{kind}
          </div>
        ))}
      </div>

      {/* main card */}
      <div style={{ padding: '8px 28px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <WBox pad={24} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>station 3 · cloze · item 3 of 5</WText>
              <div style={{ marginTop: 6 }}>
                <WChip>subjunctive</WChip><span style={{ marginLeft: 6 }}><WChip>doubt clauses</WChip></span>
              </div>
            </div>
            <WMono size={11} color={WF.inkMute}>B2 · authentic</WMono>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '18px 0' }}>
            <WText size={13} color={WF.inkSoft} style={{ marginBottom: 8 }}>fill in the blank — don't worry about accents.</WText>
            <div style={{
              fontFamily: WF.uiFont, fontSize: 22, color: WF.ink, lineHeight: 1.5,
              padding: '14px 18px',
              background: WF.paperAlt, borderRadius: 8, border: `1.2px solid ${WF.ink}22`,
            }}>
              no creo que <span style={{
                display: 'inline-block', minWidth: 110,
                borderBottom: `2px solid ${WF.accent}`,
                padding: '0 8px', margin: '0 4px',
                fontFamily: WF.monoFont, fontSize: 18, color: WF.accent,
              }}>____</span> tiempo para eso.
              <div style={{ marginTop: 10, fontFamily: WF.uiFont, fontSize: 12, color: WF.inkMute }}>
                (tener, 3rd sg.)
              </div>
            </div>

            {/* options */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              {['tiene', 'tenga', 'tendrá', 'tuviera'].map((w, i) => (
                <div key={w} style={{
                  flex: 1, padding: '10px 12px',
                  border: `1.3px solid ${WF.ink}`, borderRadius: 5,
                  textAlign: 'center', background: i === 1 ? WF.hiliteSoft : WF.card,
                  fontFamily: WF.uiFont, fontSize: 14,
                  boxShadow: `1px 1.5px 0 ${WF.ink}22`,
                }}>{w}</div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <WText size={11} color={WF.inkMute}>hint ⓘ · skip</WText>
            <WBtn primary size={14}>check →</WBtn>
          </div>
        </WBox>
      </div>

      <WMargin style={{ position: 'absolute', right: 18, top: 140 }} tilt={2} arrow="right">
        shows whole circuit;<br />you know what's coming
      </WMargin>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// B — Coach-guided: chat-like, AI explains picks
function DrillB() {
  return (
    <WShell title="drill · coached" lang="es">
      <div style={{ display: 'flex', height: '100%' }}>
        {/* left: coach chat rail */}
        <div style={{
          width: 220, borderRight: `1.5px dashed ${WF.inkMute}`,
          padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10,
          background: WF.paperAlt,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.handFont, fontSize: 13 }}>c</div>
            <WText size={11} color={WF.inkSoft}>coach</WText>
          </div>

          {[
            { who: 'c', txt: "let's tackle subjunctive today. your recall slipped 3pts last week." },
            { who: 'c', txt: "starting easy — recognition warm-up." },
            { who: 'u', txt: '✓ 4/4' },
            { who: 'c', txt: "good. now production — writing 5 sentences." },
          ].map((m, i) => (
            <div key={i} style={{ alignSelf: m.who === 'c' ? 'flex-start' : 'flex-end', maxWidth: '92%' }}>
              <div style={{
                fontFamily: WF.uiFont, fontSize: 11, lineHeight: 1.4,
                padding: '6px 9px',
                background: m.who === 'c' ? WF.card : WF.ink,
                color: m.who === 'c' ? WF.ink : WF.paper,
                border: m.who === 'c' ? `1.2px solid ${WF.ink}` : 'none',
                borderRadius: 5,
              }}>{m.txt}</div>
            </div>
          ))}

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>coming up</WText>
            <WText size={11} color={WF.inkSoft}>→ writing · 5 prompts</WText>
            <WText size={11} color={WF.inkMute}>→ listening rep</WText>
            <WText size={11} color={WF.inkMute}>→ speak summary</WText>
          </div>
        </div>

        {/* right: current exercise */}
        <div style={{ flex: 1, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>writing · prompt 1 of 5</WText>
              <div style={{ marginTop: 10 }}>
                <WLabel size={24}>translate — "i doubt they'll arrive on time."</WLabel>
              </div>
              <div style={{ marginTop: 6 }}>
                <WText size={11} color={WF.inkSoft}>use the subjunctive. 'dudar que' triggers it.</WText>
              </div>
            </div>
            <button style={{
              border: `1.3px solid ${WF.ink}`, background: 'transparent', padding: '4px 8px',
              borderRadius: 5, fontFamily: WF.uiFont, fontSize: 10, color: WF.ink, cursor: 'pointer',
            }}>ask coach</button>
          </div>

          {/* input */}
          <div style={{
            marginTop: 18,
            height: 100,
            border: `1.5px solid ${WF.ink}`, borderRadius: 6,
            padding: 12, background: WF.card,
            fontFamily: WF.uiFont, fontSize: 15, color: WF.ink,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            boxShadow: `1.5px 2px 0 ${WF.ink}22`,
          }}>
            <span><WMono size={14} color={WF.inkMute}>dudo que </WMono><span style={{ display: 'inline-block', width: 2, height: 18, background: WF.accent, verticalAlign: 'middle' }} />
              <span style={{ fontFamily: WF.monoFont, fontSize: 12, color: WF.inkMute, marginLeft: 4 }}>|</span>
            </span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <WMono size={10} color={WF.inkMute}>8 / 80 words</WMono>
              <div style={{ display: 'flex', gap: 8 }}>
                <WBtn size={11}>🎤 speak it</WBtn>
                <WBtn primary size={12}>submit</WBtn>
              </div>
            </div>
          </div>

          {/* hint bubble */}
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.handFont, fontSize: 13, flexShrink: 0 }}>c</div>
            <div style={{
              padding: '8px 12px', background: WF.hiliteSoft,
              border: `1.2px solid ${WF.ink}`, borderRadius: 5,
              fontFamily: WF.uiFont, fontSize: 12, color: WF.inkSoft, maxWidth: 360,
            }}>
              remember: <WHilite>llegar</WHilite> → 3rd plural subjunctive. try without peeking — i'll tell you after.
            </div>
          </div>

          <div style={{ flex: 1 }} />
          <WMargin tilt={-2} arrow="left" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            AI picks the next exercise<br />based on this answer
          </WMargin>
        </div>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// C — Timed rally: rapid-fire
function DrillC() {
  return (
    <WShell title="drill · rally" lang="es">
      <div style={{ padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>rally · 90 sec</WText>
          <WChip fill={WF.accent} color={WF.accent}><span style={{ color: WF.paper }}>⏱ live</span></WChip>
        </div>
        <WText size={11} color={WF.inkSoft}>streak: <WMono size={13} color={WF.accent}>×7</WMono></WText>
      </div>

      {/* big countdown ring */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 4px' }}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke={WF.paperAlt} strokeWidth="6" />
          <circle cx="40" cy="40" r="34" fill="none" stroke={WF.accent} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 34}`} strokeDashoffset={`${2 * Math.PI * 34 * 0.35}`}
            transform="rotate(-90 40 40)" strokeLinecap="round" />
          <text x="40" y="46" fontFamily={WF.monoFont} fontSize="22" textAnchor="middle" fill={WF.ink}>58</text>
        </svg>
      </div>

      {/* prompt — big, center */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', position: 'relative' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 2 }}>say or type · fast</WText>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <WLabel size={34}>"they leave at 8."</WLabel>
          <div style={{ marginTop: 6 }}>
            <WText size={12} color={WF.inkSoft}>→ spanish · present tense</WText>
          </div>
        </div>

        {/* input — minimal */}
        <div style={{
          marginTop: 20, width: '100%', maxWidth: 420,
          borderBottom: `2px solid ${WF.ink}`, padding: '8px 6px',
          textAlign: 'center',
        }}>
          <WMono size={20} color={WF.ink}>salen a las ocho</WMono>
          <span style={{ display: 'inline-block', width: 2, height: 20, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
        </div>

        {/* quick actions */}
        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          <WBtn size={11}>⏭ skip</WBtn>
          <WBtn size={11}>🎤 voice</WBtn>
          <WBtn primary size={12}>↵ send</WBtn>
        </div>

        <WMargin style={{ position: 'absolute', left: 14, bottom: 20 }} tilt={-3} arrow="left">
          no multiple choice.<br />produce under pressure.
        </WMargin>
      </div>

      {/* score strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-around',
        padding: '10px 0', borderTop: `1.5px solid ${WF.ink}`,
        background: WF.paperAlt,
      }}>
        <div style={{ textAlign: 'center' }}>
          <WMono size={18} color={WF.ink}>11</WMono>
          <div><WText size={10} color={WF.inkMute}>correct</WText></div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <WMono size={18} color={WF.accent}>2</WMono>
          <div><WText size={10} color={WF.inkMute}>missed</WText></div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <WMono size={18} color={WF.ink}>3.4s</WMono>
          <div><WText size={10} color={WF.inkMute}>avg time</WText></div>
        </div>
      </div>
    </WShell>
  );
}

Object.assign(window, { DrillA, DrillB, DrillC });
