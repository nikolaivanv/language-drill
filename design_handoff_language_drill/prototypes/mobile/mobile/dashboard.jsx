// Mobile dashboard — today's plan, skill rings, streak header.

function MobileDashboard() {
  return (
    <MScreen>
      {/* greeting header */}
      <div style={{ padding: '14px 20px 18px', borderBottom: `1px solid ${M.rule}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ ...T.micro }}>tuesday · day 12</div>
            <h1 style={{ ...T.display(26), margin: '2px 0 0', lineHeight: 1.2, letterSpacing: '-0.3px' }}>buenos días, sam</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: M.paper2, borderRadius: 999, border: `1px solid ${M.rule}` }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill={M.accent}><path d="M8 1c0 3-3 4-3 7a3 3 0 006 0c0-1.5-1-2.5-1-4 0 0 2 1 2 4a4 4 0 11-8 0c0-3 4-4 4-7z" /></svg>
            <span style={{ ...T.mono(13), fontWeight: 600 }}>12</span>
          </div>
        </div>
        <div style={{ ...T.ui(13), color: M.inkSoft, marginTop: 6 }}>
          you're tracking around <b style={{ color: M.ink }}>B1+</b>. today: 24 min, focus on production.
        </div>
      </div>

      {/* skill snapshot */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ ...T.micro, marginBottom: 8 }}>skill estimate · cefr</div>
        <MCard style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, columnGap: 16 }}>
            {[
              { k: 'reading', v: 'B2-', w: 78 },
              { k: 'listening', v: 'B1+', w: 70 },
              { k: 'grammar', v: 'B1', w: 58 },
              { k: 'speaking', v: 'A2+', w: 44 },
              { k: 'writing', v: 'B1', w: 52 },
              { k: 'vocab', v: 'B1+', w: 64 },
            ].map((s) => (
              <div key={s.k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ ...T.ui(12), color: M.inkSoft }}>{s.k}</span>
                  <span style={{ ...T.mono(11), color: M.ink, fontWeight: 600 }}>{s.v}</span>
                </div>
                <MBar pct={s.w} color={s.k === 'speaking' ? M.accent : M.ink} height={4} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${M.rule}` }}>
            <div style={{ ...T.ui(11), color: M.inkMute }}>speaking is dragging your overall down — today targets it</div>
            <button style={{ ...T.ui(12, 500), color: M.ink, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>see all</button>
          </div>
        </MCard>
      </div>

      {/* today's plan */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ ...T.micro }}>today's plan · 24 min</div>
          <span style={{ ...T.ui(11), color: M.inkMute }}>1/5 done</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { n: '01', t: 'warm-up · cloze', d: 'fill the blank · 6 items', min: 4, status: 'done' },
            { n: '02', t: 'cloze · perfect tenses', d: 'b1 grammar focus · 6 items', min: 7, status: 'next' },
            { n: '03', t: 'translation · en→es', d: 'production · 6 items', min: 8, status: 'queued' },
            { n: '04', t: 'vocabulary recall', d: '6 words · b1 frequency', min: 5, status: 'queued' },
            { n: '05', t: 'cool-down · writing', d: '3 sentences · summarize', min: 4, status: 'queued' },
          ].map((s, i) => (
            <button key={i} style={{
              all: 'unset', display: 'flex', alignItems: 'center', gap: 12,
              padding: 14, borderRadius: M.r3,
              background: s.status === 'next' ? M.ink : M.card,
              color: s.status === 'next' ? M.paper : M.ink,
              border: `1px solid ${s.status === 'next' ? M.ink : M.rule}`,
              opacity: s.status === 'done' ? 0.55 : 1, cursor: 'pointer',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: s.status === 'next' ? M.paper : M.paper2,
                color: s.status === 'next' ? M.ink : M.inkSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                ...T.mono(12), fontWeight: 600, flexShrink: 0,
              }}>
                {s.status === 'done' ? '✓' : s.n}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...T.display(15), color: 'inherit' }}>{s.t}</div>
                <div style={{ ...T.ui(12), color: s.status === 'next' ? 'rgba(250,247,241,0.65)' : M.inkSoft, marginTop: 2 }}>
                  {s.d} · {s.min} min
                </div>
              </div>
              {s.status === 'next' && (
                <div style={{
                  width: 36, height: 36, borderRadius: 18, background: M.paper, color: M.ink,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.5l6 4.5-6 4.5z" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* footer note */}
      <div style={{ padding: '20px 20px 12px' }}>
        <div style={{ ...T.ui(11), color: M.inkMute, fontStyle: 'italic', textAlign: 'center' }}>
          plan adjusts if you skip or struggle
        </div>
      </div>

      {/* read entry-point */}
      <div style={{ padding: '0 20px 16px' }}>
        <div style={{
          padding: 14, background: M.card, border: `1px solid ${M.rule}`, borderRadius: M.r3,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: M.r2, background: M.accentSoft, color: M.accent2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3z" /><path d="M21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z" /></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ ...T.display(15) }}>reading something?</span>
              <Chip color={M.accent2} bg={M.accentSoft} border={M.accentSoft}>new</Chip>
            </div>
            <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 2, lineHeight: 1.4 }}>paste a paragraph — i'll surface unfamiliar words in your next session.</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={M.ink} strokeWidth="1.7" strokeLinecap="round"><path d="M5 3l5 5-5 5" /></svg>
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <MBottomNav current="dashboard" />
    </MScreen>
  );
}

Object.assign(window, { MobileDashboard });
