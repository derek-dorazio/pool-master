/**
 * The Customers rows (#1882): each league's owner is its longest-serving active commissioner, its
 * counts default to zero, and its Premium preview end shows only while the preview runs.
 */
import { expect } from '@jest/globals';
import type { CustomerLeagueCommissioner, CustomerLeagueFacts, CustomerLeagueRecord, CustomerReader } from '@poolmaster/shared/db';
import { LeaguePlan, type CustomerUser } from '@poolmaster/shared/domain';
import { CustomerService, customerLeagues } from '../../../packages/core-api/src/modules/customers/customer-service';

const NOW = new Date('2026-11-19T12:00:00.000Z');

function league(overrides: Partial<CustomerLeagueRecord> = {}): CustomerLeagueRecord {
  return {
    id: 'league-1',
    leagueCode: 'HOOPS22',
    name: 'Office Hoops',
    isActive: true,
    plan: LeaguePlan.PRO,
    planRenewsAt: new Date('2027-03-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function commissioner(overrides: Partial<CustomerLeagueCommissioner> = {}): CustomerLeagueCommissioner {
  return { leagueId: 'league-1', userId: 'user-b', firstName: 'Ana', lastName: 'Ruiz', joinedAt: new Date('2026-09-01T00:00:00.000Z'), ...overrides };
}

function facts(overrides: Partial<CustomerLeagueFacts> = {}): CustomerLeagueFacts {
  return { leagues: [league()], commissioners: [], memberCounts: new Map(), activeContestCounts: new Map(), ...overrides };
}

describe('customerLeagues', () => {
  it('names the earliest-joined active commissioner as owner, whatever order the reader found them in', () => {
    const [row] = customerLeagues(facts({
      commissioners: [
        commissioner({ userId: 'user-late', firstName: 'Ben', joinedAt: new Date('2026-10-01T00:00:00.000Z') }),
        commissioner({ userId: 'user-first', firstName: 'Ana', joinedAt: new Date('2026-08-01T00:00:00.000Z') }),
        commissioner({ userId: 'user-later', firstName: 'Cy', joinedAt: new Date('2026-11-01T00:00:00.000Z') }),
      ],
    }), NOW);

    expect(row.owner).toEqual({ userId: 'user-first', firstName: 'Ana', lastName: 'Ruiz' });
  });

  it('breaks a tie between commissioners who joined at the same instant by user id, so the owner never flips', () => {
    const joinedAt = new Date('2026-08-01T00:00:00.000Z');
    const forwards = customerLeagues(facts({ commissioners: [commissioner({ userId: 'user-b', joinedAt }), commissioner({ userId: 'user-a', joinedAt })] }), NOW);
    const backwards = customerLeagues(facts({ commissioners: [commissioner({ userId: 'user-a', joinedAt }), commissioner({ userId: 'user-b', joinedAt })] }), NOW);

    expect(forwards[0]?.owner?.userId).toBe('user-a');
    expect(backwards[0]?.owner?.userId).toBe('user-a');
  });

  it('gives each league its own owner and counts, and zero counts and no owner to a league the reader found none for', () => {
    const rows = customerLeagues(facts({
      leagues: [league(), league({ id: 'league-2', name: 'Golf Pals' })],
      commissioners: [commissioner({ leagueId: 'league-2', userId: 'user-g', firstName: 'Gail' })],
      memberCounts: new Map([['league-2', 7]]),
      activeContestCounts: new Map([['league-2', 2]]),
    }), NOW);

    expect(rows).toEqual([
      expect.objectContaining({ id: 'league-1', owner: null, memberCount: 0, activeContestCount: 0 }),
      expect.objectContaining({ id: 'league-2', owner: { userId: 'user-g', firstName: 'Gail', lastName: 'Ruiz' }, memberCount: 7, activeContestCount: 2 }),
    ]);
  });

  it('shows the preview end while the gifted plan still runs, and none once it has ended or ends this instant', () => {
    const rows = customerLeagues(facts({
      leagues: [
        league({ id: 'running', planRenewsAt: new Date('2027-01-01T00:00:00.000Z') }),
        league({ id: 'ended', planRenewsAt: new Date('2026-10-01T00:00:00.000Z') }),
        league({ id: 'ending-now', planRenewsAt: NOW }),
      ],
    }), NOW);

    expect(rows.map((row) => [row.id, row.previewEndsAt])).toEqual([
      ['running', new Date('2027-01-01T00:00:00.000Z')],
      ['ended', null],
      ['ending-now', null],
    ]);
  });

  it('carries each league\'s code, name, status, plan and creation date through unchanged', () => {
    const [row] = customerLeagues(facts({ leagues: [league({ isActive: false, plan: LeaguePlan.FREE })] }), NOW);

    expect(row).toMatchObject({ leagueCode: 'HOOPS22', name: 'Office Hoops', isActive: false, plan: LeaguePlan.FREE, createdAt: new Date('2026-09-01T00:00:00.000Z') });
  });
});

describe('CustomerService', () => {
  const user: CustomerUser = {
    id: 'user-1', email: 'ana@example.com', username: 'ana', firstName: 'Ana', lastName: 'Ruiz', isRootAdmin: false, isActive: true,
    leagues: [{ id: 'league-1', leagueCode: 'HOOPS22', name: 'Office Hoops' }], joinedAt: new Date('2026-09-02T00:00:00.000Z'), lastSignInAt: null,
  };
  const reader = (): CustomerReader => ({
    readLeagueFacts: jest.fn().mockResolvedValue(facts()),
    readUsers: jest.fn().mockResolvedValue([user]),
  });

  it('lists every league with its preview judged against the service clock, and logs how many', async () => {
    const info = jest.fn();
    const service = new CustomerService({ reader: reader(), now: () => new Date('2027-06-01T00:00:00.000Z'), logger: { info } as never });

    const leagues = await service.listLeagues();

    expect(leagues).toEqual([expect.objectContaining({ id: 'league-1', previewEndsAt: null })]);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ action: 'customers.leagues.success', data: { leagueCount: 1 } }), expect.any(String));
  });

  it('judges the preview against the current time when no clock is given', async () => {
    const leagues = await new CustomerService({ reader: reader() }).listLeagues();

    // The fixture's preview ends 2027-03-01, after any day this suite runs before then, and before any after.
    expect(leagues[0]?.previewEndsAt).toEqual(Date.now() < Date.parse('2027-03-01T00:00:00.000Z') ? new Date('2027-03-01T00:00:00.000Z') : null);
  });

  it('lists every user as the reader found them', async () => {
    const info = jest.fn();
    const users = await new CustomerService({ reader: reader(), logger: { info } as never }).listUsers();

    expect(users).toEqual([user]);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ action: 'customers.users.success', data: { userCount: 1 } }), expect.any(String));
  });
});
