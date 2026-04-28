// Mobile onboarding — matches desktop structure:
// 4 steps (languages → primary+level → goals → schedule)
// Self-reported level + opt-in placement test on step 2.

const ALL_LANGS_M = [
  { code: 'es', name: 'español', tag: 'es' },
  { code: 'fr', name: 'français', tag: 'fr' },
  { code: 'ja', name: '日本語', tag: 'ja' },
  { code: 'de', name: 'deutsch', tag: 'de' },
  { code: 'it', name: 'italiano', tag: 'it' },
  { code: 'pt', name: 'português', tag: 'pt' },
  { code: 'zh', name: '中文', tag: 'zh' },
  { code: 'ko', name: '한국어', tag: 'ko' },
];

const LEVELS_M = [
  { code: 'A1', name: 'beginner', desc: 'basic phrases, hello / goodbye' },
  { code: 'A2', name: 'elementary', desc: 'simple convos, familiar topics' },
  { code: 'B1', name: 'intermediate', desc: 'can handle most situations' },
  { code: 'B2', name: 'upper int.', desc: 'fluent on familiar topics, some friction' },
  { code: 'C1', name: 'advanced', desc: 'comfortable, occasional gaps' },
  { code: 'C2', name: 'mastery', desc: 'near-native, all registers' },
];

const GOALS_M = [
  { id: 'grammar', label: 'grammar', desc: 'subjunctive, tenses, conjugation' },
  { id: 'speaking', label: 'speaking fluency', desc: 'real conversations, less hesitation' },
  { id: 'listening', label: 'fast speech', desc: 'podcasts, native speakers, films' },
  { id: 'writing', label: 'writing', desc: 'emails, essays, longer texts' },
  { id: 'vocab', label: 'vocabulary', desc: 'expanding active range' },
  { id: 'travel', label: 'trip / convo prep', desc: 'specific upcoming need' },
];

function MobileOnboarding({ initialStep = 1 } = {}) {
  // initialStep = which screen state to render (0..3 = the four steps)
  const step = initialStep;
  const data = {
    languages: ['es', 'fr', 'ja'],
    primary: 'es',
    level: 2, // B1
    goals: ['grammar', 'speaking'],
    schedule: 10,
    nudge: true,
  };

  return (
    <MScreen>
      {/* progress + back */}
      <div style={{ padding: '10px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', visibility: step === 0 ? 'hidden' : 'visible' }}>
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M11 4l-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ flex: 1, display: 'flex', gap: 4 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{
              flex: i === step ? 2 : 1, height: 4, borderRadius: 2,
              background: i <= step ? M.ink : M.paper3, transition: 'all .25s',
            }} />
          ))}
        </div>
        <span style={{ ...T.mono(11), color: M.inkSoft }}>{step + 1}/4</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 20px' }}>
        {step === 0 && <StepLanguages data={data} />}
        {step === 1 && <StepLevel data={data} />}
        {step === 2 && <StepGoals data={data} />}
        {step === 3 && <StepSchedule data={data} />}
      </div>

      {/* sticky CTA */}
      <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${M.rule}`, background: M.paper, flexShrink: 0, display: 'flex', gap: 8 }}>
        <MBtn variant="ghost" size="lg" style={{ flex: 1, visibility: step === 0 ? 'hidden' : 'visible' }}>back</MBtn>
        <MBtn variant="primary" size="lg" style={{ flex: 2 }}>{step < 3 ? 'continue →' : 'finish setup →'}</MBtn>
      </div>
    </MScreen>
  );
}

function StepLanguages({ data }) {
  return (
    <div>
      <div style={{ ...T.micro }}>step 1</div>
      <h1 style={{ ...T.display(26), margin: '4px 0 8px', lineHeight: 1.2, letterSpacing: '-0.3px' }}>which languages?</h1>
      <p style={{ ...T.ui(13), color: M.inkSoft, margin: '0 0 18px', lineHeight: 1.5 }}>pick any you're working on — even ones you haven't started yet.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {ALL_LANGS_M.map(l => {
          const on = data.languages.includes(l.code);
          return (
            <div key={l.code} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
              borderRadius: M.r2, cursor: 'pointer',
              background: on ? M.ink : M.card, color: on ? M.paper : M.ink,
              border: `1.5px solid ${on ? M.ink : M.rule}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 16,
                background: on ? M.paper : M.paper2,
                color: on ? M.ink : M.inkSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                ...T.mono(11), fontWeight: 700, flexShrink: 0,
              }}>{l.tag}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...T.display(14), color: 'inherit' }}>{l.name}</div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: 4,
                border: `1.5px solid ${on ? M.paper : M.ruleStrong}`,
                background: on ? M.paper : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {on && <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5L4.5 8 9 3" stroke={M.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepLevel({ data }) {
  return (
    <div>
      <div style={{ ...T.micro }}>step 2</div>
      <h1 style={{ ...T.display(26), margin: '4px 0 8px', lineHeight: 1.25, letterSpacing: '-0.3px' }}>
        your <span style={{ background: M.hiliteSoft, padding: '0 4px', borderRadius: 3 }}>spanish</span> level?
      </h1>
      <p style={{ ...T.ui(13), color: M.inkSoft, margin: '0 0 18px', lineHeight: 1.5 }}>
        don't overthink it. you can always retake the placement test later.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {LEVELS_M.map((l, i) => {
          const on = data.level === i;
          return (
            <div key={l.code} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderRadius: M.r2, cursor: 'pointer',
              background: on ? M.card : M.card,
              border: `1.5px solid ${on ? M.ink : M.rule}`,
            }}>
              <div style={{ ...T.mono(13), fontWeight: 700, width: 32, color: on ? M.ink : M.inkMute }}>{l.code}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...T.display(14), color: M.ink }}>{l.name}</div>
                <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 1 }}>{l.desc}</div>
              </div>
              <div style={{
                width: 18, height: 18, borderRadius: 9,
                border: `1.5px solid ${on ? M.ink : M.ruleStrong}`,
                background: 'transparent', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {on && <div style={{ width: 8, height: 8, borderRadius: 4, background: M.ink }} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* placement test opt-in callout */}
      <div style={{
        marginTop: 16, padding: 14,
        border: `1px dashed ${M.ruleStrong}`, borderRadius: M.r3,
        background: M.paper,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ ...T.hand(20), color: M.inkSoft, lineHeight: 1 }}>not sure?</span>
        </div>
        <div style={{ ...T.ui(13), color: M.ink, lineHeight: 1.5, marginBottom: 12 }}>
          take a 5-min adaptive placement test for a more accurate band.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <MBtn variant="primary" size="md" style={{ flex: 1 }}>take it now →</MBtn>
          <MBtn variant="bare" size="md" style={{ color: M.inkMute }}>later</MBtn>
        </div>
      </div>
    </div>
  );
}

function StepGoals({ data }) {
  return (
    <div>
      <div style={{ ...T.micro }}>step 3</div>
      <h1 style={{ ...T.display(26), margin: '4px 0 8px', lineHeight: 1.2, letterSpacing: '-0.3px' }}>what to drill?</h1>
      <p style={{ ...T.ui(13), color: M.inkSoft, margin: '0 0 18px', lineHeight: 1.5 }}>i'll prioritize these in your daily plan. pick as many as fit.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {GOALS_M.map(g => {
          const on = data.goals.includes(g.id);
          return (
            <div key={g.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderRadius: M.r2, cursor: 'pointer',
              background: M.card, border: `1.5px solid ${on ? M.ink : M.rule}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...T.display(14), color: M.ink }}>{g.label}</div>
                <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 1 }}>{g.desc}</div>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: 4,
                border: `1.5px solid ${on ? M.ink : M.ruleStrong}`,
                background: on ? M.ink : 'transparent', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {on && <svg width="12" height="12" viewBox="0 0 11 11" fill="none"><path d="M2 5.5L4.5 8 9 3" stroke={M.paper} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18 }}>
        <div style={{ ...T.ui(11), color: M.inkSoft, marginBottom: 6 }}>anything specific i should know? (optional)</div>
        <div style={{
          padding: 12, borderRadius: M.r2,
          background: M.card, border: `1px solid ${M.rule}`,
          ...T.ui(13), color: M.inkMute, fontStyle: 'italic', minHeight: 64,
        }}>
          e.g. I keep mixing up preterite vs imperfect…
        </div>
      </div>
    </div>
  );
}

function StepSchedule({ data }) {
  const opts = [5, 10, 20, 30];
  return (
    <div>
      <div style={{ ...T.micro }}>step 4</div>
      <h1 style={{ ...T.display(26), margin: '4px 0 8px', lineHeight: 1.2, letterSpacing: '-0.3px' }}>time per day?</h1>
      <p style={{ ...T.ui(13), color: M.inkSoft, margin: '0 0 18px', lineHeight: 1.5 }}>
        consistent and short beats long and irregular. you can change this anytime.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {opts.map(m => {
          const on = data.schedule === m;
          return (
            <div key={m} style={{
              padding: '20px 12px', borderRadius: M.r2,
              background: M.card, border: `1.5px solid ${on ? M.ink : M.rule}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              cursor: 'pointer',
            }}>
              <div style={{ ...T.display(28), color: on ? M.ink : M.inkSoft, fontWeight: 500, lineHeight: 1 }}>{m}</div>
              <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 2 }}>min / day</div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 16, padding: 14,
        background: M.card, border: `1px solid ${M.rule}`, borderRadius: M.r2,
        display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: 4, marginTop: 1,
          border: `1.5px solid ${data.nudge ? M.ink : M.ruleStrong}`,
          background: data.nudge ? M.ink : 'transparent', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {data.nudge && <svg width="12" height="12" viewBox="0 0 11 11" fill="none"><path d="M2 5.5L4.5 8 9 3" stroke={M.paper} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ ...T.display(14), color: M.ink }}>gentle nudges on quiet days</div>
          <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 2, lineHeight: 1.5 }}>
            no streak shaming. one calm note if you've missed two days, never more.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...T.hand(17), color: M.accent }}>p.s.</span>
        <span style={{ ...T.ui(12), color: M.inkSoft }}>no XP, no levels, no leaderboards.</span>
      </div>
    </div>
  );
}

Object.assign(window, { MobileOnboarding });
