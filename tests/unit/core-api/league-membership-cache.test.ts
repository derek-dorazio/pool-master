import type { LeagueMembership } from '@poolmaster/shared/domain';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import {
  LeagueMembershipCache,
  readLeagueMembershipCacheTtlMs,
} from '../../../packages/core-api/src/core/league-membership-cache';

// The task's league membership cache (#1438): an ACTIVE membership is kept for the TTL, "not a
// member" never is, and a write this task makes forgets what it changes. The same behaviour
// against Postgres, across two tasks' caches, is in league-membership-cache.integration.ts.

const T0 = new Date('2026-11-07T20:00:00.000Z');

function membership(overrides: Partial<LeagueMembership> = {}): LeagueMembership {
  return {
    id: 'membership-1',
    leagueId: 'league-1',
    userId: 'user-1',
    role: LeagueRole.MEMBER,
    status: LeagueMembershipStatus.ACTIVE,
    joinedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** A cache on a clock the test moves, and a load that counts its calls and answers `row`. */
function setup(ttlMs = 30_000) {
  let nowMs = T0.getTime();
  const cache = new LeagueMembershipCache(ttlMs, () => new Date(nowMs));
  const db = { row: membership() as LeagueMembership | null, reads: 0 };
  const load = async () => {
    db.reads += 1;
    return db.row;
  };
  return {
    cache,
    db,
    read: () => cache.read('league-1', 'user-1', load),
    advance: (ms: number) => { nowMs += ms; },
  };
}

describe('LeagueMembershipCache keeps an active membership', () => {
  it('answers a repeat read within 30 seconds without reading the database again', async () => {
    const { db, read, advance } = setup();

    const first = await read();
    advance(29_999);
    const second = await read();

    expect(db.reads).toBe(1);
    expect(second).toBe(first);
  });

  it('reads the database again once 30 seconds have passed, and sees a role change made elsewhere', async () => {
    const { db, read, advance } = setup();
    await read();
    db.row = membership({ role: LeagueRole.COMMISSIONER });

    advance(30_000);
    const after = await read();

    expect(db.reads).toBe(2);
    expect(after?.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('keeps nothing when the TTL is 0, so every read goes to the database', async () => {
    const { db, read } = setup(0);

    await read();
    await read();

    expect(db.reads).toBe(2);
  });

  it('keeps each league and user apart', async () => {
    const { cache } = setup();
    let reads = 0;
    const load = (row: LeagueMembership) => async () => { reads += 1; return row; };

    await cache.read('league-1', 'user-1', load(membership()));
    const other = await cache.read('league-1', 'user-2', load(membership({ userId: 'user-2' })));
    const otherLeague = await cache.read('league-2', 'user-1', load(membership({ leagueId: 'league-2' })));

    expect(reads).toBe(3);
    expect(other?.userId).toBe('user-2');
    expect(otherLeague?.leagueId).toBe('league-2');
  });
});

describe('LeagueMembershipCache never keeps "not a member"', () => {
  it('reads the database again on the very next request after finding no membership, so a user who just joined is let in', async () => {
    const { db, read } = setup();
    db.row = null;
    await expect(read()).resolves.toBeNull();

    db.row = membership();
    const next = await read();

    expect(db.reads).toBe(2);
    expect(next?.status).toBe(LeagueMembershipStatus.ACTIVE);
  });

  it('reads the database again after finding an inactive membership, so a member who rejoined is let in', async () => {
    const { db, read } = setup();
    db.row = membership({ status: LeagueMembershipStatus.INACTIVE });
    await read();

    db.row = membership();
    const next = await read();

    expect(db.reads).toBe(2);
    expect(next?.status).toBe(LeagueMembershipStatus.ACTIVE);
  });

  it('does not keep a failed read', async () => {
    const { cache } = setup();
    await expect(cache.read('league-1', 'user-1', async () => { throw new Error('connection lost'); })).rejects.toThrow('connection lost');

    const after = await cache.read('league-1', 'user-1', async () => membership());

    expect(after?.status).toBe(LeagueMembershipStatus.ACTIVE);
  });
});

describe('LeagueMembershipCache forgets on this task\'s own writes', () => {
  it('reads afresh at once after forget, so a removed member is turned away on their next request here', async () => {
    const { cache, db, read } = setup();
    await read();

    db.row = membership({ status: LeagueMembershipStatus.INACTIVE });
    cache.forget('league-1', 'user-1');
    const after = await read();

    expect(db.reads).toBe(2);
    expect(after?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('forgets every member of a league with forgetLeague and leaves other leagues kept', async () => {
    const { cache } = setup();
    let reads = 0;
    const load = (row: LeagueMembership) => async () => { reads += 1; return row; };
    await cache.read('league-1', 'user-1', load(membership()));
    await cache.read('league-1', 'user-2', load(membership({ userId: 'user-2' })));
    await cache.read('league-2', 'user-1', load(membership({ leagueId: 'league-2' })));

    cache.forgetLeague('league-1');
    await cache.read('league-1', 'user-1', load(membership()));
    await cache.read('league-1', 'user-2', load(membership({ userId: 'user-2' })));
    await cache.read('league-2', 'user-1', load(membership({ leagueId: 'league-2' })));

    expect(reads).toBe(5);
  });

  it('keeps nothing read while a write is under way, so the row from before the commit is not put back', async () => {
    const { cache, db, read } = setup();
    let commit: () => void = () => undefined;
    const writing = cache.writing(() => new Promise<void>((resolve) => { commit = resolve; }));

    await read();
    db.row = membership({ status: LeagueMembershipStatus.INACTIVE });
    commit();
    await writing;
    const after = await read();

    expect(db.reads).toBe(2);
    expect(after?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('does not keep a read that started before a write finished', async () => {
    const { cache, db } = setup();
    let answer: (row: LeagueMembership | null) => void = () => undefined;
    const before = cache.read('league-1', 'user-1', () => new Promise((resolve) => { answer = resolve; }));

    await cache.writing(async () => { db.row = membership({ role: LeagueRole.COMMISSIONER }); });
    answer(membership());
    await before;
    const after = await cache.read('league-1', 'user-1', async () => db.row);

    expect(after?.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('lets reads be kept again once a failed write has finished', async () => {
    const { cache, db, read } = setup();
    await expect(cache.writing(async () => { throw new Error('unique violation'); })).rejects.toThrow('unique violation');

    await read();
    await read();

    expect(db.reads).toBe(1);
  });
});

describe('LEAGUE_MEMBERSHIP_CACHE_TTL_MS', () => {
  it('keeps memberships 30 seconds when unset or empty, and takes a whole number of milliseconds otherwise', () => {
    expect(readLeagueMembershipCacheTtlMs({})).toBe(30_000);
    expect(readLeagueMembershipCacheTtlMs({ LEAGUE_MEMBERSHIP_CACHE_TTL_MS: '' })).toBe(30_000);
    expect(readLeagueMembershipCacheTtlMs({ LEAGUE_MEMBERSHIP_CACHE_TTL_MS: '0' })).toBe(0);
    expect(readLeagueMembershipCacheTtlMs({ LEAGUE_MEMBERSHIP_CACHE_TTL_MS: '15000' })).toBe(15_000);
  });

  it.each(['-1', '1.5', 'thirty'])('refuses to start with LEAGUE_MEMBERSHIP_CACHE_TTL_MS=%s rather than guess a TTL', (raw) => {
    expect(() => readLeagueMembershipCacheTtlMs({ LEAGUE_MEMBERSHIP_CACHE_TTL_MS: raw }))
      .toThrow('LEAGUE_MEMBERSHIP_CACHE_TTL_MS must be a whole number');
  });
});
