import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyLoadControl } from '../daily-load-control';

describe('DailyLoadControl', () => {
  it('renders 3 radio options (quick, medium, long)', () => {
    render(
      <DailyLoadControl current="medium" onSelect={vi.fn()} />,
    );
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(3);
    expect(screen.getByText('quick')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('long')).toBeInTheDocument();
  });

  it('marks the current option as aria-checked=true', () => {
    render(
      <DailyLoadControl current="medium" onSelect={vi.fn()} />,
    );
    const options = screen.getAllByRole('radio');
    const checked = options.filter(
      (el) => el.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('medium');
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
      <DailyLoadControl current="medium" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('long'));
    expect(onSelect).toHaveBeenCalledWith('long');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn();
    render(
      <DailyLoadControl current="medium" onSelect={onSelect} disabled />,
    );
    fireEvent.click(screen.getByText('long'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has a radiogroup labelled "today\'s load"', () => {
    render(
      <DailyLoadControl current="long" onSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole('radiogroup', { name: "today's load" }),
    ).toBeInTheDocument();
  });

  it('sets aria-disabled=true on the radiogroup when disabled', () => {
    render(
      <DailyLoadControl current="medium" onSelect={vi.fn()} disabled />,
    );
    const radiogroup = screen.getByRole('radiogroup', { name: "today's load" });
    expect(radiogroup).toHaveAttribute('aria-disabled', 'true');
  });

  it('sets aria-disabled=false on the radiogroup when not disabled', () => {
    render(
      <DailyLoadControl current="medium" onSelect={vi.fn()} />,
    );
    const radiogroup = screen.getByRole('radiogroup', { name: "today's load" });
    expect(radiogroup).toHaveAttribute('aria-disabled', 'false');
  });

  it('marks the current goal as checked and calls onSelect', async () => {
    const onSelect = vi.fn();
    render(<DailyLoadControl current="medium" onSelect={onSelect} />);
    const long = screen.getByRole('radio', { name: 'long' });
    expect(screen.getByRole('radio', { name: 'medium' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'medium' }).className).toContain('bg-hilite');
    await userEvent.click(long);
    expect(onSelect).toHaveBeenCalledWith('long');
  });
});
