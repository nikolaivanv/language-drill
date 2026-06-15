import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwBrief } from './fw-brief';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'i',
  title: 'El teletrabajo',
  task: 'Argumenta.',
  domain: 'opinión',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 20,
  requiredElements: [{ id: 'cond', label: 'Usa dos condicionales' }],
};

describe('FwBrief', () => {
  it('shows the prompt, constraints and required elements', () => {
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    expect(screen.getByText('El teletrabajo')).toBeInTheDocument();
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText('Usa dos condicionales')).toBeInTheDocument();
  });

  it('begins on click', () => {
    const onBegin = vi.fn();
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={onBegin} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /begin/i }));
    expect(onBegin).toHaveBeenCalled();
  });

  it('labels the spec rows in English, not Spanish', () => {
    render(
      <FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />,
    );
    // English chrome present
    expect(screen.getByText('topic')).toBeInTheDocument();
    expect(screen.getByText('register')).toBeInTheDocument();
    expect(screen.getByText('length')).toBeInTheDocument();
    expect(screen.getByText('required elements')).toBeInTheDocument();
    expect(screen.getByText(/words/)).toBeInTheDocument();
    expect(screen.getByText(/address a general reader/i)).toBeInTheDocument();
    // Spanish gone
    expect(screen.queryByText('tema')).toBeNull();
    expect(screen.queryByText('registro')).toBeNull();
    expect(screen.queryByText('longitud')).toBeNull();
    expect(screen.queryByText('elementos obligatorios')).toBeNull();
    expect(screen.queryByText(/palabras/)).toBeNull();
    expect(screen.queryByText(/dirígete/)).toBeNull();
  });
});
