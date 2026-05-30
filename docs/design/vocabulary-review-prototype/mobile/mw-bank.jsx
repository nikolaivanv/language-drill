// Mobile-web vocabulary bank — reflow of review/bank.jsx.
// tabbar variant · filter chips (horizontal scroll) · search · stacked rows.

function MWVocabBank({ onNav, initialFilter }) {
  const [filter, setFilter] = React.useState(initialFilter || 'all');
  const [q, setQ] = React.useState('');
  const lemmas = window.RV.LEMMAS;
  const extra = [
    { id: 'es-mientras', lang: 'es', lemma: 'mientras', gloss: 'while, meanwhile', pos: 'conj.', cefr: 'B1', freqRank: 410, fsrs: { stability: 14, difficulty: 3, dueIn: '2d', state: 'mature' }, history: ['ok','ok','ok','ok','ok'] },
    { id: 'es-acaso', lang: 'es', lemma: 'acaso', gloss: 'perhaps; by any chance', pos: 'adv.', cefr: 'B2', freqRank: 2810, fsrs: { stability: 0.6, difficulty: 8.2, dueIn: 'now', state: 'leech' }, history: ['miss','miss','ok','miss','miss'] },
    { id: 'es-quizas', lang: 'es', lemma: 'quizás', gloss: 'maybe', pos: 'adv.', cefr: 'A2', freqRank: 700, fsrs: { stability: 28, difficulty: 2.4, dueIn: '6d', state: 'mature' }, history: ['ok','ok','ok','ok','ok','ok','ok','ok'] },
    { id: 'es-empeñarse', lang: 'es', lemma: 'empeñarse', gloss: 'to insist on, persist in', pos: 'verb', cefr: 'B2', freqRank: 3300, fsrs: { stability: 0, difficulty: 0, dueIn: 'new', state: 'new' }, history: [] },
  ];
  const all = [...lemmas, ...extra];
  const rows = all.filter((l) => {
    if (filter !== 'all' && l.fsrs.state !== filter) return false;
    if (q && !l.lemma.toLowerCase().includes(q.toLowerCase()) && !l.gloss.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const countFor = (id) => id === 'all' ? all.length : all.filter((x) => x.fsrs.state === id).length;
  const FILTERS = [
    { id: 'all', l: 'all' }, { id: 'new', l: 'new' }, { id: 'learning', l: 'learning' },
    { id: 'mature', l: 'mature' }, { id: 'leech', l: 'leeches', warn: true }, { id: 'known', l: 'known' }, { id: 'suspended', l: 'suspended' },
  ];

  return (
    <MWShell current="review" onNav={onNav} lang="es">
      <div className="mw-section" style={{ paddingTop: 18 }}>
        <div className="t-micro">vocabulary bank · español</div>
        <h1 className="mw-h1" style={{ marginTop: 6 }}>your words.</h1>
        <p className="t-body" style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-2)' }}>every lemma you've saved. one row per lemma — surface forms live inside.</p>
      </div>

      {/* search */}
      <div className="mw-section tight" style={{ paddingTop: 6 }}>
        <div style={{ position: 'relative' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search lemmas, glosses…"
            style={{ width: '100%', padding: '11px 12px 11px 34px', fontSize: 13, background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', outline: 'none', color: 'var(--ink)' }} />
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ position: 'absolute', left: 11, top: 12, color: 'var(--ink-mute)' }}><circle cx="7" cy="7" r="5" /><path d="m11 11 3 3" /></svg>
        </div>
      </div>

      {/* filter chips — horizontal scroll */}
      <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '12px 18px 4px' }}>
        {FILTERS.map((f) => {
          const active = filter === f.id; const n = countFor(f.id);
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              flexShrink: 0, padding: '7px 12px', borderRadius: 999, fontSize: 12,
              border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
              background: active ? 'var(--ink)' : 'var(--card)',
              color: active ? 'var(--paper)' : (f.warn && n > 0 ? 'var(--accent-2)' : 'var(--ink-soft)'),
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {f.l}
              <span className="t-mono" style={{ fontSize: 10, padding: '0 5px', borderRadius: 4, background: active ? 'rgba(255,255,255,.15)' : 'var(--paper-2)', color: active ? 'var(--paper)' : 'var(--ink-mute)' }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* leech banner */}
      {filter === 'leech' && rows.length > 0 && (
        <div className="mw-section tight" style={{ paddingTop: 12 }}>
          <div style={{ background: 'var(--accent-soft)', borderRadius: 'var(--r-md)', borderLeft: '3px solid var(--accent)', padding: '13px 14px' }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{rows.length} words have lapsed ≥ 3 times.</div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 3 }}>try a leech rescue: alternate item types + a generated mnemonic for the worst.</div>
            <button className="btn accent sm" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>start leech rescue →</button>
          </div>
        </div>
      )}

      {/* rows */}
      <div className="mw-section tight" style={{ paddingTop: 12, paddingBottom: 24 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((l, i) => (
            <div key={l.id} onClick={() => onNav && onNav('review')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--rule)' : 'none', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--t-display)', fontSize: 18 }}>{l.lemma}</span>
                  <span className="t-mono" style={{ fontSize: 9, color: 'var(--ink-mute)' }}>{l.cefr} · #{l.freqRank}</span>
                </div>
                <div className="t-small" style={{ fontSize: 12, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.gloss}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <StatusPill kind={l.fsrs.state} />
                  <div style={{ flex: 1, height: 4, background: 'var(--paper-3)', borderRadius: 999, maxWidth: 90 }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (l.fsrs.stability / 30) * 100)}%`, background: l.fsrs.state === 'leech' ? 'var(--accent)' : 'var(--ink)', borderRadius: 999 }} />
                  </div>
                  {l.history && l.history.length > 0 && <Spark history={l.history} />}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="t-mono" style={{ fontSize: 11, color: l.fsrs.dueIn === 'now' ? 'var(--accent-2)' : 'var(--ink-soft)' }}>{l.fsrs.dueIn}</div>
                <span style={{ color: 'var(--ink-mute)' }}>›</span>
              </div>
            </div>
          ))}
        </div>
        <div className="t-small" style={{ marginTop: 10, fontSize: 11, textAlign: 'center' }}>{rows.length} of {all.length} lemmas · tap a row for detail</div>
      </div>
    </MWShell>
  );
}

Object.assign(window, { MWVocabBank });
