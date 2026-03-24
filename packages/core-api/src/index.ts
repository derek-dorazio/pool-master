import express from 'express';
import { healthRouter } from './routes/health';
import { leaguesRouter } from './routes/leagues';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(healthRouter);
app.use('/api/v1', leaguesRouter);

app.listen(PORT, () => {
  console.log(`PoolMaster Core API listening on port ${PORT}`);
});

export { app };
