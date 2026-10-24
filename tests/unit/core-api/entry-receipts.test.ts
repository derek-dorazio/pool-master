/**
 * Entry receipts for the formats whose members pick games (#867): a pick'em week, a bracket and a
 * survivor week. The contest world is in memory; the email service is the real one over an
 * in-memory outbox, so the tests assert on the emails recorded.
 */
import {
  ContestEntryStatus,
  PickEmMode,
  SelectionType,
  Sport,
  type ContestEntryMatchPrediction,
  type SportEventMatch,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { EMAIL_SETTINGS, EmailService } from '../../../packages/core-api/src/modules/email';
import { EntryReceipts, type DrawnSquaresBoard } from '../../../packages/core-api/src/modules/notifications';
import type { GamePickGame, GamePickTeam, GamePicksView } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, inMemoryEmailOptOuts, inMemoryEmailSuppressions, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { TEST_UNSUBSCRIBE } from '../../support/email-service';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

const SUBMITTED_AT = new Date('2026-09-10T12:00:00.000Z');
const KICKOFF = new Date('2026-09-13T17:00:00.000Z');

function team(name: string): GamePickTeam {
  return { sportEventParticipantId: `sep-${name}`, participantId: `participant-${name}`, name };
}

/** One game of the view: `away` at `home`, the entry's pick of `picked` (null for a tie pick), unpicked when undefined. */
function game(options: {
  id: string;
  away: string;
  home: string;
  picked?: string | null;
  confidence?: number;
  homeSpread?: number;
  roundNumber?: number;
  matchNumber?: number;
  kickoff?: Date;
  predictedAway?: string;
  predictedHome?: string;
}): GamePickGame {
  const away = team(options.away);
  const home = team(options.home);
  return {
    match: {
      id: options.id,
      homeSportEventParticipantId: home.sportEventParticipantId,
      awaySportEventParticipantId: away.sportEventParticipantId,
      isNeutralSite: false,
      homeSpread: options.homeSpread ?? null,
      roundNumber: options.roundNumber ?? 1,
      matchNumber: options.matchNumber ?? 1,
    } as SportEventMatch,
    kickoff: options.kickoff ?? KICKOFF,
    home,
    away,
    predictedHome: options.predictedHome === undefined ? home : team(options.predictedHome),
    predictedAway: options.predictedAway === undefined ? away : team(options.predictedAway),
    locked: false,
    revealed: true,
    pick: options.picked === undefined
      ? null
      : {
        sportEventMatchId: options.id,
        sportEventParticipantId: options.picked === null ? null : `sep-${options.picked}`,
        confidence: options.confidence ?? null,
      } as ContestEntryMatchPrediction,
    pickScore: null,
  };
}

describe('EntryReceipts', () => {
  let world: InMemoryContestWorld;
  let outbox: InMemoryEmailMessages;
  let roundNames: string[];
  let logger: ReturnType<typeof fakeLogger>;

  beforeEach(() => {
    world = new InMemoryContestWorld();
    outbox = inMemoryEmailMessages();
    roundNames = [];
    logger = fakeLogger();
  });

  function receipts(): EntryReceipts {
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
    return new EntryReceipts({
      contests: world.contestRepo(),
      leagues: world.leagueRepo(),
      entries: world.entryRepo(),
      squadMemberships: world.squadMembershipRepo(),
      users: world.userRepo(),
      sportEvents: world.sportEventRepo(),
      sportLeagues: { findById: async () => ({ roundNames } as unknown as SportLeague) },
      email,
      appBaseUrl: 'https://app.example.test/',
      logger,
    });
  }

  /** A league with a squad of two active owners and a closed account, an entry in a contest on `event`. */
  async function entryIn(selectionType: SelectionType, eventOverrides: Parameters<InMemoryContestWorld['addSportEvent']>[0]) {
    const league = world.addLeague({ name: 'Office League', leagueCode: 'OFFICE24' });
    const event = world.addSportEvent(eventOverrides);
    const contest = world.addContest(league.id, { name: 'Office Pool', selectionType, sportEventIds: [event.id] });
    const squad = world.addSquad(league.id, 'Birdie Brigade');
    const owners = ['Nora', 'Cora'].map((firstName) => {
      const user = world.addUser({ firstName, lastName: 'Owner' });
      world.addMember(league.id, user.id);
      world.addSquadMember(squad.id, user.id);
      return user;
    });
    const closed = world.addUser({ firstName: 'Cal', lastName: 'Closed', isActive: false });
    world.addMember(league.id, closed.id);
    world.addSquadMember(squad.id, closed.id);
    const created = await world.entryRepo().create({ contestId: contest.id, squadId: squad.id, entryNumber: 1, name: 'Entry 1', tiebreakerValue: null }, { entriesPerContest: null });
    if (created.status !== 'created') throw new Error('entry not created');
    return { contest, event, entry: created.entry, owners };
  }

  function view(base: { contestId: string; entryId: string; sportEventId: string }, overrides: Partial<GamePicksView>): GamePicksView {
    return {
      ...base,
      entryName: 'Entry 1',
      selectionType: SelectionType.PICK_EM,
      mode: null,
      againstTheSpread: false,
      tiePicksOffered: false,
      survivor: null,
      status: ContestEntryStatus.SUBMITTED,
      submittedAt: SUBMITTED_AT,
      picksCloseAt: KICKOFF,
      ownEntry: true,
      canSubmit: false,
      pickedCount: 0,
      gameCount: 0,
      tiebreakerMatchId: null,
      tiebreakerValue: null,
      points: null,
      maxPossiblePoints: null,
      games: [],
      ...overrides,
    };
  }

  function textTo(userId: string): string {
    return outbox.rows.find((row) => row.recipientUserId === userId)?.textBody ?? '';
  }

  it('sends each active owner a pick\'em receipt with every pick at its spread and confidence and the tiebreaker in points, from the contest\'s league', async () => {
    const { contest, event, entry, owners } = await entryIn(SelectionType.PICK_EM, { name: 'Week 1', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });

    await receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      mode: PickEmMode.CONFIDENCE,
      againstTheSpread: true,
      tiebreakerMatchId: 'game-1',
      tiebreakerValue: 45,
      games: [
        game({ id: 'game-1', away: 'Bills', home: 'Chiefs', picked: 'Chiefs', confidence: 2, homeSpread: -3.5 }),
        game({ id: 'game-2', away: 'Bears', home: 'Lions', picked: 'Bears', confidence: 1, homeSpread: -7 }),
        game({ id: 'game-3', away: 'Jets', home: 'Giants' }),
      ],
    }));

    expect(outbox.rows.map((row) => row.recipientUserId ?? '').sort((left, right) => left.localeCompare(right)))
      .toEqual(owners.map((owner) => owner.id).sort((left, right) => left.localeCompare(right)));
    expect(outbox.rows.every((row) => row.templateKey === 'CONTEST_ENTRY_COMPLETED' && row.fromName === 'Office League')).toBe(true);
    const text = textTo(owners[0].id);
    expect(text).toContain('Week 1 picks:');
    expect(text).toContain('- Bills at Chiefs: Chiefs -3.5 (2)');
    expect(text).toContain('- Bears at Lions: Bears +7 (1)');
    expect(text).not.toContain('Jets at Giants');
    expect(text).toContain('Tiebreaker: 45 total points (Bills at Chiefs)');
    expect(text).toContain(`Review entry: https://app.example.test/league/OFFICE24/contests/${contest.id}/entries/${entry.id}`);
  });

  it('names a tie pick in the sport\'s word for it: a draw in soccer', async () => {
    const { contest, event, entry, owners } = await entryIn(SelectionType.PICK_EM, { name: 'Matchday 1', sport: Sport.SOCCER, startDate: KICKOFF });

    await receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      tiePicksOffered: true,
      games: [game({ id: 'game-1', away: 'Arsenal', home: 'Chelsea', picked: null })],
    }));

    expect(textTo(owners[0].id)).toContain('- Arsenal at Chelsea: Draw');
  });

  it('sends a second receipt when a week is submitted again, and none twice for the same submission', async () => {
    const { contest, event, entry } = await entryIn(SelectionType.PICK_EM, { name: 'Week 1', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });
    const base = { contestId: contest.id, entryId: entry.id, sportEventId: event.id };
    const games = [game({ id: 'game-1', away: 'Bills', home: 'Chiefs', picked: 'Chiefs' })];

    await receipts().gamePicksSubmitted(view(base, { games }));
    await receipts().gamePicksSubmitted(view(base, { games }));
    await receipts().gamePicksSubmitted(view(base, { games, submittedAt: new Date('2026-09-11T12:00:00.000Z') }));

    expect(outbox.rows).toHaveLength(4);
  });

  it('lists a bracket\'s last three rounds, the final first, in the sport league\'s words, with the teams the entry\'s own picks put there', async () => {
    const { contest, event, entry, owners } = await entryIn(SelectionType.BRACKET, {
      name: 'NCAA Tournament', sport: Sport.BASKETBALL, rounds: 4, startDate: KICKOFF,
    });
    roundNames = ['First Round', 'Elite Eight', 'Final Four', 'Championship'];

    await receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      selectionType: SelectionType.BRACKET,
      picksCloseAt: new Date('2026-03-19T16:15:00.000Z'),
      games: [
        game({ id: 'r1', away: 'Duke', home: 'Vermont', picked: 'Duke', roundNumber: 1, kickoff: new Date('2026-03-19T16:15:00.000Z') }),
        game({ id: 'r2-1', away: 'TBD1', home: 'TBD2', predictedAway: 'Duke', predictedHome: 'Alabama', picked: 'Duke', roundNumber: 2, matchNumber: 1 }),
        game({ id: 'r2-2', away: 'TBD3', home: 'TBD4', predictedAway: 'Houston', predictedHome: 'Purdue', picked: 'Houston', roundNumber: 2, matchNumber: 2 }),
        game({ id: 'r3', away: 'TBD5', home: 'TBD6', predictedAway: 'Duke', predictedHome: 'Houston', picked: 'Duke', roundNumber: 3 }),
        game({ id: 'r4', away: 'TBD7', home: 'TBD8', predictedAway: 'Duke', predictedHome: 'Auburn', picked: 'Duke', roundNumber: 4 }),
      ],
    }));

    const text = textTo(owners[0].id);
    expect(text).toContain('NCAA Tournament bracket:');
    expect(text).toContain('- Championship: Duke');
    expect(text).toContain('- Final Four: Duke');
    expect(text).toContain('- Elite Eight: Duke, Houston');
    expect(text).not.toContain('First Round');
    expect(text.indexOf('Championship')).toBeLessThan(text.indexOf('Elite Eight'));
    expect(text).toContain('You can change your bracket until Mar 19, 2026');
  });

  it('says a second-chance bracket locks at its starting round, not at the event start its untimed later games fall back to', async () => {
    const eventStart = new Date('2026-03-19T16:15:00.000Z');
    const sweetSixteen = new Date('2026-03-26T23:10:00.000Z');
    const { contest, event, entry, owners } = await entryIn(SelectionType.BRACKET, {
      name: 'NCAA Tournament', sport: Sport.BASKETBALL, rounds: 4, startDate: eventStart,
    });
    roundNames = ['Sweet 16', 'Elite Eight', 'Final Four', 'Championship'];

    await receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      selectionType: SelectionType.BRACKET,
      picksCloseAt: sweetSixteen,
      games: [
        game({ id: 's16', away: 'Duke', home: 'Arizona', picked: 'Duke', roundNumber: 1, kickoff: sweetSixteen }),
        // A later game with no time yet reports the event's start as its kickoff.
        game({ id: 'e8', away: 'TBD1', home: 'TBD2', predictedAway: 'Duke', predictedHome: 'Houston', picked: 'Duke', roundNumber: 2, kickoff: eventStart }),
      ],
    }));

    expect(textTo(owners[0].id)).toContain('You can change your bracket until Mar 26, 2026, 11:10 PM UTC.');
  });

  it('sends a survivor receipt with the team, its game and when the pick locks', async () => {
    const { contest, event, entry, owners } = await entryIn(SelectionType.SURVIVOR, { name: 'Week 3', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });

    await receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      selectionType: SelectionType.SURVIVOR,
      games: [
        game({ id: 'game-1', away: 'Bears', home: 'Lions', picked: 'Lions' }),
        game({ id: 'game-2', away: 'Bills', home: 'Chiefs' }),
      ],
    }));

    const text = textTo(owners[0].id);
    expect(text).toContain('Week 3 pick:');
    expect(text).toContain('- Lions: Bears at Lions, Sep 13, 2026');
    expect(text).toContain('You can change your pick until Sep 13, 2026');
    expect(text).not.toContain('Bills at Chiefs');
  });

  it('still sends the other owners their receipt, and resolves, when one owner\'s cannot be queued, so the submit it follows stands', async () => {
    const { contest, event, entry, owners } = await entryIn(SelectionType.PICK_EM, { name: 'Week 1', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });
    const record = outbox.record.bind(outbox);
    outbox.record = async (input) => (input.recipientUserId === owners[0].id ? Promise.reject(new Error('database unavailable')) : record(input));

    await expect(receipts().gamePicksSubmitted(view({ contestId: contest.id, entryId: entry.id, sportEventId: event.id }, {
      games: [game({ id: 'game-1', away: 'Bills', home: 'Chiefs', picked: 'Chiefs' })],
    }))).resolves.toBeUndefined();

    expect(outbox.rows.map((row) => row.recipientUserId)).toEqual([owners[1].id]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.entryReceipt.failed' }),
      'Failed to queue an entry receipt',
    );
  });

  describe('squaresDrawn', () => {
    /** The drawn board: rows take the away team's digits, columns the home team's. */
    function drawnBoard(contestId: string, boxes: Array<{ rowIndex: number; columnIndex: number; contestEntryId: string }>): DrawnSquaresBoard {
      return {
        contest: expectDefinedContest(contestId),
        homeTeamName: 'Chiefs',
        awayTeamName: 'Eagles',
        boxes: boxes.map((box) => ({ ...box, entryName: '' })),
        digits: {
          contestId,
          seed: 'seed',
          rowDigits: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9],
          columnDigits: [7, 1, 2, 3, 4, 5, 6, 0, 8, 9],
          drawnByUserId: null,
          drawnAt: SUBMITTED_AT,
        },
      };
    }

    function expectDefinedContest(contestId: string) {
      const contest = world.contests.get(contestId);
      if (!contest) throw new Error('contest missing');
      return contest;
    }

    it('sends every active owner of each entry with a box its boxes\' numbers by team, once, and nothing to an entry without one', async () => {
      const { contest, entry, owners } = await entryIn(SelectionType.SQUARES, { name: 'Super Bowl', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });
      const empty = await world.entryRepo().create({ contestId: contest.id, squadId: entry.squadId, entryNumber: 2, name: 'Entry 2', tiebreakerValue: null }, { entriesPerContest: null });
      if (empty.status !== 'created') throw new Error('entry not created');
      const board = drawnBoard(contest.id, [
        { rowIndex: 0, columnIndex: 0, contestEntryId: entry.id },
        { rowIndex: 1, columnIndex: 7, contestEntryId: entry.id },
      ]);

      await receipts().squaresDrawn(board);
      await receipts().squaresDrawn(board);

      expect(outbox.rows.map((row) => row.recipientUserId ?? '').sort((left, right) => left.localeCompare(right)))
        .toEqual(owners.map((owner) => owner.id).sort((left, right) => left.localeCompare(right)));
      const text = textTo(owners[0].id);
      expect(outbox.rows[0].subject).toBe('Your numbers: Office Pool');
      expect(text).toContain('- Box 1: Eagles 0, Chiefs 0');
      expect(text).toContain('- Box 2: Eagles 3, Chiefs 7');
      expect(text).toContain(`Review entry: https://app.example.test/league/OFFICE24/contests/${contest.id}/entries/${entry.id}`);
    });

    it('names the row and column sides Away and Home while the game\'s teams are not known', async () => {
      const { contest, entry, owners } = await entryIn(SelectionType.SQUARES, { name: 'Super Bowl', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });
      const board = { ...drawnBoard(contest.id, [{ rowIndex: 0, columnIndex: 0, contestEntryId: entry.id }]), homeTeamName: null, awayTeamName: null };

      await receipts().squaresDrawn(board);

      expect(textTo(owners[0].id)).toContain('- Box 1: Away 3, Home 7');
    });

    it('logs and resolves, sending nothing, when the draw is missing from the board', async () => {
      const { contest, entry } = await entryIn(SelectionType.SQUARES, { name: 'Super Bowl', sport: Sport.AMERICAN_FOOTBALL, startDate: KICKOFF });
      const board = { ...drawnBoard(contest.id, [{ rowIndex: 0, columnIndex: 0, contestEntryId: entry.id }]), digits: null };

      await expect(receipts().squaresDrawn(board)).resolves.toBeUndefined();

      expect(outbox.rows).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'email.entryReceipt.skipped' }), expect.any(String));
    });
  });
});
