import { Sport } from '@poolmaster/shared/domain';
import { resolveRankingType } from '../../../packages/core-api/src/modules/ingestion/core/ranking-types';

describe('Ranking type resolution', () => {
  it('pool-master-rop.68.1.3 resolves Golf to OWGR and keeps a default fallback for unsupported ranking sports', () => {
    expect(resolveRankingType(Sport.GOLF)).toBe('OWGR');
    expect(resolveRankingType(Sport.NFL)).toBe('default');
  });
});
