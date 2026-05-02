import { describe, expect, it } from 'vitest';
import { getLogger, logger } from './index';

describe('pool-master-dxd.24: logger accessor naming', () => {
  it('exports getLogger for singleton access without pretending to be a React hook', () => {
    expect(getLogger()).toBe(logger);
  });
});
