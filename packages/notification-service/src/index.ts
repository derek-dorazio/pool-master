import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    return { status: 'ok', service: 'notification-service' };
  });

  // TODO: Register notification modules and event consumer

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3004);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
