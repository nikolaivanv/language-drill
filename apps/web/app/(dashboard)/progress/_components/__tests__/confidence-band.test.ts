import { describe, it, expect } from 'vitest';
import { confidenceBand } from '../confidence-band';

describe('confidenceBand', () => {
  it('maps high', () => expect(confidenceBand(88).label).toBe('high'));
  it('maps boundary 70 as high', () => expect(confidenceBand(70).label).toBe('high'));
  it('maps building', () => expect(confidenceBand(55).label).toBe('building'));
  it('maps boundary 40 as building', () => expect(confidenceBand(40).label).toBe('building'));
  it('maps low', () => expect(confidenceBand(18).label).toBe('low'));
});
