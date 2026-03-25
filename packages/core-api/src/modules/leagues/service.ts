import type { LeagueRepository } from '@poolmaster/shared/db';
import type { League } from '@poolmaster/shared/domain';

export class LeagueService {
  constructor(private readonly leagueRepo: LeagueRepository) {}

  async findByTenant(tenantId: string): Promise<League[]> {
    return this.leagueRepo.findByTenant(tenantId);
  }
}
