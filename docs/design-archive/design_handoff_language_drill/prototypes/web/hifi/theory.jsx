// Theory panel — slide-over reference, scrollable + with TOC
// Triggered from any screen. Shows topic summary, use cases, formation, irregulars, examples.
// Multiple topics; default opens to current drill's topic.

const THEORY = {
  'subjunctive': {
    title: 'el subjuntivo',
    subtitle: 'present subjunctive · doubt, hope, desire, hypotheticals',
    cefr: 'B1–B2',
    sections: [
      {
        id: 'what',
        title: 'what is it?',
        body: (
          <>
            <p>the <span className="hilite">subjunctive</span> is a <strong>mood</strong>, not a tense. it expresses how the speaker feels about an action — doubt, desire, emotion, possibility — rather than stating it as fact.</p>
            <p>english has it (rare): <em>"i suggest he <strong>be</strong> here"</em>, <em>"if i <strong>were</strong> you"</em>. spanish uses it constantly.</p>
            <div className="callout">
              <strong>indicative</strong> = facts. <strong>subjunctive</strong> = subjective takes (doubt, hope, want, react).
            </div>
          </>
        ),
      },
      {
        id: 'when',
        title: 'when to use it',
        body: (
          <>
            <p>after a small set of <em>trigger expressions</em> in a main clause, followed by <span className="t-mono">que</span> + a different subject:</p>
            <ul className="theory-list">
              <li><strong>doubt:</strong> <span className="t-mono">no creo que…</span>, <span className="t-mono">dudo que…</span></li>
              <li><strong>hope / wish:</strong> <span className="t-mono">espero que…</span>, <span className="t-mono">ojalá…</span></li>
              <li><strong>desire / request:</strong> <span className="t-mono">quiero que…</span>, <span className="t-mono">te pido que…</span></li>
              <li><strong>emotion:</strong> <span className="t-mono">me alegro de que…</span>, <span className="t-mono">es triste que…</span></li>
              <li><strong>impersonal:</strong> <span className="t-mono">es importante que…</span>, <span className="t-mono">es posible que…</span></li>
              <li><strong>concession:</strong> <span className="t-mono">aunque…</span> (when uncertain)</li>
              <li><strong>relative clauses w/ unknown antecedent:</strong> <span className="t-mono">busco un libro que sea…</span></li>
            </ul>
            <div className="callout warn">
              <strong>WEIRDO</strong> — common mnemonic: <strong>W</strong>ishes, <strong>E</strong>motion, <strong>I</strong>mpersonal, <strong>R</strong>ecommendations, <strong>D</strong>oubt, <strong>O</strong>jalá.
            </div>
          </>
        ),
      },
      {
        id: 'form-regular',
        title: 'how it\'s formed · regular',
        body: (
          <>
            <p>start from the <span className="t-mono">yo</span> form of the present indicative, drop the <span className="t-mono">-o</span>, and swap endings:</p>
            <table className="theory-table">
              <thead><tr><th></th><th>-AR (hablar)</th><th>-ER (comer)</th><th>-IR (vivir)</th></tr></thead>
              <tbody>
                <tr><td>yo</td><td>hable</td><td>coma</td><td>viva</td></tr>
                <tr><td>tú</td><td>hables</td><td>comas</td><td>vivas</td></tr>
                <tr><td>él/ella</td><td>hable</td><td>coma</td><td>viva</td></tr>
                <tr><td>nosotros</td><td>hablemos</td><td>comamos</td><td>vivamos</td></tr>
                <tr><td>vosotros</td><td>habléis</td><td>comáis</td><td>viváis</td></tr>
                <tr><td>ellos</td><td>hablen</td><td>coman</td><td>vivan</td></tr>
              </tbody>
            </table>
            <div className="callout">
              <strong>"opposite vowel" rule:</strong> -AR verbs take <span className="t-mono">e</span> endings, -ER/-IR verbs take <span className="t-mono">a</span> endings.
            </div>
          </>
        ),
      },
      {
        id: 'form-irregular',
        title: 'irregulars to memorize',
        body: (
          <>
            <p>six common verbs are fully irregular. mnemonic: <strong>DISHES</strong> — <span className="t-mono">dar, ir, ser, haber, estar, saber</span>.</p>
            <table className="theory-table">
              <thead><tr><th>infinitive</th><th>yo</th><th>tú</th><th>él</th><th>nosotros</th><th>ellos</th></tr></thead>
              <tbody>
                <tr><td>ser</td><td>sea</td><td>seas</td><td>sea</td><td>seamos</td><td>sean</td></tr>
                <tr><td>estar</td><td>esté</td><td>estés</td><td>esté</td><td>estemos</td><td>estén</td></tr>
                <tr><td>ir</td><td>vaya</td><td>vayas</td><td>vaya</td><td>vayamos</td><td>vayan</td></tr>
                <tr><td>haber</td><td>haya</td><td>hayas</td><td>haya</td><td>hayamos</td><td>hayan</td></tr>
                <tr><td>saber</td><td>sepa</td><td>sepas</td><td>sepa</td><td>sepamos</td><td>sepan</td></tr>
                <tr><td>dar</td><td>dé</td><td>des</td><td>dé</td><td>demos</td><td>den</td></tr>
              </tbody>
            </table>
            <p>stem-changing verbs (e→ie, o→ue) keep their changes in subjunctive. spelling-change verbs (-car, -gar, -zar) shift to <span className="t-mono">-que, -gue, -ce</span>.</p>
          </>
        ),
      },
      {
        id: 'examples',
        title: 'examples in context',
        body: (
          <>
            <div className="example">
              <div className="example-es">No creo que <span className="hilite">tenga</span> tiempo hoy.</div>
              <div className="example-en">I don't think I have time today.</div>
              <div className="example-note">"no creo que" → doubt → subjunctive of <em>tener</em>.</div>
            </div>
            <div className="example">
              <div className="example-es">Espero que mis amigos <span className="hilite">vengan</span> a la fiesta.</div>
              <div className="example-en">I hope my friends come to the party.</div>
              <div className="example-note">"esperar que" → wish/hope → subjunctive of <em>venir</em>.</div>
            </div>
            <div className="example">
              <div className="example-es">Es importante que tú <span className="hilite">digas</span> la verdad.</div>
              <div className="example-en">It's important that you tell the truth.</div>
              <div className="example-note">impersonal expression → subjunctive of <em>decir</em>.</div>
            </div>
            <div className="example">
              <div className="example-es">Quiero un coche que <span className="hilite">gaste</span> poco combustible.</div>
              <div className="example-en">I want a car that uses little fuel.</div>
              <div className="example-note">non-specific antecedent (any car like that) → subjunctive in the relative clause.</div>
            </div>
          </>
        ),
      },
      {
        id: 'pitfalls',
        title: 'common pitfalls',
        body: (
          <>
            <ul className="theory-list">
              <li><strong>same subject?</strong> use the infinitive, not subjunctive: <span className="t-mono">quiero ir</span>, not <span className="t-mono">quiero que vaya</span>.</li>
              <li><strong>creo que</strong> (affirmative) takes <em>indicative</em>: <span className="t-mono">creo que viene</span>. only <span className="t-mono">no creo que</span> triggers subjunctive.</li>
              <li><strong>cuando</strong> + future event → subjunctive: <span className="t-mono">cuando llegue, te llamo</span>. about a habit → indicative.</li>
              <li><strong>aunque</strong> + uncertain → subjunctive; <strong>aunque</strong> + known fact → indicative.</li>
            </ul>
          </>
        ),
      },
    ],
  },
  'preterite-imperfect': {
    title: 'pretérito vs. imperfecto',
    subtitle: 'two past tenses, two different lenses on the same event',
    cefr: 'A2–B1',
    sections: [
      {
        id: 'what',
        title: 'what\'s the difference?',
        body: (
          <>
            <p>both are past tenses. the difference is <strong>aspect</strong> — how you frame the action:</p>
            <ul className="theory-list">
              <li><strong>pretérito</strong> → completed, bounded events. snapshots.</li>
              <li><strong>imperfecto</strong> → ongoing, habitual, descriptive. background.</li>
            </ul>
            <div className="callout">think <strong>video clip</strong> (preterite) vs <strong>scenery</strong> (imperfect).</div>
          </>
        ),
      },
      {
        id: 'examples',
        title: 'examples',
        body: (
          <>
            <div className="example">
              <div className="example-es"><span className="hilite">Caminaba</span> por la calle cuando <span className="hilite">vi</span> a Marta.</div>
              <div className="example-en">I was walking down the street when I saw Marta.</div>
              <div className="example-note">imperfect = ongoing scene; preterite = the bounded event that interrupts it.</div>
            </div>
          </>
        ),
      },
      { id: 'stub', title: 'more sections', body: <p className="t-small">(formation tables, signal words, contrastive drill — stubbed for prototype.)</p> },
    ],
  },
  'conditional': {
    title: 'el condicional',
    subtitle: 'would-statements, polite requests, hypotheticals',
    cefr: 'B1–B2',
    sections: [
      { id: 'stub', title: 'overview', body: <p>(stub — formation, uses, irregulars; matches subjunctive structure.)</p> },
    ],
  },
};

function TheoryPanel({ topic = 'subjunctive', onClose }) {
  const t = THEORY[topic] || THEORY['subjunctive'];
  const [active, setActive] = React.useState(t.sections[0].id);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Track which section is in view
  React.useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActive(visible[0].target.id);
    }, { root, rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    t.sections.forEach((s) => {
      const el = root.querySelector('#' + s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [topic]);

  const jump = (id) => {
    const el = scrollRef.current?.querySelector('#' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return ReactDOM.createPortal(
    <div className="theory-overlay" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(26, 22, 18, 0.42)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end' }}>
      <aside className="theory-panel" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(960px, 92vw)', height: '100vh', background: 'var(--paper)', borderLeft: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-3)' }}>
        <header className="theory-header">
          <div>
            <div className="t-micro">theory · reference</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <h2 className="t-display-l" style={{ margin: 0 }}>{t.title}</h2>
              <span className="chip">{t.cefr}</span>
            </div>
            <div className="t-small" style={{ marginTop: 4 }}>{t.subtitle}</div>
          </div>
          <button className="theory-close" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="theory-body" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* TOC */}
          <nav className="theory-toc" style={{ width: 240, flexShrink: 0, overflowY: 'auto' }}>
            <div className="t-micro">jump to</div>
            <ul>
              {t.sections.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => jump(s.id)}
                    className={active === s.id ? 'active' : ''}
                  >{s.title}</button>
                </li>
              ))}
            </ul>
            <div className="theory-other">
              <div className="t-micro">other topics</div>
              {Object.entries(THEORY).filter(([k]) => k !== topic).map(([k, v]) => (
                <button key={k} className="theory-otherbtn" onClick={() => { setActive(THEORY[k].sections[0].id); window.dispatchEvent(new CustomEvent('theory-topic', { detail: k })); }}>
                  → {v.title}
                </button>
              ))}
            </div>
          </nav>

          <div className="theory-scroll" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', scrollBehavior: 'smooth' }}>
            {t.sections.map((s) => (
              <section key={s.id} id={s.id} className="theory-section">
                <h3 className="theory-section-title">{s.title}</h3>
                <div className="theory-content">{s.body}</div>
              </section>
            ))}
            <div style={{ height: 80 }} />
            <div className="theory-footer-cta">
              <div className="t-small" style={{ marginBottom: 8 }}>feel ready?</div>
              <button className="btn primary sm" onClick={onClose}>back to drill →</button>
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

// Wrapper that lets TOC swap topic
function TheoryPanelHost({ initialTopic, onClose }) {
  const [topic, setTopic] = React.useState(initialTopic || 'subjunctive');
  React.useEffect(() => {
    const h = (e) => setTopic(e.detail);
    window.addEventListener('theory-topic', h);
    return () => window.removeEventListener('theory-topic', h);
  }, []);
  return <TheoryPanel topic={topic} onClose={onClose} />;
}

Object.assign(window, { TheoryPanel, TheoryPanelHost, THEORY });
