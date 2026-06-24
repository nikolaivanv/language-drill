// Onboarding — conversational flow (variant A from wireframes), polished.
// 4 steps: languages → primary + level → goals → schedule → done.
// Coach pane on left summarizes what's been chosen.

function OnbHiFi({ onDone }) {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({
    languages: ['es', 'fr', 'ja', 'de'],
    primary: 'es',
    level: 3, // B2
    goals: ['grammar', 'speaking'],
    schedule: 10,
    nudge: true,
    note: '',
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const steps = ['languages', 'level', 'goals', 'schedule'];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--paper)' }}>
      {/* Left coach rail */}
      <aside style={{ width: 320, background: 'var(--paper-2)', borderRight: '1px solid var(--rule)', padding: '40px 28px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12 13 4.5" stroke="#c96442" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div className="brand-name">drill</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-display)', fontSize: 22, fontWeight: 600 }}>c</div>
          <div>
            <div className="t-display-s">coach</div>
            <div className="t-small">your AI tutor</div>
          </div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 14, marginBottom: 22 }}>
          <div className="t-body" style={{ fontSize: 13 }}>
            {step === 0 && "let's start with languages. you can add more later."}
            {step === 1 && "for spanish — where would you place yourself? rough is fine."}
            {step === 2 && "what do you want to drill? pick whatever fits — even all of them."}
            {step === 3 && "last thing — how much time can you usually give me?"}
          </div>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <div className="t-micro" style={{ marginBottom: 10 }}>so far</div>
          {[
            { label: 'languages', filled: data.languages.length > 0, val: data.languages.length ? data.languages.length + ' selected' : null, idx: 0 },
            { label: 'primary + level', filled: step > 1, val: step > 1 ? data.primary.toUpperCase() + ' · ' + ['A1','A2','B1','B2','C1','C2'][data.level] : null, idx: 1 },
            { label: 'goals', filled: step > 2, val: step > 2 ? data.goals.length + ' picked' : null, idx: 2 },
            { label: 'schedule', filled: step > 3, val: step > 3 ? data.schedule + ' min/day' : null, idx: 3 },
          ].map((it) => (
            <div key={it.label} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--rule)', alignItems: 'center' }}>
              <span style={{ width: 16, color: it.filled ? 'var(--ok)' : it.idx === step ? 'var(--accent)' : 'var(--ink-mute)', fontSize: 14 }}>
                {it.filled ? '✓' : it.idx === step ? '●' : '○'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: it.idx === step ? 'var(--ink)' : 'var(--ink-soft)' }}>{it.label}</div>
                {it.val && <div className="t-small" style={{ fontSize: 11 }}>{it.val}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="t-hand" style={{ fontSize: 16, color: 'var(--ink-mute)', marginTop: 16, lineHeight: 1.3 }}>
          ~2 min total · skip anything
        </div>
      </aside>

      {/* Right pane: current question */}
      <section style={{ flex: 1, padding: '56px 64px', display: 'flex', flexDirection: 'column', maxWidth: 760 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
          {steps.map((s, i) => (
            <div key={s} style={{ height: 4, flex: i === step ? 2 : 1, background: i <= step ? 'var(--ink)' : 'var(--paper-3)', borderRadius: 2, transition: 'all .25s' }} />
          ))}
        </div>

        <div className="fade-in" key={step}>
          {step === 0 && <OnbStepLanguages data={data} set={set} />}
          {step === 1 && <OnbStepLevel data={data} set={set} />}
          {step === 2 && <OnbStepGoals data={data} set={set} />}
          {step === 3 && <OnbStepSchedule data={data} set={set} />}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn ghost" onClick={() => step > 0 ? setStep(step - 1) : null} style={{ visibility: step === 0 ? 'hidden' : 'visible' }}>← back</button>
          <div className="t-small" style={{ fontFamily: 'var(--t-mono)', fontSize: 11 }}>{step + 1} / {steps.length}</div>
          <button className="btn primary lg" onClick={() => step < 3 ? setStep(step + 1) : onDone()}>
            {step < 3 ? 'continue' : 'finish setup'} →
          </button>
        </div>
      </section>
    </div>
  );
}

const ALL_LANGS = [
  { code: 'es', name: 'español', cls: '', flag: '🇪🇸' },
  { code: 'fr', name: 'français', cls: 'fr', flag: '🇫🇷' },
  { code: 'ja', name: '日本語', cls: 'ja', flag: '🇯🇵' },
  { code: 'de', name: 'deutsch', cls: 'de', flag: '🇩🇪' },
  { code: 'it', name: 'italiano', cls: '', flag: '🇮🇹' },
  { code: 'pt', name: 'português', cls: '', flag: '🇵🇹' },
  { code: 'zh', name: '中文', cls: 'ja', flag: '🇨🇳' },
  { code: 'ko', name: '한국어', cls: 'ja', flag: '🇰🇷' },
];

function OnbStepLanguages({ data, set }) {
  const toggle = (c) => set('languages', data.languages.includes(c) ? data.languages.filter((x) => x !== c) : [...data.languages, c]);
  return (
    <div>
      <div className="t-micro">step 1</div>
      <h1 className="t-display-l" style={{ marginTop: 6, marginBottom: 6 }}>which languages are you learning?</h1>
      <p className="t-body-l">pick any you're working on — even ones you haven't started yet.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 28 }}>
        {ALL_LANGS.map((l) => {
          const on = data.languages.includes(l.code);
          return (
            <button key={l.code} className={`choice ${on ? 'on' : ''}`} onClick={() => toggle(l.code)} style={{ border: 'none', textAlign: 'left' }}>
              <div className={`flagdot ${l.cls}`} style={{ width: 32, height: 32, fontSize: 11 }}>{l.code}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{l.name}</div>
              </div>
              <div className={`checkbox ${on ? 'on' : ''}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OnbStepLevel({ data, set }) {
  const [testState, setTestState] = React.useState('idle'); // 'idle' | 'dismissed' | 'taking'
  const levels = [
    { code: 'A1', name: 'beginner', desc: 'basic phrases, hello / goodbye' },
    { code: 'A2', name: 'elementary', desc: 'simple convos, familiar topics' },
    { code: 'B1', name: 'intermediate', desc: 'can handle most situations' },
    { code: 'B2', name: 'upper int.', desc: 'fluent on familiar topics, some friction' },
    { code: 'C1', name: 'advanced', desc: 'comfortable, occasional gaps' },
    { code: 'C2', name: 'mastery', desc: 'near-native, all registers' },
  ];
  return (
    <div>
      <div className="t-micro">step 2</div>
      <h1 className="t-display-l" style={{ marginTop: 6, marginBottom: 6 }}>
        roughly, where are you with <span className="hilite">spanish</span>?
      </h1>
      <p className="t-body-l">don't overthink it. you can always retake the placement test later.</p>

      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {levels.map((l, i) => {
          const on = data.level === i;
          return (
            <button key={l.code} className={`choice ${on ? 'on' : ''}`} onClick={() => set('level', i)} style={{ border: on ? '1px solid var(--ink)' : '1px solid var(--rule)', textAlign: 'left' }}>
              <div className="t-mono" style={{ width: 38, fontSize: 13, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--ink-mute)' }}>{l.code}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{l.name}</div>
                <div className="t-small">{l.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {testState === 'idle' && (
        <div style={{ marginTop: 16, padding: 14, border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--paper)' }}>
          <span style={{ fontFamily: 'var(--t-hand)', fontSize: 18, color: 'var(--ink-soft)' }}>not sure?</span>
          <span className="t-small" style={{ flex: 1 }}>take a 5-min adaptive placement test for a more accurate band.</span>
          <button className="btn sm" onClick={() => setTestState('taking')}>take it now →</button>
          <button className="btn ghost sm" onClick={() => setTestState('dismissed')} title="i'll do this later from settings">later</button>
        </div>
      )}
      {testState === 'dismissed' && (
        <div className="fade-in" style={{ marginTop: 16, padding: 12, borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ok-soft)', color: 'var(--ok)' }}>
          <span>✓</span>
          <span className="t-small" style={{ flex: 1, color: 'var(--ink)' }}>noted — you can run the placement test anytime from <strong>settings → calibration</strong>.</span>
          <button className="btn ghost sm" onClick={() => setTestState('idle')}>undo</button>
        </div>
      )}
      {testState === 'taking' && (
        <div className="fade-in" style={{ marginTop: 16, padding: 16, borderRadius: 'var(--r-md)', background: 'var(--hilite-soft)', border: '1px solid var(--hilite)' }}>
          <div className="t-micro">placement test · stub</div>
          <div className="t-body" style={{ marginTop: 4 }}>(in the real app, the 5-min adaptive test would launch here.)</div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setTestState('idle')}>cancel</button>
        </div>
      )}
    </div>
  );
}

function OnbStepGoals({ data, set }) {
  const goals = [
    { id: 'grammar', label: 'grammar', desc: 'subjunctive, tenses, conjugation', icon: '📝' },
    { id: 'speaking', label: 'speaking fluency', desc: 'real conversations, less hesitation', icon: '🗣' },
    { id: 'listening', label: 'understanding fast speech', desc: 'podcasts, native speakers, films', icon: '🎧' },
    { id: 'writing', label: 'writing', desc: 'emails, essays, longer texts', icon: '✍️' },
    { id: 'vocab', label: 'vocabulary', desc: 'expanding active range', icon: '📚' },
    { id: 'travel', label: 'prep for a trip / convo', desc: 'specific upcoming need', icon: '🎯' },
  ];
  const toggle = (g) => set('goals', data.goals.includes(g) ? data.goals.filter((x) => x !== g) : [...data.goals, g]);
  return (
    <div>
      <div className="t-micro">step 3</div>
      <h1 className="t-display-l" style={{ marginTop: 6, marginBottom: 6 }}>what do you want to drill?</h1>
      <p className="t-body-l">i'll prioritize these in your daily plan. multi-select.</p>

      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {goals.map((g) => {
          const on = data.goals.includes(g.id);
          return (
            <button key={g.id} className={`choice ${on ? 'on' : ''}`} onClick={() => toggle(g.id)} style={{ border: 'none', alignItems: 'flex-start', padding: 14, gap: 12, textAlign: 'left' }}>
              <span style={{ fontSize: 20 }}>{g.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{g.label}</div>
                <div className="t-small" style={{ marginTop: 2 }}>{g.desc}</div>
              </div>
              <div className={`checkbox ${on ? 'on' : ''}`} />
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 22 }}>
        <label className="t-small" style={{ display: 'block', marginBottom: 6 }}>anything specific i should know? (optional)</label>
        <textarea className="textarea" rows="2" placeholder="e.g. I keep mixing up preterite vs imperfect…" value={data.note} onChange={(e) => set('note', e.target.value)} />
      </div>
    </div>
  );
}

function OnbStepSchedule({ data, set }) {
  const opts = [5, 10, 20, 30];
  return (
    <div>
      <div className="t-micro">step 4</div>
      <h1 className="t-display-l" style={{ marginTop: 6, marginBottom: 6 }}>how much time per day?</h1>
      <p className="t-body-l">consistent and short beats long and irregular. you can change this anytime.</p>

      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {opts.map((m) => {
          const on = data.schedule === m;
          return (
            <button key={m} className={`choice ${on ? 'on' : ''}`} onClick={() => set('schedule', m)} style={{ border: 'none', flexDirection: 'column', padding: '20px 12px', textAlign: 'center', alignItems: 'center', gap: 4 }}>
              <div className="t-display-m" style={{ color: on ? 'var(--ink)' : 'var(--ink-soft)' }}>{m}</div>
              <div className="t-small">min / day</div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 22, padding: 16, border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', background: 'var(--card)' }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }} onClick={() => set('nudge', !data.nudge)}>
          <div className={`checkbox ${data.nudge ? 'on' : ''}`} style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>gentle nudges on quiet days</div>
            <div className="t-small" style={{ marginTop: 2 }}>no streak shaming. one calm note if you've missed two days, never more.</div>
          </div>
        </label>
      </div>

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-soft)' }}>
        <span style={{ fontFamily: 'var(--t-hand)', fontSize: 17, color: 'var(--accent)' }}>p.s.</span>
        <span className="t-small">no XP, no levels, no leaderboards. honest skill numbers only.</span>
      </div>
    </div>
  );
}

Object.assign(window, { OnbHiFi });
