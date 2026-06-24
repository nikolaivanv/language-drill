// Dashboard — 3 distinct directions
// A · Stats-forward (skills at a glance, next drill teed up)
// B · "Today's lesson plan" (coach-curated sessions, editorial)
// C · Unified feed — mix all languages + AI notes on the intermediate plateau

function DashA() {
  return (
    <WShell title="home" lang="es">
      <div style={{ padding: '22px 28px', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>

        {/* greeting + quick mission */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <WLabel size={28}>good morning, juno</WLabel>
            <div style={{ marginTop: 4 }}>
              <WText size={13} color={WF.inkSoft}>last session — <WMono size={11}>2d ago · subjunctive · 71%</WMono></WText>
            </div>
          </div>
          <WMargin tilt={2} arrow="right">honest numbers, no XP</WMargin>
        </div>

        {/* Pick up where you left */}
        <WBox fill={WF.paperAlt} pad={16} style={{ marginBottom: 16, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>next drill · coach pick</WText>
              <div style={{ marginTop: 6, marginBottom: 2 }}>
                <WLabel size={22}>
                  <WHilite>subjunctive in doubt clauses</WHilite>
                </WLabel>
              </div>
              <WText size={12} color={WF.inkSoft}>mixed circuit · 6 items · ~8 min</WText>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <WChip>writing ×2</WChip><WChip>speak ×1</WChip><WChip>cloze ×2</WChip><WChip>listen ×1</WChip>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              <WBtn primary size={14} style={{ padding: '10px 22px' }}>▶  start drill</WBtn>
              <WBtn size={11}>swap topic</WBtn>
            </div>
          </div>
        </WBox>

        {/* skill meters grid */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 18, marginBottom: 10 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>your skills · español</WText>
          <WText size={11} color={WF.inkSoft}>▾ sort: weakest first</WText>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
          {[
            ['subjunctive recall', 71, '+4', 'warn'],
            ['preterite vs imperfect', 58, '−2', 'warn'],
            ['ser/estar contrast', 83, '+1', 'ok'],
            ['object pronouns', 66, '+6', 'ok'],
            ['articles & gender', 92, '—', 'ok'],
            ['conditional mood', 44, 'new', 'warn'],
          ].map(([name, pct, delta, kind]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <WText size={12}>{name}</WText>
                  <WMono size={11} color={kind === 'warn' ? WF.accent : WF.inkSoft}>{pct}%</WMono>
                </div>
                <WBar pct={pct} w="100%" h={6} fill={kind === 'warn' ? WF.accent : WF.ink} />
              </div>
              <WMono size={10} color={WF.inkMute} style={{ width: 26, textAlign: 'right' }}>{delta}</WMono>
            </div>
          ))}
        </div>

        {/* bottom bar — calendar + review queue */}
        <div style={{ display: 'flex', gap: 16, marginTop: 18 }}>
          <WBox pad={12} style={{ flex: 1 }}>
            <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>last 14 days</WText>
            <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
              {[1,1,0,1,1,1,1,0,0,1,1,1,1,1].map((d, i) => (
                <div key={i} style={{ width: 14, height: 18, border: `1.2px solid ${WF.ink}`, background: d ? WF.accent : 'transparent', borderRadius: 2 }} />
              ))}
            </div>
          </WBox>
          <WBox pad={12} style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>review queue</WText>
              <div style={{ marginTop: 4 }}><WLabel size={24}>23</WLabel> <WText size={11} color={WF.inkSoft}>due today</WText></div>
            </div>
            <WArrow w={30} />
          </WBox>
        </div>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// B — Editorial "lesson plan" — written like a coach
function DashB() {
  return (
    <WShell title="home" lang="es">
      <div style={{ padding: '24px 34px', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 2 }}>tuesday · week 6</WText>
          <WText size={11} color={WF.inkSoft}>~22 min planned</WText>
        </div>

        <WLabel size={34} style={{ display: 'block', marginTop: 6 }}>
          today's plan
        </WLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 22 }}>
          <WSquiggle w={180} />
        </div>

        <div style={{ fontFamily: WF.uiFont, fontSize: 14, color: WF.inkSoft, lineHeight: 1.55, maxWidth: 560, marginBottom: 22 }}>
          your <WHilite>subjunctive</WHilite> recall stalled last week. we'll push it today with production, not recognition — and sneak in a listening rep on rapid speech.
        </div>

        {/* 3 lesson cards, vertically stacked like a to-do list */}
        {[
          { n: '01', t: 'warm-up · cloze', d: 'pronoun placement · 4 items', min: '3 min', accent: false, done: true },
          { n: '02', t: 'core · writing drill', d: 'subjunctive in doubt — produce 5 sentences from prompts', min: '9 min', accent: true, done: false },
          { n: '03', t: 'listening rep', d: 'argentine podcast clip · 1.25× · dictation', min: '6 min', accent: false, done: false },
          { n: '04', t: 'cool-down · speak', d: 'summarize today in 3 sentences', min: '4 min', accent: false, done: false },
        ].map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 2px', borderBottom: i < 3 ? `1px dashed ${WF.inkMute}` : 'none', alignItems: 'center' }}>
            <div style={{
              width: 36, height: 36, border: `1.5px solid ${WF.ink}`, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s.accent ? WF.accent : 'transparent',
              color: s.accent ? WF.paper : WF.ink, flexShrink: 0,
            }}>
              <WMono size={11} color={s.accent ? WF.paper : WF.ink}>{s.done ? '✓' : s.n}</WMono>
            </div>
            <div style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.5 : 1 }}>
              <WLabel size={19}>{s.t}</WLabel>
              <div><WText size={12} color={WF.inkSoft}>{s.d}</WText></div>
            </div>
            <WMono size={11} color={WF.inkMute}>{s.min}</WMono>
            {s.accent && <WBtn primary size={12}>start →</WBtn>}
          </div>
        ))}

        <WMargin style={{ position: 'absolute', right: 28, top: 130 }} tilt={3} arrow="right">
          coach-curated;<br />not random
        </WMargin>
      </div>
    </WShell>
  );
}

// ─────────────────────────────────────────────
// C — Unified polyglot feed
function DashC() {
  return (
    <WShell title="home" lang="all">
      <div style={{ padding: '20px 26px', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <WLabel size={26}>today across 4 languages</WLabel>
          <WMargin arrow="right" tilt={2}>one feed, not<br />4 dashboards</WMargin>
        </div>

        {/* language rail with urgency */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            ['es', 'español', 'B2', 'due: 12', WF.accent],
            ['fr', 'français', 'B1', 'due: 8', WF.ink],
            ['ja', '日本語', 'A2', 'due: 20', WF.ink],
            ['de', 'deutsch', 'A2', 'cold 9d', WF.accent],
          ].map(([code, name, lvl, due, c]) => (
            <WBox key={code} pad={10} style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <WLabel size={18}>{code}</WLabel>
                <WMono size={10} color={WF.inkMute}>{lvl}</WMono>
              </div>
              <WText size={11} color={WF.inkSoft}>{name}</WText>
              <div style={{ marginTop: 6 }}>
                <WMono size={10} color={c}>{due}</WMono>
              </div>
            </WBox>
          ))}
        </div>

        {/* feed items */}
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>recommended now</WText>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { lang: 'de', reason: 'hasn\'t been touched in 9 days — warm up with cloze', kind: 'drill', minutes: 5 },
            { lang: 'es', reason: 'subjunctive recall 71% — push with writing', kind: 'drill', minutes: 9 },
            { lang: 'ja', reason: '12 items overdue in SRS · batch review', kind: 'review', minutes: 6 },
            { lang: 'fr', reason: 'new listening set — rapid speech, parisian', kind: 'listen', minutes: 7 },
          ].map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px',
              border: `1.3px solid ${WF.ink}`,
              borderRadius: 6,
              background: i === 0 ? WF.accentSoft : WF.card,
              boxShadow: `1px 1.5px 0 ${WF.ink}22`,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, border: `1.3px solid ${WF.ink}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', background: WF.paper,
              }}><WMono size={10}>{it.lang}</WMono></div>
              <div style={{ flex: 1 }}>
                <WText size={12}>{it.reason}</WText>
              </div>
              <WMono size={10} color={WF.inkMute}>{it.minutes}m</WMono>
              <WBtn size={11}>{it.kind}</WBtn>
            </div>
          ))}
        </div>

        {/* weekly pulse */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <WBox pad={10} style={{ flex: 1 }}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>pulse · 7d</WText>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'flex-end', height: 36 }}>
              {[12, 18, 0, 22, 15, 30, 24].map((v, i) => (
                <div key={i} style={{ flex: 1, height: `${v * 2}%`, background: WF.ink, borderRadius: 1, minHeight: 2 }} />
              ))}
            </div>
          </WBox>
          <WBox pad={10} style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: WF.handFont, fontSize: 20 }}>💡</div>
            <WText size={11} color={WF.inkSoft} style={{ flex: 1, lineHeight: 1.4 }}>
              you're strongest mid-morning. german is your coldest — consider 10min now.
            </WText>
          </WBox>
        </div>
      </div>
    </WShell>
  );
}

Object.assign(window, { DashA, DashB, DashC });
