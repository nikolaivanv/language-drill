// Listening · Feedback · Progress — 3 variations each

// ═══════════════════════ LISTENING ═══════════════════════
function ListenA() {
  return (
    <WShell title="listen · dictation" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>dictation · argentine podcast · clip 2/4</WText>
          <WText size={11} color={WF.inkSoft}>speed: <WMono size={11}>1.0×</WMono></WText>
        </div>
        <WLabel size={22}>type exactly what you hear</WLabel>

        {/* audio scrubber w/ segments */}
        <WBox pad={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>▶</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 32 }}>
                {Array.from({ length: 60 }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: `${20 + Math.abs(Math.sin(i * 0.5)) * 80}%`, background: i < 24 ? WF.accent : WF.inkMute, borderRadius: 1 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {['0.5×', '0.75×', '1.0×', '1.25×'].map((s) => (
                  <WChip key={s} fill={s === '1.0×' ? WF.ink : 'transparent'} color={s === '1.0×' ? WF.paper : WF.ink}><span style={{ color: s === '1.0×' ? WF.paper : WF.ink }}>{s}</span></WChip>
                ))}
                <span style={{ flex: 1 }} />
                <WMono size={10} color={WF.inkMute}>0:04 / 0:11</WMono>
              </div>
            </div>
          </div>
        </WBox>

        {/* transcription box */}
        <div style={{ flex: 1, border: `1.5px solid ${WF.ink}`, borderRadius: 6, padding: 14, background: WF.card, boxShadow: `1.5px 2px 0 ${WF.ink}22` }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>your transcription</WText>
          <div style={{ marginTop: 8, fontFamily: WF.uiFont, fontSize: 14, lineHeight: 1.7 }}>
            bueno, la verdad es que nunca <WHilite color={WF.accentSoft}>pensé</WHilite> en eso hasta que{' '}
            <span style={{ display: 'inline-block', minWidth: 60, borderBottom: `2px solid ${WF.accent}` }}>_____</span>
            {' '}a vivir en buenos
            <span style={{ display: 'inline-block', width: 2, height: 14, background: WF.accent, marginLeft: 2, verticalAlign: 'middle' }} />
          </div>
          <div style={{ borderTop: `1px dashed ${WF.inkMute}`, marginTop: 10, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <WText size={10} color={WF.inkMute}>🔁 replay last 3s · ␣ pause</WText>
            <WBtn primary size={12}>check →</WBtn>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 160 }} tilt={3} arrow="right">rapid natural speech,<br/>not textbook audio</WMargin>
      </div>
    </WShell>
  );
}

function ListenB() {
  return (
    <WShell title="listen · comprehend" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>comprehension · no transcript</WText>

        <div style={{ display: 'flex', gap: 14 }}>
          <WPlaceholder w={90} h={90} label="podcast cover" />
          <div style={{ flex: 1 }}>
            <WLabel size={20}>"la cena" · s3e4</WLabel>
            <WText size={11} color={WF.inkSoft}>a family argument at dinner · 2:40 · B2</WText>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <WChip>argentine</WChip><WChip>fast</WChip><WChip>colloquial</WChip>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: WF.accent, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>▶</div>
            <WMono size={10} color={WF.inkMute}>1:12 played</WMono>
          </div>
        </div>

        {/* questions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>questions · open</WText>
          {[
            { q: '1. ¿por qué está enojada la madre?', ans: 'porque su hijo llegó tarde otra vez sin avisar.', status: 'ok' },
            { q: '2. ¿qué propone el padre al final?', ans: '', status: 'pending' },
            { q: '3. ¿qué palabra colloquial usa el hijo para "problema"?', ans: '', status: 'pending' },
          ].map((it, i) => (
            <WBox key={i} pad={10} fill={i === 1 ? WF.hiliteSoft : WF.card}>
              <WText size={12} weight={600}>{it.q}</WText>
              <div style={{ marginTop: 4, borderBottom: `1.3px ${it.status === 'ok' ? 'solid' : 'dashed'} ${it.status === 'ok' ? WF.ok : WF.inkMute}`, minHeight: 20, padding: '2px 0' }}>
                {it.ans && <WText size={12} color={WF.inkSoft}>{it.ans}</WText>}
              </div>
              {it.status === 'ok' && <WMono size={10} color={WF.ok}>✓ accepted · 2 synonyms</WMono>}
            </WBox>
          ))}
        </div>
        <WMargin style={{ position: 'absolute', left: 14, bottom: 20 }} tilt={-2}>AI accepts paraphrases —<br/>not fill-in-blank</WMargin>
      </div>
    </WShell>
  );
}

function ListenC() {
  return (
    <WShell title="listen · karaoke" lang="es">
      <div style={{ padding: '18px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>karaoke · word-sync follow</WText>

        {/* big follow area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 20px' }}>
          <div style={{ fontFamily: WF.uiFont, fontSize: 20, lineHeight: 1.8, color: WF.inkMute, textAlign: 'center' }}>
            <span style={{ color: WF.inkMute }}>cuando </span>
            <span style={{ color: WF.inkSoft }}>era </span>
            <span style={{ color: WF.ink, fontWeight: 600 }}>pequeño, </span>
            <span style={{ background: WF.accent, color: WF.paper, padding: '2px 6px', borderRadius: 3 }}>vivía</span>
            <span style={{ color: WF.inkMute }}> con mis abuelos en un </span>
            <br/>
            <span style={{ color: WF.inkMute }}>pueblo muy pequeño cerca de la costa.</span>
          </div>
          {/* translation on hover card */}
          <div style={{ marginTop: 18, alignSelf: 'center', padding: '6px 12px', background: WF.ink, color: WF.paper, borderRadius: 6, fontFamily: WF.uiFont, fontSize: 12, position: 'relative' }}>
            vivía · "I used to live" (imperfect)
            <div style={{ position: 'absolute', top: -4, left: 40, width: 8, height: 8, background: WF.ink, transform: 'rotate(45deg)' }} />
          </div>
        </div>

        {/* controls */}
        <div style={{ borderTop: `1.5px solid ${WF.ink}`, paddingTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <WBtn size={14} style={{ padding: '10px 16px' }}>⏸</WBtn>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 4, background: WF.paperAlt, borderRadius: 2, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '34%', background: WF.accent, borderRadius: 2 }} />
              <div style={{ position: 'absolute', left: '34%', top: -3, width: 10, height: 10, background: WF.accent, borderRadius: '50%', border: `1.5px solid ${WF.paper}` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <WMono size={10}>0:42</WMono>
              <WMono size={10} color={WF.inkMute}>2:08</WMono>
            </div>
          </div>
          <WBtn size={11}>0.8×</WBtn>
          <WBtn size={11}>🇪🇸/🇬🇧</WBtn>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 50 }} tilt={3} arrow="right">tap any word<br/>for meaning + add to SRS</WMargin>
      </div>
    </WShell>
  );
}

// ═══════════════════════ FEEDBACK / POST-SESSION ═══════════════════════
function FbA() {
  // Inline annotation style
  return (
    <WShell title="feedback · inline" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>session done · 8:42 · 6/6 items</WText>
        <WLabel size={24}>let's go through what you wrote</WLabel>

        <div style={{ flex: 1, border: `1.5px solid ${WF.ink}`, borderRadius: 6, padding: 16, background: WF.card, boxShadow: `1.5px 2px 0 ${WF.ink}22`, overflow: 'hidden' }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>prompt 2 · describe a regret</WText>
          <div style={{ marginTop: 8, fontFamily: WF.uiFont, fontSize: 14, lineHeight: 1.9 }}>
            Hace dos años, acepté un trabajo en otra ciudad.{' '}
            <span style={{ background: WF.accentSoft, padding: '1px 4px', borderBottom: `2px wavy ${WF.accent}`, borderRadius: 2, position: 'relative' }}>
              Si yo habría sabido
              <span style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, fontFamily: WF.handFont, fontSize: 13, color: WF.accent, whiteSpace: 'nowrap' }}>↑ "si hubiera sabido" · subj. after "si"</span>
            </span>
            {' '}cómo iba a ser, no lo{' '}
            <span style={{ background: WF.hiliteSoft, padding: '1px 4px', borderRadius: 2, position: 'relative' }}>
              tomaría
              <span style={{ position: 'absolute', top: '100%', left: 0, marginTop: 24, fontFamily: WF.handFont, fontSize: 13, color: WF.ink, whiteSpace: 'nowrap' }}>"no lo habría tomado" · conditional perfect</span>
            </span>.
          </div>
          <div style={{ marginTop: 60, paddingTop: 10, borderTop: `1px dashed ${WF.inkMute}`, display: 'flex', gap: 14 }}>
            <div><WMono size={20}>2</WMono> <WText size={11} color={WF.inkSoft}>fixes</WText></div>
            <div><WMono size={20} color={WF.ok}>92%</WMono> <WText size={11} color={WF.inkSoft}>accuracy</WText></div>
            <div><WMono size={20}>+3</WMono> <WText size={11} color={WF.inkSoft}>new cards to SRS</WText></div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <WBtn size={12}>← prev item</WBtn>
          <WBtn size={12}>next item →</WBtn>
          <WBtn primary size={12}>done</WBtn>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 90 }} tilt={2} arrow="right">marginalia style —<br/>like a teacher's red pen</WMargin>
      </div>
    </WShell>
  );
}

function FbB() {
  // Side-by-side diff
  return (
    <WShell title="feedback · diff" lang="es">
      <div style={{ padding: '18px 26px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <WLabel size={22}>yours vs. corrected</WLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1 }}>
          <WBox pad={12} fill={WF.paperAlt}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>you</WText>
            <div style={{ marginTop: 6, fontFamily: WF.uiFont, fontSize: 13, lineHeight: 1.7 }}>
              Si <span style={{ background: WF.accentSoft, textDecoration: 'line-through', textDecorationColor: WF.accent }}>yo habría</span> sabido cómo iba a ser,<br/>no lo <span style={{ background: WF.accentSoft, textDecoration: 'line-through', textDecorationColor: WF.accent }}>tomaría</span>.
            </div>
          </WBox>
          <WBox pad={12} style={{ borderColor: WF.ok }}>
            <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>corrected</WText>
            <div style={{ marginTop: 6, fontFamily: WF.uiFont, fontSize: 13, lineHeight: 1.7 }}>
              Si <WHilite color={WF.hiliteSoft}>hubiera</WHilite> sabido cómo iba a ser,<br/>no lo <WHilite color={WF.hiliteSoft}>habría tomado</WHilite>.
            </div>
          </WBox>
        </div>

        {/* explanation list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>why?</WText>
          {[
            ['habría → hubiera', 'in "si" clauses expressing counter-factual past, use past subjunctive (hubiera) — not conditional.'],
            ['tomaría → habría tomado', 'past counter-factual result pairs with conditional perfect.'],
          ].map(([head, body], i) => (
            <div key={i} style={{ padding: 8, borderLeft: `3px solid ${WF.accent}`, background: WF.paper }}>
              <WMono size={11} color={WF.accent}>{head}</WMono>
              <div><WText size={11} color={WF.inkSoft}>{body}</WText></div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <WText size={11} color={WF.inkSoft}>was this helpful? 👍 👎</WText>
          <div style={{ display: 'flex', gap: 6 }}>
            <WBtn size={11}>drill this</WBtn>
            <WBtn primary size={12}>continue →</WBtn>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', left: 14, bottom: 50 }} tilt={-2}>clean compare —<br/>easy to scan</WMargin>
      </div>
    </WShell>
  );
}

function FbC() {
  // Coach debrief — letter from coach + skill impact
  return (
    <WShell title="feedback · debrief" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: WF.ink, color: WF.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: WF.handFont, fontSize: 20 }}>c</div>
          <div>
            <WLabel size={20}>session debrief</WLabel>
            <div><WText size={11} color={WF.inkSoft}>from your coach · 8:42 · tuesday</WText></div>
          </div>
        </div>

        <WBox pad={14}>
          <div style={{ fontFamily: WF.uiFont, fontSize: 13, lineHeight: 1.6 }}>
            solid session. you nailed the recognition warm-up but the <WHilite>conditional perfect</WHilite> is still shaky —
            you knew <WMono size={12}>hubiera</WMono> in item 3 but missed it in item 4. that's a signal, not a failure.<br/><br/>
            tomorrow i'll open with a 3-minute focused drill on past counter-factuals, then we move on.
          </div>
        </WBox>

        {/* skill impact */}
        <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>skill impact</WText>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['subjunctive recall', 71, 74, 'up'],
            ['conditional perfect', 44, 51, 'up'],
            ['preterite vs imperfect', 58, 56, 'down'],
          ].map(([n, a, b, d]) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <WText size={12}>{n}</WText>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <WMono size={10} color={WF.inkMute}>{a}</WMono>
                    <WArrow w={14} h={10} />
                    <WMono size={11} color={d === 'up' ? WF.ok : WF.accent}>{b}%</WMono>
                  </div>
                </div>
                <div style={{ position: 'relative', height: 8, border: `1.2px solid ${WF.ink}`, borderRadius: 4, marginTop: 3 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${a}%`, background: WF.paperAlt }} />
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b}%`, background: d === 'up' ? WF.ink : WF.accent, borderRadius: 4 }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 }}>
          <WBtn size={11}>review items</WBtn>
          <div style={{ display: 'flex', gap: 6 }}>
            <WBtn size={11}>one more round</WBtn>
            <WBtn primary size={12}>done for today ✓</WBtn>
          </div>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 80 }} tilt={3} arrow="right">narrative + numbers;<br/>NOT just "great job!"</WMargin>
      </div>
    </WShell>
  );
}

// ═══════════════════════ PROGRESS ═══════════════════════
function ProgA() {
  // Radar
  const skills = [
    { n: 'sub.', v: 0.71 }, { n: 'cond.', v: 0.44 }, { n: 'preterite', v: 0.58 },
    { n: 'listening', v: 0.82 }, { n: 'speaking', v: 0.64 }, { n: 'vocab', v: 0.76 },
    { n: 'pronouns', v: 0.66 }, { n: 'reading', v: 0.88 },
  ];
  const cx = 170, cy = 170, R = 130;
  const pts = skills.map((s, i) => {
    const a = (Math.PI * 2 * i) / skills.length - Math.PI / 2;
    return [cx + Math.cos(a) * R * s.v, cy + Math.sin(a) * R * s.v];
  });
  const axisPts = skills.map((s, i) => {
    const a = (Math.PI * 2 * i) / skills.length - Math.PI / 2;
    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R, s.n, a];
  });
  return (
    <WShell title="progress · shape" lang="es">
      <div style={{ padding: '20px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>shape of your spanish · B2</WText>
          <WLabel size={22} style={{ display: 'block', marginTop: 4 }}>the lopsided hexagon</WLabel>
          <svg width="340" height="340" style={{ display: 'block', marginTop: 8 }}>
            {[0.25, 0.5, 0.75, 1].map((r) => (
              <polygon key={r} points={axisPts.map(([x, y, , a]) => `${cx + Math.cos(a) * R * r},${cy + Math.sin(a) * R * r}`).join(' ')}
                fill="none" stroke={WF.inkMute} strokeWidth="0.8" strokeDasharray="2 3" opacity={0.4} />
            ))}
            {axisPts.map(([x, y, n], i) => (
              <g key={i}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke={WF.inkMute} strokeWidth="0.6" opacity={0.3} />
                <text x={x + (x - cx) * 0.12} y={y + (y - cy) * 0.12 + 4} fontFamily={WF.uiFont} fontSize="10" fill={WF.inkSoft} textAnchor="middle">{n}</text>
              </g>
            ))}
            <polygon points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill={WF.accent} fillOpacity="0.2" stroke={WF.accent} strokeWidth="1.8" />
            {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={WF.accent} />)}
          </svg>
        </div>
        <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <WText size={10} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>observations</WText>
          <WBox pad={10} fill={WF.accentSoft}>
            <WText size={11} color={WF.inkSoft}>
              you're strong at <b>input</b> (reading, listening) but weak at <b>production</b> (conditional, speaking). classic intermediate plateau shape.
            </WText>
          </WBox>
          <WBox pad={10}>
            <WText size={10} color={WF.inkMute}>COMPARE TO</WText>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <WText size={12}>▢ you · now</WText>
              <WText size={12} color={WF.inkSoft}>▢ you · 30d ago</WText>
              <WText size={12} color={WF.inkSoft}>▢ average B2</WText>
            </div>
          </WBox>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, bottom: 16 }} tilt={2} arrow="right">shape tells you<br/>what to drill</WMargin>
      </div>
    </WShell>
  );
}

function ProgB() {
  // Heatmap
  const topics = ['subjunctive', 'conditional', 'preterite', 'ser/estar', 'pronouns', 'articles', 'prepositions', 'verb agreement'];
  const days = 30;
  const data = topics.map((_, i) => Array.from({ length: days }, (_, d) => {
    const seed = (i * 17 + d * 13) % 100;
    if (seed > 80) return 0; if (seed > 60) return 1; if (seed > 30) return 2; return 3;
  }));
  const shade = (v) => ['transparent', WF.paperAlt, WF.accentSoft, WF.accent][v];
  return (
    <WShell title="progress · heatmap" lang="es">
      <div style={{ padding: '18px 26px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>topic × recency · 30 days</WText>
        <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <WLabel size={22}>where you've been practicing</WLabel>
          <WText size={11} color={WF.inkSoft}>· darker = more recent/intense</WText>
        </div>
        <div style={{ flex: 1, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
          {topics.map((t, i) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <WText size={11} style={{ width: 120, textAlign: 'right' }}>{t}</WText>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {data[i].map((v, d) => (
                  <div key={d} style={{ flex: 1, aspectRatio: 1, background: shade(v), border: `1px solid ${WF.ink}22`, borderRadius: 2, maxHeight: 18 }} />
                ))}
              </div>
              <WMono size={10} color={WF.inkMute} style={{ width: 40 }}>{[71,44,58,83,66,92,55,78][i]}%</WMono>
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1.5px dashed ${WF.inkMute}`, paddingTop: 10, marginTop: 10, display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <WBox pad={8} fill={WF.hiliteSoft} style={{ flex: 1 }}>
            <WText size={11}>🔥 hottest: <b>subjunctive</b> · practiced 9 of last 14 days</WText>
          </WBox>
          <WBox pad={8} fill={WF.accentSoft} style={{ flex: 1 }}>
            <WText size={11}>❄ coldest: <b>conditional</b> · untouched 12 days</WText>
          </WBox>
        </div>
        <WMargin style={{ position: 'absolute', right: 14, top: 40 }} tilt={2} arrow="right">github-like consistency<br/>per grammar topic</WMargin>
      </div>
    </WShell>
  );
}

function ProgC() {
  // Sparkline history — per skill trend lines
  const makeLine = (pts) => pts.map((y, i) => `${i * 30},${40 - y * 32}`).join(' ');
  const skills = [
    { n: 'subjunctive recall', v: 71, d: '+4', trend: [0.5, 0.55, 0.58, 0.6, 0.65, 0.67, 0.66, 0.7, 0.71], good: true },
    { n: 'conditional perfect', v: 44, d: '+7', trend: [0.2, 0.25, 0.3, 0.32, 0.35, 0.37, 0.4, 0.41, 0.44], good: true },
    { n: 'preterite vs imperf', v: 58, d: '−2', trend: [0.65, 0.62, 0.6, 0.58, 0.61, 0.6, 0.59, 0.58, 0.58], good: false },
    { n: 'pronouns (direct)', v: 66, d: '+6', trend: [0.4, 0.45, 0.5, 0.52, 0.56, 0.58, 0.6, 0.64, 0.66], good: true },
    { n: 'ser / estar', v: 83, d: '+1', trend: [0.78, 0.79, 0.8, 0.8, 0.81, 0.82, 0.82, 0.83, 0.83], good: true },
    { n: 'articles & gender', v: 92, d: '—', trend: [0.9, 0.91, 0.91, 0.91, 0.92, 0.92, 0.92, 0.92, 0.92], good: true },
  ];
  return (
    <WShell title="progress · trends" lang="es">
      <div style={{ padding: '18px 28px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <WText size={11} color={WF.inkMute} style={{ textTransform: 'uppercase', letterSpacing: 1.5 }}>trend · last 60 days</WText>
            <WLabel size={22} style={{ display: 'block', marginTop: 2 }}>are you actually getting better?</WLabel>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['30d', '60d', '90d', 'all'].map((r, i) => (
              <div key={r} style={{ padding: '3px 8px', border: `1.2px solid ${WF.ink}`, borderRadius: 4, background: i === 1 ? WF.ink : 'transparent', color: i === 1 ? WF.paper : WF.ink, fontFamily: WF.uiFont, fontSize: 10 }}>{r}</div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {skills.map((s, i) => (
            <div key={s.n} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 60px 60px', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < skills.length - 1 ? `1px dashed ${WF.inkMute}` : 'none' }}>
              <WText size={12}>{s.n}</WText>
              <svg height="40" width="100%" preserveAspectRatio="none" viewBox={`0 0 ${(s.trend.length - 1) * 30} 40`}>
                <polyline points={makeLine(s.trend)} fill="none" stroke={s.good ? WF.ink : WF.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={(s.trend.length - 1) * 30} cy={40 - s.trend[s.trend.length - 1] * 32} r="3" fill={s.good ? WF.ink : WF.accent} />
              </svg>
              <WMono size={13}>{s.v}%</WMono>
              <WMono size={11} color={s.d.startsWith('−') ? WF.accent : s.d === '—' ? WF.inkMute : WF.ok}>{s.d}</WMono>
            </div>
          ))}
        </div>

        <WBox pad={10} fill={WF.hiliteSoft} style={{ marginTop: 8 }}>
          <WText size={11}>💡 coach says: "preterite vs imperfect is the only thing sliding — a 10min drill now flips the trend."</WText>
        </WBox>
        <WMargin style={{ position: 'absolute', right: 14, top: 90 }} tilt={2} arrow="right">honest: up or down,<br/>not "level 14!"</WMargin>
      </div>
    </WShell>
  );
}

Object.assign(window, { ListenA, ListenB, ListenC, FbA, FbB, FbC, ProgA, ProgB, ProgC });
