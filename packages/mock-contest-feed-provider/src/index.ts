import { buildApp } from './app';

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3105);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();

export { buildApp } from './app';
