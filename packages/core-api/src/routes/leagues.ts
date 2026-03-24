import { Router } from 'express';

export const leaguesRouter = Router();

leaguesRouter.get('/leagues', (_req, res) => {
  res.json({ leagues: [] });
});

leaguesRouter.post('/leagues', (_req, res) => {
  res.status(501).json({ message: 'not implemented' });
});
