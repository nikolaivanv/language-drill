// Read — paste-text → annotate → mark words → save to bank
// States: empty (paste landing) · annotated (read view) · history list
// Two highlight metaphors swappable via a chip toggle: "subtle" (dotted underline) vs "assertive" (amber wash)

// Sample paragraph from a hypothetical learner-pasted source
const READ_SAMPLE = {
  title: "Cien años de soledad",
  source: "Gabriel García Márquez · ch. 1",
  text: `Muchos años después, frente al pelotón de fusilamiento, el coronel Aureliano Buendía había de recordar aquella tarde remota en que su padre lo llevó a conocer el hielo. Macondo era entonces una aldea de veinte casas de barro y cañabrava construidas a la orilla de un río de aguas diáfanas que se precipitaban por un lecho de piedras pulidas, blancas y enormes como huevos prehistóricos. El mundo era tan reciente, que muchas cosas carecían de nombre, y para mencionarlas había que señalarlas con el dedo. Todos los años, por el mes de marzo, una familia de gitanos desarrapados plantaba su carpa cerca de la aldea.`,
};

// Words flagged as "above the user's level" (~B1 estimate). In a real impl this comes from
// a frequency-rank lookup + the user's known-set. Each entry: { word: matched-form, lemma, pos, gloss, example, freq, cefr }
const READ_FLAGGED = {
  'pelotón': { lemma: 'pelotón', pos: 'm. noun', gloss: 'squad, platoon', example: 'el pelotón de fusilamiento — the firing squad', freq: 7820, cefr: 'C1' },
  'fusilamiento': { lemma: 'fusilamiento', pos: 'm. noun', gloss: 'execution by firing squad', example: 'la sentencia de fusilamiento — the death sentence', freq: 12400, cefr: 'C1' },
  'remota': { lemma: 'remoto', pos: 'adj. (f.)', gloss: 'remote, distant (in time or place)', example: 'una época remota — a distant era', freq: 4210, cefr: 'B2' },
  'aldea': { lemma: 'aldea', pos: 'f. noun', gloss: 'small village, hamlet', example: 'una aldea de pescadores — a fishing village', freq: 5630, cefr: 'B2' },
  'barro': { lemma: 'barro', pos: 'm. noun', gloss: 'mud, clay', example: 'casas de barro — adobe houses', freq: 6810, cefr: 'B2' },
  'cañabrava': { lemma: 'cañabrava', pos: 'f. noun', gloss: 'wild cane (a grass used for thatching)', example: 'techo de cañabrava — cane-thatched roof', freq: 22100, cefr: 'C2' },
  'orilla': { lemma: 'orilla', pos: 'f. noun', gloss: 'bank, shore, edge', example: 'a la orilla del río — at the river\'s edge', freq: 3920, cefr: 'B2' },
  'diáfanas': { lemma: 'diáfano', pos: 'adj. (f. pl.)', gloss: 'crystal-clear, translucent', example: 'aguas diáfanas — crystal-clear waters', freq: 14800, cefr: 'C1' },
  'precipitaban': { lemma: 'precipitarse', pos: 'v. (imp. pl.)', gloss: 'to rush, hurtle, fall', example: 'el agua se precipitaba — the water rushed down', freq: 5210, cefr: 'B2' },
  'lecho': { lemma: 'lecho', pos: 'm. noun', gloss: 'bed (of a river); literary: bed', example: 'lecho del río — riverbed', freq: 6480, cefr: 'B2' },
  'pulidas': { lemma: 'pulido', pos: 'adj. (f. pl.)', gloss: 'polished, smooth', example: 'piedras pulidas — polished stones', freq: 4880, cefr: 'B2' },
  'carecían': { lemma: 'carecer', pos: 'v. (imp. pl.)', gloss: 'to lack, be without', example: 'carecer de nombre — to lack a name', freq: 3110, cefr: 'B2' },
  'mencionarlas': { lemma: 'mencionar', pos: 'v. (inf. + clitic)', gloss: 'to mention them', example: 'no quiero mencionarlas — I don\'t want to mention them', freq: 1180, cefr: 'B1' },
  'señalarlas': { lemma: 'señalar', pos: 'v. (inf. + clitic)', gloss: 'to point them out', example: 'señalar con el dedo — to point with a finger', freq: 980, cefr: 'B1' },
  'gitanos': { lemma: 'gitano', pos: 'm. noun (pl.)', gloss: 'Romani people, gypsies', example: 'una familia de gitanos — a Romani family', freq: 7240, cefr: 'B2' },
  'desarrapados': { lemma: 'desarrapado', pos: 'adj. (m. pl.)', gloss: 'ragged, in tatters', example: 'unos niños desarrapados — ragged children', freq: 24300, cefr: 'C2' },
  'carpa': { lemma: 'carpa', pos: 'f. noun', gloss: 'tent, big-top', example: 'plantar la carpa — to pitch the tent', freq: 8120, cefr: 'B2' },
};

const READ_HISTORY = [
  { id: 'h1', title: 'Cien años de soledad', source: 'Gabriel García Márquez · ch. 1', words: 17, saved: 8, when: 'today', preview: 'Muchos años después, frente al pelotón…' },
  { id: 'h2', title: 'El País — opinión', source: 'editorial · last week', words: 9, saved: 4, when: '4d ago', preview: 'La transición energética europea atraviesa…' },
  { id: 'h3', title: 'NYT en español', source: 'noticia · last week', words: 12, saved: 6, when: '6d ago', preview: 'El acuerdo bilateral firmado el martes en…' },
  { id: 'h4', title: 'Conversación con Marina', source: 'note · two weeks ago', words: 6, saved: 5, when: '12d ago', preview: 'Marina me contó que en su pueblo siempre…' },
];

function ReadHiFi({ onNav }) {
  const [view, setView] = React.useState('annotated'); // 'empty' | 'pasting' | 'annotated' | 'history'
  const [intensity, setIntensity] = React.useState('subtle'); // 'subtle' | 'assertive'
  const [pasteText, setPasteText] = React.useState('');
  const [pasteTitle, setPasteTitle] = React.useState('');
  const [activeWord, setActiveWord] = React.useState(null); // { word, x, y } or null
  const [bank, setBank] = React.useState(['pelotón', 'fusilamiento', 'aldea', 'cañabrava', 'diáfanas', 'gitanos', 'desarrapados']);
  const [savedToast, setSavedToast] = React.useState(false);

  const toggleBank = (w) => {
    setBank((b) => b.includes(w) ? b.filter((x) => x !== w) : [...b, w]);
  };

  const finishReading = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 4000);
    setActiveWord(null);
  };

  return (
    <AppShell current="read" onNav={onNav}>
      {/* Top bar with view toggle */}
      <div style={{
        padding: '20px 48px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--rule)', paddingBottom: 14,
      }}>
        <div>
          <div className="t-micro">reading</div>
          <h1 className="t-display-m" style={{ margin: '4px 0 0' }}>read &amp; collect</h1>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn sm ${view === 'annotated' || view === 'pasting' || view === 'empty' ? 'primary' : ''}`} onClick={() => setView(pasteText ? 'annotated' : (view === 'pasting' ? 'pasting' : 'annotated'))}>current text</button>
          <button className={`btn sm ${view === 'history' ? 'primary' : ''}`} onClick={() => setView('history')}>history <span className="t-mono" style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{READ_HISTORY.length}</span></button>
          <button className="btn sm" onClick={() => setView('pasting')}>+ paste new</button>
        </div>
      </div>

      <div className="main-inner" style={{ paddingTop: 24, position: 'relative' }}>
        {view === 'empty' && <ReadEmpty onPaste={() => setView('pasting')} />}
        {view === 'pasting' && <ReadPaste text={pasteText} setText={setPasteText} title={pasteTitle} setTitle={setPasteTitle} onCancel={() => setView('annotated')} onAnnotate={() => setView('annotated')} />}
        {view === 'annotated' && (
          <ReadAnnotated
            sample={READ_SAMPLE}
            flagged={READ_FLAGGED}
            intensity={intensity}
            setIntensity={setIntensity}
            activeWord={activeWord}
            setActiveWord={setActiveWord}
            bank={bank}
            toggleBank={toggleBank}
            onFinish={finishReading}
          />
        )}
        {view === 'history' && <ReadHistory items={READ_HISTORY} onOpen={() => setView('annotated')} />}
      </div>

      {savedToast && <SavedToast count={bank.length} onDismiss={() => setSavedToast(false)} onSeeQueue={() => onNav('cloze')} />}
    </AppShell>
  );
}

// ─── Empty state ─────────────────────────────────────────────
function ReadEmpty({ onPaste }) {
  return (
    <div style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
      <div className="t-hand" style={{ fontSize: 26, color: 'var(--accent)', lineHeight: 1.2, marginBottom: 4 }}>read in the wild</div>
      <h2 className="t-display-l" style={{ margin: '8px 0 16px' }}>paste anything you're reading.</h2>
      <p className="t-body-l" style={{ color: 'var(--ink-soft)' }}>
        a paragraph from a book, an article, a conversation. i'll mark the words above your level and surface them in your next sessions.
      </p>
      <div style={{ marginTop: 32 }}>
        <button className="btn primary lg" onClick={onPaste}>paste a text →</button>
      </div>
      <div style={{ marginTop: 48, padding: 24, background: 'var(--paper-2)', borderRadius: 'var(--r-lg)', textAlign: 'left', border: '1px dashed var(--rule)' }}>
        <div className="t-micro" style={{ marginBottom: 10 }}>how it works</div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)' }}>
          <li>paste a paragraph (≤ 2,000 chars).</li>
          <li>i highlight words rarer than your current band (~B1+).</li>
          <li>tap a word to see meaning + an example. tap "save" to add to your bank.</li>
          <li>saved words show up in cloze, vocab recall, and translation drills, tagged "from your reading."</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Paste state ─────────────────────────────────────────────
function ReadPaste({ text, setText, title, setTitle, onCancel, onAnnotate }) {
  const len = text.length;
  const tooLong = len > 2000;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="t-micro">new text</div>
      <h2 className="t-display-m" style={{ margin: '4px 0 22px' }}>paste a passage</h2>

      <label className="t-small" style={{ display: 'block', marginBottom: 6 }}>title or source <span style={{ color: 'var(--ink-mute)' }}>(optional)</span></label>
      <input
        className="input"
        placeholder="e.g. Cien años de soledad — ch. 1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginBottom: 18 }}
      />

      <label className="t-small" style={{ display: 'block', marginBottom: 6 }}>passage</label>
      <textarea
        className="textarea"
        rows="12"
        placeholder="paste a paragraph here. just one or two — quality over quantity. i'll work better with prose than with code or lists."
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: 240, fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, lineHeight: 1.6 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div className="t-small" style={{ color: tooLong ? 'var(--accent)' : 'var(--ink-mute)', fontFamily: 'var(--t-mono)', fontSize: 11 }}>
          {len} / 2,000 {tooLong && '· too long'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={onCancel}>cancel</button>
          <button className="btn primary" disabled={!text.trim() || tooLong} onClick={onAnnotate} style={{ opacity: (!text.trim() || tooLong) ? 0.4 : 1 }}>annotate →</button>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 12, background: 'var(--paper-2)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="t-hand" style={{ fontSize: 17, color: 'var(--ink-soft)' }}>tip</span>
        <span className="t-small" style={{ flex: 1 }}>annotation runs locally first; if you save, the text is stored only in your account. nothing is shared.</span>
      </div>
    </div>
  );
}

// ─── Annotated read view ─────────────────────────────────────
function ReadAnnotated({ sample, flagged, intensity, setIntensity, activeWord, setActiveWord, bank, toggleBank, onFinish }) {
  // Render the text with flagged words wrapped in <button class="rd-word">
  const renderText = (text) => {
    // Split by whitespace+punctuation, preserve punctuation.
    const parts = text.split(/(\s+|[,.;:!?¿¡—()])/g);
    return parts.map((tok, i) => {
      const lower = tok.toLowerCase().replace(/[.,;:!?¿¡—()]/g, '');
      if (flagged[lower]) {
        const inBank = bank.includes(lower);
        return (
          <button
            key={i}
            data-word={lower}
            className={`rd-word ${intensity} ${inBank ? 'saved' : ''} ${activeWord?.word === lower ? 'active' : ''}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const containerR = e.currentTarget.closest('.rd-text').getBoundingClientRect();
              setActiveWord({ word: lower, x: r.left - containerR.left + r.width / 2, y: r.bottom - containerR.top + 6 });
            }}
          >
            {tok}
          </button>
        );
      }
      return <React.Fragment key={i}>{tok}</React.Fragment>;
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 32, alignItems: 'start' }}>
      {/* Left: reader pane */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div className="t-display-m" style={{ marginBottom: 2 }}>{sample.title}</div>
            <div className="t-small">{sample.source}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="t-micro" style={{ color: 'var(--ink-mute)' }}>highlight</span>
            <div style={{ display: 'flex', borderRadius: 999, border: '1px solid var(--rule)', padding: 2, background: 'var(--card)' }}>
              <button onClick={() => setIntensity('subtle')} className="t-small" style={{
                border: 'none', background: intensity === 'subtle' ? 'var(--ink)' : 'transparent',
                color: intensity === 'subtle' ? 'var(--paper)' : 'var(--ink-soft)',
                padding: '4px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 500,
              }}>subtle</button>
              <button onClick={() => setIntensity('assertive')} className="t-small" style={{
                border: 'none', background: intensity === 'assertive' ? 'var(--ink)' : 'transparent',
                color: intensity === 'assertive' ? 'var(--paper)' : 'var(--ink-soft)',
                padding: '4px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 500,
              }}>assertive</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 22, paddingBottom: 14, borderBottom: '1px dashed var(--rule)' }}>
          <span className="chip">~B1+ calibration</span>
          <span className="t-small" style={{ color: 'var(--ink-mute)' }}>showing words rarer than top-3000 · refined by your known set</span>
          <button className="btn ghost sm" style={{ marginLeft: 'auto', fontSize: 11 }}>adjust</button>
        </div>

        <div className="rd-text" style={{ position: 'relative' }} onClick={(e) => {
          if (!e.target.closest('.rd-word') && !e.target.closest('.rd-popover')) setActiveWord(null);
        }}>
          <p style={{
            fontFamily: "'Fraunces', Georgia, serif", fontSize: 19, lineHeight: 1.75,
            color: 'var(--ink)', margin: 0,
          }}>
            {renderText(sample.text)}
          </p>

          {activeWord && (
            <WordCard
              entry={flagged[activeWord.word]}
              word={activeWord.word}
              x={activeWord.x}
              y={activeWord.y}
              inBank={bank.includes(activeWord.word)}
              onSave={() => toggleBank(activeWord.word)}
              onClose={() => setActiveWord(null)}
            />
          )}
        </div>

        <div style={{ marginTop: 28, padding: '14px 18px', background: 'var(--paper-2)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {Object.keys(flagged).length} flagged · {bank.length} saved · {Object.keys(flagged).length - bank.length} skipped
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={() => bank.forEach((w) => toggleBank(w))}>clear bank</button>
          <button className="btn primary" disabled={bank.length === 0} onClick={onFinish} style={{ opacity: bank.length === 0 ? 0.4 : 1 }}>save {bank.length} to bank →</button>
        </div>
      </div>

      {/* Right: word bank rail */}
      <aside style={{
        position: 'sticky', top: 24,
        background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-lg)',
        padding: '18px 18px 12px', maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="t-display-s">word bank</div>
          <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{bank.length}</div>
        </div>
        <div className="t-small" style={{ marginBottom: 14 }}>marked from this passage</div>
        {bank.length === 0 ? (
          <div className="t-small" style={{
            padding: 18, border: '1px dashed var(--rule)', borderRadius: 'var(--r-md)',
            color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5,
          }}>
            tap a highlighted word to see its meaning, then save it here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', minHeight: 0, marginRight: -8, paddingRight: 8 }}>
            {bank.map((w) => {
              const e = flagged[w];
              if (!e) return null;
              return (
                <div key={w} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
                  background: 'var(--paper-2)', borderRadius: 'var(--r-sm)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 14, fontWeight: 500 }}>{e.lemma}</div>
                    <div className="t-small" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{e.gloss}</div>
                  </div>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>{e.cefr}</span>
                  <button onClick={() => toggleBank(w)} style={{
                    border: 'none', background: 'transparent', color: 'var(--ink-mute)',
                    cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, marginTop: 2,
                  }}>×</button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px dashed var(--rule)', marginTop: 14 }}>
          <div className="t-small" style={{ color: 'var(--ink-mute)', fontSize: 11, lineHeight: 1.5 }}>
            saved words appear in cloze, vocab recall, and translation drills tagged
            <span className="chip accent" style={{ marginLeft: 4, fontSize: 10, padding: '1px 6px' }}>from your reading</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Word card popover ────────────────────────────────────────
function WordCard({ entry, word, x, y, inBank, onSave, onClose }) {
  if (!entry) return null;
  const W = 320;
  const adjustedX = Math.max(8, Math.min(x - W / 2, 1200 - W));
  return (
    <div className="rd-popover" style={{
      position: 'absolute', left: adjustedX, top: y, width: W, zIndex: 30,
      background: 'var(--card)', border: '1px solid var(--ink)', borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-3)',
      animation: 'fade .18s ease both',
    }} onClick={(e) => e.stopPropagation()}>
      {/* Pointer */}
      <div style={{
        position: 'absolute', top: -7, left: x - adjustedX - 6, width: 12, height: 12,
        background: 'var(--card)', border: '1px solid var(--ink)', borderBottom: 'none', borderRight: 'none',
        transform: 'rotate(45deg)',
      }} />

      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontFamily: 'var(--t-display)', fontSize: 22, fontWeight: 500, letterSpacing: '-0.2px' }}>{entry.lemma}</div>
          <div className="t-small" style={{ fontStyle: 'italic' }}>{entry.pos}</div>
          <span style={{ marginLeft: 'auto' }} />
          <span className="t-mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{entry.cefr}</span>
        </div>
        <div className="t-body" style={{ marginTop: 4, color: 'var(--ink-2)' }}>{entry.gloss}</div>
      </div>
      <div style={{ padding: '12px 16px' }}>
        <div className="t-micro" style={{ marginBottom: 6 }}>example</div>
        <div style={{ fontFamily: 'var(--t-display)', fontSize: 15, lineHeight: 1.5, color: 'var(--ink)' }}>
          {entry.example}
        </div>
      </div>
      <div style={{ padding: '10px 12px 12px', display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
        <span className="t-small" style={{ flex: 1, fontFamily: 'var(--t-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>
          freq #{entry.freq.toLocaleString()}
        </span>
        <button className="btn ghost sm" onClick={onClose} style={{ fontSize: 11 }}>skip</button>
        <button className={`btn sm ${inBank ? 'accent' : 'primary'}`} onClick={onSave} style={{ fontSize: 11 }}>
          {inBank ? '✓ saved · undo' : '+ save to bank'}
        </button>
      </div>
    </div>
  );
}

// ─── History list ────────────────────────────────────────────
function ReadHistory({ items, onOpen }) {
  return (
    <div style={{ maxWidth: 800 }}>
      <div className="t-micro" style={{ marginBottom: 6 }}>your reading</div>
      <h2 className="t-display-m" style={{ margin: '4px 0 22px' }}>past texts</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => (
          <button
            key={it.id}
            onClick={onOpen}
            style={{
              border: '1px solid var(--rule)', borderRadius: 'var(--r-md)',
              background: 'var(--card)', padding: '16px 20px', cursor: 'pointer',
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
              textAlign: 'left', transition: 'all .15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ink)'; e.currentTarget.style.background = 'var(--paper-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; e.currentTarget.style.background = 'var(--card)'; }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--t-display)', fontSize: 18, fontWeight: 500, marginBottom: 2 }}>{it.title}</div>
              <div className="t-small" style={{ marginBottom: 6 }}>{it.source} · {it.when}</div>
              <div className="t-body" style={{ fontFamily: 'var(--t-display)', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                "{it.preview}"
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{it.words} flagged</div>
              <span className="chip ok">{it.saved} saved</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Toast confirmation ──────────────────────────────────────
function SavedToast({ count, onDismiss, onSeeQueue }) {
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--ink)', color: 'var(--paper)',
      padding: '14px 20px', borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-3)',
      display: 'flex', alignItems: 'center', gap: 14, zIndex: 60,
      animation: 'fade .2s ease both', maxWidth: 540,
    }}>
      <div style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✓</div>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--paper)' }}>{count} word{count !== 1 ? 's' : ''} added</strong> to your bank.
        <br />
        <span style={{ color: 'rgba(250,247,241,0.7)', fontSize: 12 }}>your next session will weave them in.</span>
      </div>
      <button onClick={onSeeQueue} style={{
        border: '1px solid rgba(250,247,241,0.3)', background: 'transparent', color: 'var(--paper)',
        padding: '6px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
      }}>see next session</button>
      <button onClick={onDismiss} style={{ border: 'none', background: 'transparent', color: 'rgba(250,247,241,0.5)', cursor: 'pointer', fontSize: 18, padding: 0, marginLeft: -4 }}>×</button>
    </div>
  );
}

// ─── Inject the highlight + saved-word styles ────────────────
(function injectReadStyles() {
  if (document.getElementById('read-styles')) return;
  const s = document.createElement('style');
  s.id = 'read-styles';
  s.textContent = `
    .rd-word {
      border: none; background: transparent; padding: 0; margin: 0;
      font: inherit; color: inherit; cursor: pointer;
      transition: all .12s;
      border-radius: 2px;
    }
    /* SUBTLE: dotted underline in accent */
    .rd-word.subtle {
      text-decoration: underline dotted var(--accent);
      text-decoration-thickness: 1.5px;
      text-underline-offset: 4px;
    }
    .rd-word.subtle:hover {
      background: var(--accent-soft);
      text-decoration-style: solid;
    }
    /* ASSERTIVE: amber wash */
    .rd-word.assertive {
      background: linear-gradient(180deg, transparent 50%, var(--hilite-soft) 50%, var(--hilite-soft) 92%, transparent 92%);
      padding: 0 1px;
    }
    .rd-word.assertive:hover {
      background: var(--hilite-soft);
    }
    /* SAVED: solid accent underline (both modes) */
    .rd-word.saved.subtle {
      text-decoration: underline solid var(--accent);
      text-decoration-thickness: 2px;
      color: var(--accent-2);
      font-weight: 500;
    }
    .rd-word.saved.assertive {
      background: var(--accent-soft);
      color: var(--accent-2);
      font-weight: 500;
      box-shadow: 0 0 0 1px var(--accent-soft);
      border-radius: 3px;
    }
    /* ACTIVE: ring */
    .rd-word.active {
      background: var(--ink) !important;
      color: var(--paper) !important;
      border-radius: 3px !important;
      padding: 0 3px !important;
      text-decoration: none !important;
    }
  `;
  document.head.appendChild(s);
})();

Object.assign(window, { ReadHiFi });
