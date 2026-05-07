import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

describe('pool-master-rop.78.11 auth state ownership', () => {
  it('pool-master-rop.78.11 keeps current-user server state out of a Zustand mirror', () => {
    const authMirrorModules = import.meta.glob('./session-store.ts');

    expect(Object.keys(authMirrorModules)).toHaveLength(0);
    expect((packageJson as { dependencies?: Record<string, string> }).dependencies?.zustand)
      .toBeUndefined();
  });
});
