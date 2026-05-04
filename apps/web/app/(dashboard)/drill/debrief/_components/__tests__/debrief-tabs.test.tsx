import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefTabs } from '../debrief-tabs';

describe('DebriefTabs — structure', () => {
  it('renders two tabs with the right labels and roles', () => {
    render(
      <DebriefTabs active="debrief" onChange={() => {}}>
        <div>panel</div>
      </DebriefTabs>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toBe('debrief');
    expect(tabs[1]?.textContent).toBe('review');
  });

  it('renders a tablist with an accessible label', () => {
    render(
      <DebriefTabs active="debrief" onChange={() => {}}>
        <div>panel</div>
      </DebriefTabs>,
    );
    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('debrief views');
  });

  it('marks the active tab via aria-selected and tabIndex roving', () => {
    render(
      <DebriefTabs active="review" onChange={() => {}}>
        <div>review content</div>
      </DebriefTabs>,
    );
    const debriefTab = screen.getByRole('tab', { name: 'debrief' });
    const reviewTab = screen.getByRole('tab', { name: 'review' });

    expect(reviewTab.getAttribute('aria-selected')).toBe('true');
    expect(reviewTab.getAttribute('tabindex')).toBe('0');
    expect(debriefTab.getAttribute('aria-selected')).toBe('false');
    expect(debriefTab.getAttribute('tabindex')).toBe('-1');
  });

  it('exposes a tabpanel labelled by the active tab', () => {
    render(
      <DebriefTabs active="review" onChange={() => {}}>
        <div>review content</div>
      </DebriefTabs>,
    );
    const reviewTab = screen.getByRole('tab', { name: 'review' });
    expect(reviewTab.getAttribute('aria-controls')).toBe('debrief-panel-review');

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('id')).toBe('debrief-panel-review');
    expect(panel.getAttribute('aria-labelledby')).toBe('debrief-tab-review');
    expect(panel.textContent).toContain('review content');
  });
});

describe('DebriefTabs — click activation', () => {
  it('calls onChange with the clicked tab id', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'review' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('review');
  });

  it('clicking the already-active tab still calls onChange (idempotent)', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'debrief' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('debrief');
  });
});

describe('DebriefTabs — keyboard navigation', () => {
  it('ArrowRight from "debrief" activates "review"', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'debrief' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenCalledWith('review');
  });

  it('ArrowRight from "review" wraps to "debrief"', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="review" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'review' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenCalledWith('debrief');
  });

  it('ArrowLeft from "review" activates "debrief"', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="review" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'review' }), {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenCalledWith('debrief');
  });

  it('ArrowLeft from "debrief" wraps to "review"', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'debrief' }), {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenCalledWith('review');
  });

  it('Home jumps to the first tab', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="review" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'review' }), {
      key: 'Home',
    });
    expect(onChange).toHaveBeenCalledWith('debrief');
  });

  it('End jumps to the last tab', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'debrief' }), {
      key: 'End',
    });
    expect(onChange).toHaveBeenCalledWith('review');
  });

  it('ignores keys that are not arrow / Home / End', () => {
    const onChange = vi.fn();
    render(
      <DebriefTabs active="debrief" onChange={onChange}>
        <div>panel</div>
      </DebriefTabs>,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'debrief' }), {
      key: 'a',
    });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'debrief' }), {
      key: 'Tab',
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DebriefTabs — children panel rendering', () => {
  it('renders the parent-supplied children inside the tabpanel', () => {
    render(
      <DebriefTabs active="debrief" onChange={() => {}}>
        <div data-testid="custom-panel">custom panel content</div>
      </DebriefTabs>,
    );
    expect(screen.getByTestId('custom-panel')).toBeDefined();
  });
});
