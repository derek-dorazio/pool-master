/**
 * The contest milestone emails (#845): "New contest open" (D1), "Contest is live, good luck"
 * (E1), "Final results" (F1 with F3, and F2) and an event on it postponed, moved or cancelled
 * (C6, C7). The contest world is in memory; the email service is the real one over an in-memory
 * outbox, so the tests assert on the emails recorded.
 */
import {
  ContestEntryStatus,
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  MatchStatus,
  SelectionType,
  Sport,
  SportEventStatus,
  type SportEventMatch,
  type SportLeague,
} from '@poolmaster/shared/domain';
import type { ContestFinalStandings } from '../../../packages/core-api/src/modules/contests/service';
import { ContestEventChangeKind, EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
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
  let final: ContestFinalStandings;
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    matches = [];
    roundNames = [];
    tierCount = 6;
    final = { scoringDefinitionId: null, entries: [] };
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
      finalStandings: { finalStandingsOf: async () => final },
      email,
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  /** A member of the league who owns a squad of their own. */
  function member(leagueId: string, firstName: string, options: { membership?: LeagueMembershipStatus; isActive?: boolean; role?: LeagueRole } = {}) {
    const user = world.addUser({ firstName, lastName: 'Member', isActive: options.isActive ?? true });
    world.addMember(leagueId, user.id, { status: options.membership ?? LeagueMembershipStatus.ACTIVE, role: options.role ?? LeagueRole.MEMBER });
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

  describe('contestSettled (F1, F2, F3)', () => {
    /** A settled place for an entry of the squad, as `finalStandingsOf` answers it. */
    function place(squad: { id: string; name: string }, entryName: string, position: number, displayPosition: string, score: number) {
      return { entryId: `entry-${entryName}`, entryName, squadId: squad.id, squadName: squad.name, position, displayPosition, score };
    }

    it('tells every active member who won, the final leaders in the contest\'s own scoring and where their entries finished, once each', async () => {
      const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const masters = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
      const nora = member(league.id, 'Nora');
      const dana = member(league.id, 'Dana');
      const onlooker = member(league.id, 'Sam');
      member(league.id, 'Gone', { membership: LeagueMembershipStatus.INACTIVE });
      member(world.addLeague().id, 'Other');
      final = {
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        entries: [
          place(nora.squad, 'Green Jackets', 1, '1', -14),
          ...Array.from({ length: 10 }, (_, index) => place(dana.squad, `Dana ${String(index + 1)}`, index + 2, String(index + 2), index - 9)),
          place(nora.squad, 'Long Shots', 12, '12', 3),
        ],
      };

      await notices().contestSettled(contest);
      await notices().contestSettled(contest);

      expect(recipientIds()).toEqual([nora.user.id, dana.user.id, onlooker.user.id].sort());
      expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_RESULTS' && row.fromName === 'Office League')).toBe(true);
      const toDana = textTo(dana.user.id);
      expect(toDana).toContain('Masters Pick 6 is over. Green Jackets (Nora\'s Squad) won.');
      expect(toDana).toContain('Final top 10 of 12:');
      expect(toDana).toContain('1. Green Jackets (Nora\'s Squad), -14');
      expect(toDana).not.toContain('Long Shots');
      expect(toDana).toContain('Your entry:\n11. Dana 10 (Dana\'s Squad), yours, E');
      expect(toDana).not.toContain('Congratulations');
      expect(toDana).toContain(`Final leaderboard: https://app.example.test/league/OFFICE24/contests/${contest.id}/leaderboard`);
      const toNora = textTo(nora.user.id);
      expect(toNora).toContain('Congratulations, Nora\'s Squad won Masters Pick 6 with Green Jackets!');
      expect(toNora).toContain('Your entry:');
      expect(toNora).toContain('12. Long Shots (Nora\'s Squad), yours, +3');
      expect(textTo(onlooker.user.id)).not.toContain('Your entr');
    });

    it('names every entry tied for first and congratulates each of their owners on the tie', async () => {
      const league = world.addLeague();
      const event = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest(league.id, { name: 'Week 1 Pick\'em', sportEventIds: [event.id] });
      const nora = member(league.id, 'Nora');
      const dana = member(league.id, 'Dana');
      const sam = member(league.id, 'Sam');
      final = {
        scoringDefinitionId: null,
        entries: [place(nora.squad, 'Chalk', 1, 'T1', 12), place(dana.squad, 'Upsets', 1, 'T1', 12), place(sam.squad, 'Coin Flip', 3, '3', 9)],
      };

      await notices().contestSettled(contest);

      expect(textTo(sam.user.id)).toContain('Week 1 Pick\'em is over. Chalk (Nora\'s Squad) and Upsets (Dana\'s Squad) tied for first.');
      expect(textTo(sam.user.id)).toContain('Final standings:');
      expect(textTo(sam.user.id)).toContain('3. Coin Flip (Sam\'s Squad), yours, 9');
      expect(textTo(sam.user.id)).not.toContain('Congratulations');
      expect(textTo(nora.user.id)).toContain('Congratulations, Nora\'s Squad tied for first in Week 1 Pick\'em with Chalk!');
      expect(textTo(dana.user.id)).toContain('Congratulations, Dana\'s Squad tied for first in Week 1 Pick\'em with Upsets!');
    });

    it('tells only the commissioners and the members with a submitted entry, not a draft, that a season contest whose every event was cancelled ended with no scores', async () => {
      const league = world.addLeague({ leagueCode: 'OFFICE24' });
      const event = world.addSportEvent({ startDate: STARTS_AT, status: SportEventStatus.CANCELLED });
      const later = world.addSportEvent({ startDate: STARTS_AT, status: SportEventStatus.CANCELLED });
      const contest = world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [event.id, later.id] });
      const commissioner = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });
      const entrant = member(league.id, 'Nora');
      const drafting = member(league.id, 'Dana');
      const onlooker = member(league.id, 'Sam');
      for (const [owner, submitted] of [[entrant, true], [drafting, false]] as const) {
        const created = await world.entryRepo().create({ contestId: contest.id, squadId: owner.squad.id, entryNumber: 1, name: 'Entry 1', tiebreakerValue: null });
        if (created.status !== 'created') throw new Error('entry not created');
        if (submitted) await world.entryRepo().setEventStatus(created.entry.id, event.id, ContestEntryStatus.SUBMITTED, new Date());
      }

      await notices().contestSettled(contest);

      expect(recipientIds()).toEqual([commissioner.user.id, entrant.user.id].sort());
      expect(recipientIds()).not.toContain(drafting.user.id);
      expect(recipientIds()).not.toContain(onlooker.user.id);
      const text = textTo(entrant.user.id);
      expect(outbox.rows[0]?.subject).toBe('Masters Pick 6 ended with no scores');
      expect(text).toContain('Every event was cancelled, so Masters Pick 6 ends with no scores.');
      expect(text).toContain(`View contest: https://app.example.test/league/OFFICE24/contests/${contest.id}`);
    });

    it('says only that the contest ended with no scores when some of its events were played', async () => {
      const league = world.addLeague();
      const played = world.addSportEvent({ startDate: STARTS_AT, status: SportEventStatus.COMPLETED });
      const cancelled = world.addSportEvent({ startDate: STARTS_AT, status: SportEventStatus.CANCELLED });
      const contest = world.addContest(league.id, { name: 'Super Bowl Squares', sportEventIds: [played.id, cancelled.id] });
      const commissioner = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });

      await notices().contestSettled(contest);

      expect(textTo(commissioner.user.id)).toContain('Super Bowl Squares has ended with no scores.');
    });

    it('sends nothing, and says why, when the contest\'s league is gone', async () => {
      const event = world.addSportEvent({ startDate: STARTS_AT });
      const contest = world.addContest('no-such-league', { sportEventIds: [event.id] });

      await notices().contestSettled(contest);

      expect(outbox.rows).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'email.contestSettled.skipped' }),
        expect.any(String),
      );
    });
  });

  describe('sportEventChanged (C6, C7)', () => {
    /** An entry of the member's squad in the contest, submitted for the event or left a draft. */
    async function enter(contestId: string, owner: { squad: { id: string } }, sportEventId: string, submitted: boolean) {
      const created = await world.entryRepo().create({ contestId, squadId: owner.squad.id, entryNumber: 1, name: 'Entry 1', tiebreakerValue: null });
      if (created.status !== 'created') throw new Error('entry not created');
      if (submitted) await world.entryRepo().setEventStatus(created.entry.id, sportEventId, ContestEntryStatus.SUBMITTED, new Date());
    }

    it('tells the commissioners and the members with a submitted entry, in each league with an unfinished contest on it, that a cancelled event ends a one-event contest, and sends no no-scores email after', async () => {
      const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
      const masters = world.addSportEvent({ name: 'The Masters', startDate: STARTS_AT, status: SportEventStatus.CANCELLED });
      const contest = world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
      const commissioner = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });
      const entrant = member(league.id, 'Nora');
      const drafting = member(league.id, 'Dana');
      member(league.id, 'Sam');
      await enter(contest.id, entrant, masters.id, true);
      await enter(contest.id, drafting, masters.id, false);
      const elsewhere = world.addLeague();
      world.addContest(elsewhere.id, { sportEventIds: [masters.id] });
      const otherCommissioner = member(elsewhere.id, 'Other', { role: LeagueRole.COMMISSIONER });
      const finished = world.addLeague();
      world.addContest(finished.id, { sportEventIds: [masters.id], status: ContestStatus.COMPLETED });
      member(finished.id, 'Done', { role: LeagueRole.COMMISSIONER });

      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.CANCELLED });
      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.CANCELLED });

      expect(recipientIds()).toEqual([commissioner.user.id, entrant.user.id, otherCommissioner.user.id].sort());
      expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_EVENT_CHANGED')).toBe(true);
      const toNora = outbox.rows.find((row) => row.recipientUserId === entrant.user.id);
      expect(toNora?.fromName).toBe('Office League');
      expect(toNora?.subject).toBe('Cancelled: The Masters');
      expect(textTo(entrant.user.id)).toContain('The Masters has been cancelled, so Masters Pick 6 ends with no scores.');
      expect(textTo(entrant.user.id)).toContain(`View contest: https://app.example.test/league/OFFICE24/contests/${contest.id}`);

      await notices().contestSettled(contest);

      expect(outbox.rows.filter((row) => row.templateKey === 'CONTEST_RESULTS')).toHaveLength(0);
    });

    it('says a cancelled event counts for nothing in a season contest, which goes on with its other events', async () => {
      const league = world.addLeague();
      const masters = world.addSportEvent({ name: 'The Masters', startDate: STARTS_AT, status: SportEventStatus.CANCELLED });
      const open = world.addSportEvent({ name: 'The Open', startDate: STARTS_AT });
      world.addContest(league.id, { name: 'Majors Pool', status: ContestStatus.ACTIVE, sportEventIds: [masters.id, open.id] });
      const commissioner = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });

      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.CANCELLED });

      expect(textTo(commissioner.user.id)).toContain('The Masters has been cancelled. It counts for nothing in Majors Pool, which goes on with its other events.');
    });

    it('tells an open contest a postponed event keeps its picks open, and a live one that it carries on when the event resumes', async () => {
      const masters = world.addSportEvent({ name: 'The Masters', startDate: STARTS_AT, status: SportEventStatus.POSTPONED });
      const openLeague = world.addLeague();
      world.addContest(openLeague.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
      const openCommissioner = member(openLeague.id, 'Casey', { role: LeagueRole.COMMISSIONER });
      const liveLeague = world.addLeague();
      world.addContest(liveLeague.id, { name: 'Masters Live', status: ContestStatus.ACTIVE, sportEventIds: [masters.id] });
      const liveCommissioner = member(liveLeague.id, 'Lee', { role: LeagueRole.COMMISSIONER });

      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.POSTPONED });

      expect(outbox.rows.find((row) => row.recipientUserId === openCommissioner.user.id)?.subject).toBe('Postponed: The Masters');
      expect(textTo(openCommissioner.user.id)).toContain('The Masters has been postponed, with no new date yet.');
      expect(textTo(openCommissioner.user.id)).toContain('Picks for Masters Pick 6 stay open until it starts.');
      expect(textTo(liveCommissioner.user.id)).toContain('Masters Live carries on when it resumes.');
    });

    it('gives the old and new start of a moved event, keeps the picks open, and tells a second move again', async () => {
      const league = world.addLeague();
      const newStart = new Date('2026-04-16T11:40:00.000Z');
      const masters = world.addSportEvent({ name: 'The Masters', startDate: newStart });
      world.addContest(league.id, { name: 'Masters Pick 6', sportEventIds: [masters.id] });
      const commissioner = member(league.id, 'Casey', { role: LeagueRole.COMMISSIONER });

      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.RESCHEDULED, previousStart: STARTS_AT });
      await notices().sportEventChanged(masters, { kind: ContestEventChangeKind.RESCHEDULED, previousStart: STARTS_AT });

      expect(outbox.rows).toHaveLength(1);
      expect(outbox.rows[0]?.subject).toBe('New date: The Masters');
      expect(textTo(commissioner.user.id)).toContain('The Masters has moved from Apr 9, 2026');
      expect(textTo(commissioner.user.id)).toContain('to Apr 16, 2026');
      expect(textTo(commissioner.user.id)).toContain('Picks for Masters Pick 6 stay open until the new start.');

      await notices().sportEventChanged({ ...masters, startDate: new Date('2026-04-23T11:40:00.000Z') }, { kind: ContestEventChangeKind.RESCHEDULED, previousStart: newStart });

      expect(outbox.rows).toHaveLength(2);
      expect(outbox.rows[1]?.textBody).toContain('to Apr 23, 2026');
    });
  });
});
