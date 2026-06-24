// Cloze drill — coach-guided session (variant B shell), full hi-fi.
// Multi-item flow: 6 cloze items, current item visible, coach pane on left,
// progress bar at top. AI feedback after each check.

const CLOZE_ITEMS = [
  {
    context: 'No creo que ___ tiempo para eso esta semana.',
    blank: 'tenga',
    helper: '(tener, 3rd sg)',
    explain: '"no creo que" expresses doubt — triggers subjunctive.',
    options: ['tiene', 'tenga', 'tendrá', 'tuviera'],
    topic: 'subjunctive · doubt',
  },
  {
    context: 'Espero que mis amigos ___ a la fiesta el sábado.',
    blank: 'vengan',
    helper: '(venir, 3rd pl)',
    explain: '"esperar que" + subjunctive (wishes, hopes).',
    options: ['vienen', 'vendrán', 'vengan', 'vinieron'],
    topic: 'subjunctive · hope',
  },
  {
    context: 'Es importante que tú ___ la verdad.',
    blank: 'digas',
    helper: '(decir, 2nd sg)',
    explain: 'impersonal expressions ("es importante que") trigger subjunctive.',
    options: ['dices', 'digas', 'dirás', 'dijiste'],
    topic: 'subjunctive · impersonal',
  },
  {
    context: 'Aunque ___ cansado, voy al gimnasio igualmente.',
    blank: 'esté',
    helper: '(estar, 1st sg)',
    explain: '"aunque" + subjunctive when emphasizing concession/uncertainty.',
    options: ['estoy', 'esté', 'estaré', 'estaba'],
    topic: 'subjunctive · concession',
  },
  {
    context: 'Dudamos que ellos ___ a tiempo.',
    blank: 'lleguen',
    helper: '(llegar, 3rd pl)',
    explain: '"dudar que" → doubt → subjunctive.',
    options: ['llegan', 'lleguen', 'llegaron', 'llegarán'],
    topic: 'subjunctive · doubt',
  },
  {
    context: 'Quiero un coche que ___ poco combustible.',
    blank: 'gaste',
    helper: '(gastar, 3rd sg)',
    explain: 'antecedent is hypothetical/non-specific → subjunctive in relative clause.',
    options: ['gasta', 'gaste', 'gastará', 'gastaba'],
    topic: 'subjunctive · relative',
  },
];

// Normalize for forgiving comparison: lowercase, strip accents, trim.
function normES(s) {
  return (s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function ClozeHiFi({ onComplete, onNav, mode: initialMode = 'choice' }) {
  const [mode, setMode] = React.useState(initialMode); // 'choice' | 'type'
  const [showTheory, setShowTheory] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState(null);
  const [typed, setTyped] = React.useState('');
  const [checked, setChecked] = React.useState(false);
  const [results, setResults] = React.useState([]); // {correct, item, answer, mode}
  const [coachMsg, setCoachMsg] = React.useState("let's go. 6 items, mix of doubt/hope/relative subjunctive. read the whole sentence first.");
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (mode === 'type' && !checked && inputRef.current) inputRef.current.focus();
  }, [mode, idx, checked]);

  const item = CLOZE_ITEMS[idx];
  const answer = mode === 'choice' ? picked : typed;
  const correct = mode === 'choice'
    ? picked === item.blank
    : normES(typed) === normES(item.blank);
  const accentMiss = mode === 'type' && !correct && typed && normES(typed) === normES(item.blank);

  const onCheck = () => {
    if (mode === 'choice' ? picked == null : !typed.trim()) return;
    setChecked(true);
    setResults((r) => [...r, { correct, item, picked: answer, mode }]);
    if (correct) {
      setCoachMsg(`nice. ${item.explain}`);
    } else if (accentMiss) {
      setCoachMsg(`right form, missing accent — i'll count it. ${item.explain}`);
    } else {
      setCoachMsg(`not quite. ${item.explain} the form is "${item.blank}".`);
    }
  };

  const onNext = () => {
    if (idx + 1 >= CLOZE_ITEMS.length) {
      onComplete([...results]);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    setTyped('');
    setChecked(false);
    setCoachMsg(`item ${idx + 2}. ${idx === 0 ? 'good warm-up — trying a similar pattern.' : 'this one mixes things up a bit.'}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (checked) onNext(); else onCheck();
    }
  };

  const progress = ((idx + (checked ? 1 : 0)) / CLOZE_ITEMS.length) * 100;

  return (
    <AppShell current="drill" onNav={onNav}>
      {/* progress bar */}
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
            {CLOZE_ITEMS.map((it, i) => {
              const past = i < idx || (i === idx && checked);
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
                  <span className="t-small" style={{ fontSize: 11, flex: 1 }}>{it.topic}</span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => setShowTheory(true)}>
              📖 theory · {(item.topic || '').split(' · ')[0]}
            </button>
            <div className="t-small" style={{ fontSize: 11, fontFamily: 'var(--t-mono)' }}>~{Math.max(1, CLOZE_ITEMS.length - idx) * 90 / 60 | 0} min remaining</div>
            <button className="btn ghost sm" onClick={() => onNav('dashboard')}>pause &amp; exit</button>
          </div>
        </aside>

        {/* exercise */}
        <section style={{ flex: 1, padding: '40px 56px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-micro">cloze · item {idx + 1} of {CLOZE_ITEMS.length}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="chip">{item.topic}</span>
              <span className="chip">B2</span>
            </div>
          </div>

          <h1 className="t-display-m" style={{ marginTop: 14, marginBottom: 4 }}>fill the blank</h1>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
            <p className="t-small" style={{ margin: 0 }}>{mode === 'type' ? "type the answer. accents optional — i'll count them as right but flag them." : "don't worry about accents."}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="theory-trigger" onClick={() => setShowTheory(true)} title="open theory reference">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2.5h7a2 2 0 0 1 2 2v9l-2.5-1.5L7 13.5l-2.5-1.5L2 13.5v-9a2 2 0 0 1 1-1.5z"/></svg>
                refresh: {item.topic.split(' · ')[0]}
              </button>
              <div role="tablist" style={{ display: 'inline-flex', padding: 3, background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 999, gap: 2 }}>
                {[
                  { id: 'choice', label: 'multiple choice', sub: 'recognition' },
                  { id: 'type', label: 'type it', sub: 'production' },
                ].map((m) => (
                  <button key={m.id}
                    onClick={() => { if (checked) return; setMode(m.id); setPicked(null); setTyped(''); }}
                    disabled={checked}
                    title={m.sub}
                    style={{
                      border: 'none', background: mode === m.id ? 'var(--card)' : 'transparent',
                      color: mode === m.id ? 'var(--ink)' : 'var(--ink-soft)',
                      padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                      cursor: checked ? 'not-allowed' : 'pointer', opacity: checked ? 0.5 : 1,
                      boxShadow: mode === m.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
                      fontFamily: 'inherit',
                    }}>{m.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="card fade-in" key={idx + mode} style={{ marginTop: 24, padding: '32px 28px' }}>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 26, lineHeight: 1.5, color: 'var(--ink)', fontWeight: 400 }}>
              {(() => {
                const parts = item.context.split('___');
                const answered = mode === 'choice' ? picked : typed;
                return (
                  <>
                    {parts[0]}
                    {!checked ? (
                      mode === 'type' ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          onKeyDown={onKeyDown}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck="false"
                          placeholder="…"
                          style={{
                            display: 'inline-block', minWidth: 140, width: `${Math.max(140, typed.length * 16 + 40)}px`,
                            border: 'none', outline: 'none',
                            borderBottom: `2.5px solid ${typed ? 'var(--ink)' : 'var(--accent)'}`,
                            background: 'transparent',
                            textAlign: 'center', padding: '0 10px',
                            fontFamily: 'var(--t-mono)', fontSize: 22,
                            color: 'var(--ink)', borderRadius: 0,
                          }}
                        />
                      ) : (
                        <span style={{
                          display: 'inline-block', minWidth: 110,
                          borderBottom: `2.5px solid ${answered ? 'var(--ink)' : 'var(--accent)'}`,
                          textAlign: 'center', padding: '0 10px',
                          fontFamily: 'var(--t-mono)', fontSize: 22,
                          color: answered ? 'var(--ink)' : 'var(--accent)',
                        }}>{answered || '____'}</span>
                      )
                    ) : (
                      <span style={{
                        display: 'inline-block', padding: '2px 10px',
                        borderRadius: 6,
                        background: correct ? 'var(--ok-soft)' : 'var(--accent-soft)',
                        color: correct ? 'var(--ok)' : 'var(--accent-2)',
                        fontFamily: 'var(--t-mono)', fontSize: 22, fontWeight: 600,
                        border: correct ? '1.5px solid var(--ok)' : '1.5px solid var(--accent)',
                      }}>{correct ? answered : <><s style={{ opacity: 0.6 }}>{answered || '∅'}</s> → {item.blank}</>}</span>
                    )}
                    {parts[1]}
                  </>
                );
              })()}
            </div>
            <div className="t-small" style={{ marginTop: 12, fontFamily: 'var(--t-mono)' }}>{item.helper}</div>
            {mode === 'type' && checked && accentMiss && (
              <div className="t-small" style={{ marginTop: 8, color: 'var(--ok)' }}>✓ accepted — accent missing on "{item.blank}"</div>
            )}
          </div>

          {mode === 'choice' ? (
          /* options */
          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            {item.options.map((opt) => {
              const isPicked = picked === opt;
              const isCorrect = checked && opt === item.blank;
              const isWrong = checked && isPicked && opt !== item.blank;
              return (
                <button key={opt}
                  disabled={checked}
                  onClick={() => !checked && setPicked(opt)}
                  style={{
                    padding: '14px 12px', borderRadius: 'var(--r-md)',
                    border: `1.5px solid ${isCorrect ? 'var(--ok)' : isWrong ? 'var(--accent)' : isPicked ? 'var(--ink)' : 'var(--rule)'}`,
                    background: isCorrect ? 'var(--ok-soft)' : isWrong ? 'var(--accent-soft)' : isPicked ? 'var(--hilite-soft)' : 'var(--card)',
                    fontFamily: 'var(--t-mono)', fontSize: 16, fontWeight: 500,
                    color: 'var(--ink)', cursor: checked ? 'default' : 'pointer',
                    transition: 'all .15s', boxShadow: isPicked ? 'var(--shadow-1)' : 'none',
                  }}
                  onMouseEnter={(e) => { if (!checked && !isPicked) e.currentTarget.style.borderColor = 'var(--ink)'; }}
                  onMouseLeave={(e) => { if (!checked && !isPicked) e.currentTarget.style.borderColor = 'var(--rule)'; }}>
                  {opt}
                  {isCorrect && <span style={{ marginLeft: 6, color: 'var(--ok)' }}>✓</span>}
                </button>
              );
            })}
          </div>
          ) : (
          /* type-it helpers */
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div className="t-small" style={{ fontFamily: 'var(--t-mono)' }}>insert:</div>
            {['á','é','í','ó','ú','ñ','¿','¡'].map((c) => (
              <button key={c} disabled={checked} onClick={() => {
                setTyped((t) => t + c);
                if (inputRef.current) inputRef.current.focus();
              }} style={{
                width: 32, height: 32, border: '1px solid var(--rule)', background: 'var(--card)',
                borderRadius: 6, fontFamily: 'var(--t-mono)', fontSize: 14, cursor: checked ? 'default' : 'pointer',
                color: 'var(--ink)',
              }}>{c}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button disabled={checked || !typed} onClick={() => setTyped('')} className="btn ghost sm">clear</button>
          </div>
          )}

          {/* feedback / next */}
          <div style={{ marginTop: 'auto', paddingTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-small" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {mode === 'choice'
                ? <><span className="kbd">1</span><span className="kbd">2</span><span className="kbd">3</span><span className="kbd">4</span> to pick · <span className="kbd">↵</span> {checked ? 'next' : 'check'}</>
                : <><span className="kbd">type</span> the form · <span className="kbd">↵</span> {checked ? 'next' : 'check'}</>
              }
            </div>
            {!checked
              ? <button className="btn primary lg" onClick={onCheck} disabled={mode === 'choice' ? picked == null : !typed.trim()} style={{ opacity: (mode === 'choice' ? picked == null : !typed.trim()) ? 0.4 : 1 }}>check answer</button>
              : <button className="btn primary lg" onClick={onNext}>{idx + 1 >= CLOZE_ITEMS.length ? 'finish session →' : 'next item →'}</button>
            }
          </div>
        </section>
      </div>
      {showTheory && <TheoryPanelHost initialTopic={(item.topic || '').includes('subjunctive') ? 'subjunctive' : 'subjunctive'} onClose={() => setShowTheory(false)} />}
    </AppShell>
  );
}

Object.assign(window, { ClozeHiFi, CLOZE_ITEMS });
