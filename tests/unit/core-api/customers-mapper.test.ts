/**
 * The Customers mapper (#1882): a league and a user as the grids show them, dates as ISO strings
 * and an absent owner, preview end or sign-in as null, each matching its DTO.
 */
import { expect } from '@jest/globals';
import { CustomerLeagueDtoSchema, CustomerUserDtoSchema } from '@poolmaster/shared/dto';
import { LeaguePlan, type CustomerLeague, type CustomerUser } from '@poolmaster/shared/domain';
import { toCustomerLeagueDto, toCustomerUserDto } from '../../../packages/core-api/src/mappers/customers.mapper';

const league: CustomerLeague = {
  id: '6a0f9f1e-2a7c-4c4e-9c1e-3f0a3b1d2c01',
  leagueCode: 'HOOPS22',
  name: 'Office Hoops',
  isActive: true,
  plan: LeaguePlan.PRO,
  owner: { userId: '6a0f9f1e-2a7c-4c4e-9c1e-3f0a3b1d2c02', firstName: 'Ana', lastName: 'Ruiz' },
  memberCount: 18,
  activeContestCount: 2,
  previewEndsAt: new Date('2027-03-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

const user: CustomerUser = {
  id: '6a0f9f1e-2a7c-4c4e-9c1e-3f0a3b1d2c02',
  email: 'ana@example.com',
  username: 'ana',
  firstName: 'Ana',
  lastName: 'Ruiz',
  isRootAdmin: false,
  isActive: true,
  leagues: [{ id: league.id, leagueCode: 'HOOPS22', name: 'Office Hoops' }],
  joinedAt: new Date('2026-09-02T00:00:00.000Z'),
  lastSignInAt: new Date('2026-11-18T19:40:00.000Z'),
};

describe('toCustomerLeagueDto', () => {
  it('sends the owner, counts and preview end, with dates as ISO strings, matching the DTO', () => {
    const dto = toCustomerLeagueDto(league);

    expect(dto).toEqual({
      ...league,
      owner: { userId: league.owner?.userId, firstName: 'Ana', lastName: 'Ruiz' },
      previewEndsAt: '2027-03-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    expect(CustomerLeagueDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('sends null for a league with no owner and an ended preview', () => {
    const dto = toCustomerLeagueDto({ ...league, owner: null, previewEndsAt: null });

    expect(dto).toMatchObject({ owner: null, previewEndsAt: null });
    expect(CustomerLeagueDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe('toCustomerUserDto', () => {
  it('sends the role, status, leagues and dates as ISO strings, matching the DTO', () => {
    const dto = toCustomerUserDto(user);

    expect(dto).toEqual({ ...user, joinedAt: '2026-09-02T00:00:00.000Z', lastSignInAt: '2026-11-18T19:40:00.000Z' });
    expect(CustomerUserDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('sends a null last sign-in for a user with none recorded', () => {
    const dto = toCustomerUserDto({ ...user, lastSignInAt: null });

    expect(dto.lastSignInAt).toBeNull();
    expect(CustomerUserDtoSchema.safeParse(dto).success).toBe(true);
  });
});
