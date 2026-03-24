import express from 'express';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'scoring-service' });
});

app.listen(PORT, () => {
  console.log(`PoolMaster Scoring Service listening on port ${PORT}`);
});

export { app };
