import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
});
