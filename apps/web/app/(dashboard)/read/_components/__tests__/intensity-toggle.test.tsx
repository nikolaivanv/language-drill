import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IntensityToggle } from '../intensity-toggle';

// ---------------------------------------------------------------------------
// IntensityToggle — WAI-ARIA radiogroup behavior (Requirements 6.4, 14.1).
// ---------------------------------------------------------------------------

describe('IntensityToggle — aria semantics', () => {
  it('renders a radiogroup with two radio children', () => {
    render(<IntensityToggle value="subtle" onChange={() => {}} />);
    const group = screen.getByRole('radiogroup');
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveTextContent('subtle');
    expect(radios[1]).toHaveTextContent('assertive');
  });

  it('marks aria-checked on the active option only', () => {
    render(<IntensityToggle value="subtle" onChange={() => {}} />);
    const subtle = screen.getByRole('radio', { name: /subtle/i });
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    expect(subtle).toHaveAttribute('aria-checked', 'true');
    expect(assertive).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects aria-checked when the value flips', () => {
    render(<IntensityToggle value="assertive" onChange={() => {}} />);
    const subtle = screen.getByRole('radio', { name: /subtle/i });
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    expect(subtle).toHaveAttribute('aria-checked', 'false');
    expect(assertive).toHaveAttribute('aria-checked', 'true');
  });

  it('uses roving tabindex (only the active radio is in tab order)', () => {
    render(<IntensityToggle value="subtle" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /subtle/i })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByRole('radio', { name: /assertive/i })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });
});

describe('IntensityToggle — clicks', () => {
  it('clicking an option fires onChange with that option', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="subtle" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /assertive/i }));
    expect(onChange).toHaveBeenCalledWith('assertive');
  });
});

describe('IntensityToggle — keyboard', () => {
  it('ArrowRight from "subtle" focuses + selects "assertive"', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="subtle" onChange={onChange} />);
    const subtle = screen.getByRole('radio', { name: /subtle/i });
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    subtle.focus();
    fireEvent.keyDown(subtle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('assertive');
    expect(assertive).toHaveFocus();
  });

  it('ArrowLeft from "assertive" focuses + selects "subtle"', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="assertive" onChange={onChange} />);
    const subtle = screen.getByRole('radio', { name: /subtle/i });
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    assertive.focus();
    fireEvent.keyDown(assertive, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('subtle');
    expect(subtle).toHaveFocus();
  });

  it('Enter on the focused radio fires onChange with that radio\'s value', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="subtle" onChange={onChange} />);
    const subtle = screen.getByRole('radio', { name: /subtle/i });
    subtle.focus();
    fireEvent.keyDown(subtle, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('subtle');
  });

  it('Space on the focused radio fires onChange with that radio\'s value', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="assertive" onChange={onChange} />);
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    assertive.focus();
    fireEvent.keyDown(assertive, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('assertive');
  });

  it('ArrowRight cycles past the end (assertive → subtle)', () => {
    const onChange = vi.fn();
    render(<IntensityToggle value="assertive" onChange={onChange} />);
    const assertive = screen.getByRole('radio', { name: /assertive/i });
    assertive.focus();
    fireEvent.keyDown(assertive, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('subtle');
  });
});
