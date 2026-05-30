// Word detail — re-rendered saved deep-card snapshot + occurrences + SR stats + history + actions.

function WordDetail() {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');

  return (
    <RvFrame current="review" lang="tr">
      {/* Breadcrumb */}
      <div className="t-small" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-mute)' }}>
        <span style={{ cursor: 'pointer' }}>← bank</span>
        <span>›</span>
        <span>türkçe</span>
        <span>›</span>
        <span style={{ color: 'var(--ink-soft)' }}>ev</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <h1 className="t-display-xl" style={{ margin: 0 }}>{lemma.lemma}</h1>
            <span className="t-small" style={{ fontFamily: 'var(--t-mono)' }}>/ev/</span>
            <span className="t-small">{lemma.pos}</span>
            <span className="chip">{lemma.cefr}</span>
            <span className="chip">freq #{lemma.freqRank}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <StatusPill kind={lemma.fsrs.state} />
            <span className="t-body">{lemma.gloss}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost sm">suspend</button>
          <button className="btn ghost sm">mark known</button>
          <button className="btn ghost sm" style={{ color: 'var(--accent-2)' }}>delete</button>
          <button className="btn primary">review now →</button>
        </div>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 28, marginTop: 28 }}>
        <div>
          {/* Saved deep-card snapshot */}
          <div className="rv-h" style={{ marginBottom: 10 }}>saved snapshot · core</div>
          <div className="card" style={{ padding: 22 }}>
            <div className="rv-h" style={{ marginBottom: 4 }}>türkçe definition</div>
            <div className="t-body" style={{ fontSize: 15 }}>{lemma.monolingualDef}</div>

            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px dashed var(--rule)' }}>
              <div className="rv-h" style={{ marginBottom: 8 }}>morphology · ev as a root</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {[{ p: 'ev', r: 'house · root' }, { p: '-ler', r: 'plural' }, { p: '-i / -si', r: 'poss.' }, { p: '-e / -de / -den', r: 'case' }].map((m, i) => (
                  <div key={i} style={{ padding: '6px 12px', border: '1px solid var(--rule)', borderRadius: 6, background: i === 0 ? 'var(--paper-2)' : 'var(--card)' }}>
                    <div className="t-mono" style={{ fontSize: 13 }}>{m.p}</div>
                    <div className="t-small" style={{ fontSize: 10 }}>{m.r}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Occurrences — the heart of the spec */}
          <div className="rv-h" style={{ marginTop: 26, marginBottom: 10, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span>occurrences · {lemma.occurrences.length} surface forms pooled</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11, color: 'var(--ink-soft)' }}>cloze picks one at random per session</span>
          </div>
          {lemma.occurrences.map((o, i) => (
            <div key={i} className="card" style={{ padding: 18, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--t-mono)', fontSize: 18, fontWeight: 600, color: 'var(--accent-2)' }}>{o.surface}</span>
                  <span className="t-small" style={{ fontSize: 12 }}>"{o.contextualSense}"</span>
                </div>
                <span className="t-small" style={{ fontSize: 11, fontStyle: 'italic' }}>{o.source}</span>
              </div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, lineHeight: 1.5 }}>
                {o.sentence.split(o.surface).map((part, j, arr) => (
                  <React.Fragment key={j}>
                    {part}
                    {j < arr.length - 1 && <span style={{ background: 'var(--hilite-soft)', padding: '0 4px', borderRadius: 3 }}>{o.surface}</span>}
                  </React.Fragment>
                ))}
              </div>
              <div className="t-small" style={{ marginTop: 4, fontStyle: 'italic' }}>{o.translation}</div>
              <div className="t-small" style={{ marginTop: 10, fontSize: 11, padding: 8, background: 'var(--paper-2)', borderRadius: 4, color: 'var(--ink-soft)' }}>
                <strong style={{ color: 'var(--ink)' }}>why this form: </strong>{o.whyThisForm}
              </div>
            </div>
          ))}

          <button className="btn ghost sm" style={{ marginTop: 4 }}>+ add an occurrence manually</button>
        </div>

        {/* Right rail: SR stats + review history */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 14 }}>scheduler state · FSRS</div>
            <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginTop: 16, fontSize: 12 }}>
              <div>
                <div className="rv-h" style={{ marginBottom: 2 }}>reps</div>
                <div className="t-mono">{lemma.fsrs.reps}</div>
              </div>
              <div>
                <div className="rv-h" style={{ marginBottom: 2 }}>lapses</div>
                <div className="t-mono">{lemma.fsrs.lapses}</div>
              </div>
              <div>
                <div className="rv-h" style={{ marginBottom: 2 }}>last review</div>
                <div className="t-mono">{lemma.fsrs.lastReview} ago</div>
              </div>
              <div>
                <div className="rv-h" style={{ marginBottom: 2 }}>next interval</div>
                <div className="t-mono">{lemma.fsrs.nextInterval}d</div>
              </div>
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--rule)' }}>
              <div className="rv-h" style={{ marginBottom: 6 }}>due</div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, color: 'var(--accent-2)' }}>now · in today's queue</div>
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="rv-h" style={{ marginBottom: 12 }}>review history</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { when: 'today',          ago: 'now',      type: 'cloze',   r: 'queued' },
                { when: '4d ago',         ago: 'apr 22',   type: 'meaning', r: 'ok'   },
                { when: '8d ago',         ago: 'apr 18',   type: 'cloze',   r: 'ok'   },
                { when: '14d ago',        ago: 'apr 12',   type: 'cloze',   r: 'miss' },
                { when: '21d ago',        ago: 'apr 5',    type: 'recog',   r: 'ok'   },
                { when: 'first seen',     ago: 'mar 28',   type: '+ saved', r: 'new'  },
              ].map((h, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr 90px', gap: 8, alignItems: 'center', fontSize: 11 }}>
                  <span className={`rv-tick ${h.r === 'ok' ? 'ok' : h.r === 'miss' ? 'miss' : 'skip'}`} style={{ width: 12, height: 12 }}>
                    {h.r === 'ok' ? '✓' : h.r === 'miss' ? '✗' : '·'}
                  </span>
                  <span>
                    <span style={{ color: 'var(--ink)' }}>{h.when}</span>
                    <span className="t-mono" style={{ marginLeft: 6, color: 'var(--ink-mute)' }}>{h.type}</span>
                  </span>
                  <span className="t-mono" style={{ color: 'var(--ink-mute)', textAlign: 'right', fontSize: 10 }}>{h.ago}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16, background: 'var(--hilite-soft)', borderColor: 'var(--hilite)' }}>
            <div className="rv-h" style={{ marginBottom: 6, color: 'var(--ink)' }}>grammar points fed by this card</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {['ablative case', 'dative case', 'plural -ler', '3p possessive'].map((g) => (
                <span key={g} className="chip" style={{ background: 'rgba(255,255,255,.7)', fontSize: 11 }}>{g}</span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </RvFrame>
  );
}

window.WordDetail = WordDetail;
