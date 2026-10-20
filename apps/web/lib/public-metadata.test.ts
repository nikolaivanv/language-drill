import { describe, it, expect } from 'vitest';
import { publicPageMetadata } from './public-metadata';

describe('publicPageMetadata', () => {
  it('builds canonical, Open Graph and Twitter tags from one set of strings', () => {
    const meta = publicPageMetadata({ title: 'Ser vs estar in Spanish (A1)', description: 'D.', path: '/spanish/grammar/a1-ser' });
    expect(meta.title).toBe('Ser vs estar in Spanish (A1)');
    expect(meta.alternates).toEqual({ canonical: '/spanish/grammar/a1-ser' });
    expect(meta.openGraph).toMatchObject({ url: '/spanish/grammar/a1-ser', title: 'Ser vs estar in Spanish (A1)', description: 'D.', siteName: 'drill' });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: 'Ser vs estar in Spanish (A1)' });
  });

  // A page's own `openGraph` stops Next attaching the root `opengraph-image`,
  // so a helper-built page with no explicit image ships a card with no picture.
  it('names the shared image explicitly', () => {
    const meta = publicPageMetadata({ title: 'T', description: 'D.', path: '/x' });
    expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: '/opengraph-image' })]);
    expect(meta.twitter?.images).toEqual([expect.objectContaining({ url: '/opengraph-image' })]);
  });

  it('opts out of the root title template on request', () => {
    expect(publicPageMetadata({ title: 'drill — x', description: 'D.', path: '/', absoluteTitle: true }).title).toEqual({ absolute: 'drill — x' });
  });
});
