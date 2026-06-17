import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCurriculum = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useCurriculum: (args: unknown) => mockUseCurriculum(args) };
});

import CurriculumPage from '../page';

const entry = {
  key: 'tr-a1-present-tense', kind: 'grammar', name: 'Present tense', description: 'The present tense',
  cefrLevel: 'A1', language: 'TR', examplesPositive: ['geliyorum', 'gidiyor'], examplesNegative: ['*gelmek'],
  commonErrors: ['drops the suffix'], prerequisiteKeys: [], targetOverride: null,
  clozeUnsuitable: false, sentenceConstructionSuitable: true, conjugationSuitable: false,
  coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2, '3sg': 2 } }] },
  freeWritingRegister: null, exerciseTypes: ['cloze', 'translation'],
};
const data = { items: [entry], total: 1, curriculumVersionByLanguage: { ES: 'es@1', DE: 'de@1', TR: 'tr@1' } };

beforeEach(() => { mockUseCurriculum.mockReset(); });

describe('CurriculumPage', () => {
  it('renders a row with key, kind badge, and flag chips; expand reveals detail + deep-link', () => {
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data });
    render(<CurriculumPage />);
    expect(screen.getByText('tr-a1-present-tense')).toBeInTheDocument();
    expect(screen.getByText('Present tense')).toBeInTheDocument();
    expect(screen.getByText(/SC/)).toBeInTheDocument();
    expect(screen.getByText(/coverage/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('tr-a1-present-tense'));
    expect(screen.getByText('The present tense')).toBeInTheDocument();
    expect(screen.getByText('geliyorum')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /pool content/i });
    expect(link).toHaveAttribute('href', '/admin/content?language=TR&level=A1&grammarPoint=tr-a1-present-tense');
  });

  it('client text filter narrows the list', () => {
    const two = { items: [entry, { ...entry, key: 'es-b1-subjunctive', name: 'Subjunctive', language: 'ES', cefrLevel: 'B1' }], total: 2, curriculumVersionByLanguage: data.curriculumVersionByLanguage };
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data: two });
    render(<CurriculumPage />);
    expect(screen.getByText('es-b1-subjunctive')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'present' } });
    expect(screen.queryByText('es-b1-subjunctive')).not.toBeInTheDocument();
    expect(screen.getByText('tr-a1-present-tense')).toBeInTheDocument();
  });

  it('shows loading and empty states', () => {
    mockUseCurriculum.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { rerender } = render(<CurriculumPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0, curriculumVersionByLanguage: data.curriculumVersionByLanguage } });
    rerender(<CurriculumPage />);
    expect(screen.getByText(/no (entries|curriculum|results)/i)).toBeInTheDocument();
  });
});
