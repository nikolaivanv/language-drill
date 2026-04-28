// Vocabulary recall drill — definition/context → type the word.
// Progressive hints (first letter → syllable count → blanked example).
// AI-style grading: binary core + partial for close inflections / synonyms / spelling slips.

const VOCAB_ITEMS = [
  {
    word: 'aprovechar',
    pos: 'verbo',
    monolingual: false,
    defL1: 'to take advantage of (an opportunity, time, etc.) — to make good use of',
    defTL: 'sacar provecho de algo o usarlo de manera útil',
    syllables: 4,
    examples: [
      { es: 'Voy a ___ el fin de semana para descansar.', en: "I'll take advantage of the weekend to rest." },
      { es: 'Hay que ___ las oportunidades cuando llegan.', en: "You have to seize opportunities when they come." },
    ],
    confusions: ['aprobar (to approve)', 'aprovecharse (reflexive: to take unfair advantage)'],
    freqRank: 842,
    cefr: 'B1',
  },
  {
    word: 'apenas',
    pos: 'adverbio',
    monolingual: false,
    defL1: 'barely, hardly — just barely / scarcely',
    defTL: 'casi no; con dificultad o en muy pequeña medida',
    syllables: 3,
    examples: [
      { es: '___ podía oírlo sobre el ruido.', en: 'I could barely hear him over the noise.' },
      { es: 'Llegó ___ a tiempo.', en: 'He arrived just barely on time.' },
    ],
    confusions: ['a penas (two words = "to sorrows" — different)', 'casi (almost — similar but not the same)'],
    freqRank: 612,
    cefr: 'B1',
  },
  {
    word: 'imprescindible',
    pos: 'adjetivo',
    monolingual: true,
    defL1: 'essential, indispensable — that cannot be done without',
    defTL: 'tan necesario que no se puede prescindir de ello',
    syllables: 6,
    examples: [
      { es: 'Un buen diccionario es ___ para aprender una lengua.', en: 'A good dictionary is essential for learning a language.' },
      { es: 'Su ayuda fue ___.', en: 'Her help was indispensable.' },
    ],
    confusions: ['indispensable (synonym, less common in Spain)', 'esencial (essential — overlaps but more abstract)'],
    freqRank: 2104,
    cefr: 'B2',
  },
  {
    word: 'soler',
    pos: 'verbo',
    monolingual: false,
    defL1: 'to usually do (something) — to be in the habit of (always with another verb in infinitive)',
    defTL: 'tener costumbre de hacer algo',
    syllables: 2,
    examples: [
      { es: '___ levantarme temprano los lunes.', en: 'I usually get up early on Mondays.' },
      { es: 'No ___ comer carne.', en: "I don't usually eat meat." },
    ],
    confusions: ['acostumbrar (similar but heavier)', 'sólido (unrelated — false friend in shape)'],
    freqRank: 489,
    cefr: 'A2',
  },
  {
    word: 'madrugada',
    pos: 'sustantivo (f.)',
    monolingual: true,
    defL1: 'early morning hours — roughly 1am–6am, before dawn',
    defTL: 'parte del día entre la medianoche y el amanecer',
    syllables: 4,
    examples: [
      { es: 'Llegamos a las tres de la ___.', en: 'We arrived at 3 in the early morning.' },
      { es: 'Trabajó hasta la ___.', en: 'He worked into the small hours.' },
    ],
    confusions: ['mañana (morning, after dawn)', 'amanecer (sunrise — the moment, not the period)'],
    freqRank: 3201,
    cefr: 'B1',
  },
  {
    word: 'hartar',
    pos: 'verbo',
    monolingual: true,
    defL1: 'to fed up / to sicken with too much of something (often reflexive: hartarse)',
    defTL: 'cansar o fastidiar a alguien por exceso o repetición',
    syllables: 2,
    examples: [
      { es: 'Me ___ de esperar.', en: 'I got fed up with waiting.' },
      { es: 'Sus quejas constantes me ___.', en: 'His constant complaints exhaust me.' },
    ],
    confusions: ['cansar (to tire — milder)', 'aburrir (to bore — different shade)'],
    freqRank: 4520,
    cefr: 'B2',
  },
];

function syllabify(word) {
  // Decorative — splits roughly on vowel groups for the hint display.
  const out = [];
  let cur = '';
  const vowels = 'aeiouáéíóúü';
  for (let i = 0; i < word.length; i++) {
    cur += word[i];
    const next = word[i + 1];
    if (vowels.includes(word[i].toLowerCase()) && next && !vowels.includes(next.toLowerCase()) && word[i + 2]) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out.length > 1 ? out : [word];
}

function gradeVocab(input, item) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const ni = norm(input);
  const target = norm(item.word);
  if (!ni) return null;
  if (ni === target) return { tier: 'exact', score: 1, headline: 'exact', note: 'perfect recall.' };

  // Levenshtein-ish similarity for typo / inflection
  const dist = lev(ni, target);
  const maxLen = Math.max(ni.length, target.length);
  const sim = 1 - dist / maxLen;

  // Same root prefix (4+ chars) = likely inflection
  const sharedRoot = sharedPrefix(ni, target);
  if (sharedRoot >= Math.min(4, target.length - 2) && dist <= 3) {
    return {
      tier: 'inflection',
      score: 0.7,
      headline: 'right word, wrong form',
      note: `you wrote "${input}" — the lemma we're tracking is "${item.word}". close enough that it counts as partial; we'll requeue this one to firm up the form.`,
    };
  }

  if (dist <= 2 && sim > 0.7) {
    return {
      tier: 'spelling',
      score: 0.6,
      headline: 'spelling slip',
      note: `you meant "${item.word}" — small typo (${dist} character${dist > 1 ? 's' : ''} off). counted as partial.`,
    };
  }

  return {
    tier: 'wrong',
    score: 0,
    headline: 'not the word we had in mind',
    note: `the word is "${item.word}". if you typed a synonym, it might be valid in another context — we're tracking this exact lemma here.`,
  };
}

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function VocabHiFi({ onComplete, onNav }) {
  const [idx, setIdx] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [hintLevel, setHintLevel] = React.useState(0); // 0 none, 1 first letter, 2 syllables, 3 example
  const [graded, setGraded] = React.useState(null);
  const [results, setResults] = React.useState([]);
  const [coachMsg, setCoachMsg] = React.useState("read the definition and type the word. hints unlock progressively if you need them — using them won't fail you, just tags this one as 'shaky'.");
  const [showTheory, setShowTheory] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const inputRef = React.useRef(null);
  const item = VOCAB_ITEMS[idx];

  React.useEffect(() => {
    setInput(''); setHintLevel(0); setGraded(null); setRevealed(false);
    if (inputRef.current) inputRef.current.focus();
  }, [idx]);

  const onCheck = () => {
    if (!input.trim()) return;
    const g = gradeVocab(input, item);
    setGraded(g);
    const ok = g.tier === 'exact' || g.tier === 'inflection';
    setResults((r) => [...r, { item, input, graded: g, correct: ok, hintsUsed: hintLevel }]);
    setCoachMsg(
      g.tier === 'exact' ? (hintLevel === 0 ? "clean recall — no hints. that goes straight to the 'know it' bucket."
        : `got it — with ${hintLevel} hint${hintLevel > 1 ? 's' : ''}. tagged as 'shaky', i'll bring it back tomorrow.`)
      : g.tier === 'inflection' ? "you knew the lemma but not the form. partial credit — we'll drill the inflection."
      : g.tier === 'spelling' ? "you knew it, fingers slipped. partial credit, requeued."
      : "no shame. seeing it once builds passive recall — we'll show you the examples and try again in a day."
    );
  };

  const onReveal = () => {
    setRevealed(true);
    setGraded({ tier: 'wrong', score: 0, headline: 'revealed', note: `the word is "${item.word}". it'll come back soon — passive exposure first.` });
    setResults((r) => [...r, { item, input: input || '(skipped)', graded: { tier: 'wrong', score: 0, note: 'revealed', reference: item.word }, correct: false, hintsUsed: hintLevel, revealed: true }]);
    setCoachMsg("revealed. read the examples — passive recognition first, then we'll come back to active recall.");
  };

  const onNext = () => {
    if (idx + 1 >= VOCAB_ITEMS.length) { onComplete(results); return; }
    setIdx(idx + 1);
    setCoachMsg(`item ${idx + 2} of ${VOCAB_ITEMS.length}. ${VOCAB_ITEMS[idx + 1].monolingual ? 'monolingual mode — definition is in spanish.' : 'definition in english.'}`);
  };

  const onHint = () => {
    if (hintLevel >= 3) return;
    setHintLevel(hintLevel + 1);
    setCoachMsg(hintLevel === 0 ? "first letter shown. tagged this one as 'shaky' — i'll requeue it sooner."
      : hintLevel === 1 ? "syllable count too. you've still got it."
      : "here's the word in context — fill in the blank.");
  };

  const progress = ((idx + (graded ? 1 : 0)) / VOCAB_ITEMS.length) * 100;
  const verdictStyle = {
    exact: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok)' },
    inflection: { bg: 'var(--ok-soft)', fg: 'var(--ok)', border: 'var(--ok)' },
    spelling: { bg: 'var(--hilite-soft)', fg: 'var(--ink)', border: 'var(--hilite)' },
    wrong: { bg: 'var(--accent-soft)', fg: 'var(--accent-2)', border: 'var(--accent)' },
  }[graded?.tier || 'exact'];

  // Build progressive-hint blanked example
  const exForHint = item.examples[0];
  const blanked = exForHint.es.replace('___', '_'.repeat(item.word.length));

  return (
    <AppShell current="drill" onNav={onNav}>
      <div style={{ height: 3, background: 'var(--paper-3)', position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: 'var(--accent)', transition: 'width .35s' }} />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* coach rail */}
        <aside style={{ width: 280, flexShrink: 0, padding: '32px 24px', background: 'var(--paper-2)', borderRight: '1px solid var(--rule)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--t-display)', fontSize: 18, fontWeight: 600 }}>c</div>
            <div>
              <div style={{ fontWeight: 600 }}>coach</div>
              <div className="t-small" style={{ fontSize: 11 }}>vocabulary recall</div>
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 14, marginBottom: 18, minHeight: 100 }} className="fade-in" key={coachMsg}>
            <div className="t-body" style={{ fontSize: 13 }}>{coachMsg}</div>
          </div>

          <div className="t-micro" style={{ marginBottom: 8 }}>active vocabulary</div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 'var(--r-md)', padding: 14, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span className="t-small" style={{ fontSize: 12 }}>top 5K words</span>
              <span className="t-mono" style={{ fontSize: 12, fontWeight: 600 }}>3,184</span>
            </div>
            <div className="bar"><i style={{ width: '63.7%' }} /></div>
            <div className="t-small" style={{ fontSize: 11, marginTop: 6 }}>≈ B2 active range. you need ~800 more for solid B2.</div>
          </div>

          <div className="t-micro" style={{ marginBottom: 8 }}>session map</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {VOCAB_ITEMS.map((it, i) => {
              const cur = i === idx;
              const r = results[i];
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                  background: cur ? 'var(--card)' : 'transparent',
                  border: cur ? '1px solid var(--ink)' : '1px solid transparent',
                  opacity: r ? 0.65 : cur ? 1 : 0.4,
                }}>
                  <span style={{ width: 14, color: r ? (r.correct ? 'var(--ok)' : 'var(--accent)') : 'var(--ink-mute)', fontSize: 12 }}>{r ? (r.correct ? '✓' : '✗') : (cur ? '●' : '○')}</span>
                  <span className="t-small" style={{ fontSize: 11, flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{it.cefr} · {it.pos}</span>
                  <span className="t-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>#{it.freqRank}</span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="btn ghost sm" onClick={() => onNav('dashboard')}>pause &amp; exit</button>
          </div>
        </aside>

        {/* exercise */}
        <section style={{ flex: 1, padding: '40px 56px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-micro">vocabulary recall · item {idx + 1} of {VOCAB_ITEMS.length}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="chip">{item.pos}</span>
              <span className="chip">freq #{item.freqRank}</span>
              <span className="chip">{item.cefr}</span>
              {item.monolingual && <span className="chip" style={{ background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }}>monolingual</span>}
            </div>
          </div>

          <h1 className="t-display-m" style={{ marginTop: 14, marginBottom: 4 }}>type the word that means…</h1>
          <p className="t-small">{item.monolingual ? 'definition is in spanish (target language). higher cefr = monolingual mode.' : 'definition shown in english.'}</p>

          {/* definition card */}
          <div className="card fade-in" key={idx} style={{ marginTop: 24, padding: '28px 32px' }}>
            <div className="t-micro" style={{ marginBottom: 10 }}>{item.monolingual ? 'definición · español' : 'definition'}</div>
            <div style={{ fontFamily: 'var(--t-display)', fontSize: 24, lineHeight: 1.4, color: 'var(--ink)', fontWeight: 400 }}>
              {item.monolingual ? item.defTL : item.defL1}
            </div>

            {/* progressive hints */}
            {hintLevel >= 1 && (
              <div className="fade-in" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--rule)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <span className="t-micro">first letter</span>
                  <span style={{ fontFamily: 'var(--t-mono)', fontSize: 22, fontWeight: 600, color: 'var(--accent)' }}>{item.word[0]}</span>
                  <span className="t-small" style={{ fontFamily: 'var(--t-mono)', color: 'var(--ink-mute)' }}>{'·'.repeat(item.word.length - 1)}</span>
                  <span className="t-small" style={{ marginLeft: 'auto', fontFamily: 'var(--t-mono)', fontSize: 11 }}>{item.word.length} letters</span>
                </div>
                {hintLevel >= 2 && (
                  <div className="fade-in" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span className="t-micro">syllables</span>
                    <span style={{ fontFamily: 'var(--t-mono)', fontSize: 13, color: 'var(--ink-soft)' }}>{syllabify(item.word).join(' · ')}</span>
                    <span className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 'auto' }}>{item.syllables} syllables</span>
                  </div>
                )}
                {hintLevel >= 3 && (
                  <div className="fade-in" style={{ marginTop: 4, padding: 12, background: 'var(--paper-2)', borderRadius: 'var(--r-md)' }}>
                    <span className="t-micro" style={{ display: 'block', marginBottom: 4 }}>example, blanked</span>
                    <div style={{ fontFamily: 'var(--t-display)', fontSize: 16, lineHeight: 1.45 }}>{blanked}</div>
                    <div className="t-small" style={{ marginTop: 4, fontStyle: 'italic' }}>{exForHint.en}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* answer */}
          <div style={{ marginTop: 18 }}>
            <div className="t-micro" style={{ marginBottom: 6 }}>your word</div>
            <input
              ref={inputRef}
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="escribe la palabra…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); graded ? onNext() : onCheck(); } }}
              disabled={!!graded}
              style={{
                fontSize: 22, fontFamily: 'var(--t-display)', padding: '14px 18px',
                background: graded ? 'var(--paper-2)' : 'var(--card)',
                borderColor: graded ? verdictStyle.border : 'var(--rule)',
                borderWidth: graded ? 1.5 : 1,
                letterSpacing: 0.3,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['á','é','í','ó','ú','ñ'].map((c) => (
                  <button key={c} disabled={!!graded} onClick={() => { setInput((t) => t + c); if (inputRef.current) inputRef.current.focus(); }} style={{
                    width: 26, height: 26, border: '1px solid var(--rule)', background: 'var(--card)',
                    borderRadius: 5, fontFamily: 'var(--t-mono)', fontSize: 12, cursor: graded ? 'default' : 'pointer', color: 'var(--ink)',
                  }}>{c}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!graded && hintLevel < 3 && (
                  <button className="btn ghost sm" onClick={onHint}>
                    {hintLevel === 0 ? 'hint · first letter' : hintLevel === 1 ? 'hint · syllables' : 'hint · example'}
                  </button>
                )}
                {!graded && <button className="btn ghost sm" onClick={onReveal} style={{ color: 'var(--ink-mute)' }}>reveal &amp; move on</button>}
              </div>
            </div>
          </div>

          {/* graded */}
          {graded && (
            <div className="fade-in" style={{
              marginTop: 18, padding: 18,
              background: verdictStyle.bg,
              border: `1.5px solid ${verdictStyle.border}`,
              borderRadius: 'var(--r-md)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: verdictStyle.border, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>
                  {graded.tier === 'exact' ? '✓' : graded.tier === 'wrong' ? '?' : '~'}
                </span>
                <div className="t-display-s" style={{ margin: 0, color: verdictStyle.fg }}>{graded.headline}</div>
                <div style={{ flex: 1 }} />
                <div className="t-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>+{Math.round(graded.score * 100)}% mastery</div>
              </div>
              <p className="t-body" style={{ margin: '0 0 12px', color: 'var(--ink)' }}>{graded.note}</p>

              {/* word card with examples */}
              <div style={{ background: 'rgba(255,255,255,0.7)', padding: 16, borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                  <div style={{ fontFamily: 'var(--t-display)', fontSize: 28, fontWeight: 500 }}>{item.word}</div>
                  <div className="t-small" style={{ fontFamily: 'var(--t-mono)', fontSize: 12 }}>/{item.word.replace(/h/g, '').replace(/v/g, 'b').replace(/c([ei])/g, 's$1')}/</div>
                  <div className="t-small">{item.pos}</div>
                </div>
                <div className="t-micro" style={{ marginBottom: 6 }}>in context</div>
                <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                  {item.examples.map((ex, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <span style={{ fontFamily: 'var(--t-display)' }}>{ex.es.replace('___', item.word)}</span>
                      <div className="t-small" style={{ fontStyle: 'italic', fontSize: 12 }}>{ex.en}</div>
                    </li>
                  ))}
                </ul>
                <div className="t-micro" style={{ marginBottom: 4 }}>commonly confused with</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {item.confusions.map((c, i) => <span key={i} className="chip" style={{ fontSize: 11 }}>{c}</span>)}
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-soft)' }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 4v4l2.5 2" /></svg>
                <span>scheduled for review {graded.tier === 'exact' && hintLevel === 0 ? 'in 4 days' : graded.tier === 'wrong' ? 'in 1 day' : 'in 2 days'}</span>
              </div>
            </div>
          )}

          {/* action bar */}
          <div style={{ marginTop: 'auto', paddingTop: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="t-small" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="kbd">↵</span> to {graded ? 'continue' : 'check'}
              {!graded && hintLevel > 0 && <span style={{ color: 'var(--ink-mute)' }}>· hints used: {hintLevel}/3</span>}
            </div>
            {!graded
              ? <button className="btn primary lg" onClick={onCheck} disabled={!input.trim()} style={{ opacity: !input.trim() ? 0.4 : 1 }}>check word</button>
              : <button className="btn primary lg" onClick={onNext}>{idx + 1 >= VOCAB_ITEMS.length ? 'finish session →' : 'next word →'}</button>
            }
          </div>
        </section>
      </div>
    </AppShell>
  );
}

Object.assign(window, { VocabHiFi, VOCAB_ITEMS });
