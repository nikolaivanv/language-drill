import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DailyLoadControl } from '../daily-load-control';

describe('DailyLoadControl', () => {
  it('renders 4 radio options (5, 10, 20, 30 min)', () => {
    render(
      <DailyLoadControl current={10} onSelect={vi.fn()} />,
    );
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(4);
    expect(screen.getByText('5 min')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
  });

  it('marks the current option as aria-checked=true', () => {
    render(
      <DailyLoadControl current={10} onSelect={vi.fn()} />,
    );
    const options = screen.getAllByRole('radio');
    // Find the "10 min" button — it should be aria-checked
    const checked = options.filter(
      (el) => el.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('10 min');
  });

  it('marks no option as selected when current is null', () => {
    render(
      <DailyLoadControl current={null} onSelect={vi.fn()} />,
    );
    const options = screen.getAllByRole('radio');
    const checked = options.filter(
      (el) => el.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(0);
  });

  it('calls onSelect with the clicked value', () => {
    const onSelect = vi.fn();
    render(
      <DailyLoadControl current={10} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('20 min'));
    expect(onSelect).toHaveBeenCalledWith(20);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn();
    render(
      <DailyLoadControl current={10} onSelect={onSelect} disabled />,
    );
    fireEvent.click(screen.getByText('20 min'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has a radiogroup labelled "today\'s load"', () => {
    render(
      <DailyLoadControl current={20} onSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole('radiogroup', { name: "today's load" }),
    ).toBeInTheDocument();
  });
});
