// Mobile-web theory library — index screen at 402px.
// Sticky search header, horizontal sort/group strips, accordion-grouped topic list.
// Clicking a topic navigates to the topic detail (MWTheory) for the canvas tour;
// in a real app the router would push to that route.
//
// Reads its catalog from window.TOPICS (defined by hifi/theory-index.jsx).

function MWTheoryIndex({ onNav, openTopic, initialSearch = '', initialGroupBy = 'category', initialSortBy = 'curriculum' }) {
  const [search, setSearch] = React.useState(initialSearch);
  const [groupBy, setGroupBy] = React.useState(initialGroupBy);
  const [sortBy, setSortBy] = React.useState(initialSortBy);
  const [open, setOpen] = React.useState(() => new Set(['moods', 'tenses'])); // accordion default-open
  const TOPICS = window.TOPICS || [];
  const CATS = window.TOPIC_CATEGORIES || [];

  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!q) return TOPICS;
    return TOPICS.filter((t) => (t.title + ' ' + t.tags + ' ' + t.level).toLowerCase().includes(q));
  }, [q, TOPICS]);

  const sortFn = React.useMemo(() => {
    if (sortBy === 'alpha') return (a, b) => a.title.localeCompare(b.title);
    if (sortBy === 'mastery') return (a, b) => a.mastery - b.mastery;
    return (a, b) => a.order - b.order;
  }, [sortBy]);

  const groups = React.useMemo(() => {
    if (q || groupBy === 'none') {
      return [{ id: 'all', label: q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : 'all topics', topics: [...filtered].sort(sortFn) }];
    }
    if (groupBy === 'level') {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      return levels
        .map((lv) => ({ id: lv, label: lv, topics: filtered.filter((t) => t.level === lv).sort(sortFn) }))
        .filter((g) => g.topics.length > 0);
    }
    return CATS
      .map((c) => ({ id: c.id, label: c.label, topics: filtered.filter((t) => t.category === c.id).sort(sortFn) }))
      .filter((g) => g.topics.length > 0);
  }, [filtered, groupBy, sortFn, q, CATS]);

  // When grouping changes, default-open the largest two groups.
  React.useEffect(() => {
    if (q || groupBy === 'none') { setOpen(new Set(groups.map((g) => g.id))); return; }
    const biggest = [...groups].sort((a, b) => b.topics.length - a.topics.length).slice(0, 2).map((g) => g.id);
    setOpen(new Set(biggest));
  }, [groupBy, q]); // eslint-disable-line

  const toggle = (id) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleOpen = (t) => { (openTopic || (() => onNav && onNav('theory')))(t); };

  const todays = TOPICS.filter((t) => t.today);
  const recent = TOPICS.filter((t) => t.recent);

  return (
    <MWShell current="theory" onNav={onNav}>
      {/* Header — title, then search */}
      <div className="mw-section" style={{ paddingTop: 20 }}>
        <div className="t-micro">grammar reference · {TOPICS.length} topics</div>
        <h1 className="mw-h1" style={{ marginTop: 4, fontSize: 30 }}>theory library.</h1>
        <p className="t-body" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
          everything we drill, on its own. browse, sort, or search.
        </p>
      </div>

      {/* Sticky-ish search */}
      <div className="mw-section tight" style={{ paddingTop: 4 }}>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            style={{ position: 'absolute', left: 12, top: 13, color: 'var(--ink-mute)' }}>
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='search "por para", "subjuntivo"…'
            style={{
              width: '100%', padding: '11px 14px 11px 34px',
              background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
              fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none',
              boxShadow: 'var(--shadow-1)',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 8, top: 8, width: 28, height: 28,
              border: 'none', background: 'transparent', color: 'var(--ink-mute)',
              fontSize: 18, cursor: 'pointer', borderRadius: 14,
            }}>×</button>
          )}
        </div>
      </div>

      {/* Group + sort strips — horizontal scroll */}
      <div style={{ padding: '12px 18px 8px' }}>
        <div className="t-micro" style={{ fontSize: 9, marginBottom: 6 }}>group by</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, margin: '0 -18px', padding: '0 18px 4px' }}>
          {[
            { id: 'category', label: 'category' },
            { id: 'level',    label: 'CEFR level' },
            { id: 'none',     label: 'flat list' },
          ].map((o) => (
            <button key={o.id} onClick={() => setGroupBy(o.id)} style={{
              padding: '6px 12px', whiteSpace: 'nowrap', borderRadius: 999,
              border: '1px solid ' + (groupBy === o.id ? 'var(--ink)' : 'var(--rule)'),
              background: groupBy === o.id ? 'var(--ink)' : 'var(--card)',
              color: groupBy === o.id ? 'var(--paper)' : 'var(--ink-soft)',
              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
            }}>{o.label}</button>
          ))}
        </div>

        <div className="t-micro" style={{ fontSize: 9, marginTop: 12, marginBottom: 6 }}>sort</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, margin: '0 -18px', padding: '0 18px 4px' }}>
          {[
            { id: 'curriculum', label: 'curriculum' },
            { id: 'alpha',      label: 'A → Z' },
            { id: 'mastery',    label: 'weakest first' },
          ].map((o) => (
            <button key={o.id} onClick={() => setSortBy(o.id)} style={{
              padding: '6px 12px', whiteSpace: 'nowrap', borderRadius: 999,
              border: '1px solid ' + (sortBy === o.id ? 'var(--ink)' : 'var(--rule)'),
              background: sortBy === o.id ? 'var(--ink)' : 'var(--card)',
              color: sortBy === o.id ? 'var(--paper)' : 'var(--ink-soft)',
              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
            }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Personalized strip — only when no search */}
      {!q && (todays.length > 0 || recent.length > 0) && (
        <div className="mw-section" style={{ paddingTop: 6 }}>
          <div className="t-micro" style={{ fontSize: 9, marginBottom: 8 }}>from your drill</div>
          <div style={{
            display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -18px', padding: '0 18px 4px',
          }}>
            {[...todays, ...recent.filter((t) => !todays.includes(t))].map((t) => (
              <button key={t.id} onClick={() => handleOpen(t)} style={{
                flexShrink: 0, width: 220, textAlign: 'left',
                padding: 12, background: 'var(--paper-2)', border: '1px solid var(--rule)',
                borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  {t.today && <span className="chip accent" style={{ fontSize: 9, padding: '1px 6px' }}>today</span>}
                  {!t.today && t.recent && <span className="chip" style={{ fontSize: 9, padding: '1px 6px' }}>recent</span>}
                  <span className="chip" style={{ fontSize: 9, padding: '1px 6px', fontFamily: 'var(--t-mono)' }}>{t.level}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 4, background: 'var(--paper-3)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${t.mastery}%`, height: '100%', background: t.mastery >= 80 ? 'var(--ok)' : t.mastery >= 55 ? 'var(--ink-soft)' : 'var(--accent)' }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Groups (accordion) */}
      <div style={{ padding: '12px 0 100px' }}>
        {groups.length === 0 && (
          <div style={{ margin: '12px 18px', padding: 24, textAlign: 'center', background: 'var(--card)', border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)' }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>no topics match "{search}"</div>
            <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setSearch('')}>show all</button>
          </div>
        )}
        {groups.map((g) => {
          const isOpen = open.has(g.id) || q;
          return (
            <section key={g.id} style={{ marginTop: 10 }}>
              <button onClick={() => toggle(g.id)} style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 18px',
                background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule)',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--t-display)', fontSize: 17, fontWeight: 500 }}>{g.label}</span>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{g.topics.length}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>›</span>
              </button>
              {isOpen && (
                <div>
                  {g.topics.map((t) => (
                    <button key={t.id} onClick={() => handleOpen(t)} style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 18px',
                      background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule)',
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>
                            {q ? highlight(t.title, q) : t.title}
                          </span>
                          {t.today && <span className="chip accent" style={{ fontSize: 9, padding: '1px 5px' }}>today</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                          <span className="chip" style={{ fontSize: 9, padding: '1px 5px', fontFamily: 'var(--t-mono)' }}>{t.level}</span>
                          <div style={{ width: 52, height: 3, background: 'var(--paper-3)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${t.mastery}%`, height: '100%', background: t.mastery >= 80 ? 'var(--ok)' : t.mastery >= 55 ? 'var(--ink-soft)' : 'var(--accent)' }} />
                          </div>
                          <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>{t.mastery}%</span>
                        </div>
                      </div>
                      <span style={{ fontSize: 14, color: 'var(--ink-mute)' }}>→</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </MWShell>
  );
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark style={{ background: 'var(--hilite-soft)', padding: 0 }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

Object.assign(window, { MWTheoryIndex });
