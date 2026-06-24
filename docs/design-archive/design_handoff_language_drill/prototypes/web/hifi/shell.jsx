// Shared app shell — left nav, language switcher, main area.
// Uses window.AppNav() to navigate between hi-fi screens.

const NAV_ITEMS = [
  { id: 'dashboard', label: 'today', icon: 'home' },
  { id: 'drill', label: 'drill', icon: 'play' },
  { id: 'read', label: 'read', icon: 'book' },
  { id: 'progress', label: 'progress', icon: 'chart' },
  { id: 'review', label: 'review queue', icon: 'stack', count: '12' },
];

const LANGS = [
  { code: 'es', name: 'español', level: 'B2', cls: '' },
  { code: 'fr', name: 'français', level: 'B1', cls: 'fr' },
  { code: 'ja', name: '日本語', level: 'A2', cls: 'ja' },
  { code: 'de', name: 'deutsch', level: 'A2', cls: 'de' },
];

function NavIcon({ kind }) {
  const common = { width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'home') return <svg {...common} viewBox="0 0 16 16"><path d="M2 7l6-5 6 5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V7z" /><path d="M6 15v-5h4v5" /></svg>;
  if (kind === 'play') return <svg {...common} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" /><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" /></svg>;
  if (kind === 'chart') return <svg {...common} viewBox="0 0 16 16"><path d="M2 13V3M2 13h12M5 10l3-4 2 2 4-5" /></svg>;
  if (kind === 'stack') return <svg {...common} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="3" rx="1" /><rect x="2" y="7.5" width="12" height="3" rx="1" /><rect x="2" y="12" width="12" height="2" rx="1" /></svg>;
  if (kind === 'book') return <svg {...common} viewBox="0 0 16 16"><path d="M2.5 3.5h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5h-4.5z" /><path d="M13.5 3.5h-4a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5h4.5z" /></svg>;
  return null;
}

function AppShell({ current, onNav, children, hideNav }) {
  const [langOpen, setLangOpen] = React.useState(false);
  const lang = LANGS[0];

  if (hideNav) {
    return <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>{children}</div>;
  }

  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12 13 4.5" stroke="#c96442" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div className="brand-name">drill</div>
        </div>

        <div className="lang-switch" onClick={() => setLangOpen(!langOpen)} style={{ position: 'relative' }}>
          <div className="left">
            <div className={`flagdot ${lang.cls}`}>{lang.code}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{lang.name}</div>
              <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{lang.level}</div>
            </div>
          </div>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          {langOpen && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-2)', zIndex: 20, padding: 4 }}>
              {LANGS.map((l) => (
                <div key={l.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <div className={`flagdot ${l.cls}`}>{l.code}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{l.name}</div>
                    <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{l.level}</div>
                  </div>
                  {l.code === 'es' && <span className="t-mono" style={{ fontSize: 10, color: 'var(--accent)' }}>●</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {NAV_ITEMS.map((it) => (
          <button key={it.id} className={`nav-item ${current === it.id ? 'active' : ''}`} onClick={() => onNav(it.id)}>
            <NavIcon kind={it.icon} />
            <span>{it.label}</span>
            {it.count && <span className="nav-count">{it.count}</span>}
          </button>
        ))}

        <div className="footer">
          <div className="avatar">J</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>juno</div>
            <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>🔥 12 day streak</div>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

Object.assign(window, { AppShell, LANGS });
