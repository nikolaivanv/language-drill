// Onboarding — 3 distinct directions for the full flow
// Each artboard shows a multi-step flow as stacked panels in one frame
// (since wireframes are 900x600 — easier to compare flows side by side
// than scroll through 5 artboards per direction).
//
// A · Conversational (coach-led intake)
// B · Structured wizard (classic 3-step picker)
// C · Single-page dense (everything visible, fast)
// All 3 surface the optional self-assessment test prominently.

// Shared bits
function StepDots({ n, active }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{
          width: i === active ? 22 : 6, height: 6, borderRadius: 3,
          background: i === active ? WF.accent : i < active ? WF.ink : WF.paperAlt,
          border: `1px solid ${WF.ink}`,
        }} />
      ))}
    </div>
  );
}

function FlagDot({ code, size = 32, active, dim }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `1.5px solid ${WF.ink}`,
      background: active ? WF.accent : WF.card,
      color: active ? WF.paper : WF.ink,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: WF.monoFont, fontSize: size * 0.34,
      opacity: dim ? 0.4 : 1, flexShrink: 0,
      boxShadow: `1px 1.5px 0 ${WF.ink}22`,
    }}>{code}</div>
  );
}

// ─────────────────────────────────────────────
// A · Conversational onboarding — Coach asks, you answer
function OnbA() {
  return (
    <WShell title="welcome" lang="—" noHeader>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: WF.paper }}>
        {/* mini header */}
        <div style={{ padding: '14px 22px', borderBottom: `1.5px solid ${WF.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 22 22"><rect x="2" y="2" width="18" height="18" rx="3" stroke={WF.ink} strokeWidth="1.5" fill="none" /><path d="M6 11 L10 15 L17 7" stroke={WF.accent} strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
            <WLabel size={18}>drill</WLabel>
            <WText size={11} color={WF.inkMute}>· setup</WText>
          </div>
          <StepDots n={5} active={2} />
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* coach pane */}
          <div style={{ width: 240, padding: '20px 18px', background: WF.paperAlt, borderRight: `1.5px dashed ${WF.inkMute}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.handFont, fontSize: 19 }}>c</div>
              <div>
                <WLabel size={16}>coach</WLabel>
                <div><WText size={10} color={WF.inkMute}>your AI tutor</WText></div>
              </div>
            </div>
            <div style={{ marginTop: 14, fontFamily: WF.uiFont, fontSize: 11, lineHeight: 1.5, color: WF.inkSoft, padding: 10, background: WF.card, border: `1.2px solid ${WF.ink}`, borderRadius: 5 }}>
              hi! i'll ask 4 quick things, then suggest a 5-min level test. ~2 min total.
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>so far</WText>
              <WText size={11}><span style={{ color: WF.ok }}>✓</span> languages: ES, FR, JA, DE</WText>
              <WText size={11}><span style={{ color: WF.ok }}>✓</span> primary: ES (B2-ish?)</WText>
              <WText size={11} color={WF.accent}>● goals — now</WText>
              <WText size={11} color={WF.inkMute}>○ schedule</WText>
              <WText size={11} color={WF.inkMute}>○ self-assessment</WText>
            </div>
          </div>

          {/* convo pane */}
          <div style={{ flex: 1, padding: '20px 26px', display: 'flex', flexDirection: 'column' }}>
            {/* prior turn */}
            <div style={{ alignSelf: 'flex-start', maxWidth: '80%', padding: '8px 12px', border: `1.3px solid ${WF.ink}`, borderRadius: 10, background: WF.card, marginBottom: 8 }}>
              <WText size={12}>great. for spanish — what do you most want to drill?</WText>
            </div>

            {/* current question */}
            <WLabel size={22}>pick what matters most</WLabel>
            <WText size={11} color={WF.inkSoft}>multi-select — tap any that fit</WText>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              {[
                ['📝 grammar (subjunctive, etc)', true],
                ['🗣 speaking fluency', true],
                ['🎧 understanding fast speech', false],
                ['✍️ writing emails / longer texts', false],
                ['📚 vocabulary', true],
                ['🎯 prep for a trip / convo', false],
              ].map(([t, on]) => (
                <div key={t} style={{
                  padding: '10px 12px', borderRadius: 6,
                  border: `1.3px solid ${WF.ink}`,
                  background: on ? WF.hiliteSoft : WF.card,
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: `1px 1.5px 0 ${WF.ink}22`,
                }}>
                  <WCheck on={on} />
                  <WText size={11}>{t}</WText>
                </div>
              ))}
            </div>

            {/* freeform */}
            <div style={{ marginTop: 10 }}>
              <WText size={11} color={WF.inkMute}>anything else? (optional)</WText>
              <div style={{ borderBottom: `1.5px solid ${WF.ink}`, padding: '6px 4px', minHeight: 22, fontFamily: WF.uiFont, fontSize: 12, color: WF.inkSoft }}>
                I keep mixing up preterite vs imperfect…
                <span style={{ display: 'inline-block', width: 2, height: 14, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
              </div>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <WText size={11} color={WF.inkMute}>← back</WText>
              <WBtn primary size={13}>continue →</WBtn>
            </div>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 90 }} tilt={2} arrow="right">feels human;<br/>warm not chirpy</WMargin>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// B · Structured wizard — single full-page step (showing the language+level step)
function OnbB() {
  return (
    <WShell title="setup · step 2 of 4" lang="—" noHeader>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 28px', borderBottom: `1.5px solid ${WF.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>step 2 of 4 · proficiency</WText>
          <StepDots n={4} active={1} />
        </div>

        <div style={{ flex: 1, padding: '24px 32px', display: 'flex', flexDirection: 'column' }}>
          <WLabel size={28}>where are you with each language?</WLabel>
          <WText size={12} color={WF.inkSoft} style={{ marginTop: 4 }}>rough is fine — you can take a 5-min test below for a more accurate placement.</WText>

          {/* per-language rows */}
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { code: 'es', name: 'español', level: 'B2', selected: 2 },
              { code: 'fr', name: 'français', level: 'B1', selected: 1 },
              { code: 'ja', name: '日本語', level: 'A2', selected: 0 },
              { code: 'de', name: 'deutsch', level: 'A2', selected: 0 },
            ].map((l) => (
              <WBox key={l.code} pad={12}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <FlagDot code={l.code} size={36} />
                  <div style={{ width: 110 }}>
                    <WLabel size={16}>{l.name}</WLabel>
                    <div><WText size={10} color={WF.inkMute}>self-rated</WText></div>
                  </div>
                  {/* CEFR slider */}
                  <div style={{ flex: 1, display: 'flex', gap: 4 }}>
                    {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((lvl, i) => (
                      <div key={lvl} style={{
                        flex: 1, padding: '6px 0',
                        border: `1.3px solid ${WF.ink}`, borderRadius: 4,
                        textAlign: 'center', fontFamily: WF.uiFont, fontSize: 11,
                        background: i === l.selected ? WF.ink : 'transparent',
                        color: i === l.selected ? WF.paper : WF.ink,
                      }}>{lvl}</div>
                    ))}
                  </div>
                </div>
              </WBox>
            ))}
          </div>

          {/* self-assessment callout — prominent */}
          <div style={{
            marginTop: 16, padding: 14,
            border: `2px solid ${WF.accent}`, borderRadius: 8,
            background: WF.accentSoft,
            boxShadow: `2px 3px 0 ${WF.accent}33`,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: WF.accent, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>?</div>
            <div style={{ flex: 1 }}>
              <WLabel size={17}>not sure? take the placement test</WLabel>
              <div><WText size={11} color={WF.inkSoft}>5 minutes · adaptive · CEFR-aligned · one language at a time</WText></div>
            </div>
            <WBtn primary size={12}>start test →</WBtn>
            <WBtn size={11}>skip</WBtn>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', justifyContent: 'space-between' }}>
            <WBtn size={12}>← back</WBtn>
            <WBtn primary size={13}>continue →</WBtn>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 60 }} tilt={2} arrow="right">honest defaults +<br/>a clear way to verify</WMargin>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// C · Single-page dense — power-user feel, everything visible
function OnbC() {
  return (
    <WShell title="welcome" lang="—" noHeader>
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <WLabel size={26}>let's set you up</WLabel>
            <div><WText size={11} color={WF.inkSoft}>fill what you know · skip the rest · refine later in settings</WText></div>
          </div>
          <WText size={10} color={WF.inkMute}>~90 seconds</WText>
        </div>

        {/* 1 — languages row */}
        <div style={{ marginTop: 14 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>1 · which languages?</WText>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {[
              ['es', 1], ['fr', 1], ['ja', 1], ['de', 1],
              ['it', 0], ['pt', 0], ['zh', 0], ['ko', 0], ['ru', 0], ['ar', 0], ['+', 0],
            ].map(([c, on]) => (
              <FlagDot key={c} code={c} active={!!on} dim={!on} size={32} />
            ))}
          </div>
        </div>

        {/* 2 — per-language compact row */}
        <div style={{ marginTop: 12 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>2 · level &amp; goals (per language)</WText>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { code: 'es', lvl: 3, goals: ['grammar', 'speaking'], primary: true },
              { code: 'fr', lvl: 2, goals: ['vocab'], primary: false },
              { code: 'ja', lvl: 1, goals: ['speaking', 'reading'], primary: false },
              { code: 'de', lvl: 1, goals: [], primary: false },
            ].map((l) => (
              <div key={l.code} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px', border: `1.2px solid ${WF.ink}`, borderRadius: 5,
                background: l.primary ? WF.hiliteSoft : WF.card,
              }}>
                <FlagDot code={l.code} size={26} />
                <div style={{ display: 'flex', gap: 2 }}>
                  {['A1','A2','B1','B2','C1','C2'].map((lv, i) => (
                    <div key={lv} style={{
                      padding: '2px 7px', borderRadius: 3,
                      fontFamily: WF.uiFont, fontSize: 10,
                      background: i === l.lvl ? WF.ink : 'transparent',
                      color: i === l.lvl ? WF.paper : WF.inkSoft,
                      border: `1px solid ${i === l.lvl ? WF.ink : 'transparent'}`,
                    }}>{lv}</div>
                  ))}
                </div>
                <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {['grammar', 'speaking', 'listening', 'writing', 'vocab', 'reading'].map((g) => (
                    <WChip key={g} fill={l.goals.includes(g) ? WF.ink : 'transparent'} color={l.goals.includes(g) ? WF.paper : WF.inkMute} style={{ fontSize: 10 }}>
                      <span style={{ color: l.goals.includes(g) ? WF.paper : WF.inkMute }}>{g}</span>
                    </WChip>
                  ))}
                </div>
                {l.primary && <WChip fill={WF.accent} color={WF.accent} style={{ fontSize: 9 }}><span style={{ color: WF.paper }}>★ primary</span></WChip>}
              </div>
            ))}
          </div>
        </div>

        {/* 3 — schedule + assessment */}
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <WBox pad={10}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>3 · daily target</WText>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {['5 min', '10 min', '20 min', '30+ min'].map((t, i) => (
                <div key={t} style={{
                  flex: 1, padding: '6px 0', textAlign: 'center',
                  border: `1.2px solid ${WF.ink}`, borderRadius: 4,
                  background: i === 1 ? WF.ink : 'transparent',
                  color: i === 1 ? WF.paper : WF.ink,
                  fontFamily: WF.uiFont, fontSize: 11,
                }}>{t}</div>
              ))}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
              <WCheck on />
              <WText size={11}>nudge me on quiet days (no streaks)</WText>
            </div>
          </WBox>

          <div style={{ padding: 10, border: `2px solid ${WF.accent}`, borderRadius: 6, background: WF.accentSoft, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <WText size={10} color={WF.accent} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>4 · self-assessment (optional)</WText>
              <div style={{ marginTop: 4 }}>
                <WLabel size={15}>5-min adaptive placement test</WLabel>
              </div>
              <WText size={11} color={WF.inkSoft}>per-language. mixes recognition, cloze, listening. lands you on the right CEFR band.</WText>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <WBtn size={11}>maybe later</WBtn>
              <WBtn primary size={11} style={{ flex: 1 }}>start with es →</WBtn>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <WText size={11} color={WF.inkMute}>esc to skip everything · refine in settings</WText>
          <WBtn primary size={13}>finish setup →</WBtn>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 14 }} tilt={3} arrow="right">power users get<br/>everything in one view</WMargin>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// Self-assessment test screen — referenced by all 3
function OnbTest() {
  return (
    <WShell title="placement test · español" lang="—" noHeader>
      <div style={{ padding: '16px 28px 0', borderBottom: `1.5px solid ${WF.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>placement · español</WText>
          <WChip fill={WF.accent} color={WF.accent}><span style={{ color: WF.paper }}>adaptive</span></WChip>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WText size={11} color={WF.inkSoft}>~3 min left · item 7</WText>
          <div style={{ width: 100, height: 6, border: `1.2px solid ${WF.ink}`, borderRadius: 3, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, width: '55%', background: WF.accent, borderRadius: 3 }} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '24px 36px', display: 'flex', flexDirection: 'column' }}>
        {/* drift indicator — adaptive shows where you are */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>current band</WText>
          <div style={{ display: 'flex', gap: 2 }}>
            {['A1','A2','B1','B2','C1','C2'].map((lv, i) => (
              <div key={lv} style={{
                padding: '2px 8px', borderRadius: 3,
                fontFamily: WF.monoFont, fontSize: 10,
                background: i === 3 ? WF.accent : i === 2 ? WF.accentSoft : 'transparent',
                color: i === 3 ? WF.paper : WF.ink,
                border: `1px solid ${i <= 3 ? WF.ink : WF.inkMute}`,
                opacity: i > 3 ? 0.4 : 1,
              }}>{lv}</div>
            ))}
          </div>
          <WText size={10} color={WF.inkMute}>· narrowing toward B2</WText>
        </div>

        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>question 7 · grammar choice</WText>
        <WLabel size={22} style={{ marginTop: 6 }}>which sounds most natural?</WLabel>

        <div style={{
          marginTop: 12, padding: 14, background: WF.paperAlt, borderRadius: 6,
          fontFamily: WF.uiFont, fontSize: 14, lineHeight: 1.6, color: WF.inkSoft,
        }}>
          mi hermana siempre se queja de que sus hijos no ___ a tiempo a la cena.
        </div>

        {/* options */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['llegan', false],
            ['lleguen', true],
            ['llegarán', false],
            ['llegaran', false],
          ].map(([w, sel]) => (
            <div key={w} style={{
              padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
              border: `1.3px solid ${WF.ink}`, borderRadius: 5,
              background: sel ? WF.hiliteSoft : WF.card,
              boxShadow: `1px 1.5px 0 ${WF.ink}22`,
            }}>
              <WRadio on={sel} />
              <WMono size={14}>{w}</WMono>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', justifyContent: 'space-between', paddingTop: 14 }}>
          <WBtn size={11}>I don't know · skip</WBtn>
          <WBtn primary size={13}>submit →</WBtn>
        </div>
      </div>
      <WMargin style={{ position: 'absolute', right: 14, top: 60 }} tilt={2} arrow="right">"don't know" is fine —<br/>signal, not failure</WMargin>
    </WShell>
  );
}

Object.assign(window, { OnbA, OnbB, OnbC, OnbTest });
