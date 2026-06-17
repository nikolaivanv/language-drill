import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LangfuseTracesLink } from '../langfuse-traces-link';

afterEach(() => vi.unstubAllEnvs());

describe('LangfuseTracesLink', () => {
  it('renders an external link with the interpolated href when configured', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    render(<LangfuseTracesLink cellKey="tr:a1:cloze:g" />);
    const link = screen.getByRole('link', { name: /traces in langfuse/i });
    expect(link).toHaveAttribute('href', 'https://lf/traces?q=tr%3Aa1%3Acloze%3Ag');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });
  it('renders nothing when cellKey is null', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    const { container } = render(<LangfuseTracesLink cellKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing when the template env is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', '');
    const { container } = render(<LangfuseTracesLink cellKey="tr:a1:cloze:g" />);
    expect(container).toBeEmptyDOMElement();
  });
});
