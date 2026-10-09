import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Language } from '@language-drill/shared';
import { FwGuide } from './fw-guide';
import { ConsentProvider } from '../../../../../components/consent/consent-provider';
import { getWritingGuide } from '../../../../../content/writing-guides';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function renderGuide(props: Partial<Parameters<typeof FwGuide>[0]> = {}) {
  const onBandChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConsentProvider>
        <FwGuide language={Language.ES} band="b1-b2" onBandChange={onBandChange} {...props} />
      </ConsentProvider>
    </QueryClientProvider>,
  );
  return { onBandChange };
}

describe('FwGuide', () => {
  it('renders the guide title, band chip and all seven sections', () => {
    renderGuide();
    const guide = getWritingGuide(Language.ES, 'b1-b2');
    expect(screen.getByRole('heading', { level: 1, name: guide.title })).toBeInTheDocument();
    for (const section of guide.sections) {
      expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    }
  });

  it('shows the guide for the given language and band', () => {
    renderGuide({ language: Language.DE, band: 'a1-a2' });
    expect(
      screen.getByRole('heading', { level: 1, name: getWritingGuide(Language.DE, 'a1-a2').title }),
    ).toBeInTheDocument();
  });

  it('marks the current band and switches to the other', () => {
    const { onBandChange } = renderGuide({ band: 'b1-b2' });
    expect(screen.getByRole('button', { name: 'B1–B2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'A1–A2' }));
    expect(onBandChange).toHaveBeenCalledWith('a1-a2');
  });

  it('links back to free writing', () => {
    renderGuide();
    expect(screen.getByRole('link', { name: /free writing/ })).toHaveAttribute('href', '/drill/free-writing');
  });

  it('has a section table of contents but no grammar topic list', () => {
    renderGuide();
    expect(screen.getByRole('navigation', { name: 'theory sections' })).toBeInTheDocument();
    expect(screen.queryByText('all topics')).toBeNull();
  });
});
