// Read — passage renderer
// Tokenises the passage and renders each word as a clickable / selectable span.
// Supports: click-to-tap, drag-to-select-span, programmatic select (for demo states).

function tokenize(text) {
  // Tokens: words + non-word runs (spaces + punctuation). Preserve everything for round-trip.
  const out = [];
  const re = /([A-Za-zÀ-ÿğĞıİöÖüÜşŞçÇäÄëËïÏöÖüÜßñÑáéíóúÁÉÍÓÚâêîôûÂÊÎÔÛàèìòùÀÈÌÒÙ]+)/g;
  let last = 0; let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'gap', text: text.slice(last, m.index) });
    out.push({ kind: 'word', text: m[1], lower: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'gap', text: text.slice(last) });
  return out;
}

// Find sentence boundaries: array of [startTokenIdx, endTokenIdx] inclusive of the trailing punct.
function sentenceRanges(tokens) {
  const ranges = []; let start = null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'word' && start == null) start = i;
    if (tokens[i].kind === 'gap' && /[.!?]/.test(tokens[i].text) && start != null) {
      ranges.push([start, i]);
      start = null;
    }
  }
  if (start != null) ranges.push([start, tokens.length - 1]);
  return ranges;
}

function PassageReader({ passage, savedWords, activeRange, tappedIdx, loadingIdx, onTapWord, onSelectRange, children }) {
  const tokens = React.useMemo(() => tokenize(passage.text), [passage.text]);
  const sentRanges = React.useMemo(() => sentenceRanges(tokens), [tokens]);

  // selection state
  const [dragStart, setDragStart] = React.useState(null);
  const [dragEnd, setDragEnd] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef(null);

  // Cancel selection if active state cleared from parent
  React.useEffect(() => {
    if (!activeRange && !dragging) {
      setDragStart(null); setDragEnd(null);
    }
  }, [activeRange]);

  const onWordDown = (idx) => (e) => {
    e.preventDefault();
    setDragStart(idx); setDragEnd(idx); setDragging(true);
  };
  const onWordEnter = (idx) => () => {
    if (dragging) setDragEnd(idx);
  };
  const onWordUp = (idx) => (e) => {
    if (!dragging) return;
    setDragging(false);
    const a = Math.min(dragStart, idx); const b = Math.max(dragStart, idx);
    const wordIdxs = []; for (let i = a; i <= b; i++) if (tokens[i].kind === 'word') wordIdxs.push(i);
    const r = e.currentTarget.getBoundingClientRect();
    const cr = containerRef.current.getBoundingClientRect();
    const anchor = {
      x: ((containerRef.current.querySelector(`[data-idx="${a}"]`)?.getBoundingClientRect().left ?? 0) + r.right) / 2 - cr.left,
      y: r.bottom - cr.top,
      maxX: cr.width,
    };
    if (wordIdxs.length <= 1) {
      // Single tap
      onTapWord(tokens[idx].lower, idx, anchor);
      setDragStart(null); setDragEnd(null);
    } else {
      // Span select — bubble out the span text + range
      const spanText = tokens.slice(a, b + 1).map(t => t.text).join('');
      // Decide if it's a sentence (matches a known sentence range) or a phrase
      const isSentence = sentRanges.some(([s, e]) => s === a && (e === b || e === b + 1 || e === b - 1));
      onSelectRange({ a, b, text: spanText, isSentence, anchor });
    }
  };

  // Global mouseup safety
  React.useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const inActiveRange = (i) => {
    if (activeRange) return i >= activeRange.a && i <= activeRange.b;
    if (dragging && dragStart != null && dragEnd != null) {
      const a = Math.min(dragStart, dragEnd); const b = Math.max(dragStart, dragEnd);
      return i >= a && i <= b;
    }
    return false;
  };

  return (
    <div ref={containerRef} className="rd-passage" onMouseLeave={() => setDragging(false)}>
      {tokens.map((tok, i) => {
        if (tok.kind === 'gap') return <span key={i}>{tok.text}</span>;
        const isFlagged = passage.highlights[tok.lower] || passage.highlights[tok.text];
        const intensity = passage.highlights[tok.lower] || passage.highlights[tok.text] || null;
        const isSaved = savedWords.includes(tok.lower);
        const isTapped = tappedIdx === i;
        const isLoading = loadingIdx === i;
        const inRange = inActiveRange(i);
        const cls = [
          'rd-w',
          isFlagged ? `rd-w-${intensity}` : '',
          isSaved ? 'rd-w-saved' : '',
          isTapped ? 'rd-w-tapped' : '',
          isLoading ? 'rd-w-loading' : '',
          inRange ? 'rd-w-selected' : '',
        ].filter(Boolean).join(' ');
        return (
          <span
            key={i}
            data-idx={i}
            className={cls}
            onMouseDown={onWordDown(i)}
            onMouseEnter={onWordEnter(i)}
            onMouseUp={onWordUp(i)}
          >
            {tok.text}
          </span>
        );
      })}
      {children}
    </div>
  );
}

// Helper exposed so the parent can find token indices by surface text (for scripted demo states).
function findWordIdx(text, surface) {
  const tokens = tokenize(text);
  const s = surface.toLowerCase();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'word' && tokens[i].lower === s) return i;
  }
  return -1;
}

function findSpanIdx(text, spanText) {
  const tokens = tokenize(text);
  const target = spanText.toLowerCase().trim();
  // Greedy: find contiguous word tokens whose joined text contains the target
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'word') continue;
    for (let j = i; j < tokens.length; j++) {
      const joined = tokens.slice(i, j + 1).map(t => t.text).join('').toLowerCase().trim();
      if (joined === target || joined.replace(/[.,;:!?¿¡]/g, '') === target.replace(/[.,;:!?¿¡]/g, '')) {
        return { a: i, b: j };
      }
      if (joined.length > target.length + 4) break;
    }
  }
  return null;
}

Object.assign(window, { PassageReader, tokenize, findWordIdx, findSpanIdx });
