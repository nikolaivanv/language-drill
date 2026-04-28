// Writing · Speaking · Cloze — 3 variations each

// ═══════════════════════ WRITING ═══════════════════════
// A · Prompt + textarea + AI feedback inline
// B · Split translate view
// C · Progressive reveal (draft → coach diff → rewrite)

function WriteA() {
  return (
    <WShell title="write" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>writing · prompt 2 of 5</WText>
            <div style={{ marginTop: 6 }}><WLabel size={22}>describe a time you regretted a decision.</WLabel></div>
            <div style={{ marginTop: 4 }}><WText size={11} color={WF.inkSoft}>target: 60–100 words · use past conditional</WText></div>
          </div>
          <WBtn size={11}>peek example</WBtn>
        </div>
        <div style={{ flex: 1, border: `1.5px solid ${WF.ink}`, borderRadius: 6, background: WF.card, padding: 14, boxShadow: `1.5px 2px 0 ${WF.ink}22`, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontFamily: WF.uiFont, fontSize: 14, lineHeight: 1.6, color: WF.ink, flex: 1 }}>
            Hace dos años, acepté un trabajo en otra ciudad. <WHilite color={WF.hiliteSoft}>Si yo habría sabido</WHilite> cómo iba a ser, no lo <span style={{ textDecoration: 'underline wavy', textDecorationColor: WF.accent }}>tomaría</span>…
            <span style={{ display: 'inline-block', width: 2, height: 16, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px dashed ${WF.inkMute}`, paddingTop: 8, marginTop: 8 }}>
            <WMono size={10} color={WF.inkMute}>34 / 100 words · auto-save</WMono>
            <div style={{ display: 'flex', gap: 8 }}><WBtn size={11}>🎤 dictate</WBtn><WBtn primary size={12}>check</WBtn></div>
          </div>
        </div>
        <WBox pad={10} fill={WF.accentSoft} style={{ display: 'flex', gap: 10 }}>
          <WLabel size={14} color={WF.accent}>!</WLabel>
          <WText size={11} color={WF.inkSoft} style={{ flex: 1 }}>
            inline issues appear as you type — wavy accent = grammar, highlighter = awkward phrasing
          </WText>
        </WBox>
        <WMargin style={{ position: 'absolute', right: 14, top: 180 }} tilt={3} arrow="right">live AI grading,<br />not just red pen</WMargin>
      </div>
    </WShell>
  );
}

function WriteB() {
  return (
    <WShell title="translate" lang="es">
      <div style={{ padding: '18px 26px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>writing · translate · 3 of 8</WText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1 }}>
          <div style={{ border: `1.5px dashed ${WF.inkSoft}`, borderRadius: 6, padding: 14, background: WF.paperAlt, display: 'flex', flexDirection: 'column' }}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>EN · source</WText>
            <div style={{ marginTop: 10, flex: 1 }}>
              <WText size={15} style={{ lineHeight: 1.6 }}>
                "If I had known the meeting would run this long, I would have eaten first."
              </WText>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <WChip>conditional</WChip><WChip>past perfect</WChip>
            </div>
          </div>
          <div style={{ border: `1.5px solid ${WF.ink}`, borderRadius: 6, padding: 14, background: WF.card, boxShadow: `1.5px 2px 0 ${WF.ink}22`, display: 'flex', flexDirection: 'column' }}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>ES · your version</WText>
            <div style={{ marginTop: 10, flex: 1, fontFamily: WF.uiFont, fontSize: 15, lineHeight: 1.6 }}>
              Si <WMono size={14}>hubiera sabido</WMono>
              <span style={{ display: 'inline-block', width: 2, height: 16, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
            </div>
            <WText size={11} color={WF.inkMute}>⎵ tap to reveal 1st word · 2 hints used</WText>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['hubiera', 'habría', 'tuviera'].map((w, i) => (
              <WChip key={w} color={WF.ink} fill={i === 0 ? WF.hiliteSoft : WF.card}>{w}?</WChip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}><WBtn size={11}>hint</WBtn><WBtn primary size={12}>submit →</WBtn></div>
        </div>
        <WMargin style={{ position: 'absolute', left: 14, bottom: 50 }} tilt={-2}>bilingual pane —<br/>good for translate drills</WMargin>
      </div>
    </WShell>
  );
}

function WriteC() {
  return (
    <WShell title="write · revise" lang="es">
      <div style={{ padding: '18px 26px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>writing · draft → revise</WText>
          <div style={{ display: 'flex', gap: 4 }}>
            {['draft', 'coach', 'rewrite'].map((s, i) => (
              <div key={s} style={{ padding: '3px 10px', border: `1.2px solid ${WF.ink}`, borderRadius: 14, fontFamily: WF.uiFont, fontSize: 10, background: i === 1 ? WF.ink : 'transparent', color: i === 1 ? WF.paper : WF.ink }}>{i + 1}. {s}</div>
            ))}
          </div>
        </div>

        {/* Draft (muted) */}
        <WBox pad={12} fill={WF.paperAlt} style={{ opacity: 0.75 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>1 · your draft</WText>
          <div style={{ marginTop: 6, fontFamily: WF.uiFont, fontSize: 12, lineHeight: 1.5, color: WF.inkSoft }}>
            Cuando era niño, mi familia <s>vivíamos</s> en Madrid. Nos mudamos porque mi padre <s>conseguió</s> un nuevo trabajo…
          </div>
        </WBox>

        {/* Coach card — current */}
        <div style={{ border: `1.5px solid ${WF.ink}`, borderRadius: 6, padding: 14, background: WF.card, boxShadow: `1.5px 2px 0 ${WF.ink}22`, flex: 1 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.handFont, fontSize: 14, flexShrink: 0 }}>c</div>
            <div style={{ flex: 1 }}>
              <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>2 · coach notes</WText>
              <div style={{ marginTop: 6, fontFamily: WF.uiFont, fontSize: 12, lineHeight: 1.5 }}>
                good narrative flow! two things to fix:
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <div style={{ display: 'flex', gap: 8, padding: 8, background: WF.accentSoft, borderRadius: 4 }}>
                    <WMono size={10} color={WF.accent}>agr·1</WMono>
                    <WText size={11}>"mi familia vivíamos" → subject is sg, verb should be <WMono size={12}>vivía</WMono></WText>
                  </div>
                  <div style={{ display: 'flex', gap: 8, padding: 8, background: WF.hiliteSoft, borderRadius: 4 }}>
                    <WMono size={10} color={WF.ink}>tense</WMono>
                    <WText size={11}>"conseguió" is fine, but "había conseguido" shows backgrounding better</WText>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rewrite slot */}
        <div style={{ border: `1.5px dashed ${WF.inkSoft}`, borderRadius: 6, padding: 12 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>3 · rewrite (locked until you read notes)</WText>
          <div style={{ marginTop: 6, fontFamily: WF.uiFont, fontSize: 12, color: WF.inkMute, fontStyle: 'italic' }}>rewrite incorporating the two fixes above…</div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 150 }} tilt={2} arrow="right">forces you to rewrite —<br/>not just read the fix</WMargin>
      </div>
    </WShell>
  );
}

// ═══════════════════════ SPEAKING ═══════════════════════
function SpeakA() {
  return (
    <WShell title="speak" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>shadowing · clip 3 of 6</WText>
        <div style={{ marginTop: 8 }}><WLabel size={22}>listen, then shadow</WLabel></div>

        {/* original audio */}
        <WBox pad={14} style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <WText size={11} color={WF.inkMute}>ORIGINAL · native, 1.0×</WText>
            <WMono size={10}>0:04 / 0:06</WMono>
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 8, alignItems: 'flex-end', height: 36 }}>
            {Array.from({ length: 48 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: `${20 + Math.sin(i * 0.6) * 40 + (i % 3) * 15}%`, background: i < 30 ? WF.ink : WF.inkMute, borderRadius: 1 }} />
            ))}
          </div>
          <WText size={13} style={{ marginTop: 8, lineHeight: 1.5 }}>"aunque tenga dudas, voy a intentarlo de todos modos."</WText>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <WBtn size={11}>▶ play</WBtn><WBtn size={11}>0.75×</WBtn><WBtn size={11}>loop</WBtn>
          </div>
        </WBox>

        {/* your turn */}
        <div style={{ flex: 1, marginTop: 12, border: `1.5px solid ${WF.accent}`, borderRadius: 6, padding: 14, background: WF.card, boxShadow: `1.5px 2px 0 ${WF.accent}33`, display: 'flex', flexDirection: 'column' }}>
          <WText size={11} color={WF.accent} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>YOUR TURN · recording…</WText>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: WF.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 18, height: 18, background: WF.paper, borderRadius: 3 }} />
            </div>
            <div style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'center', height: 34 }}>
              {Array.from({ length: 42 }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: `${10 + Math.abs(Math.sin(i * 0.9)) * 80}%`, background: WF.accent, borderRadius: 1 }} />
              ))}
            </div>
            <WMono size={12}>0:03</WMono>
          </div>
          <div style={{ marginTop: 10, padding: 8, background: WF.paperAlt, borderRadius: 4 }}>
            <WText size={11} color={WF.inkMute}>LIVE TRANSCRIPT</WText>
            <WText size={12}>aunque <WHilite color={WF.accentSoft}>tengo</WHilite> dudas…</WText>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 130 }} tilt={2} arrow="right">shadowing = pimsleur<br/>+ live correction</WMargin>
      </div>
    </WShell>
  );
}

function SpeakB() {
  return (
    <WShell title="speak · convo" lang="es">
      <div style={{ padding: '16px 26px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>open convo · topic: travel plans</WText>
          <WText size={11} color={WF.inkSoft}>goal: 6 turns · 3/6 ✓</WText>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { who: 'ai', txt: '¿adónde piensas viajar este verano?', note: null },
            { who: 'me', txt: 'quiero ir a portugal pero no sé si... (2s pause) ...si tendré tiempo.', note: '✓ natural hedging' },
            { who: 'ai', txt: '¡portugal está genial! ¿qué ciudades te interesan?', note: null },
            { who: 'me', txt: 'lisboa, y talvez porto también.', note: 'tal vez (2 words)' },
            { who: 'ai', txt: 'porto es precioso. ¿irás solo o con amigos?', note: null },
          ].map((m, i) => (
            <div key={i} style={{ alignSelf: m.who === 'ai' ? 'flex-start' : 'flex-end', maxWidth: '78%' }}>
              <div style={{ padding: '8px 12px', border: `1.3px solid ${WF.ink}`, borderRadius: 10, background: m.who === 'ai' ? WF.card : WF.hiliteSoft, boxShadow: `1px 1.5px 0 ${WF.ink}22` }}>
                <WText size={12} style={{ lineHeight: 1.4 }}>{m.txt}</WText>
              </div>
              {m.note && <div style={{ marginTop: 3, fontFamily: WF.handFont, fontSize: 12, color: m.note.startsWith('✓') ? WF.ok : WF.accent, textAlign: m.who === 'ai' ? 'left' : 'right' }}>{m.note}</div>}
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1.5px dashed ${WF.inkMute}`, paddingTop: 10, marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: WF.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WF.paper, fontSize: 16 }}>🎤</div>
          <div style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'center', height: 22 }}>
            {Array.from({ length: 36 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: `${20 + Math.abs(Math.sin(i * 1.1)) * 80}%`, background: WF.ink, borderRadius: 1 }} />
            ))}
          </div>
          <WBtn size={11}>type</WBtn>
        </div>
        <WMargin style={{ position: 'absolute', left: 14, top: 56 }} tilt={-2}>what you do between<br/>italki sessions</WMargin>
      </div>
    </WShell>
  );
}

function SpeakC() {
  return (
    <WShell title="speak · minimal pair" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>pronunciation · /r/ vs /rr/</WText>
        <WLabel size={24} style={{ marginTop: 8 }}>say both, clearly</WLabel>

        <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
          {[
            { w: 'pero', m: 'but', pron: '/ˈpe.ɾo/', ok: true },
            { w: 'perro', m: 'dog', pron: '/ˈpe.ro/', ok: false },
          ].map((p) => (
            <WBox key={p.w} pad={18} style={{ width: 160, textAlign: 'center' }}>
              <WLabel size={32}>{p.w}</WLabel>
              <div><WMono size={11} color={WF.inkMute}>{p.pron}</WMono></div>
              <WText size={11} color={WF.inkSoft}>"{p.m}"</WText>
              <div style={{ marginTop: 10, padding: 6, background: p.ok ? WF.hiliteSoft : WF.accentSoft, borderRadius: 4 }}>
                <WMono size={10} color={p.ok ? WF.ok : WF.accent}>{p.ok ? '✓ 92% match' : '⚠ 61% — try again'}</WMono>
              </div>
            </WBox>
          ))}
        </div>

        {/* waveform comparison */}
        <div style={{ width: '100%', marginTop: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <WText size={10} color={WF.inkMute}>YOUR "perro"</WText>
          <div style={{ display: 'flex', gap: 1, height: 24 }}>
            {Array.from({ length: 60 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: `${30 + Math.abs(Math.sin(i * 0.7)) * 70}%`, background: WF.accent, alignSelf: 'center' }} />
            ))}
          </div>
          <WText size={10} color={WF.inkMute}>NATIVE · target</WText>
          <div style={{ display: 'flex', gap: 1, height: 24 }}>
            {Array.from({ length: 60 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: `${30 + Math.abs(Math.sin(i * 0.7 + 1)) * 70}%`, background: WF.ink, alignSelf: 'center' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 10 }}>
            <WBtn size={11}>▶ compare</WBtn><WBtn primary size={12}>🎤 record again</WBtn>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, bottom: 20 }} tilt={2} arrow="right">phoneme-level —<br/>not just "good/bad"</WMargin>
      </div>
    </WShell>
  );
}

// ═══════════════════════ CLOZE ═══════════════════════
function ClozeA() {
  return (
    <WShell title="cloze" lang="es">
      <div style={{ padding: '22px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>cloze · context: news clip</WText>
        <WLabel size={22} style={{ marginTop: 6 }}>el parque (se ___) de inmediato</WLabel>

        <WBox pad={16} fill={WF.paperAlt} style={{ marginTop: 14, flex: 1 }}>
          <div style={{ fontFamily: WF.uiFont, fontSize: 15, lineHeight: 1.8 }}>
            Tras el aviso meteorológico, las autoridades pidieron que el parque{' '}
            <span style={{ display: 'inline-block', minWidth: 90, borderBottom: `2px solid ${WF.accent}`, textAlign: 'center', padding: '0 6px' }}>
              <WMono size={15} color={WF.accent}>se ____</WMono>
            </span>
            {' '}de inmediato. Los visitantes no{' '}
            <span style={{ display: 'inline-block', minWidth: 70, borderBottom: `2px dashed ${WF.inkMute}`, textAlign: 'center' }}>____</span>
            {' '}volver hasta nueva orden.
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
            <WChip>cerrar (vb)</WChip><WChip color={WF.inkMute}>poder (vb)</WChip>
          </div>
        </WBox>

        {/* typing input */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <WText size={11} color={WF.inkSoft}>blank 1 of 2 →</WText>
          <div style={{ flex: 1, borderBottom: `2px solid ${WF.ink}`, padding: '6px 8px' }}>
            <WMono size={16}>cerrara</WMono>
            <span style={{ display: 'inline-block', width: 2, height: 16, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
          </div>
          <WBtn size={11}>hint</WBtn>
          <WBtn primary size={12}>check</WBtn>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 90 }} tilt={2} arrow="right">authentic context,<br/>not bare sentences</WMargin>
      </div>
    </WShell>
  );
}

function ClozeB() {
  return (
    <WShell title="cloze · drop" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>cloze · drag the right word</WText>

        <WBox pad={16} style={{ marginTop: 12 }}>
          <div style={{ fontFamily: WF.uiFont, fontSize: 15, lineHeight: 2 }}>
            Si{' '}
            <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, background: WF.hiliteSoft, border: `1.3px solid ${WF.ink}` }}>
              <WMono size={13}>tuviera</WMono>
            </span>
            {' '}tiempo, te{' '}
            <span style={{ display: 'inline-block', minWidth: 80, height: 22, background: WF.paperAlt, border: `1.3px dashed ${WF.inkMute}`, borderRadius: 4, verticalAlign: 'middle' }} />
            {' '}con el proyecto, pero ahora mismo no{' '}
            <span style={{ display: 'inline-block', minWidth: 80, height: 22, background: WF.paperAlt, border: `1.3px dashed ${WF.inkMute}`, borderRadius: 4, verticalAlign: 'middle' }} />.
          </div>
        </WBox>

        <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1, marginTop: 18 }}>word bank</WText>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {['ayudaría', 'puedo', 'tendría', 'ayudo', 'tengo', 'hubiera ayudado'].map((w) => (
            <div key={w} style={{ padding: '6px 12px', border: `1.3px solid ${WF.ink}`, borderRadius: 4, background: WF.card, boxShadow: `1px 1.5px 0 ${WF.ink}22`, fontFamily: WF.monoFont, fontSize: 13, cursor: 'grab' }}>
              {w}
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <WBox pad={10} fill={WF.accentSoft} style={{ display: 'flex', gap: 10 }}>
          <WText size={11} color={WF.inkSoft}>💡 extras are decoys — watch for gender + tense agreement</WText>
        </WBox>
        <WMargin style={{ position: 'absolute', left: 14, bottom: 90 }} tilt={-2}>kinesthetic —<br/>lower cognitive load</WMargin>
      </div>
    </WShell>
  );
}

function ClozeC() {
  return (
    <WShell title="cloze · stack" lang="es">
      <div style={{ padding: '18px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>cloze · SRS stack</WText>
          <WText size={11} color={WF.inkSoft}><WMono size={11}>12</WMono> remaining</WText>
        </div>

        {/* stacked cards */}
        <div style={{ flex: 1, position: 'relative', marginTop: 14 }}>
          <div style={{ position: 'absolute', inset: '10px 30px 30px 10px', background: WF.paperAlt, border: `1.3px solid ${WF.inkMute}`, borderRadius: 8, transform: 'rotate(-1.5deg)' }} />
          <div style={{ position: 'absolute', inset: '5px 20px 15px 5px', background: WF.paper, border: `1.3px solid ${WF.ink}`, borderRadius: 8, transform: 'rotate(0.8deg)' }} />
          <div style={{ position: 'absolute', inset: '0 10px 0 0', background: WF.card, border: `1.5px solid ${WF.ink}`, borderRadius: 8, boxShadow: `2px 3px 0 ${WF.ink}33`, padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <WChip>subjunctive</WChip>
              <WMono size={10} color={WF.inkMute}>seen 4× · last: 3d</WMono>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <WLabel size={22}>ojalá que no ___ tarde.</WLabel>
                <div style={{ marginTop: 6 }}><WText size={11} color={WF.inkSoft}>(llegar, 3rd pl)</WText></div>
                <div style={{ marginTop: 18, minWidth: 180, borderBottom: `2px solid ${WF.ink}`, padding: '6px 0', textAlign: 'center' }}>
                  <WMono size={18}>lleguen</WMono>
                  <span style={{ display: 'inline-block', width: 2, height: 16, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
              <WBtn size={11}>again</WBtn>
              <WBtn size={11}>hard</WBtn>
              <WBtn size={11}>good</WBtn>
              <WBtn primary size={11}>easy</WBtn>
            </div>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 60 }} tilt={2} arrow="right">anki-style stack,<br/>prettier</WMargin>
      </div>
    </WShell>
  );
}

Object.assign(window, { WriteA, WriteB, WriteC, SpeakA, SpeakB, SpeakC, ClozeA, ClozeB, ClozeC });
