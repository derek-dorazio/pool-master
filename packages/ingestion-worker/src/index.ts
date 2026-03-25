import Fastify from 'fastify';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3000);

app.get('/health', async () => {
  return { status: 'ok', service: 'ingestion-worker' };
});

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

export { app };
