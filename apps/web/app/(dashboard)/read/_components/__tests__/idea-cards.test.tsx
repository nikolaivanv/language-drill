import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { READING_IDEAS } from '@language-drill/shared';
import { IdeaCards } from '../idea-cards';

// ---------------------------------------------------------------------------
// IdeaCards — renders all 6 ideas; click fires onPick; selected = aria-pressed
// ---------------------------------------------------------------------------

describe('IdeaCards — card variant', () => {
  it('renders all 6 ideas', () => {
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={() => {}}
        variant="card"
      />,
    );
    // Each idea's prompt should appear as a button
    expect(screen.getAllByRole('button')).toHaveLength(6);
    // Spot-check a couple of prompts
    expect(screen.getByText('a short café conversation')).toBeInTheDocument();
    expect(screen.getByText('a morning at the neighborhood market')).toBeInTheDocument();
  });

  it('calls onPick with the correct idea when clicked', () => {
    const onPick = vi.fn();
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={onPick}
        variant="card"
      />,
    );
    // Click the first idea (dialogue — "a short café conversation")
    const firstIdea = READING_IDEAS[0];
    fireEvent.click(screen.getByText(firstIdea.prompt));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(firstIdea);
  });

  it('marks the selected idea with aria-pressed=true', () => {
    const selectedPrompt = READING_IDEAS[2].prompt; // "a short story about a cat that came back"
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        selectedPrompt={selectedPrompt}
        onPick={() => {}}
        variant="card"
      />,
    );
    const buttons = screen.getAllByRole('button');
    const selectedButton = buttons.find(
      (btn) => btn.getAttribute('aria-pressed') === 'true',
    );
    expect(selectedButton).toBeDefined();
    expect(selectedButton).toHaveTextContent(READING_IDEAS[2].prompt);
  });

  it('marks non-selected ideas with aria-pressed=false', () => {
    const selectedPrompt = READING_IDEAS[0].prompt;
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        selectedPrompt={selectedPrompt}
        onPick={() => {}}
        variant="card"
      />,
    );
    const buttons = screen.getAllByRole('button');
    const unpressedButtons = buttons.filter(
      (btn) => btn.getAttribute('aria-pressed') === 'false',
    );
    expect(unpressedButtons).toHaveLength(5);
  });

  it('renders category labels uppercased', () => {
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={() => {}}
        variant="card"
      />,
    );
    // DIALOGUE is the first idea's category
    expect(screen.getByText('DIALOGUE')).toBeInTheDocument();
    expect(screen.getByText('STORY')).toBeInTheDocument();
  });

  it('renders descriptors in card variant', () => {
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={() => {}}
        variant="card"
      />,
    );
    expect(screen.getByText('two friends, present tense')).toBeInTheDocument();
    expect(screen.getByText('reportage, past tense')).toBeInTheDocument();
  });
});

describe('IdeaCards — chip variant', () => {
  it('renders all 6 ideas as chips', () => {
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={() => {}}
        variant="chip"
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('calls onPick with the correct idea when a chip is clicked', () => {
    const onPick = vi.fn();
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        onPick={onPick}
        variant="chip"
      />,
    );
    const lastIdea = READING_IDEAS[5];
    fireEvent.click(screen.getByText(lastIdea.prompt));
    expect(onPick).toHaveBeenCalledWith(lastIdea);
  });

  it('marks selected chip with aria-pressed=true', () => {
    const selectedPrompt = READING_IDEAS[1].prompt;
    render(
      <IdeaCards
        ideas={READING_IDEAS}
        selectedPrompt={selectedPrompt}
        onPick={() => {}}
        variant="chip"
      />,
    );
    const buttons = screen.getAllByRole('button');
    const selected = buttons.find(
      (btn) => btn.getAttribute('aria-pressed') === 'true',
    );
    expect(selected).toBeDefined();
  });
});
