// Mobile-web review sessions — cloze / meaning / use-it / listening.
// drill variant · sticky action bar with progress meta + primary button.
// Reuses window.RV data + atoms (ItemTypeChip, FsrsMeter, StatusPill).

// ── shared scaffolding ───────────────────────────────────────────
function MWSessionShell({ onNav, lang, idx, total, type, timer, children, primary }) {
  const actionBar = (
    <>
      <div style={{ flex: 1 }}>
        <div className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>item {idx} of {total}</div>
        <div className="t-small" style={{ fontSize: 11 }}>~{Math.max(1, total - idx)} min left</div>
      </div>
      {primary}
    </>
  );
  return (
    <MWShell variant="drill" lang={lang}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>review · {idx}/{total}</span>}
      onBack={() => onNav('review')}
      topRight={<button className="icon-btn" title="pause"><MWIcon kind="close" size={16} /></button>}
      actionBar={actionBar}
    >
      {/* progress bar */}
      <div style={{ height: 3, background: 'var(--paper-3)', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${(idx / total) * 100}%`, background: 'var(--accent)' }} />
      </div>
      {/* type + timer strip */}
      <div className="mw-section tight" style={{ paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ItemTypeChip kind={type} />
        <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{timer}</span>
      </div>
      {children}
    </MWShell>
  );
}

// ── cloze-in-context (Turkish ev → evlerinden) ──────────────────
function MWReviewCloze({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');
  const occ = lemma.occurrences[0];
  const [input, setInput] = React.useState('evler');
  const primary = <button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px', opacity: input ? 1 : 0.4 }} disabled={!input}>check ↵</button>;
  return (
    <MWSessionShell onNav={onNav} lang="tr" idx={4} total={12} type="cloze" timer="11s" primary={primary}>
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <h2 className="mw-h2">type the form that fits.</h2>
        <p className="t-small" style={{ marginTop: 4, fontSize: 12 }}>cloze-in-context · from your saved sentence</p>
      </div>

      {/* blanked sentence card */}
      <div className="mw-section tight" style={{ paddingTop: 8 }}>
        <div className="card" style={{ padding: '18px 16px' }}>
          <div className="t-micro" style={{ marginBottom: 8 }}>source · {occ.source}</div>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 19, lineHeight: 1.55, color: 'var(--ink)' }}>
            Çocuklar okula gitmek için
            <span className={`rv-cloze-blank ${!input ? 'empty' : ''}`} style={{ minWidth: 96, fontSize: 16 }}>{input || ' '}</span>
            erkenden çıkarlar.
          </div>
          <div className="t-small" style={{ marginTop: 8, fontStyle: 'italic', fontSize: 12 }}>{occ.translation}</div>

          {/* slot requirement + morphology */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--rule)' }}>
            <div className="t-small" style={{ fontSize: 12, marginBottom: 8 }}>
              lemma <strong style={{ fontFamily: 'var(--t-display)', fontSize: 14 }}>ev</strong> · needs <strong>ablative · plural · 3p-poss</strong>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {occ.morphology.map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: 'var(--ink-mute)' }}>+</span>}
                  <div style={{ padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 6, background: i === 0 ? 'var(--paper-2)' : 'var(--card)' }}>
                    <div className="t-mono" style={{ fontSize: 12, color: i === 0 ? 'var(--ink)' : 'var(--accent-2)' }}>{m.p}</div>
                    <div className="t-small" style={{ fontSize: 9 }}>{m.r}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* answer */}
      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div className="t-micro" style={{ marginBottom: 6 }}>your answer</div>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="type the inflected form…"
          style={{ width: '100%', padding: '14px 16px', fontFamily: 'var(--t-mono)', fontSize: 19, fontWeight: 500, color: 'var(--ink)', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 'var(--r-md)', outline: 'none', boxShadow: '0 0 0 3px rgba(26,22,18,0.06)', letterSpacing: '0.5px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span className="t-small" style={{ fontSize: 11 }}>local-graded · exact → Good</span>
          <button className="btn ghost sm" style={{ fontSize: 11 }}>reveal</button>
        </div>
      </div>
    </MWSessionShell>
  );
}

// ── meaning → production ────────────────────────────────────────
function MWReviewMeaning({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-apenas');
  const occ = lemma.occurrences[0];
  const [input, setInput] = React.useState('apen');
  const [hint, setHint] = React.useState(1);
  const primary = <button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px' }}>check ↵</button>;
  return (
    <MWSessionShell onNav={onNav} lang="es" idx={3} total={12} type="meaning" timer="6s" primary={primary}>
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <h2 className="mw-h2">what's the word that means…</h2>
        <p className="t-small" style={{ marginTop: 4, fontSize: 12 }}>meaning → production · saved {lemma.fsrs.lastReview} ago</p>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 8 }}>
        <div className="card" style={{ padding: '18px 16px' }}>
          <div className="rv-h" style={{ marginBottom: 8 }}>contextual sense</div>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 24, lineHeight: 1.3, color: 'var(--ink)' }}>“{occ.contextualSense}”</div>
          <div className="t-small" style={{ marginTop: 8, fontSize: 12 }}>{lemma.pos} · {lemma.cefr} · freq #{lemma.freqRank}</div>

          {hint >= 1 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--rule)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="rv-h" style={{ marginBottom: 0 }}>first letter</span>
                <span style={{ fontFamily: 'var(--t-mono)', fontSize: 20, fontWeight: 600, color: 'var(--accent)' }}>{lemma.lemma[0]}</span>
                <span style={{ fontFamily: 'var(--t-mono)', color: 'var(--ink-mute)', fontSize: 13 }}>{'·'.repeat(lemma.lemma.length - 1)}</span>
                <span className="t-mono" style={{ fontSize: 10, marginLeft: 'auto' }}>{lemma.lemma.length} letters</span>
              </div>
              {hint >= 2 && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="rv-h" style={{ marginBottom: 0 }}>syllables</span>
                  <span style={{ fontFamily: 'var(--t-mono)', fontSize: 13, color: 'var(--ink-soft)' }}>a · pe · nas</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="t-micro" style={{ fontSize: 9 }}>hints:</span>
          <button onClick={() => setHint(1)} className={`chip ${hint >= 1 ? 'accent' : ''}`} style={{ fontSize: 10, cursor: 'pointer', border: 'none' }}>first letter</button>
          <button onClick={() => setHint(2)} className={`chip ${hint >= 2 ? 'accent' : ''}`} style={{ fontSize: 10, cursor: 'pointer', border: 'none' }}>syllables</button>
          <button className="chip" style={{ fontSize: 10, cursor: 'pointer', border: 'none' }}>blanked example</button>
          <span className="t-small" style={{ fontSize: 10, marginLeft: 'auto' }}>hints cap rating at Hard</span>
        </div>
      </div>

      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div className="t-micro" style={{ marginBottom: 6 }}>your word</div>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="escribe la palabra…"
          style={{ width: '100%', padding: '14px 16px', fontFamily: 'var(--t-display)', fontSize: 22, fontWeight: 500, color: 'var(--ink)', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 'var(--r-md)', outline: 'none', boxShadow: '0 0 0 3px rgba(26,22,18,0.06)' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {['á','é','í','ó','ú','ñ'].map((c) => (
            <button key={c} style={{ width: 32, height: 32, border: '1px solid var(--rule)', background: 'var(--card)', borderRadius: 6, fontFamily: 'var(--t-mono)', fontSize: 13, cursor: 'pointer' }}>{c}</button>
          ))}
        </div>
      </div>
    </MWSessionShell>
  );
}

// ── "use it" · free production, Claude-graded ───────────────────
function MWReviewUseIt({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-aprovechar');
  const [input, setInput] = React.useState('Aprovecho la mañana para correr.');
  const primary = <button className="btn primary lg" style={{ flex: '0 0 56%', justifyContent: 'center', padding: '12px 14px', fontSize: 13 }}>grade ↵</button>;
  return (
    <MWSessionShell onNav={onNav} lang="es" idx={7} total={12} type="useit" timer="42s" primary={primary}>
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <h2 className="mw-h2">write a new sentence with <em style={{ fontFamily: 'var(--t-display)', fontStyle: 'italic' }}>{lemma.lemma}</em>.</h2>
        <p className="t-small" style={{ marginTop: 4, fontSize: 12 }}>"use it" · free production · claude-graded</p>
      </div>

      {/* reminder card */}
      <div className="mw-section tight" style={{ paddingTop: 8 }}>
        <div className="card" style={{ padding: '14px 16px', background: 'var(--paper-2)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 18 }}>{lemma.lemma}</div>
            <div className="t-small" style={{ fontSize: 11 }}>{lemma.gloss} · {lemma.pos}</div>
          </div>
          <div className="t-small" style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>seen as · "{lemma.occurrences[0].sentence}"</div>
          <div className="t-small" style={{ fontSize: 11, marginTop: 4 }}>don't recycle this one — write something fresh.</div>
        </div>
      </div>

      {/* free text */}
      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div className="t-micro" style={{ marginBottom: 6 }}>your sentence</div>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3}
          style={{ width: '100%', padding: '14px 16px', fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.4, color: 'var(--ink)', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 'var(--r-md)', outline: 'none', resize: 'none', boxShadow: '0 0 0 3px rgba(26,22,18,0.06)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span className="t-small" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} /> ai-graded · ~$0.006
          </span>
          <button className="btn ghost sm" style={{ fontSize: 11 }}>need a prompt?</button>
        </div>
      </div>

      {/* rubric */}
      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div style={{ background: 'var(--hilite-soft)', border: '1px solid var(--hilite)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
          <div className="rv-h" style={{ marginBottom: 6, color: 'var(--ink)' }}>graded on</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['uses the lemma', 'grammatical', 'natural register', 'preserves meaning'].map((r) => (
              <span key={r} className="chip" style={{ fontSize: 10, background: 'rgba(255,255,255,.7)' }}>{r}</span>
            ))}
          </div>
        </div>
      </div>
    </MWSessionShell>
  );
}

// ── listening · type what you hear ──────────────────────────────
function MWReviewListening({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'es-madrugada');
  const [input, setInput] = React.useState('Llegamos a las tres de la');
  const primary = <button className="btn primary lg" style={{ flex: '0 0 50%', justifyContent: 'center', padding: '12px 18px' }}>check ↵</button>;
  return (
    <MWSessionShell onNav={onNav} lang="es" idx={9} total={12} type="listen" timer="18s" primary={primary}>
      <div className="mw-section tight" style={{ paddingTop: 12 }}>
        <h2 className="mw-h2">type what you hear.</h2>
        <p className="t-small" style={{ marginTop: 4, fontSize: 12 }}>listening · transcribe the sentence</p>
      </div>

      {/* audio card */}
      <div className="mw-section tight" style={{ paddingTop: 8 }}>
        <div className="card" style={{ padding: '22px 16px', textAlign: 'center' }}>
          <button className="rv-audio-bubble" style={{ width: 72, height: 72, margin: '0 auto' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: 40, marginTop: 18 }}>
            {Array.from({ length: 44 }).map((_, i) => {
              const h = 4 + Math.abs(Math.sin(i * 0.4) * 30) + Math.abs(Math.sin(i * 0.09) * 8);
              const past = i < 17;
              return <div key={i} style={{ width: 3, height: h, background: past ? 'var(--ink)' : 'var(--ink-mute)', opacity: past ? 1 : 0.35, borderRadius: 1 }} />;
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
            <button className="btn ghost sm" style={{ fontSize: 11 }}>↻ replay</button>
            <button className="btn ghost sm" style={{ fontSize: 11 }}>½ speed</button>
          </div>
          <div className="t-micro" style={{ marginTop: 10, fontSize: 9 }}>aws polly · neural · es-ES · lupe · played 2×</div>
        </div>
      </div>

      {/* transcript */}
      <div className="mw-section tight" style={{ paddingTop: 14, paddingBottom: 22 }}>
        <div className="t-micro" style={{ marginBottom: 6 }}>your transcription</div>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          style={{ width: '100%', padding: '14px 16px', fontFamily: 'var(--t-display)', fontSize: 18, lineHeight: 1.5, color: 'var(--ink)', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 'var(--r-md)', outline: 'none', resize: 'none', boxShadow: '0 0 0 3px rgba(26,22,18,0.06)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span className="t-small" style={{ fontSize: 11 }}>accents stripped · graded locally</span>
          <button className="btn ghost sm" style={{ fontSize: 11 }}>reveal</button>
        </div>
      </div>
    </MWSessionShell>
  );
}

Object.assign(window, { MWSessionShell, MWReviewCloze, MWReviewMeaning, MWReviewUseIt, MWReviewListening });
