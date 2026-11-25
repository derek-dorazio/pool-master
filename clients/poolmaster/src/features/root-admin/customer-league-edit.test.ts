import { LeaguePlan } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { CustomerLeagueDto } from '@/lib/api';
import { customerLeagueChange, customerLeagueFormValues } from './customer-league-edit';

const league: CustomerLeagueDto = {
  id: 'league-1',
  leagueCode: 'BIGDAWGS',
  name: 'Big Dawgs',
  isActive: true,
  plan: LeaguePlan.PRO,
  owner: null,
  memberCount: 4,
  activeContestCount: 1,
  previewEndsAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('customer league edit', () => {
  it('starts the form on the league\'s plan with its preview end kept', () => {
    expect(customerLeagueFormValues(league)).toEqual({ plan: LeaguePlan.PRO, extendMonths: '' });
  });

  it('changes nothing when the plan is unchanged and no month count is picked', () => {
    expect(customerLeagueChange(league, { plan: LeaguePlan.PRO, extendMonths: '' })).toEqual({ plan: null, extendMonths: null });
  });

  it('sends a moved plan and a picked month count as a number', () => {
    expect(customerLeagueChange(league, { plan: LeaguePlan.PREMIUM, extendMonths: '3' })).toEqual({ plan: LeaguePlan.PREMIUM, extendMonths: 3 });
  });
});
