// Post-session feedback — blends B (diff) + C (debrief + skill impact)
// Tabbed view: review (per-item diff) · debrief (coach narrative + skill deltas)

function FeedbackHiFi({ results, onContinue, onNav }) {
  const [tab, setTab] = React.useState('debrief');
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const accuracy = Math.round((correct / total) * 100);

  return (
    <AppShell current="drill" onNav={onNav}>
      <div className="main-inner">
        <div className="t-micro">session done · 8m 42s</div>
        <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>nice work.</h1>
        <p className="t-body-l" style={{ marginTop: 8 }}>
          you got <span className="hilite"><strong>{correct} of {total}</strong></span> · accuracy <span className="t-mono">{accuracy}%</span> · that's a real signal.
        </p>

        {/* summary cards */}
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { l: 'accuracy', v: `${accuracy}%`, sub: accuracy >= 80 ? 'solid B2 range' : 'B1+ range' },
            { l: 'avg time / item', v: '52s', sub: 'median for B2' },
            { l: 'cards added to SRS', v: `+${total - correct + 2}`, sub: 'misses + tricky correct' },
          ].map((s) => (
            <div key={s.l} className="card" style={{ padding: 16 }}>
              <div className="t-micro">{s.l}</div>
              <div className="t-display-m" style={{ marginTop: 4 }}>{s.v}</div>
              <div className="t-small" style={{ marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{ marginTop: 32, borderBottom: '1px solid var(--rule)', display: 'flex', gap: 4 }}>
          {[
            { id: 'debrief', label: 'debrief' },
            { id: 'review', label: `review items (${total})` },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '12px 16px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${tab === t.id ? 'var(--ink)' : 'transparent'}`,
              color: tab === t.id ? 'var(--ink)' : 'var(--ink-soft)',
              fontWeight: tab === t.id ? 500 : 400, fontSize: 14, marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'debrief' ? <DebriefTab results={results} /> : <ReviewTab results={results} />}

        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn ghost" onClick={() => onNav('progress')}>see your progress →</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={() => onNav('dashboard')}>done for today</button>
            <button className="btn primary" onClick={onContinue}>one more round</button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function DebriefTab({ results }) {
  const wrong = results.filter((r) => !r.correct);
  return (
    <div className="fade-in">
      {/* coach letter */}
      <div style={{ marginTop: 24, display: 'flex', gap: 16 }}>
        <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-display)', fontSize: 22, fontWeight: 600 }}>c</div>
        <div className="card" style={{ flex: 1, padding: 20, position: 'relative' }}>
          <div style={{ position: 'absolute', left: -7, top: 18, width: 14, height: 14, background: 'var(--card)', border: '1px solid var(--rule)', borderRight: 'none', borderTop: 'none', transform: 'rotate(45deg)' }} />
          <div className="t-micro" style={{ marginBottom: 6 }}>coach · debrief</div>
          <p className="t-body-l" style={{ margin: 0, fontSize: 15, color: 'var(--ink)' }}>
            solid session. you nailed <strong>doubt clauses</strong> ("dudar que", "no creo que") — that pattern is sticking.
            {wrong.length > 0 ? (
              <> the friction is in <span className="hilite">non-specific antecedent</span> relative clauses (item with "un coche que…") — that's a different trigger and it's fair to mix it up.</>
            ) : (
              <> all six right — the doubt+hope+relative mix is genuinely tricky at B2.</>
            )}
          </p>
          <p className="t-body" style={{ marginTop: 10, marginBottom: 0 }}>
            tomorrow i'll open with 3 minutes on relative-clause subjunctive, then move to a writing prompt where you'll have to produce it without prompts.
          </p>
        </div>
      </div>

      {/* skill impact */}
      <div style={{ marginTop: 28 }}>
        <div className="t-micro">skill impact · this session</div>
        <h3 className="t-display-s" style={{ margin: '4px 0 16px' }}>what moved</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { name: 'subjunctive · doubt clauses', before: 71, after: 78, dir: 'up' },
            { name: 'subjunctive · hope expressions', before: 64, after: 70, dir: 'up' },
            { name: 'subjunctive · relative clauses', before: 51, after: 49, dir: 'down' },
            { name: 'subjunctive · concession (aunque)', before: 58, after: 62, dir: 'up' },
          ].map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 240, fontSize: 13, fontWeight: 500 }}>{s.name}</div>
              <div style={{ flex: 1, position: 'relative', height: 10, background: 'var(--paper-3)', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${s.before}%`, background: 'var(--paper-3)' }} />
                <div style={{ position: 'absolute', left: Math.min(s.before, s.after) + '%', top: 0, bottom: 0, width: Math.abs(s.after - s.before) + '%', background: s.dir === 'up' ? 'var(--ok)' : 'var(--accent)', opacity: 0.85 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(s.before, s.after)}%`, background: 'var(--ink)' }} />
              </div>
              <div className="t-mono" style={{ fontSize: 12, color: 'var(--ink-mute)', width: 30 }}>{s.before}</div>
              <svg width="14" height="10" viewBox="0 0 14 10"><path d="M2 5h9m-3-3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              <div className="t-mono" style={{ fontSize: 13, color: s.dir === 'up' ? 'var(--ok)' : 'var(--accent)', width: 36, fontWeight: 600 }}>{s.after}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewTab({ results }) {
  return (
    <div className="fade-in" style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {results.map((r, i) => {
        const isTrans = !!r.graded && !!r.item.en; // translation result shape (has English source)
        const isVocab = !!r.graded && !!r.item.word; // vocab result shape (has target word)
        return (
          <div key={i} className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>#{i + 1}</span>
                <span className="chip">{r.item.topic}</span>
                {isTrans && <span className="chip">{r.item.kind}</span>}
                {isVocab && <span className="chip">freq #{r.item.freqRank}</span>}
                {isVocab && r.hintsUsed > 0 && <span className="chip" style={{ background: 'var(--hilite-soft)' }}>{r.hintsUsed} hint{r.hintsUsed > 1 ? 's' : ''}</span>}
                {r.correct ? <span className="chip ok">✓ correct</span> : <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-2)', borderColor: 'var(--accent-soft)' }}>✗ missed</span>}
              </div>
            </div>

            {isVocab ? (
              <>
                <div className="t-small" style={{ marginBottom: 8, fontStyle: 'italic' }}>"{r.item.monolingual ? r.item.defTL : r.item.defL1}"</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <div className="t-micro" style={{ marginBottom: 6 }}>you typed</div>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.4 }}>{r.input}</div>
                  </div>
                  <div style={{ background: r.correct ? 'transparent' : 'var(--ok-soft)', borderRadius: 'var(--r-md)', padding: 14, border: r.correct ? '1px dashed var(--rule)' : 'none' }}>
                    <div className="t-micro" style={{ marginBottom: 6 }}>target word</div>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.4, marginBottom: 6, fontWeight: 500 }}>{r.item.word}</div>
                    <div className="t-small" style={{ fontSize: 12 }}>{r.graded.note}</div>
                  </div>
                </div>
              </>
            ) : isTrans ? (
              <>
                <div className="t-small" style={{ marginBottom: 8, fontStyle: 'italic' }}>"{r.item.en}"</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--r-md)', padding: 14 }}>
                    <div className="t-micro" style={{ marginBottom: 6 }}>your translation</div>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.4 }}>{r.input}</div>
                  </div>
                  <div style={{ background: r.correct ? 'transparent' : 'var(--ok-soft)', borderRadius: 'var(--r-md)', padding: 14, border: r.correct ? '1px dashed var(--rule)' : 'none' }}>
                    <div className="t-micro" style={{ marginBottom: 6 }}>{r.correct ? 'one accepted form' : 'reference'}</div>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.4, marginBottom: 8 }}>{r.graded.reference}</div>
                    <div className="t-small" style={{ fontSize: 12 }}>{r.graded.note}</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ background: 'var(--paper-2)', borderRadius: 'var(--r-md)', padding: 14 }}>
                  <div className="t-micro" style={{ marginBottom: 6 }}>your answer</div>
                  <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, lineHeight: 1.4 }}>
                    {r.item.context.split('___').map((p, j, arr) => (
                      <React.Fragment key={j}>
                        {p}{j < arr.length - 1 && (
                          <span className="t-mono" style={{
                            background: r.correct ? 'var(--ok-soft)' : 'var(--accent-soft)',
                            color: r.correct ? 'var(--ok)' : 'var(--accent-2)',
                            padding: '1px 6px', borderRadius: 4, fontSize: 15,
                            textDecoration: r.correct ? 'none' : 'line-through',
                          }}>{r.picked}</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div style={{ background: r.correct ? 'transparent' : 'var(--ok-soft)', borderRadius: 'var(--r-md)', padding: 14, border: r.correct ? '1px dashed var(--rule)' : 'none' }}>
                  <div className="t-micro" style={{ marginBottom: 6 }}>{r.correct ? 'why it works' : 'corrected'}</div>
                  {!r.correct && (
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, lineHeight: 1.4, marginBottom: 8 }}>
                      {r.item.context.split('___').map((p, j, arr) => (
                        <React.Fragment key={j}>
                          {p}{j < arr.length - 1 && (
                            <span className="t-mono" style={{ background: 'var(--card)', padding: '1px 6px', borderRadius: 4, fontSize: 15, fontWeight: 600, border: '1.5px solid var(--ok)' }}>{r.item.blank}</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  <div className="t-small" style={{ fontSize: 12 }}>{r.item.explain}</div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { FeedbackHiFi });
