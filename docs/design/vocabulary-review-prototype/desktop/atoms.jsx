// Mini shell + atoms used across all review artboards.
// We don't load hifi/shell.jsx here because we want each artboard self-contained
// and pinned to the "review queue" nav state.

const NAV = [
  { id: 'dashboard', label: 'today', icon: 'home' },
  { id: 'drill', label: 'drill', icon: 'play' },
  { id: 'read', label: 'read', icon: 'book' },
  { id: 'progress', label: 'progress', icon: 'chart' },
  { id: 'theory', label: 'theory', icon: 'theory' },
  { id: 'review', label: 'review queue', icon: 'stack', count: '23' },
];

function RvNavIcon({ kind }) {
  const c = { width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'home')   return <svg {...c} viewBox="0 0 16 16"><path d="M2 7l6-5 6 5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V7z" /><path d="M6 15v-5h4v5" /></svg>;
  if (kind === 'play')   return <svg {...c} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" /><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" /></svg>;
  if (kind === 'chart')  return <svg {...c} viewBox="0 0 16 16"><path d="M2 13V3M2 13h12M5 10l3-4 2 2 4-5" /></svg>;
  if (kind === 'stack')  return <svg {...c} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" rx="1" /><rect x="2" y="7.5" width="12" height="3" rx="1" /><rect x="2" y="12" width="12" height="2" rx="1" /></svg>;
  if (kind === 'book')   return <svg {...c} viewBox="0 0 16 16"><path d="M2.5 3.5h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5h-4.5z" /><path d="M13.5 3.5h-4a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5h4.5z" /></svg>;
  if (kind === 'theory') return <svg {...c} viewBox="0 0 16 16"><path d="M3 2.5h7a2 2 0 0 1 2 2v9l-2.5-1.5L7 13.5l-2.5-1.5L2 13.5v-9a2 2 0 0 1 1-1.5z" /></svg>;
  return null;
}

function RvFrame({ children, current = 'review', lang = 'es', noPad }) {
  // mini language switch — language varies by artboard so we accept a prop
  const langs = { es: { name: 'español', level: 'B2', cls: '' },
                  tr: { name: 'türkçe',  level: 'A2', cls: 'ja' },
                  fr: { name: 'français',level: 'B1', cls: 'fr' },
                  de: { name: 'deutsch', level: 'A2', cls: 'de' } };
  const L = langs[lang];
  return (
    <div className="rv-frame">
      <aside className="rv-nav">
        <div className="rv-brand">
          <div className="mark">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12 13 4.5" stroke="#c96442" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div className="name">drill</div>
        </div>
        <div className="rv-langswitch">
          <div className="left">
            <div className={`flagdot ${L.cls}`}>{lang}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{L.name}</div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{L.level}</div>
            </div>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </div>

        {NAV.map((it) => (
          <button key={it.id} className={`rv-navitem ${current === it.id ? 'active' : ''}`}>
            <RvNavIcon kind={it.icon} />
            <span>{it.label}</span>
            {it.count && <span className="rv-count">{it.count}</span>}
          </button>
        ))}

        <div className="rv-userfoot">
          <div className="rv-avatar">J</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>juno</div>
            <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>polyglot · 4 langs</div>
          </div>
        </div>
      </aside>
      <main className="rv-main">
        {noPad ? children : <div className="rv-main-inner">{children}</div>}
      </main>
    </div>
  );
}

// ─── Atoms ───────────────────────────────────────────────────────

function StatusPill({ kind, children }) {
  return <span className={`rv-status ${kind}`}>{children || kind}</span>;
}

function ItemTypeChip({ kind, label }) {
  const map = {
    cloze:   { label: 'cloze',       cls: 'cloze' },
    meaning: { label: 'meaning → word', cls: 'meaning' },
    useit:   { label: '"use it"',    cls: 'useit' },
    recog:   { label: 'recognition', cls: 'recog' },
    listen:  { label: 'listening',   cls: 'listen' },
  };
  const m = map[kind] || { label, cls: 'recog' };
  return (
    <span className={`rv-mix ${m.cls}`}>
      <span className="dot" />
      {label || m.label}
    </span>
  );
}

function FsrsMeter({ stability, difficulty }) {
  // stability: 0..30 days mapped → 0..100%
  // difficulty: 1..10 mapped → 0..100%, higher = warn
  const sPct = Math.min(100, (stability / 30) * 100);
  const dPct = Math.min(100, (difficulty / 10) * 100);
  return (
    <div className="rv-fsrs">
      <div className="lab">stability</div>
      <div className="bar"><i style={{ width: `${sPct}%` }} /></div>
      <div className="val">{stability.toFixed(1)} d</div>
      <div className="lab">difficulty</div>
      <div className="bar"><i className={difficulty > 7 ? 'warn' : ''} style={{ width: `${dPct}%` }} /></div>
      <div className="val">{difficulty.toFixed(1)} / 10</div>
    </div>
  );
}

function Spark({ history }) {
  // history: array of 'ok' | 'miss' | 'skip', recent first
  const items = history.slice().reverse();
  return (
    <div className="rv-spark">
      {items.map((h, i) => (
        <i key={i}
           className={h === 'miss' ? 'miss' : ''}
           style={{ height: h === 'ok' ? 14 : h === 'miss' ? 8 : 4 }} />
      ))}
    </div>
  );
}

function Coach({ children, avatar = 'c' }) {
  return (
    <div className="rv-coach">
      <div className="av">{avatar}</div>
      <div className="t-body" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{children}</div>
    </div>
  );
}

// little KBD-spaced "↵ to continue" footer
function Kbar({ left, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 18, marginTop: 12, borderTop: '1px solid var(--rule)' }}>
      <div className="t-small">{left}</div>
      <div>{right}</div>
    </div>
  );
}

Object.assign(window, { RvFrame, StatusPill, ItemTypeChip, FsrsMeter, Spark, Coach, Kbar });
