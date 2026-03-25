import Fastify from 'fastify';
import { healthRoute } from './routes/health';
import { leaguesRoute } from './routes/leagues';

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT ?? 3000);

app.register(healthRoute);
app.register(leaguesRoute, { prefix: '/api/v1' });

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

export { app };
