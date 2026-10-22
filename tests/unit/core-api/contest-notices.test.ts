/**
 * The contest milestone emails (#845): "New contest open" (D1) and "Contest is live, good luck"
 * (E1). The contest world is in memory; the email service is the real one over an in-memory
 * outbox, so the tests assert on the emails recorded.
 */
import {
  ContestEntryStatus,
  LeagueMembershipStatus,
  MatchStatus,
  SelectionType,
  Sport,
  SportEventStatus,
  type SportEventMatch,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { ContestNotices } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

const STARTS_AT = new Date('2026-04-09T11:40:00.000Z');

describe('ContestNotices', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let matches: SportEventMatch[];
  let roundNames: string[];
  let tierCount: number;
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    matches = [];
    roundNames = [];
    tierCount = 6;
    logger = fakeLogger();
  });

  function notices(): ContestNotices {
    const config = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' });
    const email = new EmailService({
      messages: outbox,
      providerName: 'smtp',
      readConfig: () => config,
      senderAddress: 'noreply@poolmaster.test',
      suppressions: inMemoryEmailSuppressions(),
      optOuts: inMemoryEmailOptOuts(),
      unsubscribe: TEST_UNSUBSCRIBE,
      logger,
    });
    return new ContestNotices({
      contests: world.contestRepo(),
      configurations: world.configurationRepo(),
      sportEvents: world.sportEventRepo(),
      sportLeagues: { findById: async () => ({ roundNames } as unknown as SportLeague) },
      matches: { findBySportEvent: async (sportEventId) => matches.filter((match) => match.sportEventId === sportEventId) },
      tiers: {
        getEffectiveTiersForSportEvent: async (sportEventId) => world.addEventTiers(sportEventId, tierCount)
          .map((tier) => ({ ...tier, participants: [] })),
      },
      entries: world.entryRepo(),
      leagues: world.leagueRepo(),
      memberships: world.membershipRepo(),
      squadMemberships: world.squadMembershipRepo(),
      users: world.userRepo(),
      email,
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  /** A member of the league who owns a squad of their own. */
  function member(leagueId: string, firstName: string, options: { membership?: LeagueMembershipStatus; isActive?: boolean } = {}) {
    const user = world.addUser({ firstName, lastName: 'Member', isActive: options.isActive ?? true });
    world.addMember(leagueId, user.id, { status: options.membership ?? LeagueMembershipStatus.ACTIVE });
    const squad = world.addSquad(leagueId, `${firstName}'s Squad`);
    world.addSquadMember(squad.id, user.id);
    return { user, squad };
  }

  function textTo(userId: string): string {
    return outbox.rows.find((row) => row.recipientUserId === userId)?.textBody ?? '';
  }

  function recipientIds(): string[] {
    return outbox.rows.map((row) => row.recipientUserId ?? '').sort();
  }

  describe('contestOpened (D1)', () => {
    it('tells every active league member once, from the league, with the event, the rules, the entry limit, when picks close and a link to the contest', async () => {
      const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const masters = world.addSportEvent({ name: 'The Masters', venue: 'Augusta National', startDate: STARTS_AT });
      const contest = world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
      world.addConfiguration(contest.id, { maxEntriesPerSquad: 2 });
      const nora = member(league.id, 'Nora');
      const dana = member(league.id, 'Dana');
      member(league.id, 'Gone', { membership: LeagueMembershipStatus.INACTIVE });
      member(league.id, 'Closed', { isActive: false });
      const elsewhere = world.addLeague();
      member(elsewhere.id, 'Other');

      await notices().contestOpened(contest.id);
      await notices().contestOpened(contest.id);

      expect(recipientIds()).toEqual([nora.user.id, dana.user.id].sort());
      expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_OPENED' && row.fromName === 'Office League')).toBe(true);
      const text = textTo(nora.user.id);
      expect(text).toContain('Masters Pick 6 is open in Office League.');
      expect(text).toContain('Event: The Masters');
      expect(text).toContain('Venue: Augusta National');
      expect(text).toContain('Rules: Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
      expect(text).toContain('Entries: 2 entries per member');
      expect(text).toContain('Picks close: Apr 9, 2026');
      expect(text).toContain(`Enter contest: https://app.example.test/league/OFFICE24/contests/${contest.id}`);
    });

    it('says a second-chance bracket closes at its starting round, named in the sport league\'s words', async () => {
      const league = world.addLeague();
      const tournament = world.addSportEvent({
        name: 'March Madness',
        sport: Sport.BASKETBALL,
        rounds: 6,
        status: SportEventStatus.IN_PROGRESS,
        startDate: new Date('2026-03-19T16:00:00.000Z'),
      });
      const contest = world.addContest(league.id, { selectionType: SelectionType.BRACKET, sportEventIds: [tournament.id] });
      world.addConfiguration(contest.id, {
        selectionType: SelectionType.BRACKET,
        configJson: { selectionType: SelectionType.BRACKET, startsAtRound: 3 },
      });
      roundNames = ['First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'Championship'];
      matches = [2, 3].map((roundNumber) => ({
        id: `game-${String(roundNumber)}`,
        sportEventId: tournament.id,
        roundNumber,
        status: roundNumber === 2 ? MatchStatus.COMPLETED : MatchStatus.SCHEDULED,
        scheduledDate: roundNumber === 2 ? new Date('2026-03-21T16:00:00.000Z') : STARTS_AT,
      }) as SportEventMatch);
      const nora = member(league.id, 'Nora');

      await notices().contestOpened(contest.id);

      expect(textTo(nora.user.id)).toContain('Rules: Second-chance bracket from the Sweet 16');
      expect(textTo(nora.user.id)).toContain('Picks close: Apr 9, 2026');
    });

    it('sends nothing, and says why, for a contest whose rules are gone', async () => {
      const league = world.addLeague();
      const event = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest(league.id, { sportEventIds: [event.id] });
      member(league.id, 'Nora');

      await notices().contestOpened(contest.id);

      expect(outbox.rows).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'email.contestOpened.skipped' }),
        expect.any(String),
      );
    });

    it('still tells the rest of the league when one member\'s email cannot be queued', async () => {
      const league = world.addLeague();
      const event = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest(league.id, { sportEventIds: [event.id] });
      world.addConfiguration(contest.id);
      const nora = member(league.id, 'Nora');
      const dana = member(league.id, 'Dana');
      const record = outbox.record.bind(outbox);
      outbox.record = async (input) => (input.recipientUserId === nora.user.id ? Promise.reject(new Error('database unavailable')) : record(input));

      await notices().contestOpened(contest.id);

      expect(recipientIds()).toEqual([dana.user.id]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'email.contestNotice.failed' }),
        'Failed to queue a contest email',
      );
    });
  });

  describe('contestStarted (E1)', () => {
    it('wishes every active member good luck with the event, the rules and the entry count, and tells members without an entry they can follow along', async () => {
      const league = world.addLeague({ leagueCode: 'OFFICE24' });
      const week = world.addSportEvent({ name: 'NFL Week 1', sport: Sport.AMERICAN_FOOTBALL, startDate: STARTS_AT });
      const contest = world.addContest(league.id, { name: 'Week 1 Pick\'em', selectionType: SelectionType.PICK_EM, sportEventIds: [week.id] });
      world.addConfiguration(contest.id, {
        selectionType: SelectionType.PICK_EM,
        configJson: { selectionType: SelectionType.PICK_EM, mode: 'STRAIGHT_UP', againstTheSpread: false },
      });
      matches = [1, 2].map((matchNumber) => ({ id: `game-${String(matchNumber)}`, sportEventId: week.id, matchNumber }) as SportEventMatch);
      const entrant = member(league.id, 'Sam');
      const drafting = member(league.id, 'Dana');
      const onlooker = member(league.id, 'Nora');
      for (const [owner, submitted] of [[entrant, true], [drafting, false]] as const) {
        const created = await world.entryRepo().create({ contestId: contest.id, squadId: owner.squad.id, entryNumber: 1, name: 'Entry 1', tiebreakerValue: null });
        if (created.status !== 'created') throw new Error('entry not created');
        if (submitted) await world.entryRepo().setEventStatus(created.entry.id, week.id, ContestEntryStatus.SUBMITTED, new Date());
      }

      await notices().contestStarted(contest, week);

      expect(recipientIds()).toEqual([entrant.user.id, drafting.user.id, onlooker.user.id].sort());
      expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_STARTED_SUMMARY')).toBe(true);
      const text = textTo(entrant.user.id);
      expect(text).toContain('Good luck, everyone.');
      expect(text).toContain('Week 1 Pick\'em is live for NFL Week 1.');
      expect(text).toContain('Format: 2 games');
      expect(text).toContain('Rules: Pick the winner of every game.');
      expect(text).toContain('Entries: 1');
      expect(text).toContain(`Leaderboard: https://app.example.test/league/OFFICE24/contests/${contest.id}/leaderboard`);
      expect(text).not.toContain('You didn\'t enter this one');
      expect(textTo(drafting.user.id)).toContain('You didn\'t enter this one');
      expect(textTo(onlooker.user.id)).toContain('You didn\'t enter this one');
    });

    it('queues the good luck email once per member and event, however often it is asked', async () => {
      const league = world.addLeague();
      const event = world.addSportEvent({ startDate: STARTS_AT, rounds: 4 });
      const contest = world.addContest(league.id, { sportEventIds: [event.id] });
      world.addConfiguration(contest.id);
      member(league.id, 'Nora');

      await notices().contestStarted(contest, event);
      await notices().contestStarted(contest, event);

      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]?.textBody).toContain('Format: 4 rounds');
    });

    it('sends nothing when the contest\'s league is gone', async () => {
      const event = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest('no-such-league', { sportEventIds: [event.id] });
      world.addConfiguration(contest.id);

      await notices().contestStarted(contest, event);

      expect(outbox.rows).toHaveLength(0);
    });
  });
});
