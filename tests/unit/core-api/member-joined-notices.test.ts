/**
 * "New member joined" (#903 B6): the first three people to join a league on a day are told to its
 * commissioners at once, and the rest of a busy day in one email the next day. The league world is
 * in memory; the email service is the real one over an in-memory outbox, so the tests assert on
 * the emails recorded.
 */
import { LeagueRole, type League, type User } from '@poolmaster/shared/domain';
import { MemberJoinedNotices } from '../../../packages/core-api/src/modules/notifications';
import { emailServiceInto } from '../../support/email-service';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';

/** 9am US Eastern (daylight time) on Thursday 2026-10-22. */
const THURSDAY_MORNING = new Date('2026-10-22T13:00:00.000Z');
/** 1am US Eastern on Friday 2026-10-23: Thursday is over there. */
const FRIDAY_SMALL_HOURS = new Date('2026-10-23T05:00:00.000Z');
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
      squads: world.squads,
      users: world.users,
      email: emailServiceInto(outbox),
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, logger };
  }

  /** `firstName` joins `inLeague` at `joinedAt`, with a squad of their own, which the world names after them. */
  async function join(firstName: string, joinedAt: Date, inLeague: League = league) {
    const user = world.addUser({ firstName, lastName: 'Joiner' });
    const { membership } = world.addMember({ league: inLeague, user });
    return { user, membership: await world.memberships.update(membership.id, { joinedAt }) };
  }

  const joinedEmails = () => outbox.rows.filter((row) => row.templateKey === 'LEAGUE_MEMBER_JOINED');

  it('tells the commissioners the next day of every join after the third on a busy day, in the order they joined, in one email', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee', 'Eve'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_SMALL_HOURS);

    expect(joinedEmails()).toHaveLength(1);
    const email = expectDefined(joinedEmails()[0]);
    expect(email).toMatchObject({ recipientEmail: 'casey@example.com', subject: '2 more joined Office Pool' });
    expect(email.textBody).toContain([
      'After the first three, 2 more people joined Office Pool yesterday:',
      'Dee Joiner (Dee Joiner)',
      'Eve Joiner (Eve Joiner)',
    ].join('\n'));
    expect(email.textBody).toContain('The league has 6 members now.');
    expect(email.textBody).toContain('Members and owners: https://app.example.test/league/OFFICE/admin/teams');
  });

  it('sends the next-day email once, however many sweeps run that day', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }
    const { service } = notices();

    await service.queueDue(FRIDAY_SMALL_HOURS);
    await service.queueDue(new Date(FRIDAY_SMALL_HOURS.getTime() + 60 * MINUTE));

    expect(joinedEmails()).toHaveLength(1);
  });

  it('sends nothing the next day when three or fewer joined, as each was told at once', async () => {
    for (const [index, name] of ['Ann', 'Ben', 'Cal'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_SMALL_HOURS);

    expect(joinedEmails()).toHaveLength(0);
  });

  it('counts the day in US Eastern time, so joins late in the Eastern evening belong to that day, not the next UTC one', async () => {
    // 11pm Thursday Eastern is 3am Friday UTC.
    const lateThursday = new Date('2026-10-23T03:00:00.000Z');
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      await join(name, new Date(lateThursday.getTime() + index * MINUTE));
    }

    await notices().service.queueDue(FRIDAY_SMALL_HOURS);

    expect(joinedEmails().map((row) => row.subject)).toEqual(['1 more joined Office Pool']);
  });

  it("keeps each league's busy day to itself: another league's joins don't count toward this one's three", async () => {
    const other = world.addLeague({ name: 'Golf Pool' });
    for (const [index, name] of ['Ann', 'Ben'].entries()) {
      await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE));
      await join(`${name}2`, new Date(THURSDAY_MORNING.getTime() + index * MINUTE), other);
    }

    await notices().service.queueDue(FRIDAY_SMALL_HOURS);

    expect(joinedEmails()).toHaveLength(0);
  });

  it('tells a join at once when it is among the first three of its day, and not when it is the fourth', async () => {
    const { service } = notices();
    const joins = [];
    for (const [index, name] of ['Ann', 'Ben', 'Cal', 'Dee'].entries()) {
      joins.push(await join(name, new Date(THURSDAY_MORNING.getTime() + index * MINUTE)));
    }

    for (const { membership } of joins) await service.tellJoined(league, membership);

    expect(joinedEmails().map((row) => row.subject)).toEqual([
      'Ann Joiner joined Office Pool',
      'Ben Joiner joined Office Pool',
      'Cal Joiner joined Office Pool',
    ]);
  });

  it('logs and swallows a failure to tell the commissioners, as the member has already joined', async () => {
    const { service, logger } = notices({ findByLeagueFails: true });
    const { membership } = await join('Ann', THURSDAY_MORNING);

    await expect(service.tellJoined(league, membership)).resolves.toBeUndefined();

    expect(joinedEmails()).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.memberJoined.failed' }),
      expect.any(String),
    );
  });
});
