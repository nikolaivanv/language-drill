// Read — main shell
// Single passage view with:
//  · subtle + assertive highlights co-existing
//  · saved-word style
//  · tap any word (highlighted = instant card, non-highlighted = skeleton → card)
//  · drag-select a span → phrase or sentence card
//  · width toggle: desktop popover vs mobile bottom sheet (side-by-side or single)
//  · vocabulary bank persists across demo states

function ReadHiFi({ onNav }) {
  const [lang, setLang] = React.useState('tr');           // 'tr' | 'de' | 'es'
  const [layout, setLayout] = React.useState('split');    // 'split' | 'desktop' | 'mobile'
  const [bank, setBank] = React.useState(['yürüyerek', 'Dorf'.toLowerCase()]);
  const [savedToast, setSavedToast] = React.useState(null);

  // Active card state — same shape for both desktop & mobile mirrors
  // { kind: 'word'|'phrase'|'sentence', key, anchor, range?, loading? }
  const [active, setActive] = React.useState(null);

  const passage = window.READ_PASSAGES[lang];

  // ─── Switching passages clears any open card ──
  React.useEffect(() => { setActive(null); }, [lang]);

  const closeCard = () => setActive(null);

  const toggleBank = (key) => {
    setBank((b) => {
      const has = b.includes(key);
      const next = has ? b.filter((x) => x !== key) : [...b, key];
      setSavedToast({ key, added: !has });
      window.clearTimeout(window.__rd_toast);
      window.__rd_toast = window.setTimeout(() => setSavedToast(null), 2400);
      return next;
    });
  };

  // ── Tap a word in the passage ─────────────
  const handleTapWord = (lower, idx, anchor) => {
    const isFlagged = !!passage.highlights[lower];
    if (isFlagged && window.READ_WORDS[lower]) {
      setActive({ kind: 'word', key: lower, anchor, tappedIdx: idx, loading: false });
    } else {
      // cold tap → skeleton → real card (~1.5s)
      setActive({ kind: 'word', key: lower, anchor, tappedIdx: idx, loading: true });
      const t = window.setTimeout(() => {
        setActive((a) => (a && a.key === lower && a.tappedIdx === idx) ? { ...a, loading: false } : a);
      }, 1500);
      window.__rd_load = t;
    }
  };

  // ── Drag selection ────────────────────────
  const handleSelectRange = ({ a, b, text, isSentence, anchor }) => {
    const sentKey = text.toLowerCase().trim();
    if (isSentence && window.READ_SENTENCES[sentKey]) {
      setActive({ kind: 'sentence', key: sentKey, anchor, range: { a, b } });
      return;
    }
    const phraseKey = text.toLowerCase().trim().replace(/[.,;:!?¿¡]/g, '').trim();
    if (window.READ_PHRASES[phraseKey]) {
      setActive({ kind: 'phrase', key: phraseKey, anchor, range: { a, b } });
      return;
    }
    // Unknown span — treat as phrase with placeholder loading
    setActive({ kind: 'phrase', key: phraseKey, anchor, range: { a, b }, loading: true });
    window.setTimeout(() => setActive((a) => a && a.range && a.range.a === a.range.a ? { ...a, loading: false } : a), 1500);
  };

  // ── Programmatic demo triggers ─────────────
  const demoTap = (surface) => {
    const idx = window.findWordIdx(passage.text, surface);
    if (idx < 0) return;
    // Synthesize an anchor near the middle-top of the passage; the popover positioning is approximate in demo
    handleTapWord(surface.toLowerCase(), idx, { x: 280, y: 60, maxX: 720 });
  };
  const demoSelect = (spanText) => {
    const span = window.findSpanIdx(passage.text, spanText);
    if (!span) return;
    handleSelectRange({
      a: span.a, b: span.b, text: spanText, isSentence: false,
      anchor: { x: 280, y: 110, maxX: 720 },
    });
  };
  const demoSelectSentence = (sentText) => {
    const span = window.findSpanIdx(passage.text, sentText);
    if (!span) return;
    handleSelectRange({
      a: span.a, b: span.b, text: sentText, isSentence: true,
      anchor: { x: 280, y: 110, maxX: 720 },
    });
  };

  // ── Build card payload from active state ──
  const cardForVariant = (variant) => {
    if (!active) return null;
    if (active.loading) {
      return <CardSkeleton variant={variant} anchor={active.anchor} onClose={closeCard} />;
    }
    if (active.kind === 'word') {
      const entry = window.READ_WORDS[active.key];
      if (!entry) return null;
      return <WordCard entry={entry} variant={variant} anchor={active.anchor}
        inBank={bank.includes(active.key)} onSave={() => toggleBank(active.key)} onClose={closeCard} />;
    }
    if (active.kind === 'phrase') {
      const entry = window.READ_PHRASES[active.key];
      if (!entry) return null;
      return <PhraseCard entry={entry} variant={variant} anchor={active.anchor}
        inBank={bank.includes(active.key)} onSave={() => toggleBank(active.key)} onClose={closeCard} />;
    }
    if (active.kind === 'sentence') {
      const entry = window.READ_SENTENCES[active.key];
      if (!entry) return null;
      return <SentenceCard entry={entry} variant={variant} anchor={active.anchor} onClose={closeCard} />;
    }
    return null;
  };

  const showDesktop = layout !== 'mobile';
  const showMobile = layout !== 'desktop';

  return (
    <AppShell current="read" onNav={onNav}>
      {/* ── Top bar ─────────────────────────────── */}
      <div style={{
        padding: '20px 48px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        borderBottom: '1px solid var(--rule)', gap: 24, flexWrap: 'wrap',
      }}>
        <div>
          <div className="t-micro">reading</div>
          <h1 className="t-display-m" style={{ margin: '4px 0 0' }}>annotate as you read</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <LangPicker lang={lang} setLang={setLang} />
          <LayoutToggle layout={layout} setLayout={setLayout} />
        </div>
      </div>

      <div className="main-inner" style={{ paddingTop: 22, maxWidth: 1200 }}>
        <div className="rd-grid" data-layout={layout}>
          {/* ── Left: rail with demo controls + legend ───────────── */}
          <aside className="rd-rail">
            <DemoStates
              lang={lang}
              passage={passage}
              demoTap={demoTap}
              demoSelect={demoSelect}
              demoSelectSentence={demoSelectSentence}
              closeCard={closeCard}
              active={active}
            />
            <Legend />
            <Bank bank={bank} onClear={() => setBank([])} />
          </aside>

          {/* ── Center: desktop frame ────────────────────────────── */}
          {showDesktop && (
            <Frame variant="desktop" title={`${passage.title} · desktop`} sub={passage.source}>
              <PassageReader
                passage={passage}
                savedWords={bank}
                activeRange={active && active.range}
                tappedIdx={active && active.kind === 'word' ? active.tappedIdx : null}
                loadingIdx={active && active.loading && active.kind === 'word' ? active.tappedIdx : null}
                onTapWord={handleTapWord}
                onSelectRange={handleSelectRange}
              >
                {cardForVariant('popover')}
              </PassageReader>
            </Frame>
          )}

          {/* ── Right: mobile frame ──────────────────────────────── */}
          {showMobile && (
            <Frame variant="mobile" title={`${passage.title}`} sub={`mobile · ≤760px`}>
              <PassageReader
                passage={passage}
                savedWords={bank}
                activeRange={active && active.range}
                tappedIdx={active && active.kind === 'word' ? active.tappedIdx : null}
                loadingIdx={active && active.loading && active.kind === 'word' ? active.tappedIdx : null}
                onTapWord={handleTapWord}
                onSelectRange={handleSelectRange}
              />
              {cardForVariant('sheet')}
            </Frame>
          )}
        </div>
      </div>

      {savedToast && (
        <div className="rd-toast">
          <span className="rd-toast-tick">{savedToast.added ? '✓' : '↶'}</span>
          <span>{savedToast.added ? 'added to vocabulary' : 'removed'} · </span>
          <strong>{savedToast.key}</strong>
        </div>
      )}
    </AppShell>
  );
}

// ─── Tiny widgets ───────────────────────────────────────────────
function LangPicker({ lang, setLang }) {
  const langs = [
    { code: 'tr', label: 'Turkish', flag: 'TR' },
    { code: 'de', label: 'German',  flag: 'DE' },
    { code: 'es', label: 'Spanish', flag: 'ES' },
  ];
  return (
    <div className="rd-segment" role="tablist" aria-label="passage language">
      {langs.map((l) => (
        <button key={l.code}
          className={`rd-segment-btn ${lang === l.code ? 'on' : ''}`}
          onClick={() => setLang(l.code)}>
          <span className="rd-segment-flag">{l.flag}</span>{l.label}
        </button>
      ))}
    </div>
  );
}

function LayoutToggle({ layout, setLayout }) {
  return (
    <div className="rd-segment rd-segment-icon" role="tablist" aria-label="layout">
      {[
        ['desktop', '▭', 'desktop'],
        ['split', '▭▯', 'side-by-side'],
        ['mobile', '▯', 'mobile'],
      ].map(([k, ic, lbl]) => (
        <button key={k} title={lbl} className={`rd-segment-btn ${layout === k ? 'on' : ''}`} onClick={() => setLayout(k)}>
          <span className="rd-layout-icon">{ic}</span>{lbl}
        </button>
      ))}
    </div>
  );
}

function Frame({ variant, title, sub, children }) {
  return (
    <section className={`rd-frame rd-frame-${variant}`}>
      <header className="rd-frame-head">
        <div>
          <div className="rd-frame-title">{title}</div>
          <div className="rd-frame-sub">{sub}</div>
        </div>
        <div className="rd-frame-chip">{variant === 'mobile' ? 'bottom sheet' : 'popover'}</div>
      </header>
      <div className={`rd-frame-body rd-frame-body-${variant}`}>{children}</div>
    </section>
  );
}

function DemoStates({ lang, passage, demoTap, demoSelect, demoSelectSentence, closeCard, active }) {
  const items = [];
  // Find an assertive word in the highlights to feature
  const assertive = Object.entries(passage.highlights).find(([, v]) => v === 'assertive');
  const subtle = Object.entries(passage.highlights).find(([, v]) => v === 'subtle');

  if (assertive) items.push({ id: 'tap-flagged', label: `tap “${assertive[0]}”`, sub: 'assertive · instant card', fn: () => demoTap(assertive[0]) });
  if (subtle) items.push({ id: 'tap-subtle', label: `tap “${subtle[0]}”`, sub: 'subtle · instant card', fn: () => demoTap(subtle[0]) });
  if (passage.demo.coldTap) items.push({ id: 'cold', label: `tap “${passage.demo.coldTap}”`, sub: 'unflagged · skeleton → card', fn: () => demoTap(passage.demo.coldTap) });
  if (passage.demo.phraseSpan) items.push({ id: 'phrase', label: `select “${passage.demo.phraseSpan}”`, sub: 'phrase card', fn: () => demoSelect(passage.demo.phraseSpan) });
  if (passage.demo.sentenceSpan) items.push({ id: 'sent', label: `select sentence`, sub: 'sentence card', fn: () => demoSelectSentence(passage.demo.sentenceSpan) });

  return (
    <div className="rd-card rd-card-pad">
      <div className="t-micro">demo states</div>
      <div className="rd-h2" style={{ marginBottom: 10 }}>walk the flow</div>
      <div className="rd-states-list">
        {items.map((it) => (
          <button key={it.id} className="rd-state-btn" onClick={it.fn}>
            <span className="rd-state-num">→</span>
            <span className="rd-state-text">
              <span className="rd-state-label">{it.label}</span>
              <span className="rd-state-sub">{it.sub}</span>
            </span>
          </button>
        ))}
        {active && (
          <button className="rd-state-btn rd-state-clear" onClick={closeCard}>
            <span className="rd-state-num">×</span>
            <span className="rd-state-text"><span className="rd-state-label">close card</span><span className="rd-state-sub">return to passage</span></span>
          </button>
        )}
      </div>
      <div className="rd-hint">
        or interact directly: click any word, drag across words to select a phrase / sentence.
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="rd-card rd-card-pad">
      <div className="t-micro">legend</div>
      <div className="rd-h2" style={{ marginBottom: 12 }}>highlight styles</div>
      <div className="rd-legend">
        <div className="rd-legend-row"><span className="rd-w rd-w-subtle">subtle</span><span>dotted accent · probably worth a glance</span></div>
        <div className="rd-legend-row"><span className="rd-w rd-w-assertive">assertive</span><span>amber wash · likely unknown to you</span></div>
        <div className="rd-legend-row"><span className="rd-w rd-w-saved">saved</span><span>bolder · already in your vocabulary</span></div>
      </div>
    </div>
  );
}

function Bank({ bank, onClear }) {
  return (
    <div className="rd-card rd-card-pad">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div className="t-micro">vocabulary</div>
          <div className="rd-h2">your bank</div>
        </div>
        <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{bank.length}</span>
      </div>
      {bank.length === 0 ? (
        <div className="rd-bank-empty">nothing saved yet — tap a word and hit save.</div>
      ) : (
        <ul className="rd-bank-list">
          {bank.map((w) => (
            <li key={w}>
              <span className="rd-bank-word">{w}</span>
            </li>
          ))}
        </ul>
      )}
      {bank.length > 0 && (
        <button className="rd-bank-clear" onClick={onClear}>clear bank</button>
      )}
    </div>
  );
}

Object.assign(window, { ReadHiFi });
