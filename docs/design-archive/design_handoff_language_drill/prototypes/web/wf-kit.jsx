// Shared wireframe primitives — sketchy, warm, readable.

const WF = {
  paper: '#f7f4ee',
  paperAlt: '#efeae0',
  ink: '#1f1a15',
  inkSoft: '#5a5148',
  inkMute: '#8a8074',
  rule: '#1f1a15',
  accent: '#c96442',
  accentSoft: '#f2d3c4',
  hilite: '#ffe27a',
  hiliteSoft: '#fff3b8',
  ok: '#5b8a5a',
  warn: '#c96442',
  card: '#ffffff',
  handFont: "'Caveat', 'Comic Sans MS', cursive",
  uiFont: "'Architects Daughter', 'Caveat', system-ui, sans-serif",
  monoFont: "'JetBrains Mono', ui-monospace, Menlo, monospace",
};

// Sketchy border — a CSS box-shadow trick for two-stroke hand-drawn feel.
const sketchBorder = (c = WF.ink, w = 1.5) => ({
  border: `${w}px solid ${c}`,
  borderRadius: 6,
  boxShadow: `1.5px 2px 0 ${c}22, inset 0 0 0 0.5px ${c}66`,
});

// Rough box (slightly rotated for hand-drawn feel)
function WBox({ children, style = {}, tilt = 0, color = WF.ink, stroke = 1.5, fill = 'transparent', pad = 10, radius = 6 }) {
  return (
    <div style={{
      border: `${stroke}px solid ${color}`,
      borderRadius: radius,
      background: fill,
      padding: pad,
      transform: `rotate(${tilt}deg)`,
      boxShadow: `1.5px 2px 0 ${color}22`,
      ...style,
    }}>{children}</div>
  );
}

// Handwritten label
function WLabel({ children, size = 16, color = WF.ink, style = {}, tilt = 0 }) {
  return (
    <span style={{
      fontFamily: WF.handFont,
      fontSize: size,
      color,
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      display: tilt ? 'inline-block' : 'inline',
      lineHeight: 1.15,
      ...style,
    }}>{children}</span>
  );
}

// UI text (sans, slightly handwritten)
function WText({ children, size = 13, color = WF.ink, style = {}, weight = 400 }) {
  return (
    <span style={{ fontFamily: WF.uiFont, fontSize: size, color, fontWeight: weight, ...style }}>{children}</span>
  );
}

// Mono value (numbers, codes)
function WMono({ children, size = 12, color = WF.inkSoft, style = {} }) {
  return (
    <span style={{ fontFamily: WF.monoFont, fontSize: size, color, ...style }}>{children}</span>
  );
}

// Striped SVG placeholder (for imagery that should be a real asset later)
function WPlaceholder({ w = 120, h = 80, label = 'placeholder', style = {} }) {
  return (
    <div style={{
      width: w, height: h,
      background: `repeating-linear-gradient(135deg, ${WF.paperAlt} 0 7px, ${WF.paper} 7px 14px)`,
      border: `1.5px dashed ${WF.inkSoft}`,
      borderRadius: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: WF.monoFont, fontSize: 10, color: WF.inkSoft,
      textAlign: 'center', padding: 4, boxSizing: 'border-box',
      ...style,
    }}>{label}</div>
  );
}

// Sketchy button
function WBtn({ children, primary, size = 13, style = {}, tilt = 0, full }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '8px 14px',
      border: `1.5px solid ${WF.ink}`,
      borderRadius: 6,
      background: primary ? WF.ink : 'transparent',
      color: primary ? WF.paper : WF.ink,
      fontFamily: WF.uiFont,
      fontSize: size,
      boxShadow: `1.5px 2px 0 ${WF.ink}22`,
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      width: full ? '100%' : undefined,
      boxSizing: 'border-box',
      ...style,
    }}>{children}</div>
  );
}

// Squiggly underline for emphasis — inline SVG
function WSquiggle({ w = 80, color = WF.accent, style = {} }) {
  return (
    <svg width={w} height="6" viewBox={`0 0 ${w} 6`} style={{ display: 'block', ...style }}>
      <path d={`M2 4 Q ${w * 0.15} 0, ${w * 0.3} 3 T ${w * 0.6} 3 T ${w * 0.9} 3 T ${w - 2} 3`}
        fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Highlighter stroke (behind text)
function WHilite({ children, color = WF.hilite, style = {} }) {
  return (
    <span style={{
      background: `linear-gradient(180deg, transparent 40%, ${color} 40%, ${color} 92%, transparent 92%)`,
      padding: '0 3px',
      ...style,
    }}>{children}</span>
  );
}

// Arrow (hand-drawn)
function WArrow({ w = 40, h = 20, color = WF.ink, style = {}, dir = 'right' }) {
  const path = dir === 'right'
    ? `M2 ${h / 2} Q ${w * 0.5} ${h / 2 - 3}, ${w - 8} ${h / 2} M ${w - 12} ${h / 2 - 4} L ${w - 4} ${h / 2} L ${w - 12} ${h / 2 + 4}`
    : `M ${w - 2} ${h / 2} Q ${w * 0.5} ${h / 2 - 3}, 8 ${h / 2} M 12 ${h / 2 - 4} L 4 ${h / 2} L 12 ${h / 2 + 4}`;
  return (
    <svg width={w} height={h} style={style}><path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

// Checkbox / radio (sketchy)
function WCheck({ on, size = 14, color = WF.ink }) {
  return (
    <span style={{
      width: size, height: size, border: `1.5px solid ${color}`, borderRadius: 3,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: on ? color : 'transparent', flexShrink: 0,
    }}>{on && <svg width={size - 4} height={size - 4} viewBox="0 0 10 10"><path d="M2 5 L4.5 7.5 L8.5 2.5" fill="none" stroke={WF.paper} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
  );
}
function WRadio({ on, size = 14, color = WF.ink }) {
  return (
    <span style={{
      width: size, height: size, border: `1.5px solid ${color}`, borderRadius: '50%',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>{on && <span style={{ width: size - 6, height: size - 6, borderRadius: '50%', background: color }} />}</span>
  );
}

// Progress bar — hand-drawn feel
function WBar({ pct = 50, w = 120, h = 9, color = WF.ink, fill = WF.accent, style = {} }) {
  return (
    <div style={{
      width: w, height: h, border: `1.3px solid ${color}`, borderRadius: h,
      position: 'relative', overflow: 'hidden', ...style,
    }}>
      <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: fill }} />
    </div>
  );
}

// Tag / chip
function WChip({ children, color = WF.ink, fill = 'transparent', style = {} }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      border: `1.2px solid ${color}`, color, background: fill,
      borderRadius: 20, padding: '2px 8px',
      fontFamily: WF.uiFont, fontSize: 11, lineHeight: 1.2,
      ...style,
    }}>{children}</span>
  );
}

// Page shell: browser-chrome-lite header + content area, consistent across all artboards
function WShell({ children, title = 'drill', lang = 'es', streak = 12, style = {}, accent, noHeader }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: WF.paper,
      fontFamily: WF.uiFont,
      color: WF.ink,
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box',
      ...style,
    }}>
      {!noHeader && <WShellHeader title={title} lang={lang} streak={streak} accent={accent} />}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>{children}</div>
    </div>
  );
}

function WShellHeader({ title, lang, streak, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px',
      borderBottom: `1.5px solid ${WF.ink}`,
      background: WF.paper,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="2" y="2" width="18" height="18" rx="3" stroke={WF.ink} strokeWidth="1.5" />
          <path d="M6 11 L10 15 L17 7" stroke={WF.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <span style={{ fontFamily: WF.handFont, fontSize: 19, fontWeight: 700 }}>drill</span>
        <span style={{ fontFamily: WF.uiFont, fontSize: 11, color: WF.inkMute, marginLeft: 4 }}>· {title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <WChip style={{ fontSize: 11 }}>🔥 <WMono size={11}>{streak}d</WMono></WChip>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          border: `1.3px solid ${WF.ink}`, borderRadius: 6, padding: '3px 8px',
          boxShadow: `1px 1.5px 0 ${WF.ink}22`,
        }}>
          <WMono size={11} color={WF.ink}>{lang}</WMono>
          <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1 3 L4.5 6.5 L8 3" stroke={WF.ink} strokeWidth="1.3" fill="none" strokeLinecap="round" /></svg>
        </div>
        <div style={{
          width: 26, height: 26, border: `1.3px solid ${WF.ink}`, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: WF.accentSoft,
          fontFamily: WF.handFont, fontSize: 14,
        }}>j</div>
      </div>
    </div>
  );
}

// Margin note w/ arrow — explains a design decision next to a UI element.
function WMargin({ children, style = {}, arrow = 'left', tilt = -1 }) {
  return (
    <div style={{
      fontFamily: WF.handFont, fontSize: 15, color: WF.accent,
      lineHeight: 1.2, transform: `rotate(${tilt}deg)`,
      display: 'flex', alignItems: 'flex-start', gap: 6,
      ...style,
    }}>
      {arrow === 'left' && <span style={{ fontSize: 18 }}>←</span>}
      <span>{children}</span>
      {arrow === 'right' && <span style={{ fontSize: 18 }}>→</span>}
    </div>
  );
}

Object.assign(window, {
  WF, WBox, WLabel, WText, WMono, WPlaceholder, WBtn, WSquiggle, WHilite,
  WArrow, WCheck, WRadio, WBar, WChip, WShell, WMargin, sketchBorder,
});
