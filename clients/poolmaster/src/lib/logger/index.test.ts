import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/query-client';
import { getLogger, logger } from './index';
import type * as Config from '@/lib/config';
import type * as Logger from './logger';

describe('pool-master-dxd.24: logger accessor naming', () => {
  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('exports getLogger for singleton access without pretending to be a React hook', () => {
    expect(getLogger()).toBe(logger);
  });
});

describe('logger: sinks by runtime mode, and the context stamped on each line', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/config');
    vi.doUnmock('./logger');
    vi.resetModules();
  });

  async function loggerOptions(mode: string) {
    vi.resetModules();
    const created: Array<{ sinks: unknown[]; getContext: () => { route?: string } }> = [];
    vi.doMock('@/lib/config', async (importOriginal) => {
      const actual = await importOriginal<typeof Config>();
      return { ...actual, poolMasterConfig: { ...actual.poolMasterConfig, mode } };
    });
    vi.doMock('./logger', async (importOriginal) => {
      const actual = await importOriginal<typeof Logger>();
      return { ...actual, createLogger: (options: (typeof created)[number]) => { created.push(options); return actual.createLogger(options as never); } };
    });
    await import('./index');
    return created[0];
  }

  it('sends lines to the network as well as the console on a deployed site, and only to the console locally', async () => {
    expect((await loggerOptions('production')).sinks).toHaveLength(2);
    expect((await loggerOptions('test')).sinks).toHaveLength(1);
  });

  it('stamps the page route when there is a window, and none when there is not', async () => {
    const options = await loggerOptions('test');
    expect(options.getContext().route).toBe(window.location.pathname);
    vi.stubGlobal('window', undefined);
    expect(options.getContext().route).toBeUndefined();
  });
});
