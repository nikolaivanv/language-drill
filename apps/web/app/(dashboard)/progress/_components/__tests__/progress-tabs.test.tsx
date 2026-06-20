import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressTabs } from '../progress-tabs';

describe('ProgressTabs', () => {
  it('renders three tabs with the right labels and roles', () => {
    render(
      <ProgressTabs active="shape" onChange={() => {}}>
        <div>panel</div>
      </ProgressTabs>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveProperty('textContent', 'shape');
    expect(tabs[1]).toHaveProperty('textContent', 'fluency');
    expect(tabs[2]).toHaveProperty('textContent', 'history');
  });

  it('marks the active tab via aria-selected and exposes a tabpanel', () => {
    render(
      <ProgressTabs active="fluency" onChange={() => {}}>
        <div>fluency content</div>
      </ProgressTabs>,
    );
    const fluencyTab = screen.getByRole('tab', { name: 'fluency' });
    expect(fluencyTab.getAttribute('aria-selected')).toBe('true');
    expect(fluencyTab.getAttribute('aria-controls')).toBe('progress-panel-fluency');

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('id')).toBe('progress-panel-fluency');
    expect(panel.getAttribute('aria-labelledby')).toBe('progress-tab-fluency');
    expect(panel.textContent).toContain('fluency content');
  });

  it('calls onChange with the clicked tab id', () => {
    const onChange = vi.fn();
    render(
      <ProgressTabs active="shape" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'history' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('history');
  });

  it('moves activation right on ArrowRight and wraps after the last tab', () => {
    const onChange = vi.fn();
    render(
      <ProgressTabs active="shape" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'shape' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenCalledWith('fluency');

    onChange.mockClear();
    render(
      <ProgressTabs active="history" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.keyDown(screen.getAllByRole('tab', { name: 'history' })[1], {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenCalledWith('shape'); // wraps to start
  });

  it('moves activation left on ArrowLeft and wraps before the first tab', () => {
    const onChange = vi.fn();
    render(
      <ProgressTabs active="fluency" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'fluency' }), {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenCalledWith('shape');

    onChange.mockClear();
    render(
      <ProgressTabs active="shape" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.keyDown(screen.getAllByRole('tab', { name: 'shape' })[1], {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenCalledWith('history'); // wraps to end
  });

  it('Home jumps to the first tab and End jumps to the last', () => {
    const onChange = vi.fn();
    render(
      <ProgressTabs active="fluency" onChange={onChange}>
        <div>panel</div>
      </ProgressTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'fluency' }), {
      key: 'Home',
    });
    expect(onChange).toHaveBeenCalledWith('shape');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'fluency' }), {
      key: 'End',
    });
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('only the active tab is in the tab order (tabIndex management)', () => {
    render(
      <ProgressTabs active="history" onChange={() => {}}>
        <div>panel</div>
      </ProgressTabs>,
    );
    expect(
      screen.getByRole('tab', { name: 'shape' }).getAttribute('tabindex'),
    ).toBe('-1');
    expect(
      screen.getByRole('tab', { name: 'fluency' }).getAttribute('tabindex'),
    ).toBe('-1');
    expect(
      screen.getByRole('tab', { name: 'history' }).getAttribute('tabindex'),
    ).toBe('0');
  });
});
