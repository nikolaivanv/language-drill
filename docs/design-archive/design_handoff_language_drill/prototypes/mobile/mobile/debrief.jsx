// Mobile post-session debrief — score, review, what's next

function MobileDebrief() {
  return (
    <MScreen bg={M.paper2}>
      <div style={{ padding: '24px 20px 20px', textAlign: 'center', background: M.paper }}>
        <div style={{ ...T.micro, marginBottom: 6 }}>session complete · 24 min</div>
        <div style={{ ...T.display(34), lineHeight: 1.1 }}>nice run.</div>
        <div style={{ ...T.ui(13), color: M.inkSoft, marginTop: 6 }}>
          5 of 6 in cloze, 5 of 6 in translation, 4 of 6 in vocab.
        </div>

        {/* big number */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 18 }}>
          {[
            { v: '14', l: 'right', c: M.ok },
            { v: '4', l: 'partial', c: M.hilite },
            { v: '0', l: 'wrong', c: M.accent },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'center' }}>
              <div style={{ ...T.display(32), color: s.c, fontWeight: 600, lineHeight: 1 }}>{s.v}</div>
              <div style={{ ...T.ui(11), color: M.inkSoft, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 20px' }}>
        {/* skill movement */}
        <div style={{ ...T.micro, marginBottom: 8 }}>skill movement</div>
        <MCard style={{ padding: 14, marginBottom: 16 }}>
          {[
            { k: 'grammar', from: 56, to: 58, val: '+2' },
            { k: 'vocab', from: 62, to: 64, val: '+2' },
            { k: 'production', from: 42, to: 44, val: '+2' },
          ].map(s => (
            <div key={s.k} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...T.ui(13), color: M.ink }}>
                <span>{s.k}</span>
                <span style={{ ...T.mono(12), color: M.ok, fontWeight: 600 }}>{s.val}</span>
              </div>
              <div style={{ marginTop: 4, height: 6, background: M.paper3, borderRadius: 3, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${s.from}%`, background: M.ruleStrong, borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${s.to}%`, background: M.ink, borderRadius: 3 }} />
              </div>
            </div>
          ))}
          <div style={{ ...T.ui(12), color: M.inkSoft, fontStyle: 'italic', borderTop: `1px dashed ${M.rule}`, paddingTop: 10, marginTop: 4 }}>
            you nudged your B1 confidence higher. one more solid run on production and we'll re-test.
          </div>
        </MCard>

        {/* review the misses */}
        <div style={{ ...T.micro, marginBottom: 8 }}>review · 2 to revisit</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <MCard style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: M.hilite }} />
              <span style={{ ...T.ui(11, 500), color: M.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 }}>partial · accent missed</span>
            </div>
            <div style={{ ...T.display(15), color: M.ink, lineHeight: 1.4 }}>
              te <span style={{ background: M.hiliteSoft, padding: '0 2px' }}>habria</span> llamado…
            </div>
            <div style={{ ...T.ui(12), color: M.inkSoft, marginTop: 4 }}>
              should be <b>habría</b> — accent on the í.
            </div>
          </MCard>

          <MCard style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: M.accent }} />
              <span style={{ ...T.ui(11, 500), color: M.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 }}>wrong · word didn't recall</span>
            </div>
            <div style={{ ...T.ui(13), color: M.ink, marginBottom: 4 }}>
              "to fed up / to sicken with too much"
            </div>
            <div style={{ ...T.display(16), color: M.accent2 }}>hartar</div>
            <div style={{ ...T.ui(12), color: M.inkSoft, marginTop: 4 }}>
              you typed "cansar" — close synonym, but not the lemma. requeued tomorrow.
            </div>
          </MCard>
        </div>

        {/* coach takeaway */}
        <MCard style={{ padding: 14, background: M.ink, color: M.paper, border: 'none' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: M.paper, color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', ...T.display(15), fontWeight: 600, flexShrink: 0 }}>c</div>
            <div style={{ flex: 1 }}>
              <div style={{ ...T.ui(13), lineHeight: 1.5 }}>
                today's takeaway: your perfect tenses are clicking. accent marks are the friction point — i'll start flagging them with a tighter grade. tomorrow we'll lean into <b>speaking</b>, your weakest area.
              </div>
            </div>
          </div>
        </MCard>
      </div>

      {/* CTA */}
      <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${M.rule}`, background: M.paper, flexShrink: 0, display: 'flex', gap: 8 }}>
        <MBtn variant="ghost" size="lg" style={{ flex: 1 }}>see progress</MBtn>
        <MBtn variant="primary" size="lg" style={{ flex: 1 }}>done</MBtn>
      </div>
    </MScreen>
  );
}

Object.assign(window, { MobileDebrief });
