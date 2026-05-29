// Theory Library — index screen the user lands on when navigating to "theory".
// Search, grouping (by category / by level / flat), sort (curriculum / a–z / mastery).
// Clicking a topic opens the existing TheoryPanelHost overlay for the detail.
//
// Topic catalog is the source of truth — the existing THEORY map in hifi/theory.jsx
// supplies the full content for any topic whose `linked` field matches a key there;
// the rest fall back to the most relevant existing entry.

const TOPIC_CATEGORIES = [
  { id: 'tenses',      label: 'tiempos verbales',          subtitle: 'present, past, future, perfect forms' },
  { id: 'moods',       label: 'modos · subjuntivo · condicional', subtitle: 'subjunctive, conditional, imperative' },
  { id: 'pairs',       label: 'verbos confundibles',       subtitle: 'ser/estar, por/para, saber/conocer…' },
  { id: 'syntax',      label: 'sintaxis y oraciones',      subtitle: 'conditionals, reported speech, passives' },
  { id: 'pronouns',    label: 'pronombres',                subtitle: 'object, reflexive, relative, demonstrative' },
  { id: 'articles',    label: 'artículos y género',        subtitle: 'el, la, lo, plurals, agreement' },
  { id: 'orthography', label: 'ortografía',                subtitle: 'accents, spelling shifts' },
];

const TOPICS = [
  // === tenses ===
  { id: 't-pres',       title: 'presente de indicativo',           category: 'tenses', level: 'A1', order: 1,  mastery: 92, tags: 'present indicative regular hablo como vivo' },
  { id: 't-pres-cont',  title: 'presente continuo (estar + -ndo)', category: 'tenses', level: 'A2', order: 2,  mastery: 88, tags: 'progressive gerund estar hablando' },
  { id: 't-fut-ir',     title: 'futuro con "ir a"',                category: 'tenses', level: 'A1', order: 3,  mastery: 94, tags: 'going to ir a voy a hacer' },
  { id: 't-indef',      title: 'pretérito indefinido',             category: 'tenses', level: 'A2', order: 6,  mastery: 68, tags: 'preterite simple past hablé comí' },
  { id: 't-imp',        title: 'pretérito imperfecto',             category: 'tenses', level: 'A2', order: 7,  mastery: 58, tags: 'imperfect hablaba comía vivía' },
  { id: 't-perf',       title: 'pretérito perfecto compuesto',     category: 'tenses', level: 'A2', order: 8,  mastery: 74, tags: 'present perfect he hablado haber participle' },
  { id: 't-pret-imp',   title: 'pretérito vs. imperfecto',         category: 'tenses', level: 'B1', order: 12, mastery: 58, tags: 'preterite imperfect aspect contrast', linked: 'preterite-imperfect' },
  { id: 't-fut',        title: 'futuro simple',                    category: 'tenses', level: 'A2', order: 11, mastery: 80, tags: 'future hablaré will' },
  { id: 't-pluscuam',   title: 'pretérito pluscuamperfecto',       category: 'tenses', level: 'B1', order: 14, mastery: 52, tags: 'past perfect había hablado' },
  { id: 't-fut-perf',   title: 'futuro perfecto',                  category: 'tenses', level: 'B2', order: 23, mastery: 33, tags: 'future perfect habré hablado will have' },

  // === moods ===
  { id: 'm-imper-pos',  title: 'imperativo afirmativo',            category: 'moods', level: 'A2', order: 9,  mastery: 76, tags: 'commands habla coma tú usted vosotros' },
  { id: 'm-imper-neg',  title: 'imperativo negativo',              category: 'moods', level: 'B1', order: 15, mastery: 64, tags: 'commands negative no hables no comas' },
  { id: 'm-cond',       title: 'condicional simple',               category: 'moods', level: 'B1', order: 16, mastery: 66, tags: 'conditional would hablaría tendría', linked: 'conditional', recent: true },
  { id: 'm-subj-pres',  title: 'subjuntivo presente',              category: 'moods', level: 'B1', order: 18, mastery: 71, tags: 'subjunctive present que hable que tenga doubt hope', linked: 'subjunctive', today: true, recent: true },
  { id: 'm-subj-imp',   title: 'subjuntivo imperfecto',            category: 'moods', level: 'B2', order: 24, mastery: 42, tags: 'subjunctive past hablara hablase tuviera si clauses' },
  { id: 'm-cond-perf',  title: 'condicional compuesto',            category: 'moods', level: 'B2', order: 25, mastery: 44, tags: 'conditional perfect habría hablado' },
  { id: 'm-subj-perf',  title: 'subjuntivo perfecto',              category: 'moods', level: 'B2', order: 26, mastery: 28, tags: 'subjunctive present perfect haya hablado' },
  { id: 'm-subj-plus',  title: 'subjuntivo pluscuamperfecto',      category: 'moods', level: 'C1', order: 30, mastery: 12, tags: 'subjunctive past perfect hubiera hablado' },

  // === pairs ===
  { id: 'p-ser-estar',  title: 'ser vs. estar',                    category: 'pairs', level: 'A1', order: 4,  mastery: 83, tags: 'ser estar to be temporary permanent' },
  { id: 'p-haber-tener',title: 'haber vs. tener',                  category: 'pairs', level: 'A1', order: 5,  mastery: 90, tags: 'haber tener have hay' },
  { id: 'p-por-para',   title: 'por vs. para',                     category: 'pairs', level: 'A2', order: 13, mastery: 54, tags: 'por para for through by reason purpose' },
  { id: 'p-saber-cono', title: 'saber vs. conocer',                category: 'pairs', level: 'A2', order: 17, mastery: 70, tags: 'saber conocer know fact person' },
  { id: 'p-pedir-pre',  title: 'pedir vs. preguntar',              category: 'pairs', level: 'B1', order: 22, mastery: 62, tags: 'pedir preguntar ask request' },
  { id: 'p-llevar-tra', title: 'llevar vs. traer',                 category: 'pairs', level: 'B1', order: 31, mastery: 58, tags: 'llevar traer take bring' },
  { id: 'p-gustar',     title: 'verbos como gustar',               category: 'pairs', level: 'A2', order: 32, mastery: 75, tags: 'gustar encantar interesar me indirect object reverse' },
  { id: 'p-reflex',     title: 'verbos reflexivos',                category: 'pairs', level: 'A2', order: 33, mastery: 79, tags: 'reflexive se levantarse ducharse' },

  // === syntax / conditionals / connectives ===
  { id: 'c-si-real',    title: 'condicionales reales (si + presente)',          category: 'syntax', level: 'A2', order: 10, mastery: 78, tags: 'if clauses real first conditional si' },
  { id: 'c-si-hypo',    title: 'condicionales hipotéticas (si + imperfecto)',   category: 'syntax', level: 'B1', order: 19, mastery: 56, tags: 'if clauses hypothetical second conditional' },
  { id: 'c-when',       title: 'cuando · mientras · hasta que',                 category: 'syntax', level: 'B1', order: 20, mastery: 62, tags: 'when while until time clauses subjunctive' },
  { id: 'c-si-imp',     title: 'condicionales imposibles (si + pluscuam)',      category: 'syntax', level: 'B2', order: 27, mastery: 24, tags: 'if clauses impossible third conditional past' },
  { id: 'c-reported',   title: 'estilo indirecto',                              category: 'syntax', level: 'B2', order: 28, mastery: 38, tags: 'reported speech indirect dijo que' },
  { id: 'c-although',   title: 'aunque · a pesar de',                           category: 'syntax', level: 'B2', order: 29, mastery: 48, tags: 'although despite concession' },
  { id: 's-passive',    title: 'voz pasiva (ser + participio)',                 category: 'syntax', level: 'B2', order: 43, mastery: 50, tags: 'passive voice ser fue construido' },
  { id: 's-se-imp',     title: 'se pasiva e impersonal',                        category: 'syntax', level: 'B1', order: 44, mastery: 60, tags: 'se passive impersonal se vende se dice' },
  { id: 's-comp',       title: 'comparativos y superlativos',                   category: 'syntax', level: 'A2', order: 45, mastery: 75, tags: 'comparative superlative más menos mejor el más' },
  { id: 's-neg',        title: 'negación (no · nunca · nadie)',                 category: 'syntax', level: 'A1', order: 46, mastery: 88, tags: 'negation never nobody nothing double' },

  // === pronouns ===
  { id: 'pr-do',        title: 'pronombres de objeto directo',     category: 'pronouns', level: 'A2', order: 34, mastery: 70, tags: 'direct object lo la los las' },
  { id: 'pr-io',        title: 'pronombres de objeto indirecto',   category: 'pronouns', level: 'A2', order: 35, mastery: 66, tags: 'indirect object le les se' },
  { id: 'pr-double',    title: 'doble pronombre (se lo)',          category: 'pronouns', level: 'B1', order: 36, mastery: 58, tags: 'double object se lo dárselo placement' },
  { id: 'pr-dem',       title: 'demostrativos (este · ese · aquel)', category: 'pronouns', level: 'A1', order: 38, mastery: 88, tags: 'demonstratives this that those' },
  { id: 'pr-rel',       title: 'pronombres relativos (que · quien · el cual)', category: 'pronouns', level: 'B2', order: 37, mastery: 46, tags: 'relative pronouns which who that' },

  // === articles & gender ===
  { id: 'a-gender',     title: 'género de los sustantivos',        category: 'articles', level: 'A1', order: 39, mastery: 92, tags: 'noun gender masculine feminine -o -a' },
  { id: 'a-articles',   title: 'artículos definidos e indefinidos',category: 'articles', level: 'A1', order: 40, mastery: 95, tags: 'articles el la un una los unos' },
  { id: 'a-plural',     title: 'formación del plural',             category: 'articles', level: 'A1', order: 42, mastery: 90, tags: 'plural -s -es' },
  { id: 'a-lo',         title: 'el neutro "lo"',                   category: 'articles', level: 'B1', order: 41, mastery: 55, tags: 'neuter lo lo importante lo bueno' },

  // === orthography ===
  { id: 'o-accents',    title: 'reglas de acentuación',            category: 'orthography', level: 'A2', order: 47, mastery: 65, tags: 'accents tildes agudas llanas esdrújulas' },
];

// Resolve a topic to a THEORY key. Fallback to subjunctive if we don't have a hand-written entry.
function resolveTopicKey(topic) {
  if (topic.linked && window.THEORY && window.THEORY[topic.linked]) return topic.linked;
  return 'subjunctive';
}

function masteryColor(pct) {
  if (pct >= 80) return 'var(--ok)';
  if (pct >= 55) return 'var(--ink-soft)';
  return 'var(--accent)';
}

function MasteryBar({ pct, width = 64 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width, height: 4, background: 'var(--paper-3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: masteryColor(pct) }} />
      </div>
      <span className="t-mono" style={{ fontSize: 11, color: masteryColor(pct), width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function TopicRow({ topic, onOpen, dense = true, showCategory = false }) {
  const cat = TOPIC_CATEGORIES.find((c) => c.id === topic.category);
  return (
    <button
      onClick={() => onOpen(topic)}
      style={{
        display: 'grid',
        gridTemplateColumns: showCategory ? '1fr 110px 36px 110px 18px' : '1fr 36px 110px 18px',
        alignItems: 'center', gap: 16,
        width: '100%', padding: dense ? '11px 14px' : '16px 18px',
        background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-2)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{topic.title}</span>
        {topic.today && <span className="chip accent" style={{ fontSize: 9, padding: '1px 6px' }}>today's drill</span>}
        {topic.recent && !topic.today && <span className="chip" style={{ fontSize: 9, padding: '1px 6px' }}>recent</span>}
      </div>
      {showCategory && <span className="t-small" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{cat?.label}</span>}
      <span className="chip" style={{ fontSize: 10, padding: '1px 6px', justifySelf: 'center', fontFamily: 'var(--t-mono)' }}>{topic.level}</span>
      <MasteryBar pct={topic.mastery} />
      <span style={{ fontSize: 14, color: 'var(--ink-mute)', justifySelf: 'end' }}>→</span>
    </button>
  );
}

// Highlight matching substring in topic title for search results.
function HighlightedRow({ topic, q, onOpen }) {
  const cat = TOPIC_CATEGORIES.find((c) => c.id === topic.category);
  const title = topic.title;
  const idx = q ? title.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const titleEl = idx >= 0
    ? <>{title.slice(0, idx)}<mark style={{ background: 'var(--hilite-soft)', padding: 0 }}>{title.slice(idx, idx + q.length)}</mark>{title.slice(idx + q.length)}</>
    : title;
  return (
    <button
      onClick={() => onOpen(topic)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 36px 110px 18px',
        alignItems: 'center', gap: 16,
        width: '100%', padding: '11px 14px',
        background: 'transparent', border: 'none', borderBottom: '1px solid var(--rule)',
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--paper-2)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontSize: 14, fontWeight: 500 }}>{titleEl}</span>
      <span className="t-small" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{cat?.label}</span>
      <span className="chip" style={{ fontSize: 10, padding: '1px 6px', justifySelf: 'center', fontFamily: 'var(--t-mono)' }}>{topic.level}</span>
      <MasteryBar pct={topic.mastery} />
      <span style={{ fontSize: 14, color: 'var(--ink-mute)', justifySelf: 'end' }}>→</span>
    </button>
  );
}

function SegControl({ value, onChange, options }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 2, background: 'var(--paper-2)',
      border: '1px solid var(--rule)', borderRadius: 999,
    }}>
      {options.map((opt) => (
        <button key={opt.id} onClick={() => onChange(opt.id)} style={{
          padding: '5px 12px', fontSize: 12,
          border: 'none', borderRadius: 999,
          background: value === opt.id ? 'var(--ink)' : 'transparent',
          color: value === opt.id ? 'var(--paper)' : 'var(--ink-soft)',
          fontWeight: value === opt.id ? 500 : 400,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function TheoryIndex({ onNav }) {
  const [search, setSearch] = React.useState('');
  const [groupBy, setGroupBy] = React.useState('category'); // category | level | none
  const [sortBy, setSortBy] = React.useState('curriculum'); // curriculum | alpha | mastery
  const [activeTopic, setActiveTopic] = React.useState(null);
  const inputRef = React.useRef(null);

  // ⌘K to focus search.
  React.useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openTopic = (t) => setActiveTopic(t);
  const closeTopic = () => setActiveTopic(null);

  // === filter ===
  const q = search.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    if (!q) return TOPICS;
    return TOPICS.filter((t) => {
      const hay = (t.title + ' ' + t.tags + ' ' + t.level).toLowerCase();
      return hay.includes(q);
    });
  }, [q]);

  // === sort ===
  const sortFn = React.useMemo(() => {
    if (sortBy === 'alpha') return (a, b) => a.title.localeCompare(b.title);
    if (sortBy === 'mastery') return (a, b) => a.mastery - b.mastery;
    return (a, b) => a.order - b.order; // curriculum
  }, [sortBy]);

  // === group ===
  const groups = React.useMemo(() => {
    if (q || groupBy === 'none') {
      return [{ id: 'all', label: q ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}` : 'all topics', topics: [...filtered].sort(sortFn) }];
    }
    if (groupBy === 'level') {
      const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      return levels
        .map((lv) => ({ id: lv, label: lv, subtitle: cefrLabel(lv), topics: filtered.filter((t) => t.level === lv).sort(sortFn) }))
        .filter((g) => g.topics.length > 0);
    }
    // default: category
    return TOPIC_CATEGORIES
      .map((c) => ({ id: c.id, label: c.label, subtitle: c.subtitle, topics: filtered.filter((t) => t.category === c.id).sort(sortFn) }))
      .filter((g) => g.topics.length > 0);
  }, [filtered, groupBy, sortFn, q]);

  // Personalized strip — only show on default state (no search).
  const recent = TOPICS.filter((t) => t.recent).sort(sortFn);
  const todays = TOPICS.filter((t) => t.today);
  const weakest = [...TOPICS].sort((a, b) => a.mastery - b.mastery).slice(0, 3);

  return (
    <AppShell current="theory" onNav={onNav}>
      <div className="main-inner" style={{ paddingBottom: 80 }}>
        {/* Header */}
        <div className="t-micro">grammar reference · 47 topics</div>
        <h1 className="t-display-xl" style={{ margin: '4px 0 0' }}>theory library.</h1>
        <p className="t-body-l" style={{ marginTop: 8, maxWidth: 680 }}>
          everything we drill, explained on its own. browse by category, sort by where you are in the curriculum, or search for what you need.
        </p>

        {/* Search */}
        <div style={{ marginTop: 24, position: 'relative', maxWidth: 720 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            style={{ position: 'absolute', left: 14, top: 14, color: 'var(--ink-mute)' }}>
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='search topics · try "subjuntivo", "por para", or "passive"'
            style={{
              width: '100%', padding: '12px 14px 12px 40px',
              background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
              fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none',
              boxShadow: 'var(--shadow-1)',
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--ink)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--rule)'}
          />
          <span className="t-mono" style={{
            position: 'absolute', right: 12, top: 10, fontSize: 10, color: 'var(--ink-mute)',
            padding: '3px 7px', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--paper-2)',
          }}>⌘K</span>
        </div>

        {/* Controls */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="t-micro" style={{ fontSize: 10 }}>group by</span>
            <SegControl value={groupBy} onChange={setGroupBy} options={[
              { id: 'category', label: 'category' },
              { id: 'level',    label: 'CEFR level' },
              { id: 'none',     label: 'flat' },
            ]} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="t-micro" style={{ fontSize: 10 }}>sort</span>
            <SegControl value={sortBy} onChange={setSortBy} options={[
              { id: 'curriculum', label: 'curriculum order' },
              { id: 'alpha',      label: 'A → Z' },
              { id: 'mastery',    label: 'weakest first' },
            ]} />
          </div>
        </div>

        {/* Personalized — only on default state */}
        {!q && (
          <div style={{
            marginTop: 28, padding: 18,
            background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)',
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24,
          }}>
            <PinnedColumn label="from today's drill" topics={todays} onOpen={openTopic} emptyText="—" />
            <PinnedColumn label="recently viewed" topics={recent} onOpen={openTopic} emptyText="—" />
            <PinnedColumn label="weakest right now" topics={weakest} onOpen={openTopic} emptyText="—" />
          </div>
        )}

        {/* Results header */}
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div className="t-micro">{q ? 'search results' : groupBy === 'none' ? 'all topics' : `browsing by ${groupBy === 'category' ? 'category' : 'CEFR level'}`}</div>
          {q && <button className="btn ghost sm" onClick={() => setSearch('')}>clear search ✕</button>}
        </div>

        {/* Groups */}
        {groups.length === 0 && (
          <div style={{
            marginTop: 16, padding: '32px 18px', textAlign: 'center',
            background: 'var(--card)', border: '1px dashed var(--rule)', borderRadius: 'var(--r-lg)',
          }}>
            <div className="t-display-s" style={{ fontSize: 18 }}>no topics match "{search}"</div>
            <div className="t-small" style={{ marginTop: 6 }}>try a different term, or browse by category below.</div>
            <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setSearch('')}>show all topics</button>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.id} style={{ marginTop: 24 }}>
            <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
              <div>
                <h2 className="t-display-m" style={{ margin: 0, fontSize: 22 }}>{g.label}</h2>
                {g.subtitle && <div className="t-small" style={{ marginTop: 2 }}>{g.subtitle}</div>}
              </div>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{g.topics.length}</div>
            </header>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--rule)',
              borderRadius: 'var(--r-lg)', overflow: 'hidden',
            }}>
              {g.topics.map((t, i) => (
                q
                  ? <HighlightedRow key={t.id} topic={t} q={q} onOpen={openTopic} />
                  : <TopicRow key={t.id} topic={t} onOpen={openTopic} showCategory={groupBy === 'level' || groupBy === 'none'} />
              ))}
            </div>
          </section>
        ))}

        {/* Footer */}
        <div style={{ marginTop: 40, padding: 16, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-mute)', fontSize: 12, justifyContent: 'center' }}>
          <span>need a topic that isn't here?</span>
          <button className="btn ghost sm">request a topic →</button>
        </div>
      </div>

      {activeTopic && (
        <TheoryPanelHost
          initialTopic={resolveTopicKey(activeTopic)}
          onClose={closeTopic}
        />
      )}
    </AppShell>
  );
}

function PinnedColumn({ label, topics, onOpen, emptyText }) {
  return (
    <div>
      <div className="t-micro" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {topics.length === 0 && <div className="t-small" style={{ color: 'var(--ink-mute)' }}>{emptyText}</div>}
        {topics.map((t) => (
          <button key={t.id} onClick={() => onOpen(t)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--card)', border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm)', padding: '8px 10px',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{t.title}</span>
            <span className="t-mono" style={{ fontSize: 10, color: masteryColor(t.mastery) }}>{t.mastery}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function cefrLabel(lv) {
  return ({
    A1: 'beginner — high frequency basics',
    A2: 'elementary — building blocks',
    B1: 'intermediate — most everyday grammar',
    B2: 'upper intermediate — nuance & contrast',
    C1: 'advanced — uncommon forms',
    C2: 'mastery',
  })[lv] || '';
}

Object.assign(window, { TheoryIndex, TOPICS, TOPIC_CATEGORIES });
