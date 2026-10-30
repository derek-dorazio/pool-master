/**
 * "Contest expanded" (#987): a contest's expansion is told to the league's commissioners other
 * than whoever expanded it; a root admin's grant names Primetime Commissioner. The league world is in memory;
 * the email service is the real one over an in-memory outbox, so the tests assert on the emails
 * recorded.
 */
import { LeagueRole, type League, type User } from '@poolmaster/shared/domain';
import { ContestExpandedNotices } from '../../../packages/core-api/src/modules/notifications';
import { buildContest } from '../../factories';
import { emailServiceInto } from '../../support/email-service';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';

describe('ContestExpandedNotices', () => {
  let world: InMemoryLeagueWorld;
  let outbox: InMemoryEmailMessages;
  let league: League;
  let sam: User;
  let casey: User;

  beforeEach(() => {
    world = inMemoryLeagueWorld();
    outbox = inMemoryEmailMessages();
    league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE' });
    sam = world.addUser({ firstName: 'Sam', lastName: 'Starter', email: 'sam@example.com' });
    casey = world.addUser({ firstName: 'Casey', lastName: 'Commish', email: 'casey@example.com' });
    world.addMember({ league, user: sam, role: LeagueRole.COMMISSIONER });
    world.addMember({ league, user: casey, role: LeagueRole.COMMISSIONER });
    world.addMember({ league, user: world.addUser({ firstName: 'Morgan', email: 'morgan@example.com' }) });
  });

  function notices(overrides: { membersReadFails?: boolean } = {}) {
    const logger = fakeLogger();
    const service = new ContestExpandedNotices({
      leagues: world.leagues,
      memberships: overrides.membersReadFails
        ? { findByLeagues: async () => { throw new Error('connection reset'); } }
        : world.memberships,
      users: world.users,
      email: emailServiceInto(outbox),
      appBaseUrl: 'https://app.example.test',
      logger,
    });
    return { service, logger };
  }

  const contest = () => buildContest({ id: 'contest-1', leagueId: league.id, name: 'Masters Pool' });

  it('tells the other commissioners, not the one who expanded it nor a plain member, who expanded which contest to what, linking to Manage contest', async () => {
    await notices().service.tellExpanded({ contest: contest(), entriesPerContest: 50, expandedById: sam.id, granted: false });

    expect(outbox.rows.map((row) => row.recipientEmail)).toEqual(['casey@example.com']);
    expect(outbox.rows[0]).toMatchObject({ templateKey: 'CONTEST_EXPANDED', leagueId: league.id, subject: 'Masters Pool now takes 50 entries' });
    expect(outbox.rows[0].textBody).toContain('Masters Pool was expanded to 50 entries by Sam Starter.');
    expect(outbox.rows[0].textBody).toContain('Manage contest: https://app.example.test/league/OFFICE/admin/contests/contest-1');
  });

  it('names Primetime Commissioner for a root admin\'s grant and tells every commissioner', async () => {
    const admin = world.addUser({ firstName: 'Root', lastName: 'Admin', isRootAdmin: true });

    await notices().service.tellExpanded({ contest: contest(), entriesPerContest: 500, expandedById: admin.id, granted: true });

    expect(outbox.rows.map((row) => row.recipientEmail).sort()).toEqual(['casey@example.com', 'sam@example.com']);
    expect(outbox.rows[0].textBody).toContain('Masters Pool was expanded to 500 entries by Primetime Commissioner.');
    expect(outbox.rows[0].textBody).not.toContain('Root Admin');
  });

  it('tells each commissioner of one expansion once, however often it is told', async () => {
    const { service } = notices();

    await service.tellExpanded({ contest: contest(), entriesPerContest: 50, expandedById: sam.id, granted: false });
    await service.tellExpanded({ contest: contest(), entriesPerContest: 50, expandedById: sam.id, granted: false });
    await service.tellExpanded({ contest: contest(), entriesPerContest: 100, expandedById: sam.id, granted: false });

    expect(outbox.rows.map((row) => row.subject)).toEqual(['Masters Pool now takes 50 entries', 'Masters Pool now takes 100 entries']);
  });

  it('tells no one of an expansion in an inactive league', async () => {
    world.tables.leagues.patch(league.id, { isActive: false });

    await notices().service.tellExpanded({ contest: contest(), entriesPerContest: 500, expandedById: sam.id, granted: true });

    expect(outbox.rows).toEqual([]);
  });

  it('logs rather than throws when the commissioners can\'t be read, since the expansion has already been written', async () => {
    const { service, logger } = notices({ membersReadFails: true });

    await expect(service.tellExpanded({ contest: contest(), entriesPerContest: 50, expandedById: sam.id, granted: false })).resolves.toBeUndefined();

    expect(outbox.rows).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.contestExpanded.failed' }),
      'Failed to queue the contest expanded email',
    );
  });
});
