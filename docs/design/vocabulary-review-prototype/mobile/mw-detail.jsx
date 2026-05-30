// Mobile-web word detail — reflow of review/detail.jsx. drill variant with back.
// "review now" is the primary action-bar button; secondary actions in an overflow row.

function MWWordDetail({ onNav }) {
  const lemma = window.RV.LEMMAS.find((l) => l.id === 'tr-ev');
  const actionBar = (
    <>
      <button className="btn ghost" style={{ flex: '0 0 auto', justifyContent: 'center' }}>suspend</button>
      <button className="btn primary lg" style={{ flex: 1, justifyContent: 'center', padding: '12px 18px' }}>review now →</button>
    </>
  );
  return (
    <MWShell variant="drill" lang="tr" title="word detail" onBack={() => onNav('review')}
      topRight={<button className="icon-btn" title="more"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></svg></button>}
      actionBar={actionBar}>

      {/* header */}
      <div className="mw-section" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 className="mw-h1" style={{ fontSize: 38 }}>{lemma.lemma}</h1>
          <span className="t-mono" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>/ev/</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <StatusPill kind={lemma.fsrs.state} />
          <span className="chip" style={{ fontSize: 10 }}>{lemma.pos}</span>
          <span className="chip" style={{ fontSize: 10 }}>{lemma.cefr}</span>
          <span className="chip" style={{ fontSize: 10 }}>freq #{lemma.freqRank}</span>
        </div>
        <div className="t-body" style={{ fontSize: 14, marginTop: 8 }}>{lemma.gloss}</div>
      </div>

      {/* FSRS stats card */}
      <div className="mw-section tight" style={{ paddingTop: 10 }}>
        <div className="card" style={{ padding: '16px' }}>
          <div className="rv-h" style={{ marginBottom: 12 }}>scheduler state · FSRS</div>
          <FsrsMeter stability={lemma.fsrs.stability} difficulty={lemma.fsrs.difficulty} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: 14, fontSize: 12 }}>
            <MWKv k="reps" v={lemma.fsrs.reps} />
            <MWKv k="lapses" v={lemma.fsrs.lapses} />
            <MWKv k="last review" v={`${lemma.fsrs.lastReview} ago`} />
            <MWKv k="next interval" v={`${lemma.fsrs.nextInterval}d`} />
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--rule)' }}>
            <div className="rv-h" style={{ marginBottom: 4 }}>due</div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 17, color: 'var(--accent-2)' }}>now · in today's queue</div>
          </div>
        </div>
      </div>

      {/* saved snapshot */}
      <div className="mw-section tight" style={{ paddingTop: 14 }}>
        <div className="rv-h" style={{ marginBottom: 8 }}>saved snapshot · core</div>
        <div className="card" style={{ padding: '16px' }}>
          <div className="rv-h" style={{ marginBottom: 4 }}>türkçe definition</div>
          <div className="t-body" style={{ fontSize: 14 }}>{lemma.monolingualDef}</div>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--rule)' }}>
            <div className="rv-h" style={{ marginBottom: 8 }}>morphology · ev as a root</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {[{ p: 'ev', r: 'house · root' }, { p: '-ler', r: 'plural' }, { p: '-i / -si', r: 'poss.' }, { p: '-e/-de/-den', r: 'case' }].map((m, i) => (
                <div key={i} style={{ padding: '5px 9px', border: '1px solid var(--rule)', borderRadius: 6, background: i === 0 ? 'var(--paper-2)' : 'var(--card)' }}>
                  <div className="t-mono" style={{ fontSize: 12 }}>{m.p}</div>
                  <div className="t-small" style={{ fontSize: 9 }}>{m.r}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* occurrences */}
      <div className="mw-section tight" style={{ paddingTop: 16 }}>
        <div className="rv-h" style={{ marginBottom: 4 }}>occurrences · {lemma.occurrences.length} surface forms pooled</div>
        <div className="t-small" style={{ fontSize: 11, marginBottom: 8 }}>cloze picks one at random per session</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lemma.occurrences.map((o, i) => (
            <div key={i} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--t-mono)', fontSize: 16, fontWeight: 600, color: 'var(--accent-2)' }}>{o.surface}</span>
                <span className="t-small" style={{ fontSize: 11 }}>"{o.contextualSense}"</span>
              </div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.5 }}>
                {o.sentence.split(o.surface).map((part, j, arr) => (
                  <React.Fragment key={j}>{part}{j < arr.length - 1 && <span style={{ background: 'var(--hilite-soft)', padding: '0 4px', borderRadius: 3 }}>{o.surface}</span>}</React.Fragment>
                ))}
              </div>
              <div className="t-small" style={{ marginTop: 4, fontStyle: 'italic', fontSize: 11 }}>{o.translation}</div>
              <div className="t-small" style={{ marginTop: 8, fontSize: 11, padding: 8, background: 'var(--paper-2)', borderRadius: 4 }}>
                <strong style={{ color: 'var(--ink)' }}>why this form: </strong>{o.whyThisForm}
              </div>
              <div className="t-micro" style={{ marginTop: 6, fontSize: 9 }}>{o.source}</div>
            </div>
          ))}
        </div>
      </div>

      {/* review history */}
      <div className="mw-section tight" style={{ paddingTop: 16 }}>
        <div className="rv-h" style={{ marginBottom: 8 }}>review history</div>
        <div className="card" style={{ padding: '12px 16px' }}>
          {[
            { when: 'today', ago: 'now', type: 'cloze', r: 'queued' },
            { when: '4d ago', ago: 'may 25', type: 'meaning', r: 'ok' },
            { when: '8d ago', ago: 'may 21', type: 'cloze', r: 'ok' },
            { when: '14d ago', ago: 'may 15', type: 'cloze', r: 'miss' },
            { when: '21d ago', ago: 'may 8', type: 'recog', r: 'ok' },
            { when: 'first seen', ago: 'apr 30', type: '+ saved', r: 'new' },
          ].map((h, i, arr) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '16px 1fr 70px', gap: 8, alignItems: 'center', fontSize: 11, padding: '5px 0', borderBottom: i < arr.length - 1 ? '1px dashed var(--rule)' : 'none' }}>
              <span className={`rv-tick ${h.r === 'ok' ? 'ok' : h.r === 'miss' ? 'miss' : 'skip'}`} style={{ width: 12, height: 12 }}>{h.r === 'ok' ? '✓' : h.r === 'miss' ? '✗' : '·'}</span>
              <span><span style={{ color: 'var(--ink)' }}>{h.when}</span><span className="t-mono" style={{ marginLeft: 6, color: 'var(--ink-mute)' }}>{h.type}</span></span>
              <span className="t-mono" style={{ color: 'var(--ink-mute)', textAlign: 'right', fontSize: 10 }}>{h.ago}</span>
            </div>
          ))}
        </div>
      </div>

      {/* grammar points */}
      <div className="mw-section tight" style={{ paddingTop: 16, paddingBottom: 24 }}>
        <div style={{ background: 'var(--hilite-soft)', border: '1px solid var(--hilite)', borderRadius: 'var(--r-md)', padding: '13px 14px' }}>
          <div className="rv-h" style={{ marginBottom: 8, color: 'var(--ink)' }}>grammar points fed by this card</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['ablative case', 'dative case', 'plural -ler', '3p possessive'].map((g) => (
              <span key={g} className="chip" style={{ background: 'rgba(255,255,255,.7)', fontSize: 11 }}>{g}</span>
            ))}
          </div>
        </div>
      </div>
    </MWShell>
  );
}

function MWKv({ k, v }) {
  return (
    <div>
      <div className="rv-h" style={{ marginBottom: 2 }}>{k}</div>
      <div className="t-mono" style={{ fontSize: 13 }}>{v}</div>
    </div>
  );
}

Object.assign(window, { MWWordDetail });
