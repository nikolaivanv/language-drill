// Mobile progress / stats — radar + heatmap + frequency

function MobileProgress() {
  return (
    <MScreen>
      <MTopbar title="progress" right={<button style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', color: M.ink }}>···</button>} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>
        {/* current level */}
        <div style={{ padding: 16, background: M.ink, color: M.paper, borderRadius: M.r3, marginBottom: 16 }}>
          <div style={{ ...T.micro, color: 'rgba(250,247,241,0.6)', marginBottom: 4 }}>your level</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ ...T.display(40), color: M.paper, lineHeight: 1 }}>B1+</div>
            <div style={{ ...T.ui(12), color: 'rgba(250,247,241,0.7)' }}>tracking toward B2</div>
          </div>
          <div style={{ marginTop: 14, height: 6, background: 'rgba(250,247,241,0.18)', borderRadius: 3, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '68%', background: M.paper, borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...T.ui(11), color: 'rgba(250,247,241,0.6)', marginTop: 6 }}>
            <span>B1</span>
            <span>~38 sessions to B2</span>
            <span>B2</span>
          </div>
        </div>

        {/* skill radar */}
        <div style={{ ...T.micro, marginBottom: 8 }}>skill profile</div>
        <MCard style={{ padding: 16, marginBottom: 16 }}>
          <RadarChart />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            {[
              { k: 'reading', v: 'B2-' }, { k: 'listening', v: 'B1+' },
              { k: 'grammar', v: 'B1' }, { k: 'speaking', v: 'A2+' },
              { k: 'writing', v: 'B1' }, { k: 'vocab', v: 'B1+' },
            ].map(s => (
              <div key={s.k} style={{ display: 'flex', justifyContent: 'space-between', ...T.ui(12) }}>
                <span style={{ color: M.inkSoft }}>{s.k}</span>
                <span style={{ ...T.mono(12), color: M.ink, fontWeight: 600 }}>{s.v}</span>
              </div>
            ))}
          </div>
        </MCard>

        {/* streak heatmap */}
        <div style={{ ...T.micro, marginBottom: 8 }}>last 12 weeks</div>
        <MCard style={{ padding: 14, marginBottom: 16 }}>
          <Heatmap />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, ...T.ui(11), color: M.inkSoft }}>
            <span>72 of 84 days</span>
            <span>longest streak: <b style={{ color: M.ink }}>18</b></span>
          </div>
        </MCard>

        {/* vocab frequency */}
        <div style={{ ...T.micro, marginBottom: 8 }}>active vocabulary</div>
        <MCard style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ ...T.display(28), lineHeight: 1, fontWeight: 500 }}>3,184</div>
              <div style={{ ...T.ui(12), color: M.inkSoft, marginTop: 2 }}>of top 5,000 words known</div>
            </div>
            <div style={{ ...T.mono(12), color: M.ok, fontWeight: 600 }}>+47 this week</div>
          </div>
          <MBar pct={63.7} color={M.ink} height={6} />
          <div style={{ ...T.ui(11), color: M.inkMute, marginTop: 8, fontStyle: 'italic' }}>
            ≈ B2 active range. ~800 more for solid B2.
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {[
              { band: '1k', pct: 92 }, { band: '2k', pct: 81 },
              { band: '3k', pct: 68 }, { band: '4k', pct: 42 },
              { band: '5k', pct: 18 }, { band: '6k+', pct: 4 },
            ].map(b => (
              <div key={b.band} style={{ flex: 1 }}>
                <div style={{ height: 36, background: M.paper3, borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${b.pct}%`, background: M.ink }} />
                </div>
                <div style={{ ...T.mono(10), color: M.inkSoft, textAlign: 'center', marginTop: 4 }}>{b.band}</div>
              </div>
            ))}
          </div>
        </MCard>

        {/* milestones */}
        <div style={{ ...T.micro, marginBottom: 8 }}>milestones</div>
        <MCard style={{ padding: 14 }}>
          {[
            { t: 'first 1,000 words active', d: '8 weeks ago', done: true },
            { t: 'pluscuamperfecto unlocked', d: '4 days ago', done: true },
            { t: 'first conversation drill', d: 'unlocks at B2', done: false },
            { t: 'subjunctive mode', d: 'next on the path', done: false, current: true },
          ].map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < 3 ? `1px dashed ${M.rule}` : 'none' }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11,
                background: m.done ? M.ok : m.current ? M.accent : M.paper2,
                color: m.done || m.current ? '#fff' : M.inkMute,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, flexShrink: 0,
              }}>{m.done ? '✓' : m.current ? '●' : '○'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...T.ui(13), color: m.done ? M.inkSoft : M.ink }}>{m.t}</div>
                <div style={{ ...T.ui(11), color: M.inkMute }}>{m.d}</div>
              </div>
            </div>
          ))}
        </MCard>
      </div>
      <MBottomNav current="progress" />
    </MScreen>
  );
}

function RadarChart() {
  const skills = [
    { k: 'reading', v: 0.78 }, { k: 'listening', v: 0.70 },
    { k: 'grammar', v: 0.58 }, { k: 'speaking', v: 0.44 },
    { k: 'writing', v: 0.52 }, { k: 'vocab', v: 0.64 },
  ];
  const cx = 130, cy = 130, R = 95;
  const angle = (i) => (i / skills.length) * 2 * Math.PI - Math.PI / 2;
  const point = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];
  const path = skills.map((s, i) => {
    const [x, y] = point(i, R * s.v);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';
  return (
    <svg width="100%" height="260" viewBox="0 0 260 260" style={{ display: 'block', margin: '0 auto', maxWidth: 260 }}>
      {[0.25, 0.5, 0.75, 1].map(r => (
        <polygon key={r} points={skills.map((_, i) => point(i, R * r).join(',')).join(' ')}
          fill="none" stroke={M.rule} strokeWidth={r === 1 ? 1.5 : 1} />
      ))}
      {skills.map((s, i) => {
        const [x2, y2] = point(i, R);
        return <line key={s.k} x1={cx} y1={cy} x2={x2} y2={y2} stroke={M.rule} strokeWidth="1" />;
      })}
      <path d={path} fill={M.ink} fillOpacity={0.12} stroke={M.ink} strokeWidth={1.6} strokeLinejoin="round" />
      {skills.map((s, i) => {
        const [x, y] = point(i, R * s.v);
        return <circle key={s.k} cx={x} cy={y} r={3.5} fill={M.ink} />;
      })}
      {skills.map((s, i) => {
        const [x, y] = point(i, R + 16);
        return <text key={s.k} x={x} y={y} fill={M.inkSoft} fontFamily={M.fontUI} fontSize="11"
          textAnchor="middle" dominantBaseline="middle">{s.k}</text>;
      })}
    </svg>
  );
}

function Heatmap() {
  const days = 12 * 7;
  const cells = Array.from({ length: days }, (_, i) => {
    if (i > days - 3) return 0;
    const r = Math.sin(i * 1.3) * 0.5 + 0.5;
    return Math.floor(r * 4) + (i % 9 === 0 ? -1 : 0);
  });
  const colors = [M.paper3, '#ddd2bc', '#a8997b', '#5c4f3a', M.ink];
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
      {Array.from({ length: 12 }, (_, w) => (
        <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: 7 }, (_, d) => {
            const idx = w * 7 + d;
            const v = Math.max(0, Math.min(4, cells[idx] ?? 0));
            return <div key={d} style={{ width: 22, height: 14, borderRadius: 3, background: colors[v] }} />;
          })}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { MobileProgress });
