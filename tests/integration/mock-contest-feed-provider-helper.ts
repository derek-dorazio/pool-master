import type { FastifyInstance } from 'fastify';
import { buildApp, type MockContestFeedAppOptions } from '../../packages/mock-contest-feed-provider/src/app';

export interface RunningMockContestFeedProvider {
  app: FastifyInstance;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startMockContestFeedProvider(
  options: MockContestFeedAppOptions = {},
): Promise<RunningMockContestFeedProvider> {
  const app = buildApp(options);
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('Mock contest feed provider did not bind to an ephemeral TCP port');
  }

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await app.close();
    },
  };
}
