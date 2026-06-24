// Translation drill — EN → ES, free typing, AI-graded, multiple correct accepted.
// Mix of phrases + sentences. Hint scenarios. Vocab gloss on hover.

const TRANS_ITEMS = [
  {
    en: "I don't think we have time for that this week.",
    refs: [
      "No creo que tengamos tiempo para eso esta semana.",
      "No pienso que tengamos tiempo para eso esta semana.",
    ],
    scenario: "you're declining a colleague's proposal in a slack message",
    glosses: { "I don't think": "no creo que (+ subjuntivo)", "have time": "tener tiempo", "this week": "esta semana" },
    topic: "subjunctive · doubt",
    cefr: 'B2',
    kind: 'sentence',
  },
  {
    en: "as soon as I get home",
    refs: ["en cuanto llegue a casa", "tan pronto como llegue a casa", "apenas llegue a casa"],
    scenario: "fragment — promise of when you'll do something",
    glosses: { "as soon as": "en cuanto / tan pronto como", "get home": "llegar a casa" },
    topic: "subjunctive · time clause",
    cefr: 'B1',
    kind: 'phrase',
  },
  {
    en: "She told me she would have called if she had known.",
    refs: [
      "Me dijo que habría llamado si hubiera sabido.",
      "Me dijo que habría llamado si lo hubiera sabido.",
      "Me dijo que hubiera llamado si hubiera sabido.",
    ],
    scenario: "recounting a friend's apology",
    glosses: { "she would have called": "habría llamado", "if she had known": "si hubiera sabido" },
    topic: "conditional perfect + pluperfect subjunctive",
    cefr: 'C1',
    kind: 'sentence',
  },
  {
    en: "for what it's worth",
    refs: ["por lo que vale", "por si sirve de algo", "para lo que valga"],
    scenario: "softening an opinion you're about to give",
    glosses: { "for what it's worth": "por lo que vale (idiomatic)" },
    topic: "idiomatic · register",
    cefr: 'B2',
    kind: 'phrase',
  },
  {
    en: "If I had more time, I would learn another instrument.",
    refs: [
      "Si tuviera más tiempo, aprendería otro instrumento.",
      "Si tuviese más tiempo, aprendería otro instrumento.",
    ],
    scenario: "wistful comment in a casual conversation",
    glosses: { "if I had": "si tuviera (+ imperfect subjunctive)", "I would learn": "aprendería", "another instrument": "otro instrumento" },
    topic: "conditional · hypothetical",
    cefr: 'B2',
    kind: 'sentence',
  },
  {
    en: "no matter what they say",
    refs: ["digan lo que digan", "no importa lo que digan", "pase lo que pase con lo que digan"],
    scenario: "asserting confidence before a critic's review",
    glosses: { "no matter what": "digan lo que digan (idiom)", "they say": "digan (subjuntivo)" },
    topic: "subjunctive · idiomatic concession",
    cefr: 'B2',
    kind: 'phrase',
  },
];

// Render English with hoverable vocab glosses.
function GlossedEn({ text, glosses }) {
  if (!glosses || Object.keys(glosses).length === 0) return text;
  // Sort keys longest-first so longer phrases match before their substrings.
  const keys = Object.keys(glosses).sort((a, b) => b.length - a.length);
  // Build a regex that captures each gloss key as an alternation.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${keys.map(esc).join('|')})`, 'gi');
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), g: null });
    // find the matching gloss key (case-insensitive)
    const matched = keys.find((k) => k.toLowerCase() === m[0].toLowerCase());
    parts.push({ t: m[0], g: glosses[matched] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), g: null });
  return parts.map((p, i) => p.g ? <GlossSpan key={i} text={p.t} gloss={p.g} /> : <React.Fragment key={i}>{p.t}</React.Fragment>);
}

function GlossSpan({ text, gloss }) {
  const [show, setShow] = React.useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)} onBlur={() => setShow(false)}
      tabIndex={0}>
      <span style={{
        borderBottom: '1.5px dotted var(--accent)',
        cursor: 'help',
        background: show ? 'var(--hilite-soft)' : 'transparent',
        transition: 'background .15s',
        padding: '0 1px',
      }}>{text}</span>
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: 'var(--paper)',
          padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.3,
          whiteSpace: 'nowrap', zIndex: 5, fontFamily: 'var(--t-ui)',
          boxShadow: 'var(--shadow-2)', pointerEvents: 'none',
        }}>
          {gloss}
          <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid var(--ink)' }} />
        </span>
      )}
    </span>
  );
}

// AI-style grading. Real version would call window.claude.complete; this is a deterministic stub
// that mimics the response: picks the closest reference and produces a verdict + diff + notes.
function gradeTranslation(input, item) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿¡.,!?;:]/g, '').trim().replace(/\s+/g, ' ');
  const ni = norm(input);
  let best = null;
  let bestScore = -1;
  for (const ref of item.refs) {
    const nr = norm(ref);
    const score = similarity(ni, nr);
    if (score > bestScore) { best = ref; bestScore = score; }
  }
  // Verdict tiers
  let verdict, headline, note;
  if (bestScore >= 0.95) {
    verdict = 'great';
    headline = 'spot on';
    note = `that matches one of the natural ways to say it. ${item.refs.length > 1 ? `(${item.refs.length} accepted variants exist for this prompt.)` : ''}`;
  } else if (bestScore >= 0.7) {
    verdict = 'ok';
    headline = 'meaning is right · small issues';
    note = inferNote(input, best, item);
  } else if (bestScore >= 0.4) {
    verdict = 'partial';
    headline = 'gist is there · grammar drifted';
    note = inferNote(input, best, item);
  } else {
    verdict = 'wrong';
    headline = 'not quite the right structure';
    note = `the prompt needs ${item.topic.replace(' · ', ' — ')}. closest reference: "${best}".`;
  }
  return { verdict, headline, note, reference: best, score: bestScore, allRefs: item.refs };
}

// Token-overlap similarity, 0–1.
function similarity(a, b) {
  if (a === b) return 1;
  const ta = a.split(' '), tb = b.split(' ');
  const set = new Set(ta);
  let overlap = 0;
  for (const t of tb) if (set.has(t)) overlap++;
  return overlap / Math.max(ta.length, tb.length);
}

function inferNote(input, ref, item) {
  const ni = input.toLowerCase();
  const nr = (ref || '').toLowerCase();
  // Cheap heuristics to make the stub feel coachy.
  if (item.topic.includes('subjunctive') && !/(tenga|tengamos|llegue|sea|haya|sepa|venga|digan|hubiera|hubiese|tuviera|tuviese)/.test(ni)) {
    return `you used indicative — this prompt triggers the subjunctive. reference: "${ref}".`;
  }
  if (ni.includes('tengo') && nr.includes('tengamos')) return `subject is "we", not "I" — should be "tengamos". reference: "${ref}".`;
  return `close. reference: "${ref}". small word-order or word-choice difference.`;
}

function TranslationHiFi({ onComplete, onNav }) {
  const [idx, setIdx] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [graded, setGraded] = React.useState(null);
  const [hintShown, setHintShown] = React.useState(false);
  const [results, setResults] = React.useState([]);
  const [showTheory, setShowTheory] = React.useState(false);
  const [coachMsg, setCoachMsg] = React.useState("translate from english to spanish. there's usually more than one correct way — i'll accept all natural ones.");
  const taRef = React.useRef(null);

  const item = TRANS_ITEMS[idx];

  React.useEffect(() => {
    setHintShown(false);
    if (taRef.current) taRef.current.focus();
  }, [idx]);

  const onCheck = () => {
    if (!input.trim()) return;
    const g = gradeTranslation(input, item);
    setGraded(g);
    const correct = g.verdict === 'great' || g.verdict === 'ok';
    setResults((r) => [...r, { item, input, graded: g, correct }]);
    setCoachMsg(g.verdict === 'great'
      ? "perfect — that's exactly how a native would say it."
      : g.verdict === 'ok'
        ? "meaning's there. minor polish."
        : g.verdict === 'partial'
          ? "you got the idea. let's tighten the grammar."
          : "tricky one. read the reference and let's move on.");
  };

  const onNext = () => {
    if (idx + 1 >= TRANS_ITEMS.length) {
      onComplete([...results]);
      return;
    }
    setIdx(idx + 1);
    setInput('');
    setGraded(null);
    setCoachMsg(`item ${idx + 2}. ${TRANS_ITEMS[idx + 1].kind === 'phrase' ? 'this is just a phrase — keep it short.' : 'full sentence — watch the verb form.'}`);
  };

  const progress = ((idx + (graded ? 1 : 0)) / TRANS_ITEMS.length) * 100;
  const verdictStyle = {
    great: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok)' },
    ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok)' },
    partial: { bg: 'var(--hilite-soft)', fg: 'var(--ink)', border: 'var(--hilite)' },
    wrong: { bg: 'var(--accent-soft)', fg: 'var(--accent-2)', border: 'var(--accent)' },
  }[graded?.verdict || 'great'];

  return (
    <AppShell current="drill" onNav={onNav}>
      {/* progress */}
      <div style={{ height: 3, background: 'var(--paper-3)', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: 'var(--accent)', transition: 'width .35s' }} />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* coach rail */}
        <aside style={{ width: 280, flexShrink: 0, padding: '32px 24px', background: 'var(--paper-2)', borderRight: '1px solid var(--rule)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-display)', fontSize: 18, fontWeight: 600 }}>c</div>
            <div>
              <div style={{ fontWeight: 600 }}>coach</div>
              <div className="t-small" style={{ fontSize: 11 }}>guiding this session</div>
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 14, marginBottom: 18, minHeight: 100 }} className="fade-in" key={coachMsg}>
            <div className="t-body" style={{ fontSize: 13 }}>{coachMsg}</div>
          </div>

          <div className="t-micro" style={{ marginBottom: 8 }}>session map</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TRANS_ITEMS.map((it, i) => {
              const past = i < idx || (i === idx && graded);
              const cur = i === idx;
              const r = results[i];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                  background: cur ? 'var(--card)' : 'transparent',
                  border: cur ? '1px solid var(--ink)' : '1px solid transparent',
                  opacity: past ? 0.65 : cur ? 1 : 0.4,
                }}>
                  <span style={{ width: 14, color: r ? (r.correct ? 'var(--ok)' : 'var(--accent)') : 'var(--ink-mute)', fontSize: 12 }}>{r ? (r.correct ? '✓' : '✗') : (cur ? '●' : '○')}</span>
                  <span className="t-small" style={{ fontSize: 11, flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{it.kind === 'phrase' ? '◇' : '◆'} {it.topic}</span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => setShowTheory(true)}>
              📖 theory · {(item.topic || '').split(' · ')[0]}
            </button>
            <div className="t-small" style={{ fontSize: 11, fontFamily: 'var(--t-mono)' }}>~{Math.max(1, TRANS_ITEMS.length - idx) * 90 / 60 | 0} min remaining</div>
            <button className="btn ghost sm" onClick={() => onNav('dashboard')}>pause &amp; exit</button>
          </div>
        </aside>

        {/* exercise */}
        <section style={{ flex: 1, padding: '40px 56px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-micro">translation · en → es · item {idx + 1} of {TRANS_ITEMS.length}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="chip">{item.kind}</span>
              <span className="chip">{item.topic}</span>
              <span className="chip">{item.cefr}</span>
            </div>
          </div>

          <h1 className="t-display-m" style={{ marginTop: 14, marginBottom: 4 }}>translate to spanish</h1>
          <p className="t-small">multiple natural translations are accepted. hover dotted words for vocab.</p>

          {/* prompt card */}
          <div className="card fade-in" key={idx} style={{ marginTop: 24, padding: '28px 32px', position: 'relative' }}>
            <div className="t-micro" style={{ marginBottom: 10 }}>english</div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 26, lineHeight: 1.45, color: 'var(--ink)', fontWeight: 400 }}>
              <GlossedEn text={item.en} glosses={item.glosses} />
            </div>

            {/* scenario / hint */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px dashed var(--rule)' }}>
              {!hintShown ? (
                <button
                  onClick={() => setHintShown(true)}
                  style={{
                    border: '1px dashed var(--rule)', background: 'transparent', borderRadius: 999,
                    padding: '6px 12px', fontSize: 12, color: 'var(--ink-soft)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
                  }}>
                  <span style={{ fontFamily: 'var(--t-hand)', fontSize: 16, color: 'var(--accent)' }}>?</span>
                  show scenario hint
                </button>
              ) : (
                <div className="fade-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--t-hand)', fontSize: 18, color: 'var(--accent)', flexShrink: 0, lineHeight: 1.3 }}>scenario</span>
                  <span style={{ fontFamily: 'var(--t-hand)', fontSize: 18, color: 'var(--ink-soft)', lineHeight: 1.4 }}>{item.scenario}</span>
                </div>
              )}
            </div>
          </div>

          {/* answer area */}
          <div style={{ marginTop: 18 }}>
            <div className="t-micro" style={{ marginBottom: 6 }}>your spanish</div>
            <textarea
              ref={taRef}
              className="textarea"
              rows={3}
              placeholder="escribe tu traducción…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  graded ? onNext() : onCheck();
                }
              }}
              disabled={!!graded}
              style={{
                fontSize: 18, fontFamily: 'var(--t-display)', lineHeight: 1.5, padding: 18,
                minHeight: 88,
                background: graded ? 'var(--paper-2)' : 'var(--card)',
                borderColor: graded ? verdictStyle.border : 'var(--rule)',
                borderWidth: graded ? 1.5 : 1,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div className="t-small" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {['á','é','í','ó','ú','ñ','¿','¡'].map((c) => (
                  <button key={c} disabled={!!graded} onClick={() => {
                    setInput((t) => t + c);
                    if (taRef.current) taRef.current.focus();
                  }} style={{
                    width: 26, height: 26, border: '1px solid var(--rule)', background: 'var(--card)',
                    borderRadius: 5, fontFamily: 'var(--t-mono)', fontSize: 12, cursor: graded ? 'default' : 'pointer',
                    color: 'var(--ink)',
                  }}>{c}</button>
                ))}
              </div>
              <div className="t-small" style={{ fontFamily: 'var(--t-mono)', fontSize: 11 }}>{input.length} chars</div>
            </div>
          </div>

          {/* graded card */}
          {graded && (
            <div className="fade-in" style={{
              marginTop: 18, padding: 18,
              background: verdictStyle.bg,
              border: `1.5px solid ${verdictStyle.border}`,
              borderRadius: 'var(--r-md)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: verdictStyle.border, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600,
                }}>{graded.verdict === 'great' ? '✓' : graded.verdict === 'wrong' ? '✗' : '~'}</span>
                <div className="t-display-s" style={{ margin: 0, color: verdictStyle.fg }}>{graded.headline}</div>
                <div style={{ flex: 1 }} />
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>match {Math.round(graded.score * 100)}%</div>
              </div>
              <p className="t-body" style={{ margin: '0 0 12px', color: 'var(--ink)' }}>{graded.note}</p>

              {/* diff: yours vs reference */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div style={{ background: 'rgba(255,255,255,0.6)', padding: 12, borderRadius: 6 }}>
                  <div className="t-micro" style={{ marginBottom: 4 }}>yours</div>
                  <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.4 }}>{input}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.6)', padding: 12, borderRadius: 6 }}>
                  <div className="t-micro" style={{ marginBottom: 4 }}>reference</div>
                  <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.4 }}>{graded.reference}</div>
                </div>
              </div>

              {graded.allRefs.length > 1 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink-soft)', userSelect: 'none' }}>
                    {graded.allRefs.length - 1} other accepted translation{graded.allRefs.length > 2 ? 's' : ''}
                  </summary>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, fontFamily: 'var(--t-display)', lineHeight: 1.6 }}>
                    {graded.allRefs.filter((r) => r !== graded.reference).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* action bar */}
          <div style={{ marginTop: 'auto', paddingTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-small" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="kbd">⌘</span><span className="kbd">↵</span> to {graded ? 'continue' : 'check'}
            </div>
            {!graded
              ? <button className="btn primary lg" onClick={onCheck} disabled={!input.trim()} style={{ opacity: !input.trim() ? 0.4 : 1 }}>check translation</button>
              : <button className="btn primary lg" onClick={onNext}>{idx + 1 >= TRANS_ITEMS.length ? 'finish session →' : 'next item →'}</button>
            }
          </div>
        </section>
      </div>
      {showTheory && <TheoryPanelHost initialTopic={'subjunctive'} onClose={() => setShowTheory(false)} />}
    </AppShell>
  );
}

Object.assign(window, { TranslationHiFi, TRANS_ITEMS });
