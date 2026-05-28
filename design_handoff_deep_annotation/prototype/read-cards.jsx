// Read — annotation cards (Word / Phrase / Sentence) + skeleton
// Cards render as either a desktop popover (anchored) or a mobile bottom sheet (full-width).
// The parent decides chrome via `variant`; the inner card body is identical.

// ─── Card chrome ─────────────────────────────────────────────
function CardChrome({ variant, anchor, children, onClose }) {
  if (variant === 'sheet') {
    return (
      <div className="rd-sheet-wrap" onClick={onClose}>
        <div className="rd-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="rd-sheet-handle" />
          {children}
        </div>
      </div>
    );
  }
  // popover
  const W = 340;
  const ax = anchor?.x ?? 0;
  const ay = anchor?.y ?? 0;
  const max = anchor?.maxX ?? 9999;
  const left = Math.max(8, Math.min(ax - W / 2, max - W - 8));
  const tail = ax - left;
  return (
    <div className="rd-popover" style={{ left, top: ay + 10, width: W }} onClick={(e) => e.stopPropagation()}>
      <div className="rd-popover-tail" style={{ left: Math.max(16, Math.min(tail, W - 16)) - 6 }} />
      {children}
    </div>
  );
}

// ─── Skeleton (cold-tap loading) ─────────────────────────────
function CardSkeleton({ variant, anchor, onClose }) {
  return (
    <CardChrome variant={variant} anchor={anchor} onClose={onClose}>
      <div className="rd-card-body">
        <div className="rd-skel-row">
          <div className="rd-skel rd-skel-headword" />
          <div className="rd-skel rd-skel-chip" />
          <div className="rd-skel rd-skel-chip" />
        </div>
        <div className="rd-skel rd-skel-line" style={{ width: '70%' }} />
        <div className="rd-skel rd-skel-line" style={{ width: '92%', marginTop: 14 }} />
        <div className="rd-skel rd-skel-line" style={{ width: '85%' }} />
        <div className="rd-skel rd-skel-line" style={{ width: '60%' }} />
        <div className="rd-skel-caption">
          <span className="rd-spinner" /> looking it up · ~1.5s
        </div>
      </div>
    </CardChrome>
  );
}

// ─── Deep WORD card ─────────────────────────────────────────
function WordCard({ entry, variant, anchor, inBank, onSave, onClose }) {
  const [open, setOpen] = React.useState({ syn: false, coll: false, reg: false, ex: false });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  if (!entry) return null;

  return (
    <CardChrome variant={variant} anchor={anchor} onClose={onClose}>
      <div className="rd-card-body">
        {/* ── Header ───────────────────────────── */}
        <div className="rd-card-head">
          <div className="rd-headword">{entry.headword}</div>
          <button className="rd-audio" title="play audio" onClick={(e) => e.stopPropagation()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19 12c0-2.5-1.5-4.5-3-5.5"/><path d="M15.5 8.5a3.5 3.5 0 010 7"/></svg>
          </button>
        </div>
        <div className="rd-meta-row">
          <span className="rd-pos">{entry.pos}</span>
          <span className="rd-dot">·</span>
          <span className="rd-cefr">{entry.cefr}</span>
          <span className="rd-dot">·</span>
          <span className="rd-freq">#{entry.freq.toLocaleString()}</span>
        </div>
        {entry.inflection && (
          <div className="rd-inflection">{entry.inflection}</div>
        )}

        {/* ── Contextual sense ─────────────────── */}
        <div className="rd-sense">
          <span className="rd-sense-mark">here:</span>
          <span className="rd-sense-text">“{entry.contextualSense}”</span>
        </div>

        {/* ── Target-language definition ───────── */}
        {entry.definition && (
          <div className="rd-def">
            <div className="rd-def-label">{entry.definitionLabel || 'definition'}</div>
            <div className="rd-def-text">{entry.definition}</div>
          </div>
        )}

        {/* ── Morphology breakdown ─────────────── */}
        {entry.morphology && (
          <div className="rd-morph">
            <div className="rd-morph-label">morphology</div>
            <div className="rd-morph-row">
              {entry.morphology.map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="rd-morph-plus">+</span>}
                  <div className="rd-morph-cell">
                    <div className="rd-morph-part">{m.part}</div>
                    <div className="rd-morph-role">{m.role}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
            {entry.morphWhy && (
              <div className="rd-morph-why"><span className="rd-why-tag">why this form</span>{entry.morphWhy}</div>
            )}
          </div>
        )}

        {/* ── EXTRAS (collapsed rows) ──────────── */}
        <div className="rd-extras">
          {entry.synonyms && (
            <ExtraRow open={open.syn} onToggle={() => toggle('syn')} label="synonyms" count={entry.synonyms.length}>
              <ul className="rd-extras-list">
                {entry.synonyms.map((s, i) => (
                  <li key={i}><span className="rd-syn-word">{s.word}</span><span className="rd-syn-note">{s.note}</span></li>
                ))}
              </ul>
            </ExtraRow>
          )}
          {entry.collocations && (
            <ExtraRow open={open.coll} onToggle={() => toggle('coll')} label="collocations" count={entry.collocations.length}>
              <ul className="rd-extras-list">
                {entry.collocations.map((c, i) => (
                  <li key={i}><span className="rd-syn-word">{c.phrase}</span><span className="rd-syn-note">{c.gloss}</span></li>
                ))}
              </ul>
            </ExtraRow>
          )}
          {entry.register && (
            <ExtraRow open={open.reg} onToggle={() => toggle('reg')} label="register">
              <div className="rd-register">{entry.register}</div>
            </ExtraRow>
          )}
          {entry.extraExample && (
            <ExtraRow open={open.ex} onToggle={() => toggle('ex')} label="another example">
              <div className="rd-example">
                <div className="rd-example-tl">{entry.extraExample.tl}</div>
                <div className="rd-example-en">{entry.extraExample.en}</div>
              </div>
            </ExtraRow>
          )}
        </div>

        {/* ── Footer ──────────────────────────── */}
        <div className="rd-foot">
          <button className="rd-foot-skip" onClick={onClose}>skip</button>
          <button className={`rd-foot-save ${inBank ? 'is-saved' : ''}`} onClick={onSave}>
            {inBank ? '✓ saved · undo' : '+ save to vocabulary'}
          </button>
        </div>
      </div>
    </CardChrome>
  );
}

function ExtraRow({ open, onToggle, label, count, children }) {
  return (
    <div className={`rd-extra ${open ? 'open' : ''}`}>
      <button className="rd-extra-head" onClick={onToggle}>
        <span className="rd-extra-chev">{open ? '−' : '+'}</span>
        <span className="rd-extra-label">{label}</span>
        {count != null && <span className="rd-extra-count">{count}</span>}
      </button>
      {open && <div className="rd-extra-body">{children}</div>}
    </div>
  );
}

// ─── PHRASE card ────────────────────────────────────────────
function PhraseCard({ entry, variant, anchor, inBank, onSave, onClose }) {
  if (!entry) return null;
  return (
    <CardChrome variant={variant} anchor={anchor} onClose={onClose}>
      <div className="rd-card-body">
        <div className="rd-card-head">
          <div className="rd-headword">{entry.citation || entry.surface}</div>
          <span className="rd-kind-pill">phrase</span>
        </div>
        <div className="rd-meta-row">
          <span className="rd-pos">idiom</span>
          <span className="rd-dot">·</span>
          <span className="rd-cefr">{entry.register}</span>
        </div>

        <div className="rd-sense">
          <span className="rd-sense-mark">means:</span>
          <span className="rd-sense-text">“{entry.idiomatic}”</span>
        </div>

        <div className="rd-def">
          <div className="rd-def-label">literal</div>
          <div className="rd-def-text" style={{ fontStyle: 'italic' }}>{entry.literal}</div>
        </div>

        {entry.example && (
          <div className="rd-example rd-example-block">
            <div className="rd-example-tl">{entry.example.tl}</div>
            <div className="rd-example-en">{entry.example.en}</div>
          </div>
        )}

        {entry.synonyms && (
          <div className="rd-morph">
            <div className="rd-morph-label">synonymous expressions</div>
            <ul className="rd-extras-list" style={{ margin: 0 }}>
              {entry.synonyms.map((s, i) => (
                <li key={i}><span className="rd-syn-word">{s.word}</span><span className="rd-syn-note">{s.note}</span></li>
              ))}
            </ul>
          </div>
        )}

        <div className="rd-foot">
          <button className="rd-foot-skip" onClick={onClose}>skip</button>
          <button className={`rd-foot-save ${inBank ? 'is-saved' : ''}`} onClick={onSave}>
            {inBank ? '✓ saved · undo' : '+ save phrase'}
          </button>
        </div>
      </div>
    </CardChrome>
  );
}

// ─── SENTENCE card ──────────────────────────────────────────
function SentenceCard({ entry, variant, anchor, onClose }) {
  if (!entry) return null;
  return (
    <CardChrome variant={variant} anchor={anchor} onClose={onClose}>
      <div className="rd-card-body">
        <div className="rd-card-head">
          <div className="rd-kind-pill" style={{ marginLeft: 0 }}>sentence</div>
        </div>

        <div className="rd-sentence-quote">“{entry.sentence}”</div>
        <div className="rd-sentence-trans">{entry.translation}</div>

        <div className="rd-morph" style={{ marginTop: 14 }}>
          <div className="rd-morph-label">breakdown</div>
          <div className="rd-chunk-list">
            {entry.chunks.map((c, i) => (
              <div className="rd-chunk" key={i}>
                <div className="rd-chunk-head">
                  <span className="rd-chunk-text">{c.es}</span>
                  <span className="rd-chunk-role">{c.role}</span>
                </div>
                <div className="rd-chunk-note">{c.note}</div>
              </div>
            ))}
          </div>
        </div>

        {entry.grammarNotes && (
          <div className="rd-extra open" style={{ marginTop: 4 }}>
            <div className="rd-extra-head" style={{ pointerEvents: 'none' }}>
              <span className="rd-extra-chev">·</span>
              <span className="rd-extra-label">grammar covered</span>
            </div>
            <div className="rd-extra-body">
              <div className="rd-grammar-tags">
                {entry.grammarNotes.map((g, i) => (
                  <span className="rd-gram-tag" key={i}>{g}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="rd-foot">
          <button className="rd-foot-skip" onClick={onClose}>close</button>
          <button className="rd-foot-save">+ add to translation drills</button>
        </div>
      </div>
    </CardChrome>
  );
}

Object.assign(window, { WordCard, PhraseCard, SentenceCard, CardSkeleton });
