import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GrammarPointCombobox } from '../grammar-point-combobox';

const options = [
  { key: 'es-b1-present-subjunctive', name: 'Present subjunctive' },
  { key: 'es-b2-imperfect-subjunctive', name: 'Imperfect subjunctive' },
  { key: 'es-a2-ser-estar', name: 'Ser vs. estar' },
];

describe('GrammarPointCombobox', () => {
  it('renders an input with the grammar point label and placeholder', () => {
    render(<GrammarPointCombobox options={options} value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText('grammar point');
    expect(input).toHaveAttribute('placeholder', expect.stringMatching(/grammar point/i));
  });

  it('shows the selected option name in the input', () => {
    render(<GrammarPointCombobox options={options} value="es-a2-ser-estar" onChange={vi.fn()} />);
    expect(screen.getByLabelText('grammar point')).toHaveValue('Ser vs. estar');
  });

  it('filters options by human name when typing', () => {
    render(<GrammarPointCombobox options={options} value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText('grammar point');
    fireEvent.change(input, { target: { value: 'subjunctive' } });
    expect(screen.getByText('Present subjunctive')).toBeInTheDocument();
    expect(screen.getByText('Imperfect subjunctive')).toBeInTheDocument();
    expect(screen.queryByText('Ser vs. estar')).not.toBeInTheDocument();
  });

  it('filters options by key when typing', () => {
    render(<GrammarPointCombobox options={options} value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText('grammar point');
    fireEvent.change(input, { target: { value: 'ser-estar' } });
    expect(screen.getByText('Ser vs. estar')).toBeInTheDocument();
    expect(screen.queryByText('Present subjunctive')).not.toBeInTheDocument();
  });

  it('calls onChange with the option key when an option is selected', () => {
    const onChange = vi.fn();
    render(<GrammarPointCombobox options={options} value="" onChange={onChange} />);
    const input = screen.getByLabelText('grammar point');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ser' } });
    fireEvent.click(screen.getByText('Ser vs. estar'));
    expect(onChange).toHaveBeenCalledWith('es-a2-ser-estar');
  });

  it('calls onChange with an empty string when the input is cleared', () => {
    const onChange = vi.fn();
    render(<GrammarPointCombobox options={options} value="es-a2-ser-estar" onChange={onChange} />);
    const input = screen.getByLabelText('grammar point');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('disables the input when disabled', () => {
    render(<GrammarPointCombobox options={options} value="" onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('grammar point')).toBeDisabled();
  });
});
