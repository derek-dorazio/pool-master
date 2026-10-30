/**
 * "New member joined" (#903 B6): the first three people to join a league on a day are told to its
 * commissioners at once, and the rest of a busy day in one email the next day. The league world is
 * in memory; the email service is the real one over an in-memory outbox, so the tests assert on
 * the emails recorded.
 */
import { LeagueMembershipStatus, LeagueRole, type League, type User } from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { MemberJoinedNotices } from '../../../packages/core-api/src/modules/notifications';
import { emailServiceInto } from '../../support/email-service';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';

/** 9am US Eastern (daylight time) on Thursday 2026-10-22. */
const THURSDAY_MORNING = new Date('2026-10-22T13:00:00.000Z');
/** 1am US Eastern on Friday 2026-10-23: Thursday is over there, but the overnight hour hasn't come. */
const FRIDAY_SMALL_HOURS = new Date('2026-10-23T05:00:00.000Z');
/** 3am US Eastern on Friday, the overnight hour (EMAIL_CONFIG.weeklyDigestHour) every scheduled email goes at. */
const FRIDAY_OVERNIGHT = new Date('2026-10-23T07:00:00.000Z');
const MINUTE = 60_000;

describe('MemberJoinedNotices', () => {
  let world: InMemoryLeagueWorld;
  let outbox: InMemoryEmailMessages;
  let league: League;
  let commissioner: User;

  beforeEach(() => {
    world = inMemoryLeagueWorld();
    outbox = inMemoryEmailMessages();
    league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE' });
    commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish', email: 'casey@example.com' });
    world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  });

  function notices(overrides: { findByLeagueFails?: boolean } = {}) {
    const logger = fakeLogger();
    const service = new MemberJoinedNotices({
      memberships: overrides.findByLeagueFails
        ? { ...world.memberships, findByLeague: async () => { throw new Error('connection reset'); } }
        : world.memberships,
      leagues: world.leagues,
      squadMemberships: world.squadMemberships,
      users: world.users,
      email: emailServiceInto(outbox),
      readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, logger };
  }

  /**
   * `firstName` joins at `joinedAt`, with a squad of their own, which the world names after them.
   * Joining tells the commissioners, as accepting an invitation does, unless `tell` is false.
   */
  async function join(firstName: string, joinedAt: Date, options: { inLeague?: League; tell?: boolean } = {}) {
    const user = world.addUser({ firstName, lastName: 'Joiner' });
    const { membership } = world.addMember({ league: options.inLeague ?? league, user });
    const joined = await world.memberships.update(membership.id, { joinedAt });
    if (options.tell ?? true) await notices().service.tellJoined(joined);
    return { user, membership: joined };
  }

  const joinedEmails = () => outbox.rows.filter((row) => row.templateKey === 'LEAGUE_MEMBER_JOINED');
  const nextDayEmails = () => joinedEmails().filter((row) => row.subject?.includes('more joined') ?? false);

  it('tells the commissioners the next day of every join after the third on a busy day, in the order they joined, in one email', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee', 'Eve'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(nextDayEmails()).toHaveLength(1);
    const email = expectDefined(nextDayEmails()[0]);
    expect(email).toMatchObject({ recipientEmail: 'casey@example.com', subject: '2 more joined Office Pool' });
    expect(email.textBody).toContain([
      'After the first three, 2 more people joined Office Pool yesterday:',
      'Dee Joiner (Dee Joiner)',
      'Eve Joiner (Eve Joiner)',
    ].join('\n'));
    expect(email.textBody).toContain('The league has 6 members now.');
    expect(email.textBody).toContain('Members and owners: https://app.example.test/league/OFFICE/admin/teams');
  });

  it('reads every busy league, and whether each join was told at once, in one read each, however many leagues were busy (#1255)', async () => {
    const other = world.addLeague({ name: 'Golf Pool', leagueCode: 'GOLF' });
    world.addMember({ league: other, user: commissioner, role: LeagueRole.COMMISSIONER });
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
      await join(`${name}2`, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), { inLeague: other });
    }
    const leagueReads = [jest.spyOn(world.leagues, 'findByIds'), jest.spyOn(world.leagues, 'findById')];
    const toldReads = [jest.spyOn(outbox, 'findLeagueIdsRecordedByPrefix'), jest.spyOn(outbox, 'findLeagueIdsRecorded')];

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(new Set(nextDayEmails().map((row) => row.subject))).toEqual(new Set(['1 more joined Golf Pool', '1 more joined Office Pool']));
    expect(leagueReads.map((read) => read.mock.calls.length)).toEqual([1, 0]);
    // The day's next-day emails are read once too, before the joins.
    expect(toldReads.map((read) => read.mock.calls.length)).toEqual([1, 1]);
  });

  it('reads the busy leagues\' members, member counts and joiners\' squads in one read each, however many leagues and joiners (#1336)', async () => {
    const other = world.addLeague({ name: 'Golf Pool', leagueCode: 'GOLF' });
    world.addMember({ league: other, user: commissioner, role: LeagueRole.COMMISSIONER });
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee', 'Eve'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
      await join(`${name}2`, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), { inLeague: other });
    }
    const reads = [
      jest.spyOn(world.memberships, 'findByLeagues'),
      jest.spyOn(world.users, 'findActiveByLeagues'),
      jest.spyOn(world.memberships, 'countActiveByLeagues'),
      jest.spyOn(world.squadMemberships, 'findByLeagueUsersWithSquadName'),
    ];

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(new Set(nextDayEmails().map((row) => row.subject))).toEqual(new Set(['2 more joined Golf Pool', '2 more joined Office Pool']));
    expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 1, 1, 1]);
    const golf = expectDefined(nextDayEmails().find((row) => row.subject === '2 more joined Golf Pool'));
    expect(golf.textBody).toContain('Dee2 Joiner (Dee2 Joiner)\nEve2 Joiner (Eve2 Joiner)');
  });

  it('sends the next-day email once, however many sweeps run that day', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }
    const { service } = notices();

    await service.queueDue(FRIDAY_OVERNIGHT);
    await service.queueDue(new Date(FRIDAY_OVERNIGHT.getTime() + 60 * MINUTE));

    expect(nextDayEmails()).toHaveLength(1);
  });

  it('sends nothing the next day when three or fewer joined, as each was told at once', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(nextDayEmails()).toHaveLength(0);
  });

  it('counts the day in US Eastern time, so joins late in the Eastern evening belong to that day, not the next UTC one', async () => {
    // 11pm Thursday Eastern is 3am Friday UTC.
    const lateThursday = new Date('2026-10-23T03:00:00.000Z');
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(lateThursday.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(nextDayEmails().map((row) => row.subject)).toEqual(['1 more joined Office Pool']);
  });

  it("keeps each league's busy day to itself: another league's joins don't count toward this one's three", async () => {
    const other = world.addLeague({ name: 'Golf Pool' });
    for (const [index, name] of ['Ann', 'Ben'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
      await join(`${name}2`, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), { inLeague: other });
    }

    await notices().service.queueDue(FRIDAY_OVERNIGHT);

    expect(nextDayEmails()).toHaveLength(0);
  });

  it('waits for the overnight hour in US Eastern time before sending the next-day email', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }
    const { service } = notices();

    await service.queueDue(FRIDAY_SMALL_HOURS);
    expect(nextDayEmails()).toHaveLength(0);

    await service.queueDue(FRIDAY_OVERNIGHT);
    expect(nextDayEmails().map((row) => row.subject)).toEqual(['1 more joined Office Pool']);
  });

  it('still tells the next day of a fourth joiner who was not told at once when one of the first three left later that day', async () => {
    const { service } = notices();
    const joins = [];
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      const joined = await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
      joins.push(joined);
    }
    await world.memberships.update(expectDefined(joins[2]).membership.id, { status: LeagueMembershipStatus.INACTIVE });

    await service.queueDue(FRIDAY_OVERNIGHT);

    const nextDay = nextDayEmails();
    expect(nextDay.map((row) => row.subject)).toEqual(['1 more joined Office Pool']);
    expect(expectDefined(nextDay[0]).textBody).toContain('Dee Joiner (Dee Joiner)');
  });

  it('never tells a join twice: one told at once because an earlier join committed after it is left out of the next-day email', async () => {
    const { service } = notices();
    for (const [index, name] of ['Ann', 'Ben'].entries()) {
      await service.tellJoined((await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), { tell: false })).membership);
    }
    // Dee commits and is told while Cal, who joined a moment earlier, has not committed yet.
    const dee = await join('Dee', new Date(THURSDAY_MORNING.getTime() + 3 * MINUTE), { tell: false });
    await service.tellJoined(dee.membership);
    const cal = await join('Cal', new Date(THURSDAY_MORNING.getTime() + 2 * MINUTE), { tell: false });
    await service.tellJoined(cal.membership);

    await service.queueDue(FRIDAY_OVERNIGHT);

    const subjects = joinedEmails().map((row) => row.subject);
    expect(subjects.filter((subject) => subject === 'Dee Joiner joined Office Pool')).toHaveLength(1);
    expect(subjects.filter((subject) => subject?.endsWith('more joined Office Pool') ?? false)).toHaveLength(0);
  });

  it('counts the day across the end of daylight saving: joins late on the Sunday clocks fall back go in Monday\'s email at 3am Eastern', async () => {
    // 11:30pm EST on Sunday 2026-11-01 is 04:30 UTC on Monday.
    const lateSunday = new Date('2026-11-02T04:30:00.000Z');
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(lateSunday.getTime() + index * MINUTE));
    }
    const { service } = notices();

    // 2am EST on Monday: not yet the overnight hour.
    await service.queueDue(new Date('2026-11-02T07:00:00.000Z'));
    expect(nextDayEmails()).toHaveLength(0);

    // 3am EST on Monday.
    await service.queueDue(new Date('2026-11-02T08:00:00.000Z'));
    expect(nextDayEmails().map((row) => row.subject)).toEqual(['1 more joined Office Pool']);
  });

  it('tells a join at once when it is among the first three of its day, and not when it is the fourth', async () => {
    const { service } = notices();
    const joins = [];
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      joins.push(await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), { tell: false }));
    }

    for (const { membership } of joins) await service.tellJoined(membership);

    expect(joinedEmails().map((row) => row.subject)).toEqual([
      'Ann Joiner joined Office Pool',
      'Ben Joiner joined Office Pool',
      'Cal Joiner joined Office Pool',
    ]);
  });

  it('logs and swallows a failure to tell the commissioners, as the member has already joined', async () => {
    const { service, logger } = notices({ findByLeagueFails: true });
    const { membership } = await join('Ann', THURSDAY_MORNING, { tell: false });

    await expect(service.tellJoined(membership)).resolves.toBeUndefined();

    expect(joinedEmails()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.memberJoined.failed' }),
      expect.any(String),
    );
  });
});
