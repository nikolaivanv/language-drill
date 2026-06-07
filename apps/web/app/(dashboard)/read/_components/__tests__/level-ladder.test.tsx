import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';
import { LevelLadder } from '../level-ladder';

// ---------------------------------------------------------------------------
// LevelLadder — 6 CEFR levels; click → onChange; yourLevel cell marked;
//               "matched to your level" caption appears/hides
// ---------------------------------------------------------------------------

describe('LevelLadder', () => {
  it('renders all 6 CEFR levels', () => {
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);

    // Spot-check level labels
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();
  });

  it('renders all 6 CefrLevel enum values', () => {
    render(
      <LevelLadder
        value={CefrLevel.A1}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    const allLevels = Object.values(CefrLevel);
    for (const level of allLevels) {
      expect(screen.getByText(level)).toBeInTheDocument();
    }
  });

  it('marks the selected level with aria-pressed=true', () => {
    render(
      <LevelLadder
        value={CefrLevel.B2}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const selected = buttons.find((btn) => btn.getAttribute('aria-pressed') === 'true');
    expect(selected).toBeDefined();
    expect(selected).toHaveTextContent('B2');
  });

  it('marks non-selected levels with aria-pressed=false', () => {
    render(
      <LevelLadder
        value={CefrLevel.A1}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const unselected = buttons.filter((btn) => btn.getAttribute('aria-pressed') === 'false');
    expect(unselected).toHaveLength(5);
  });

  it('calls onChange with the correct level when clicked', () => {
    const onChange = vi.fn();
    render(
      <LevelLadder
        value={CefrLevel.A1}
        yourLevel={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('C1'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(CefrLevel.C1);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={null}
        onChange={onChange}
        disabled
      />,
    );
    fireEvent.click(screen.getByText('C2'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the yourLevel cell with data-your-level="true"', () => {
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={CefrLevel.B2}
        onChange={() => {}}
      />,
    );
    const yourLevelBtn = screen.getByText('B2').closest('button');
    expect(yourLevelBtn).toHaveAttribute('data-your-level', 'true');
  });

  it('does not mark any cell with data-your-level when yourLevel is null', () => {
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    const markedButtons = screen
      .getAllByRole('button')
      .filter((btn) => btn.getAttribute('data-your-level') === 'true');
    expect(markedButtons).toHaveLength(0);
  });

  it('shows "matched to your level" caption when yourLevel is set', () => {
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={CefrLevel.B1}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/matched to your level/i)).toBeInTheDocument();
  });

  it('hides the "matched to your level" caption when yourLevel is null', () => {
    render(
      <LevelLadder
        value={CefrLevel.B1}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/matched to your level/i)).not.toBeInTheDocument();
  });

  it('shows the header row with LEVEL and CEFR labels', () => {
    render(
      <LevelLadder
        value={CefrLevel.A2}
        yourLevel={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('LEVEL')).toBeInTheDocument();
    expect(screen.getByText('CEFR')).toBeInTheDocument();
  });
});
