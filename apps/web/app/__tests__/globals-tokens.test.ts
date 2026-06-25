import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');

describe('design-system foundations', () => {
  it('defines the ink-hover token (#322b24)', () => {
    expect(css).toMatch(/--color-ink-hover:\s*#322b24/);
  });
  it('sets the top-level heading to 62px desktop', () => {
    expect(css).toMatch(/\.t-display-xl\s*\{[^}]*font-size:\s*62px/);
  });
  it('sets the top-level heading to 36px mobile', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.t-display-xl\s*\{[^}]*font-size:\s*36px/);
  });
  it('defines the shared tertiary link utility', () => {
    expect(css).toMatch(/\.link-arrow\s*\{/);
  });
  it('defines the shared arrow-nudge (.lk-arr) that slides on link/button hover', () => {
    expect(css).toMatch(/\.lk-arr\s*\{/);
    expect(css).toMatch(
      /a:hover \.lk-arr,\s*button:hover \.lk-arr\s*\{[^}]*translateX\(3px\)/,
    );
  });
});
