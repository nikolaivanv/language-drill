// Mobile read — paste-text → annotate → mark words → save to bank.
// Adapts the desktop read pattern to phone-native idioms:
//   · word definition opens as a bottom sheet (not a popover)
//   · word bank shown as a horizontal chip strip + count badge
//   · highlight intensity toggle as a segmented control under the title
//   · history is a simple stack of cards (own tab inside the screen)

const M_READ_SAMPLE = {
  title: "Cien años de soledad",
  source: "García Márquez · ch. 1",
  text: `Muchos años después, frente al pelotón de fusilamiento, el coronel Aureliano Buendía había de recordar aquella tarde remota en que su padre lo llevó a conocer el hielo. Macondo era entonces una aldea de veinte casas de barro y cañabrava construidas a la orilla de un río de aguas diáfanas que se precipitaban por un lecho de piedras pulidas, blancas y enormes como huevos prehistóricos.`,
};

const M_FLAGGED = {
  'pelotón': { lemma: 'pelotón', pos: 'm. noun', gloss: 'squad, platoon', example: 'el pelotón de fusilamiento — the firing squad', freq: 7820, cefr: 'C1' },
  'fusilamiento': { lemma: 'fusilamiento', pos: 'm. noun', gloss: 'execution by firing squad', example: 'la sentencia de fusilamiento — the death sentence', freq: 12400, cefr: 'C1' },
  'remota': { lemma: 'remoto', pos: 'adj. (f.)', gloss: 'remote, distant in time', example: 'una época remota — a distant era', freq: 4210, cefr: 'B2' },
  'aldea': { lemma: 'aldea', pos: 'f. noun', gloss: 'small village, hamlet', example: 'una aldea de pescadores — a fishing village', freq: 5630, cefr: 'B2' },
  'barro': { lemma: 'barro', pos: 'm. noun', gloss: 'mud, clay', example: 'casas de barro — adobe houses', freq: 6810, cefr: 'B2' },
  'cañabrava': { lemma: 'cañabrava', pos: 'f. noun', gloss: 'wild cane (used for thatching)', example: 'techo de cañabrava — cane-thatched roof', freq: 22100, cefr: 'C2' },
  'orilla': { lemma: 'orilla', pos: 'f. noun', gloss: 'bank, shore, edge', example: 'a la orilla del río — at the river\'s edge', freq: 3920, cefr: 'B2' },
  'diáfanas': { lemma: 'diáfano', pos: 'adj. (f. pl.)', gloss: 'crystal-clear, translucent', example: 'aguas diáfanas — crystal-clear waters', freq: 14800, cefr: 'C1' },
  'precipitaban': { lemma: 'precipitarse', pos: 'v. (imp. pl.)', gloss: 'to rush, hurtle, fall', example: 'el agua se precipitaba — the water rushed down', freq: 5210, cefr: 'B2' },
  'lecho': { lemma: 'lecho', pos: 'm. noun', gloss: 'bed (of a river); literary: bed', example: 'lecho del río — riverbed', freq: 6480, cefr: 'B2' },
  'pulidas': { lemma: 'pulido', pos: 'adj. (f. pl.)', gloss: 'polished, smooth', example: 'piedras pulidas — polished stones', freq: 4880, cefr: 'B2' },
};

const M_HISTORY = [
  { id: 'h1', title: 'Cien años de soledad', source: 'García Márquez · ch. 1', words: 11, saved: 6, when: 'today', preview: 'Muchos años después, frente al pelotón…' },
  { id: 'h2', title: 'El País — opinión', source: 'editorial · 4d', words: 9, saved: 4, when: '4d', preview: 'La transición energética europea atraviesa…' },
  { id: 'h3', title: 'NYT en español', source: 'noticia · 6d', words: 12, saved: 6, when: '6d', preview: 'El acuerdo bilateral firmado el martes…' },
];

// Scenes: 'empty' · 'paste' · 'annotated' · 'history'
function MobileRead({ scene = 'annotated' }) {
  const [view, setView] = React.useState(scene);
  const [intensity, setIntensity] = React.useState('subtle');
  const [pasteText, setPasteText] = React.useState('');
  const [pasteTitle, setPasteTitle] = React.useState('');
  const [bank, setBank] = React.useState(['pelotón', 'fusilamiento', 'aldea', 'cañabrava', 'diáfanas']);
  const [activeWord, setActiveWord] = React.useState(null);
  const [toast, setToast] = React.useState(false);

  const toggleBank = (w) => setBank((b) => b.includes(w) ? b.filter((x) => x !== w) : [...b, w]);

  return (
    <MScreen>
      <MTopbar
        title="read"
        right={view === 'annotated' ? (
          <button onClick={() => setView('history')} style={{ width: 40, height: 40, border: 'none', background: 'transparent', borderRadius: 20, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="history">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M11 6v5l3.5 2" /></svg>
          </button>
        ) : (
          <button onClick={() => setView('annotated')} style={{ width: 40, height: 40, border: 'none', background: 'transparent', borderRadius: 20, cursor: 'pointer', color: M.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="back">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4l-5 5 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {view === 'empty' && <MReadEmpty onPaste={() => setView('paste')} />}
        {view === 'paste' && <MReadPaste text={pasteText} setText={setPasteText} title={pasteTitle} setTitle={setPasteTitle} onCancel={() => setView('annotated')} onAnnotate={() => setView('annotated')} />}
        {view === 'annotated' && (
          <MReadAnnotated
            sample={M_READ_SAMPLE}
            flagged={M_FLAGGED}
            intensity={intensity}
            setIntensity={setIntensity}
            bank={bank}
            onWord={(w) => setActiveWord(w)}
            onClearBank={() => setBank([])}
            onSaveAll={() => { setToast(true); setTimeout(() => setToast(false), 3500); }}
            toggleBank={toggleBank}
          />
        )}
        {view === 'history' && <MReadHistory items={M_HISTORY} onOpen={() => setView('annotated')} onNew={() => setView('paste')} />}
      </div>

      {/* word definition bottom sheet */}
      <MSheet open={!!activeWord} onClose={() => setActiveWord(null)} height={0.5}>
        {activeWord && M_FLAGGED[activeWord] && (
          <MWordSheet
            word={activeWord}
            entry={M_FLAGGED[activeWord]}
            inBank={bank.includes(activeWord)}
            onSave={() => { toggleBank(activeWord); }}
            onClose={() => setActiveWord(null)}
          />
        )}
      </MSheet>

      {/* save toast */}
      {toast && (
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 84, zIndex: 60,
          background: M.ink, color: M.paper, borderRadius: M.r2,
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', animation: 'mslidein 220ms',
        }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: M.ok, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>✓</div>
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
            <div style={{ fontWeight: 600 }}>{bank.length} word{bank.length !== 1 ? 's' : ''} added</div>
            <div style={{ color: 'rgba(250,247,241,0.7)' }}>your next session will weave them in</div>
          </div>
        </div>
      )}

      <MBottomNav current="read" />
    </MScreen>
  );
}

// ─── Empty ──────────────────────────────────────────────
function MReadEmpty({ onPaste }) {
  return (
    <div style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ ...T.hand(22), color: M.accent, marginBottom: 4 }}>read in the wild</div>
      <h2 style={{ ...T.display(28), margin: '4px 0 12px' }}>paste anything you're reading.</h2>
      <p style={{ ...T.ui(14), color: M.inkSoft, lineHeight: 1.55, maxWidth: 320 }}>
        a paragraph from a book or article. i'll mark words above your level and surface them in your next sessions.
      </p>
      <div style={{ marginTop: 24 }}>
        <MBtn onClick={onPaste}>paste a text →</MBtn>
      </div>
      <div style={{ marginTop: 32, padding: 18, background: M.paper2, borderRadius: M.r3, border: `1px dashed ${M.rule}`, textAlign: 'left', width: '100%' }}>
        <div style={{ ...T.micro, marginBottom: 8 }}>how it works</div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: M.ink2 }}>
          <li>paste a paragraph (≤ 2,000 chars).</li>
          <li>i highlight words rarer than your band.</li>
          <li>tap → see meaning → save.</li>
          <li>saved words appear in cloze, vocab, translation drills.</li>
        </ol>
      </div>
    </div>
  );
}

// ─── Paste ──────────────────────────────────────────────
function MReadPaste({ text, setText, title, setTitle, onCancel, onAnnotate }) {
  const len = text.length;
  const tooLong = len > 2000;
  return (
    <div style={{ padding: '8px 20px 24px' }}>
      <div style={{ ...T.micro, marginBottom: 4 }}>new text</div>
      <h2 style={{ ...T.display(24), margin: '2px 0 18px' }}>paste a passage</h2>

      <div style={{ ...T.ui(12, 500), marginBottom: 6, color: M.inkSoft }}>title or source <span style={{ color: M.inkMute }}>(optional)</span></div>
      <input
        placeholder="e.g. Cien años de soledad — ch. 1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: M.r2,
          border: `1px solid ${M.rule}`, background: M.card,
          fontFamily: 'inherit', fontSize: 14, color: M.ink, outline: 'none',
          marginBottom: 16,
        }}
      />

      <div style={{ ...T.ui(12, 500), marginBottom: 6, color: M.inkSoft }}>passage</div>
      <textarea
        rows="10"
        placeholder="paste a paragraph here. one or two — quality over quantity. prose works better than lists."
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: '100%', padding: 14, borderRadius: M.r2,
          border: `1px solid ${M.rule}`, background: M.card,
          fontFamily: M.fontDisplay, fontSize: 16, lineHeight: 1.55,
          color: M.ink, outline: 'none', resize: 'none', minHeight: 200,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ ...T.mono(11), color: tooLong ? M.accent : M.inkMute }}>
          {len} / 2,000 {tooLong && '· too long'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <MBtn variant="secondary" onClick={onCancel} style={{ flex: 1 }}>cancel</MBtn>
        <MBtn onClick={onAnnotate} disabled={!text.trim() || tooLong} style={{ flex: 2 }}>annotate →</MBtn>
      </div>

      <div style={{ marginTop: 16, padding: 12, background: M.paper2, borderRadius: M.r2, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ ...T.hand(16), color: M.inkSoft, marginTop: 2 }}>tip</span>
        <span style={{ ...T.ui(12), color: M.inkSoft, lineHeight: 1.5 }}>annotation runs locally first; if you save, the text is stored only in your account.</span>
      </div>
    </div>
  );
}

// ─── Annotated ──────────────────────────────────────────
function MReadAnnotated({ sample, flagged, intensity, setIntensity, bank, onWord, onClearBank, onSaveAll, toggleBank }) {
  const renderText = (text) => {
    const parts = text.split(/(\s+|[,.;:!?¿¡—()])/g);
    return parts.map((tok, i) => {
      const lower = tok.toLowerCase().replace(/[.,;:!?¿¡—()]/g, '');
      if (flagged[lower]) {
        const inBank = bank.includes(lower);
        return (
          <button
            key={i}
            data-word={lower}
            onClick={() => onWord(lower)}
            className={`mrd-word ${intensity} ${inBank ? 'saved' : ''}`}
            style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, font: 'inherit', cursor: 'pointer' }}
          >{tok}</button>
        );
      }
      return <React.Fragment key={i}>{tok}</React.Fragment>;
    });
  };

  return (
    <div style={{ padding: '10px 20px 28px' }}>
      {/* header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ ...T.display(22), letterSpacing: '-0.3px' }}>{sample.title}</div>
        <div style={{ ...T.ui(12), color: M.inkSoft, marginTop: 2 }}>{sample.source}</div>
      </div>

      {/* calibration + intensity row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: `1px dashed ${M.rule}`, flexWrap: 'wrap' }}>
        <Chip>~B1+ calibration</Chip>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', borderRadius: 999, border: `1px solid ${M.rule}`, padding: 2, background: M.card }}>
          {['subtle', 'assertive'].map((mode) => (
            <button key={mode} onClick={() => setIntensity(mode)} style={{
              border: 'none', background: intensity === mode ? M.ink : 'transparent',
              color: intensity === mode ? M.paper : M.inkSoft,
              padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
              fontSize: 11, fontFamily: M.fontUI, fontWeight: 500,
            }}>{mode}</button>
          ))}
        </div>
      </div>

      {/* the text */}
      <p style={{
        fontFamily: M.fontDisplay, fontSize: 18, lineHeight: 1.7,
        color: M.ink, margin: 0,
      }}>
        {renderText(sample.text)}
      </p>

      {/* word bank chip strip */}
      <div style={{
        marginTop: 22, padding: '14px 14px 12px',
        background: M.card, border: `1px solid ${M.rule}`, borderRadius: M.r3,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 10 }}>
          <div style={{ ...T.display(16) }}>word bank</div>
          <div style={{ ...T.mono(11), color: M.inkMute, whiteSpace: 'nowrap', flexShrink: 0 }}>{bank.length} saved</div>
        </div>
        {bank.length === 0 ? (
          <div style={{ ...T.ui(12), color: M.inkMute, fontStyle: 'italic', padding: '4px 0' }}>tap a highlighted word to add it.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {bank.map((w) => {
              const e = flagged[w];
              if (!e) return null;
              return (
                <button key={w} onClick={() => toggleBank(w)} style={{
                  border: `1px solid ${M.accentSoft}`, background: M.accentSoft,
                  color: M.accent2, padding: '5px 10px', borderRadius: 999,
                  fontSize: 12, fontFamily: M.fontDisplay, fontWeight: 500,
                  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                }}>{e.lemma} <span style={{ opacity: 0.6, fontFamily: M.fontUI }}>×</span></button>
              );
            })}
          </div>
        )}
      </div>

      {/* save CTA */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <MBtn variant="ghost" size="md" onClick={onClearBank} style={{ flex: 1 }}>clear</MBtn>
        <MBtn size="md" onClick={onSaveAll} disabled={bank.length === 0} style={{ flex: 2 }}>
          save {bank.length} to bank →
        </MBtn>
      </div>

      <div style={{ marginTop: 14, ...T.ui(11), color: M.inkMute, lineHeight: 1.5 }}>
        saved words appear in cloze, vocab, and translation drills tagged{' '}
        <Chip color={M.accent2} bg={M.accentSoft} border={M.accentSoft}>from your reading</Chip>
      </div>
    </div>
  );
}

// ─── Word definition bottom sheet ───────────────────────
function MWordSheet({ word, entry, inBank, onSave, onClose }) {
  return (
    <div style={{ padding: '6px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ ...T.display(28), letterSpacing: '-0.4px' }}>{entry.lemma}</div>
          <div style={{ ...T.ui(13), fontStyle: 'italic', color: M.inkSoft }}>{entry.pos}</div>
          <span style={{ flex: 1 }} />
          <span style={{ ...T.mono(12), color: M.accent, fontWeight: 600 }}>{entry.cefr}</span>
        </div>
        <div style={{ ...T.ui(15), color: M.ink2, marginTop: 4 }}>{entry.gloss}</div>
      </div>

      <div style={{ padding: 14, background: M.paper2, borderRadius: M.r2 }}>
        <div style={{ ...T.micro, marginBottom: 6 }}>example</div>
        <div style={{ ...T.display(15), lineHeight: 1.5, color: M.ink }}>{entry.example}</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...T.mono(11), color: M.inkMute }}>
        <span>frequency #{entry.freq.toLocaleString()}</span>
        <span>matched form: {word}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <MBtn variant="secondary" onClick={onClose} style={{ flex: 1 }}>skip</MBtn>
        <MBtn variant={inBank ? 'accent' : 'primary'} onClick={onSave} style={{ flex: 2 }}>
          {inBank ? '✓ saved · undo' : '+ save to bank'}
        </MBtn>
      </div>
    </div>
  );
}

// ─── History ────────────────────────────────────────────
function MReadHistory({ items, onOpen, onNew }) {
  return (
    <div style={{ padding: '10px 20px 24px' }}>
      <div style={{ ...T.micro, marginBottom: 4 }}>your reading</div>
      <h2 style={{ ...T.display(24), margin: '2px 0 16px' }}>past texts</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => (
          <button key={it.id} onClick={onOpen} style={{
            all: 'unset', display: 'block', padding: 14, cursor: 'pointer',
            background: M.card, border: `1px solid ${M.rule}`, borderRadius: M.r3,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
              <div style={{ ...T.display(16), letterSpacing: '-0.2px', flex: 1 }}>{it.title}</div>
              <span style={{ ...T.mono(10), color: M.inkMute }}>{it.when}</span>
            </div>
            <div style={{ ...T.ui(12), color: M.inkSoft, marginBottom: 6 }}>{it.source}</div>
            <div style={{ ...T.ui(13), color: M.inkSoft, fontStyle: 'italic', fontFamily: M.fontDisplay, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 8 }}>"{it.preview}"</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Chip>{it.words} flagged</Chip>
              <Chip color={M.ok} bg={M.okSoft} border={M.okSoft}>{it.saved} saved</Chip>
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <MBtn variant="secondary" onClick={onNew} style={{ width: '100%' }}>+ paste new text</MBtn>
      </div>
    </div>
  );
}

// ─── Word highlight styles ──────────────────────────────
(function injectMReadStyles() {
  if (document.getElementById('m-read-styles')) return;
  const s = document.createElement('style');
  s.id = 'm-read-styles';
  s.textContent = `
    .mrd-word.subtle {
      text-decoration: underline dotted ${M.accent};
      text-decoration-thickness: 1.5px;
      text-underline-offset: 4px;
    }
    .mrd-word.assertive {
      background: linear-gradient(180deg, transparent 50%, ${M.hiliteSoft} 50%, ${M.hiliteSoft} 92%, transparent 92%);
      padding: 0 1px;
      border-radius: 2px;
    }
    .mrd-word.saved.subtle {
      text-decoration: underline solid ${M.accent};
      text-decoration-thickness: 2px;
      color: ${M.accent2};
      font-weight: 500;
    }
    .mrd-word.saved.assertive {
      background: ${M.accentSoft};
      color: ${M.accent2};
      font-weight: 500;
      border-radius: 3px;
      padding: 0 2px;
    }
  `;
  document.head.appendChild(s);
})();

Object.assign(window, { MobileRead });
