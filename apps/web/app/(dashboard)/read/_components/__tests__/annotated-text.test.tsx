import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { AnnotatedText } from '../annotated-text';
import styles from '../word-flag-styles.module.css';

// ---------------------------------------------------------------------------
// AnnotatedText — class-set + click-rect + intensity/saved/active modifiers
// (Requirements 6.2, 6.4, 6.5, 6.6, 6.10, 14.2).
// ---------------------------------------------------------------------------

function flag(extras: Partial<{ freq: number; cefr: CefrLevel }> = {}): {
  lemma: string;
  pos: string;
  gloss: string;
  example: string;
  freq: number;
  cefr: CefrLevel;
} {
  return {
    lemma: 'aldea',
    pos: 'noun',
    gloss: 'village',
    example: 'la aldea pequeña',
    freq: extras.freq ?? 4200,
    cefr: extras.cefr ?? CefrLevel.B2,
  };
}

const FLAGGED: FlaggedMap = {
  aldea: flag(),
  pueblo: flag(),
};

describe('AnnotatedText — flagged vs unflagged tokens', () => {
  it('renders a flagged word as a <button> with the base + intensity classes', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'aldea' });
    expect(button).toHaveAttribute('data-word', 'aldea');
    expect(button.className).toContain(styles.word);
    expect(button.className).toContain(styles.subtle);
    expect(button.className).not.toContain(styles.assertive);
    expect(button.className).not.toContain(styles.saved);
    expect(button.className).not.toContain(styles.active);
  });

  it('renders an unflagged word as an interactive button without highlight classes (Req 3.2)', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    // "grande" is not flagged but is still tappable (tap-any-word).
    const grande = screen.getByRole('button', { name: 'grande' });
    expect(grande).toHaveAttribute('data-word', 'grande');
    // Base reset class, but no flag-highlight modifiers.
    expect(grande.className).toContain(styles.word);
    expect(grande.className).not.toContain(styles.subtle);
    expect(grande.className).not.toContain(styles.assertive);
    expect(grande.className).not.toContain(styles.saved);
  });

  it('preserves separator characters in the rendered output', () => {
    const { container } = render(
      <AnnotatedText
        text="aldea, pueblo."
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    // Round-trip: the rendered text content matches the source text exactly.
    expect(container.textContent).toBe('aldea, pueblo.');
  });
});

describe('AnnotatedText — click handler', () => {
  it('calls onWordClick with the lowercased key and a DOMRect-shaped object', () => {
    const onWordClick = vi.fn();
    render(
      <AnnotatedText
        text="ALDEA grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={onWordClick}
      />,
    );
    const button = screen.getByRole('button', { name: 'ALDEA' });
    fireEvent.click(button);
    expect(onWordClick).toHaveBeenCalledTimes(1);
    const [word, rect] = onWordClick.mock.calls[0];
    expect(word).toBe('aldea');
    // jsdom returns a DOMRect-shaped object with numeric layout fields.
    expect(rect).toMatchObject({
      top: expect.any(Number),
      left: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });
});

describe('AnnotatedText — intensity / saved / active modifiers', () => {
  it('switching intensity swaps the class (subtle → assertive)', () => {
    const { rerender } = render(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const subtleBtn = screen.getByRole('button', { name: 'aldea' });
    expect(subtleBtn.className).toContain(styles.subtle);
    expect(subtleBtn.className).not.toContain(styles.assertive);

    rerender(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="assertive"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const assertiveBtn = screen.getByRole('button', { name: 'aldea' });
    expect(assertiveBtn.className).toContain(styles.assertive);
    expect(assertiveBtn.className).not.toContain(styles.subtle);
  });

  it('adds the saved class when the word is in bankSet', () => {
    render(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set(['aldea'])}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'aldea' });
    expect(button.className).toContain(styles.saved);
  });

  it('does not add saved when the word is absent from bankSet', () => {
    render(
      <AnnotatedText
        text="aldea pueblo"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set(['aldea'])}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const pueblo = screen.getByRole('button', { name: 'pueblo' });
    expect(pueblo.className).not.toContain(styles.saved);
  });

  it('adds the active class when activeWord matches', () => {
    render(
      <AnnotatedText
        text="aldea pueblo"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord="aldea"
        onWordClick={() => {}}
      />,
    );
    const aldea = screen.getByRole('button', { name: 'aldea' });
    const pueblo = screen.getByRole('button', { name: 'pueblo' });
    expect(aldea.className).toContain(styles.active);
    expect(pueblo.className).not.toContain(styles.active);
  });
});

// ---------------------------------------------------------------------------
// onSpanSelect — tap reporting + offsets (Req 3.2)
// ---------------------------------------------------------------------------

describe('AnnotatedText — onSpanSelect on tap', () => {
  it('reports a word span with character offsets when a flagged word is tapped', () => {
    const onSpanSelect = vi.fn();
    const onWordClick = vi.fn();
    render(
      // "aldea grande" → aldea [0,5], grande [6,12]
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={onWordClick}
        onSpanSelect={onSpanSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect.mock.calls[0][0]).toMatchObject({
      start: 0,
      end: 5,
      type: 'word',
    });
    // Flagged word → onWordClick also fires (skim popover channel).
    expect(onWordClick).toHaveBeenCalledTimes(1);
    expect(onWordClick.mock.calls[0][0]).toBe('aldea');
  });

  it('reports a word span for an UNFLAGGED tap but does NOT fire onWordClick', () => {
    const onSpanSelect = vi.fn();
    const onWordClick = vi.fn();
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={onWordClick}
        onSpanSelect={onSpanSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'grande' }));

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect.mock.calls[0][0]).toMatchObject({
      start: 6,
      end: 12,
      type: 'word',
    });
    // onWordClick is flagged-only — never fires for a non-flagged word.
    expect(onWordClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onSpanSelect — mouse-drag selection mapping (Req 4.1, 4.3, 5.1)
// ---------------------------------------------------------------------------

describe('AnnotatedText — drag selection', () => {
  // "la aldea grande es bonita." token offsets:
  //   la[0,2] aldea[3,8] grande[9,15] es[16,18] bonita[19,25] .[25,26]
  const TEXT = 'la aldea grande es bonita.';

  it('maps a multi-word sub-sentence drag to a phrase span', () => {
    const onSpanSelect = vi.fn();
    render(
      <AnnotatedText
        text={TEXT}
        flaggedMap={{}}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
        onSpanSelect={onSpanSelect}
      />,
    );
    const aldea = screen.getByRole('button', { name: 'aldea' });
    const grande = screen.getByRole('button', { name: 'grande' });

    fireEvent.mouseDown(aldea);
    fireEvent.mouseEnter(grande);
    fireEvent.mouseUp(grande); // bubbles to the window mouseup listener

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect.mock.calls[0][0]).toMatchObject({
      start: 3,
      end: 15,
      type: 'phrase',
    });
  });

  it('swallows the synthetic click bubbled to the container after a drag (regression: open card was being dismissed)', () => {
    // After mousedown on A and mouseup on B (A≠B) browsers fire a click on
    // the common ancestor — which the rd-text container's outside-click
    // handler reads as "dismiss". The drag handler installs a one-shot
    // capture-phase listener that calls `stopPropagation` on that click.
    const onSpanSelect = vi.fn();
    const onContainerClick = vi.fn();
    render(
      <div onClick={onContainerClick}>
        <AnnotatedText
          text={TEXT}
          flaggedMap={{}}
          intensity="subtle"
          bankSet={new Set()}
          activeWord={null}
          onWordClick={() => {}}
          onSpanSelect={onSpanSelect}
        />
      </div>,
    );
    const aldea = screen.getByRole('button', { name: 'aldea' });
    const grande = screen.getByRole('button', { name: 'grande' });

    fireEvent.mouseDown(aldea);
    fireEvent.mouseEnter(grande);
    fireEvent.mouseUp(grande);
    expect(onSpanSelect).toHaveBeenCalledTimes(1);

    // Browsers fire `click` on the common ancestor after a cross-element drag.
    // Dispatch a native bubbling click event on the container and confirm the
    // swallow handler stopped it from reaching the parent's onClick.
    const container = aldea.parentElement!.parentElement!;
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onContainerClick).not.toHaveBeenCalled();
  });

  it('maps a full-sentence drag to a sentence span', () => {
    const onSpanSelect = vi.fn();
    render(
      <AnnotatedText
        text={TEXT}
        flaggedMap={{}}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
        onSpanSelect={onSpanSelect}
      />,
    );
    const la = screen.getByRole('button', { name: 'la' });
    const bonita = screen.getByRole('button', { name: 'bonita' });

    fireEvent.mouseDown(la);
    fireEvent.mouseEnter(bonita);
    fireEvent.mouseUp(bonita);

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect.mock.calls[0][0]).toMatchObject({
      start: 0,
      end: 25,
      type: 'sentence',
    });
  });

  it('a mouse tap (down→up, no drag) reports a single word and swallows the trailing click', () => {
    const onSpanSelect = vi.fn();
    render(
      <AnnotatedText
        text={TEXT}
        flaggedMap={{}}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
        onSpanSelect={onSpanSelect}
      />,
    );
    const grande = screen.getByRole('button', { name: 'grande' });

    fireEvent.mouseDown(grande);
    fireEvent.mouseUp(grande);
    fireEvent.click(grande); // trailing synthetic click — must be ignored

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect.mock.calls[0][0]).toMatchObject({
      start: 9,
      end: 15,
      type: 'word',
    });
  });
});

// ---------------------------------------------------------------------------
// Under-review highlight (Req 13.2)
// ---------------------------------------------------------------------------

describe('AnnotatedText — under-review highlight', () => {
  it('applies the underReview class to a flagged word whose lemma is in rotation', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        underReview={{ lemmas: new Set(['aldea']), surfaces: new Set() }}
        onWordClick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'aldea' }).className).toContain(
      styles.underReview,
    );
  });

  it('applies the underReview class to a non-flagged word via the surface fallback', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        underReview={{ lemmas: new Set(), surfaces: new Set(['grande']) }}
        onWordClick={() => {}}
      />,
    );
    // "grande" is not flagged but is in the rotation by surface.
    expect(screen.getByRole('button', { name: 'grande' }).className).toContain(
      styles.underReview,
    );
  });

  it('does not apply the underReview class when nothing matches', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        underReview={{ lemmas: new Set(['otro']), surfaces: new Set(['nada']) }}
        onWordClick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'aldea' }).className).not.toContain(
      styles.underReview,
    );
    expect(screen.getByRole('button', { name: 'grande' }).className).not.toContain(
      styles.underReview,
    );
  });

  it('applies no highlight when the underReview prop is omitted', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'aldea' }).className).not.toContain(
      styles.underReview,
    );
  });
});

// Touch multi-word selection is a select-first drag handled by native
// touchstart/move/end listeners in this component (sharing the begin/extend/
// finalize core exercised by the mouse-drag tests above). The gesture itself
// depends on real layout (`document.elementFromPoint`, live bounding rects)
// which jsdom doesn't provide, so it's covered end-to-end by the touch E2E
// (read-mobile-touch.spec.ts). A plain touch tap reaches this component via the
// synthetic click, already covered by the tap tests above.
