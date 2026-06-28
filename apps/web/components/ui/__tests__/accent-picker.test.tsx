import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { AccentPicker, type AccentLanguage } from '../accent-picker';

function ControlledHarness({
  language,
  initialValue = '',
}: {
  language: AccentLanguage;
  initialValue?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  return (
    <div>
      <input
        ref={ref}
        data-testid="target"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <AccentPicker language={language} targetRef={ref} />
    </div>
  );
}

function NoTargetHarness({ language }: { language: AccentLanguage }) {
  const ref = useRef<HTMLInputElement>(null);
  return <AccentPicker language={language} targetRef={ref} />;
}

describe('AccentPicker', () => {
  it('renders Spanish characters', () => {
    render(<ControlledHarness language="ES" />);
    ['á', 'é', 'í', 'ó', 'ú', 'ñ', '¿', '¡'].forEach((c) => {
      expect(screen.getByRole('button', { name: `insert ${c}` })).toBeInTheDocument();
    });
  });

  it('renders German characters', () => {
    render(<ControlledHarness language="DE" />);
    ['ä', 'ö', 'ü', 'ß'].forEach((c) => {
      expect(screen.getByRole('button', { name: `insert ${c}` })).toBeInTheDocument();
    });
  });

  it('renders Turkish characters', () => {
    render(<ControlledHarness language="TR" />);
    ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü'].forEach((c) => {
      expect(screen.getByRole('button', { name: `insert ${c}` })).toBeInTheDocument();
    });
  });

  it('returns null for unsupported language', () => {
    const { container } = render(
      <ControlledHarness language={'EN' as AccentLanguage} />
    );
    // The harness still renders the input, but no AccentPicker buttons
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders nothing on mobile viewports', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<ControlledHarness language="ES" />);
      // The harness still renders its own <input>, but no AccentPicker buttons.
      expect(container.querySelectorAll('button').length).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });

  it('inserts character at cursor and updates the controlled input', () => {
    render(<ControlledHarness language="ES" initialValue="hola" />);
    const target = screen.getByTestId('target') as HTMLInputElement;
    target.focus();
    target.setSelectionRange(4, 4);

    fireEvent.click(screen.getByRole('button', { name: 'insert ñ' }));

    expect(target.value).toBe('holañ');
  });

  it('inserts at cursor position when cursor is mid-string', () => {
    render(<ControlledHarness language="ES" initialValue="hola" />);
    const target = screen.getByTestId('target') as HTMLInputElement;
    target.focus();
    target.setSelectionRange(2, 2);

    fireEvent.click(screen.getByRole('button', { name: 'insert é' }));

    expect(target.value).toBe('hoéla');
  });

  it('replaces selection range', () => {
    render(<ControlledHarness language="ES" initialValue="hola" />);
    const target = screen.getByTestId('target') as HTMLInputElement;
    target.focus();
    target.setSelectionRange(1, 3); // select "ol"

    fireEvent.click(screen.getByRole('button', { name: 'insert á' }));

    expect(target.value).toBe('háa');
  });

  it('positions cursor after the inserted character', () => {
    render(<ControlledHarness language="ES" initialValue="ab" />);
    const target = screen.getByTestId('target') as HTMLInputElement;
    target.focus();
    target.setSelectionRange(1, 1);

    fireEvent.click(screen.getByRole('button', { name: 'insert ñ' }));

    expect(target.selectionStart).toBe(2);
    expect(target.selectionEnd).toBe(2);
  });

  it('disables buttons when targetRef.current is null', () => {
    render(<NoTargetHarness language="ES" />);
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('disables buttons when the disabled prop is true', () => {
    function DisabledHarness() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <div>
          <input ref={ref} data-testid="target" />
          <AccentPicker language="ES" targetRef={ref} disabled />
        </div>
      );
    }
    render(<DisabledHarness />);
    screen.getAllByRole('button').forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('uses mono font on buttons', () => {
    render(<ControlledHarness language="ES" />);
    const btn = screen.getByRole('button', { name: 'insert ñ' });
    expect(btn.className).toContain('font-mono');
  });

  describe('uppercase', () => {
    it('latches uppercase via the shift toggle: swaps glyphs and inserts the capital', () => {
      render(<ControlledHarness language="TR" initialValue="" />);
      const target = screen.getByTestId('target') as HTMLInputElement;
      target.focus();

      // Lowercase by default
      expect(screen.getByRole('button', { name: 'insert ş' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'uppercase' }));

      // Glyph + label swap to uppercase
      const upperBtn = screen.getByRole('button', { name: 'insert Ş' });
      expect(upperBtn).toBeInTheDocument();
      expect(upperBtn).toHaveTextContent('Ş');
      expect(
        screen.queryByRole('button', { name: 'insert ş' })
      ).not.toBeInTheDocument();

      fireEvent.click(upperBtn);
      expect(target.value).toBe('Ş');
    });

    it('reflects latch state via aria-pressed and toggles back off', () => {
      render(<ControlledHarness language="TR" />);
      const toggle = screen.getByRole('button', { name: 'uppercase' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'insert ş' })).toBeInTheDocument();
    });

    it('uppercases while the physical Shift key is held and reverts on release', () => {
      render(<ControlledHarness language="TR" />);
      expect(screen.getByRole('button', { name: 'insert ş' })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Shift' });
      expect(screen.getByRole('button', { name: 'insert Ş' })).toBeInTheDocument();

      fireEvent.keyUp(window, { key: 'Shift' });
      expect(screen.getByRole('button', { name: 'insert ş' })).toBeInTheDocument();
    });

    it('resets held Shift when the window loses focus', () => {
      render(<ControlledHarness language="TR" />);
      fireEvent.keyDown(window, { key: 'Shift' });
      expect(screen.getByRole('button', { name: 'insert Ş' })).toBeInTheDocument();

      fireEvent.blur(window);
      expect(screen.getByRole('button', { name: 'insert ş' })).toBeInTheDocument();
    });

    it('maps Turkish dotless ı to capital I', () => {
      render(<ControlledHarness language="TR" initialValue="" />);
      const target = screen.getByTestId('target') as HTMLInputElement;
      target.focus();

      fireEvent.click(screen.getByRole('button', { name: 'uppercase' }));
      fireEvent.click(screen.getByRole('button', { name: 'insert I' }));

      expect(target.value).toBe('I');
    });

    it('leaves characters with no capital form unchanged under Shift (German ß)', () => {
      render(<ControlledHarness language="DE" initialValue="" />);
      const target = screen.getByTestId('target') as HTMLInputElement;
      target.focus();

      fireEvent.click(screen.getByRole('button', { name: 'uppercase' }));
      // ß has no distinct single-key capital — still labelled / inserts ß
      const btn = screen.getByRole('button', { name: 'insert ß' });
      fireEvent.click(btn);

      expect(target.value).toBe('ß');
    });

    it('leaves Spanish punctuation unchanged under Shift', () => {
      render(<ControlledHarness language="ES" initialValue="" />);
      const target = screen.getByTestId('target') as HTMLInputElement;
      target.focus();

      fireEvent.click(screen.getByRole('button', { name: 'uppercase' }));
      fireEvent.click(screen.getByRole('button', { name: 'insert ¿' }));

      expect(target.value).toBe('¿');
    });

    it('disables the shift toggle along with the character buttons when there is no target', () => {
      render(<NoTargetHarness language="TR" />);
      expect(screen.getByRole('button', { name: 'uppercase' })).toBeDisabled();
    });
  });
});
