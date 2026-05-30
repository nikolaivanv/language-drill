// Vocabulary Bank — list + search + filter. Status pills, batch actions, leech surfacing.

function VocabBank({ initialFilter }) {
  const [filter, setFilter] = React.useState(initialFilter || 'all');
  const [q, setQ] = React.useState('');
  const lemmas = window.RV.LEMMAS;

  const counts = {
    all:       lemmas.length,
    new:       0,
    learning:  lemmas.filter((l) => l.fsrs.state === 'learning').length,
    mature:    lemmas.filter((l) => l.fsrs.state === 'mature').length,
    leech:     lemmas.filter((l) => l.fsrs.state === 'leech').length,
    known:     0,
    suspended: 0,
  };

  // additional fake rows to make the table feel full
  const extra = [
    { id: 'es-mientras', lang: 'es', lemma: 'mientras', gloss: 'while, meanwhile', pos: 'conj.', cefr: 'B1', freqRank: 410, fsrs: { stability: 14, difficulty: 3, reps: 8, lapses: 0, lastReview: '12d', dueIn: '2d', state: 'mature' }, history: ['ok','ok','ok','ok','ok'] },
    { id: 'es-acaso', lang: 'es', lemma: 'acaso', gloss: 'perhaps; by any chance', pos: 'adv.', cefr: 'B2', freqRank: 2810, fsrs: { stability: 0.6, difficulty: 8.2, reps: 5, lapses: 3, lastReview: '6h', dueIn: 'now', state: 'leech' }, history: ['miss','miss','ok','miss','miss'] },
    { id: 'es-rato', lang: 'es', lemma: 'rato', gloss: 'a while, short time', pos: 'noun (m.)', cefr: 'A2', freqRank: 922, fsrs: { stability: 5.0, difficulty: 4.5, reps: 4, lapses: 0, lastReview: '5d', dueIn: '0d', state: 'learning' }, history: ['ok','ok','ok','ok'] },
    { id: 'es-quizas', lang: 'es', lemma: 'quizás', gloss: 'maybe', pos: 'adv.', cefr: 'A2', freqRank: 700, fsrs: { stability: 28, difficulty: 2.4, reps: 14, lapses: 0, lastReview: '24d', dueIn: '6d', state: 'mature' }, history: ['ok','ok','ok','ok','ok','ok','ok','ok'] },
    { id: 'es-empeñarse', lang: 'es', lemma: 'empeñarse', gloss: 'to insist on, persist in', pos: 'verb', cefr: 'B2', freqRank: 3300, fsrs: { stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: '—', dueIn: 'new', state: 'new' }, history: [] },
  ];

  const all = [...lemmas, ...extra];

  const rows = all.filter((l) => {
    if (filter !== 'all' && l.fsrs.state !== filter) return false;
    if (q && !l.lemma.toLowerCase().includes(q.toLowerCase()) && !l.gloss.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <RvFrame current="review" lang="es">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div className="t-micro">vocabulary bank · español</div>
          <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>your words.</h1>
          <p className="t-body" style={{ marginTop: 4, maxWidth: 640 }}>
            every lemma you've saved or that we've added from a passage. one row per lemma — surface forms live inside.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm">⤓ export csv</button>
          <button className="btn">+ add a word manually</button>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 28, flexWrap: 'wrap' }}>
        {[
          { id: 'all', l: 'all' },
          { id: 'new', l: 'new' },
          { id: 'learning', l: 'learning' },
          { id: 'mature', l: 'mature' },
          { id: 'leech', l: 'leeches', warn: true },
          { id: 'known', l: 'known' },
          { id: 'suspended', l: 'suspended' },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 12,
            border: `1px solid ${filter === f.id ? 'var(--ink)' : 'var(--rule)'}`,
            background: filter === f.id ? 'var(--ink)' : 'var(--card)',
            color: filter === f.id ? 'var(--paper)' : (f.warn && counts[f.id] > 0 ? 'var(--accent-2)' : 'var(--ink-soft)'),
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {f.l}
            <span className="t-mono" style={{
              fontSize: 10, padding: '0 5px', borderRadius: 4,
              background: filter === f.id ? 'rgba(255,255,255,.15)' : 'var(--paper-2)',
              color: filter === f.id ? 'var(--paper)' : 'var(--ink-mute)',
            }}>{counts[f.id] || all.filter(x => x.fsrs.state === f.id).length || 0}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            placeholder="search lemmas, glosses…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 240, padding: '8px 12px 8px 32px', fontSize: 13 }}
          />
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ position: 'absolute', left: 10, top: 11, color: 'var(--ink-mute)' }}><circle cx="7" cy="7" r="5" /><path d="m11 11 3 3" /></svg>
        </div>
      </div>

      {/* Leech rescue banner — only when filter is leech and we have any */}
      {filter === 'leech' && rows.length > 0 && (
        <div style={{ marginTop: 18, padding: 16, background: 'var(--accent-soft)', borderRadius: 'var(--r-md)', borderLeft: '3px solid var(--accent)', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>these {rows.length} words have lapsed ≥ 3 times.</div>
            <div className="t-small" style={{ marginTop: 2 }}>try a leech rescue session: alternate item types and we'll generate a mnemonic prompt for the worst offender.</div>
          </div>
          <button className="btn accent">start leech rescue →</button>
        </div>
      )}

      {/* Table */}
      <div style={{ marginTop: 22, border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--card)' }}>
        <div className="rv-row head">
          <span></span>
          <span>lemma</span>
          <span>gloss · pos</span>
          <span>status</span>
          <span>stability</span>
          <span>next</span>
          <span></span>
        </div>
        {rows.map((l) => (
          <div key={l.id} className="rv-row">
            <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{l.cefr}</span>
            <div>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18 }}>{l.lemma}</div>
              <div className="t-small" style={{ fontSize: 11, fontFamily: 'var(--t-mono)' }}>#{l.freqRank}</div>
            </div>
            <div>
              <div style={{ fontSize: 13 }}>{l.gloss}</div>
              <div className="t-small" style={{ fontSize: 11 }}>{l.pos}</div>
            </div>
            <StatusPill kind={l.fsrs.state} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 4, background: 'var(--paper-3)', borderRadius: 999 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (l.fsrs.stability / 30) * 100)}%`, background: l.fsrs.state === 'leech' ? 'var(--accent)' : 'var(--ink)', borderRadius: 999 }} />
                </div>
                <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', width: 36, textAlign: 'right' }}>{l.fsrs.stability.toFixed(1)}d</span>
              </div>
              <Spark history={l.history} />
            </div>
            <span className="t-mono" style={{ fontSize: 12, color: l.fsrs.dueIn === 'now' ? 'var(--accent-2)' : 'var(--ink-soft)' }}>{l.fsrs.dueIn}</span>
            <span style={{ color: 'var(--ink-mute)' }}>›</span>
          </div>
        ))}
      </div>

      <div className="t-small" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
        <span>{rows.length} of {all.length} lemmas · sorted by next due</span>
        <span>tap a row to open detail · long-press for batch</span>
      </div>
    </RvFrame>
  );
}

window.VocabBank = VocabBank;
