import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PrivacyPage from '../privacy/page';
import TermsPage from '../terms/page';
import CookiesPage from '../cookies/page';

// Assert on full rendered text content. getByText skips elements that have
// child elements and throws on multiple matches, which makes it unreliable
// for "is this string present on the page" smoke checks (e.g. a name inside
// a <p> that also contains an <a>, or a word that appears in two paragraphs).

describe('legal pages', () => {
  it('privacy page names the controller, contact, and all sub-processors', () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Ivan Nikola');
    expect(text).toContain('info@langdrill.app');
    expect(text).toContain('Langfuse');
    expect(text).toContain('Cloudflare');
  });

  it('terms page states governing law and minimum age', () => {
    const { container } = render(<TermsPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Hungary');
    expect(text).toContain('16');
  });

  it('cookies page distinguishes necessary vs analytics', () => {
    const { container } = render(<CookiesPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Strictly necessary');
    expect(text).toContain('Analytics');
  });
});
