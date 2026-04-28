// Mobile-flavored design system — extends the hi-fi paper/ink palette,
// adapts type scale and spacing for 412×892 Android frame.
// Components are inline-styled to avoid CSS scope conflicts with desktop styles.

const M = {
  // colors — same warm paper/ink palette as desktop
  paper: '#faf7f1',
  paper2: '#f2ede2',
  paper3: '#e8e1d2',
  card: '#ffffff',
  ink: '#1a1612',
  ink2: '#2c2620',
  inkSoft: '#5a4f43',
  inkMute: '#8c8378',
  rule: '#e0d8c8',
  ruleStrong: '#c9bfac',
  accent: '#c96442',
  accentSoft: '#f7e2d3',
  accent2: '#a04a2c',
  hilite: '#f4d35e',
  hiliteSoft: '#fbeeb6',
  ok: '#5b8a5a',
  okSoft: '#d8e6d3',

  // spacing
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 32, s8: 40,

  // radii
  r1: 6, r2: 10, r3: 14, r4: 20, r5: 28,

  // type — Fraunces for display, Inter for UI, Caveat for hand
  fontDisplay: '"Fraunces", Georgia, serif',
  fontUI: '"Inter", Roboto, system-ui, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, monospace',
  fontHand: '"Caveat", cursive',
};

// type tokens
const T = {
  display: (size) => ({ fontFamily: M.fontDisplay, fontWeight: 500, fontVariationSettings: '"opsz" 144', lineHeight: size > 22 ? 1.15 : 1.25, letterSpacing: size > 28 ? -0.5 : -0.2, fontSize: size }),
  ui: (size, weight = 400) => ({ fontFamily: M.fontUI, fontSize: size, fontWeight: weight, lineHeight: 1.4 }),
  mono: (size) => ({ fontFamily: M.fontMono, fontSize: size, fontFeatureSettings: '"tnum"' }),
  hand: (size) => ({ fontFamily: M.fontHand, fontSize: size, fontWeight: 600 }),
  micro: { fontFamily: M.fontUI, fontSize: 10, lineHeight: 1.3, color: M.inkMute, textTransform: 'uppercase', letterSpacing: 1.1, fontWeight: 500 },
};

// Chip
function Chip({ children, color, bg, border }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      background: bg || M.paper2, color: color || M.inkSoft,
      border: `1px solid ${border || M.rule}`,
      fontSize: 11, fontFamily: M.fontUI, fontWeight: 500,
      letterSpacing: 0.2, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

// Primary CTA button (mobile-sized — 48px tap target)
function MBtn({ children, onClick, variant = 'primary', size = 'lg', disabled, style }) {
  const base = {
    border: 'none', borderRadius: 999, fontFamily: M.fontUI, fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', gap: 6,
    transition: 'transform .08s, background .15s', userSelect: 'none',
    opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap',
  };
  const sizes = {
    lg: { height: 48, padding: '0 22px', fontSize: 15 },
    md: { height: 40, padding: '0 16px', fontSize: 14 },
    sm: { height: 32, padding: '0 12px', fontSize: 13 },
  };
  const variants = {
    primary: { background: M.ink, color: M.paper },
    accent: { background: M.accent, color: '#fff' },
    secondary: { background: M.paper2, color: M.ink, border: `1px solid ${M.rule}` },
    ghost: { background: 'transparent', color: M.ink, border: `1px solid ${M.rule}` },
    bare: { background: 'transparent', color: M.inkSoft, border: 'none' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

// Bottom sheet (used for theory + coach)
function MSheet({ open, onClose, children, height = 0.78, title }) {
  const [dragY, setDragY] = React.useState(0);
  const startY = React.useRef(null);
  if (!open) return null;
  const tHeight = `${height * 100}%`;

  const onTouchStart = (e) => { startY.current = (e.touches?.[0] ?? e).clientY; };
  const onTouchMove = (e) => {
    if (startY.current == null) return;
    const cy = (e.touches?.[0] ?? e).clientY;
    setDragY(Math.max(0, cy - startY.current));
  };
  const onTouchEnd = () => {
    if (dragY > 80) onClose?.();
    setDragY(0);
    startY.current = null;
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0, background: 'rgba(26,22,18,0.45)', animation: 'mfade 180ms',
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: tHeight, background: M.paper,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        boxShadow: '0 -10px 40px rgba(0,0,0,0.18)',
        transform: `translateY(${dragY}px)`,
        transition: dragY === 0 ? 'transform 200ms cubic-bezier(.22,.9,.32,1)' : 'none',
        animation: 'msheet-up 280ms cubic-bezier(.22,.9,.32,1)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div onMouseDown={onTouchStart} onMouseMove={onTouchMove} onMouseUp={onTouchEnd}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          style={{ padding: '10px 0 6px', cursor: 'grab', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: M.ruleStrong, margin: '0 auto' }} />
        </div>
        {title && (
          <div style={{ padding: '4px 20px 10px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ ...T.display(20) }}>{title}</div>
            <button onClick={onClose} style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 16, cursor: 'pointer', fontSize: 20, color: M.inkSoft }}>×</button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

// Scrim screen wrapper — paper background, edge-to-edge
function MScreen({ children, bg, padTop = 0 }) {
  return (
    <div style={{
      width: '100%', minHeight: '100%', background: bg || M.paper,
      display: 'flex', flexDirection: 'column',
      paddingTop: padTop, fontFamily: M.fontUI, color: M.ink,
      position: 'relative',
    }}>{children}</div>
  );
}

// Inline status header (replaces Android's app bar — we want our own brand)
function MTopbar({ left, title, right, onBack }) {
  return (
    <div style={{
      height: 56, display: 'flex', alignItems: 'center', padding: '0 8px',
      background: M.paper, flexShrink: 0,
    }}>
      <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {onBack ? (
          <button onClick={onBack} style={{ width: 40, height: 40, border: 'none', background: 'transparent', borderRadius: 20, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4l-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        ) : left}
      </div>
      <div style={{ flex: 1, ...T.display(17), textAlign: 'center', color: M.ink }}>{title}</div>
      <div style={{ width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{right}</div>
    </div>
  );
}

// Mobile bottom nav (4 items)
function MBottomNav({ current, onNav }) {
  const items = [
    { id: 'dashboard', label: 'today', icon: 'home' },
    { id: 'drills', label: 'drill', icon: 'play' },
    { id: 'progress', label: 'progress', icon: 'chart' },
    { id: 'profile', label: 'you', icon: 'person' },
  ];
  return (
    <div style={{
      height: 64, display: 'flex', borderTop: `1px solid ${M.rule}`,
      background: M.paper, flexShrink: 0, paddingBottom: 4,
    }}>
      {items.map((it) => {
        const active = current === it.id;
        return (
          <button key={it.id} onClick={() => onNav?.(it.id)} style={{
            flex: 1, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, color: active ? M.ink : M.inkMute, fontFamily: M.fontUI, fontSize: 11, fontWeight: active ? 600 : 400,
          }}>
            <NavIconM kind={it.icon} active={active} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function NavIconM({ kind, active }) {
  const c = active ? M.ink : M.inkMute;
  const sw = active ? 1.9 : 1.6;
  const common = { width: 22, height: 22, fill: 'none', stroke: c, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'home') return <svg {...common} viewBox="0 0 22 22"><path d="M3 9l8-6 8 6v9.5a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" /><path d="M8 19.5v-6h6v6" /></svg>;
  if (kind === 'play') return <svg {...common} viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" /><path d="M9 7.5l5.5 3.5-5.5 3.5z" fill={active ? c : 'none'} /></svg>;
  if (kind === 'chart') return <svg {...common} viewBox="0 0 22 22"><path d="M3 18V4M3 18h16M7 14l4-5 3 2 5-7" /></svg>;
  if (kind === 'person') return <svg {...common} viewBox="0 0 22 22"><circle cx="11" cy="8" r="3.5" /><path d="M4 19c1.5-3.5 4.5-5 7-5s5.5 1.5 7 5" /></svg>;
}

// Coach floating button (bottom-right above bottom nav)
function CoachFab({ onClick, hasMessage }) {
  return (
    <button onClick={onClick} style={{
      position: 'absolute', right: 16, bottom: 80, zIndex: 30,
      width: 56, height: 56, borderRadius: 28, border: 'none',
      background: M.ink, color: M.paper, cursor: 'pointer',
      boxShadow: '0 6px 18px rgba(26,22,18,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: M.fontDisplay, fontSize: 22, fontWeight: 600,
    }}>
      c
      {hasMessage && (
        <span style={{
          position: 'absolute', top: 4, right: 4, width: 12, height: 12,
          borderRadius: 6, background: M.accent, border: `2px solid ${M.ink}`,
        }} />
      )}
    </button>
  );
}

// Card (paper-on-paper)
function MCard({ children, style }) {
  return (
    <div style={{
      background: M.card, border: `1px solid ${M.rule}`,
      borderRadius: M.r3, padding: M.s4,
      boxShadow: '0 1px 2px rgba(26,22,18,0.04)',
      ...style,
    }}>{children}</div>
  );
}

// Bar (progress meter)
function MBar({ pct, color, height = 6 }) {
  return (
    <div style={{ height, background: M.paper3, borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color || M.ink, borderRadius: 999, transition: 'width .3s' }} />
    </div>
  );
}

// Inject keyframes for sheet/fade
(function injectStyles() {
  if (document.getElementById('mobile-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'mobile-keyframes';
  s.textContent = `
    @keyframes msheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes mfade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes mslidein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .m-fade-in { animation: mslidein 280ms cubic-bezier(.22,.9,.32,1); }
  `;
  document.head.appendChild(s);
})();

Object.assign(window, { M, T, Chip, MBtn, MSheet, MScreen, MTopbar, MBottomNav, CoachFab, MCard, MBar });
