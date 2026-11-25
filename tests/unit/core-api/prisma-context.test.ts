import Fastify from 'fastify';
import { getAppPrisma } from '../../../packages/core-api/src/core/prisma-context';

describe('getAppPrisma', () => {
  it('hands back the client the app already carries, without making another', async () => {
    const app = Fastify({ logger: false });
    const existing = getAppPrisma(app);

    expect(getAppPrisma(app)).toBe(existing);
    await app.close();
  });

  it('makes one client for an app that has none, puts it on the app, and disconnects it when the app closes', async () => {
    const app = Fastify({ logger: false });

    const prisma = getAppPrisma(app);
    const disconnect = jest.spyOn(prisma, '$disconnect');

    expect(app.prisma).toBe(prisma);
    await app.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
