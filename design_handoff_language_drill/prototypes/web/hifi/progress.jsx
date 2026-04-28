// Progress — radar (A) + heatmap (B) tabs

function ProgressHiFi({ onNav }) {
  const [tab, setTab] = React.useState('shape');
  return (
    <AppShell current="progress" onNav={onNav}>
      <div className="main-inner">
        <div className="t-micro">español · B2 · 6 weeks in</div>
        <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>your progress.</h1>
        <p className="t-body-l" style={{ marginTop: 8, maxWidth: 560 }}>
          honest skill numbers. no XP, no levels — just where you actually are.
        </p>

        <div style={{ marginTop: 28, borderBottom: '1px solid var(--rule)', display: 'flex', gap: 4 }}>
          {[
            { id: 'shape', label: 'shape' },
            { id: 'heatmap', label: 'practice heatmap' },
            { id: 'history', label: 'history' },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '12px 16px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${tab === t.id ? 'var(--ink)' : 'transparent'}`,
              color: tab === t.id ? 'var(--ink)' : 'var(--ink-soft)',
              fontWeight: tab === t.id ? 500 : 400, fontSize: 14, marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'shape' && <ShapeTab />}
        {tab === 'heatmap' && <HeatmapTab />}
        {tab === 'history' && <HistoryTab />}
      </div>
    </AppShell>
  );
}

function ShapeTab() {
  const skills = [
    { n: 'subjunctive', v: 0.71 }, { n: 'conditional', v: 0.44 }, { n: 'preterite', v: 0.58 },
    { n: 'listening', v: 0.82 }, { n: 'speaking', v: 0.64 }, { n: 'vocab', v: 0.76 },
    { n: 'pronouns', v: 0.66 }, { n: 'reading', v: 0.88 },
  ];
  const skillsOld = [
    { v: 0.62 }, { v: 0.38 }, { v: 0.55 }, { v: 0.78 }, { v: 0.58 }, { v: 0.7 }, { v: 0.55 }, { v: 0.84 },
  ];
  const cx = 220, cy = 220, R = 170;
  const ang = (i) => (Math.PI * 2 * i) / skills.length - Math.PI / 2;
  const pts = (arr) => arr.map((s, i) => `${cx + Math.cos(ang(i)) * R * s.v},${cy + Math.sin(ang(i)) * R * s.v}`).join(' ');
  return (
    <div className="fade-in" style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 320px', gap: 32 }}>
      <div className="card" style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
        <svg width="440" height="440" viewBox="0 0 440 440">
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <polygon key={r}
              points={skills.map((_, i) => `${cx + Math.cos(ang(i)) * R * r},${cy + Math.sin(ang(i)) * R * r}`).join(' ')}
              fill="none" stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4" />
          ))}
          {skills.map((s, i) => {
            const x = cx + Math.cos(ang(i)) * R, y = cy + Math.sin(ang(i)) * R;
            const tx = cx + Math.cos(ang(i)) * (R + 26), ty = cy + Math.sin(ang(i)) * (R + 26);
            return (
              <g key={i}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--rule)" strokeWidth="0.6" />
                <text x={tx} y={ty + 5} fontFamily="Inter" fontSize="12" fill="var(--ink-soft)" textAnchor="middle">{s.n}</text>
              </g>
            );
          })}
          <polygon points={pts(skillsOld)} fill="var(--ink)" fillOpacity="0.06" stroke="var(--ink-mute)" strokeWidth="1" strokeDasharray="3 4" />
          <polygon points={pts(skills)} fill="var(--accent)" fillOpacity="0.18" stroke="var(--accent)" strokeWidth="2" />
          {skills.map((s, i) => {
            const x = cx + Math.cos(ang(i)) * R * s.v, y = cy + Math.sin(ang(i)) * R * s.v;
            return <circle key={i} cx={x} cy={y} r="4" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />;
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card" style={{ padding: 16, background: 'var(--accent-soft)', borderColor: 'var(--accent-soft)' }}>
          <div className="t-micro" style={{ color: 'var(--accent-2)' }}>observation</div>
          <div className="t-body" style={{ marginTop: 6, color: 'var(--ink)' }}>
            you're strong at <strong>input</strong> (reading, listening) and weaker at <strong>production</strong> (conditional, speaking).
            classic intermediate plateau shape.
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="t-micro">compare to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--accent)', opacity: 0.6 }} /> you · now
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'transparent', border: '1.5px dashed var(--ink-mute)' }} /> you · 30 days ago
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: 'transparent', border: '1.5px solid var(--ink-mute)' }} /> avg learner @ B2
            </label>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="t-micro">recommended drill</div>
          <div className="t-display-s" style={{ marginTop: 6 }}>conditional perfect</div>
          <div className="t-small" style={{ marginTop: 4 }}>weakest skill, hasn't moved in 14 days.</div>
          <button className="btn primary sm" style={{ marginTop: 10 }}>start 8-min drill →</button>
        </div>
      </div>
    </div>
  );
}

function HeatmapTab() {
  const topics = ['subjunctive', 'conditional', 'preterite vs imperfect', 'ser/estar', 'object pronouns', 'articles & gender', 'prepositions', 'verb agreement'];
  const days = 30;
  const data = topics.map((_, i) => Array.from({ length: days }, (_, d) => {
    const seed = (i * 17 + d * 13 + i * d) % 100;
    if (seed > 82) return 0; if (seed > 60) return 1; if (seed > 30) return 2; return 3;
  }));
  const shade = ['transparent', 'var(--paper-2)', 'var(--accent-soft)', 'var(--accent)'];
  return (
    <div className="fade-in" style={{ marginTop: 28 }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
          <div>
            <div className="t-display-s">topic × recency · last 30 days</div>
            <div className="t-small">darker = more recent and intense</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="t-small">less</span>
            {shade.map((c, i) => (<div key={i} style={{ width: 14, height: 14, background: c, border: '1px solid var(--rule)', borderRadius: 2 }} />))}
            <span className="t-small">more</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {topics.map((t, i) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 170, fontSize: 12, textAlign: 'right' }}>{t}</div>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {data[i].map((v, d) => (
                  <div key={d} style={{ flex: 1, aspectRatio: 1, maxHeight: 22, background: shade[v], border: '1px solid rgba(26,22,18,0.08)', borderRadius: 3 }} />
                ))}
              </div>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', width: 36 }}>{[71,44,58,83,66,92,55,78][i]}%</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card" style={{ padding: 16, background: 'var(--hilite-soft)', borderColor: 'var(--hilite-soft)' }}>
          <div className="t-micro">🔥 hottest</div>
          <div className="t-display-s" style={{ marginTop: 4 }}>subjunctive</div>
          <div className="t-small" style={{ marginTop: 2 }}>9 of last 14 days · paying off</div>
        </div>
        <div className="card" style={{ padding: 16, background: 'var(--accent-soft)', borderColor: 'var(--accent-soft)' }}>
          <div className="t-micro" style={{ color: 'var(--accent-2)' }}>❄ coldest</div>
          <div className="t-display-s" style={{ marginTop: 4 }}>conditional</div>
          <div className="t-small" style={{ marginTop: 2 }}>untouched 12 days</div>
        </div>
      </div>
    </div>
  );
}

function HistoryTab() {
  return (
    <div className="fade-in" style={{ marginTop: 28 }}>
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mute)' }}>
        <div className="t-display-s" style={{ color: 'var(--ink-soft)' }}>history view</div>
        <div className="t-small" style={{ marginTop: 6 }}>(stub — sparkline trends per skill, 30/60/90/all)</div>
      </div>
    </div>
  );
}

Object.assign(window, { ProgressHiFi });
