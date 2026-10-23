import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  applyEventRaceResults,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  createEvent,
  createParticipant,
  enterContest,
  generateInviteLink,
  getChampionship,
  getCup,
  getCupSquadPoints,
  listChampionshipYears,
  listContestConfigTemplates,
  listCups,
  listEventParticipants,
  listSportLeagues,
  listSports,
  openContest,
  releaseEvent,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, CupContestCount, CupWeight, SelectionType, Sport, championshipYear, findSportRow } from '@poolmaster/shared/domain';
import {
  ChampionshipResponseSchema,
  ChampionshipYearListResponseSchema,
  CupListResponseSchema,
  CupResponseSchema,
  CupSquadPointsResponseSchema,
} from '@poolmaster/shared/dto';
import { buildLeagueWithCommissioner, buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { standardEventPricing } from '../support/budget-pricing';

// A league's 2099 World Marathon Majors (men) Cup end to end (#841): the cup is made with the
// league's first contest of the season, and two races settled through the real routes rank the
// two squads on STANDARD points from their entries' frozen places. The member wins the first race
// and the commissioner the second, so they finish level on points, wins and podiums and share 1st.
// The same settlements write the league championship (#863): its year shares 1st the same way.

const RUN = `cups-${Date.now()}`;
const SEASON = 2099;
const RUNNERS = ['Kiplimo', 'Lemma', 'Kipruto', 'Tola', 'Abdi'];
const COMMISSIONER_LINEUP = ['Kiplimo', 'Lemma', 'Kipruto', 'Tola'];
const MEMBER_LINEUP = ['Kiplimo', 'Lemma', 'Kipruto', 'Abdi'];

const created = { sportEventIds: new Set<string>(), participantIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.contestEntryPick.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
  }
  if (created.participantIds.size) {
    await db.participant.deleteMany({ where: { id: { in: [...created.participantIds] } } });
  }
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: sports league cups and the league championship (#841, #863)', () => {
  it('makes the season\'s cup with its first contest, then ranks squads on STANDARD points from settled races, sharing 1st on a tie and moving the climber, and writes the league championship year alike', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Cup Director' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const sportId = expectDefined(findSportRow(expectDefined((await listSports({ client: a })).data).sports, Sport.RUNNING)).id;
    const majorsMen = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.RUNNING } })).data)
      .sportLeagues.find((league) => league.name === 'World Marathon Majors (men)'));
    const runnerIds: string[] = [];
    for (const runner of RUNNERS) {
      const id = expectDefined((await createParticipant({ client: a, body: { sportId, participantType: 'INDIVIDUAL', name: `${runner} ${RUN}` } })).data).participant.id;
      created.participantIds.add(id);
      runnerIds.push(id);
    }

    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Pacer', leagueName: `Cup Harriers ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Split Timer' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const tieredTemplate = expectDefined(expectDefined((await listContestConfigTemplates({
      client: commissioner.client,
      query: { sport: Sport.RUNNING, sportLeagueId: majorsMen.id, active: true },
    })).data).templates.find((template) => template.templateKey === 'wmm-men-tiered-top-10'));

    /** A released race with the five runners, tiered one to a tier by ranking. */
    const releaseRace = async (name: string, startDate: string) => {
      const eventId = expectDefined((await createEvent({
        client: a,
        body: { sportLeagueId: majorsMen.id, eventYear: SEASON, name: `${name} ${RUN}`, startDate, autoLifecycleEnabled: false },
      })).data).event.id;
      created.sportEventIds.add(eventId);
      await addEventParticipants({ client: a, path: { eventId }, body: { participantIds: runnerIds } });
      await applyEventParticipantUpload({
        client: a,
        path: { eventId },
        body: { rows: RUNNERS.map((runner, index) => ({ playerName: `${runner} ${RUN}`, ranking: index + 1, seedNumber: index + 1 })) },
      });
      await autoAssignEventTiers({ client: a, path: { eventId }, body: { source: 'RANKING', tierSize: 1 } });
      await autoAssignEventPrices({ client: a, path: { eventId }, body: standardEventPricing() });
      expect((await releaseEvent({ client: a, path: { eventId } })).data?.event.status).toBe('SCHEDULED');
      return eventId;
    };

    /** A contest on the race, both squads entered, settled on `finish` (runner to place). */
    const runContest = async (eventId: string, name: string, finish: Record<string, number>) => {
      const contestId = expectDefined((await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: { name, sportEventIds: [eventId], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tieredTemplate.id },
      })).data).contest.id;
      await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
      const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
      const fieldRowOf = (runner: string) => expectDefined(field.find((row) => row.participant.name === `${runner} ${RUN}`)).id;
      for (const [client, lineup] of [[commissioner.client, COMMISSIONER_LINEUP], [member.client, MEMBER_LINEUP]] as const) {
        const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
        for (const runner of lineup) {
          await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(runner) } });
        }
        expect((await submitContestEntry({ client, path: { contestId, entryId, sportEventId: eventId } })).response.status).toBe(200);
      }
      await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } });
      const rows = RUNNERS.map((runner) => ({
        playerName: `${runner} ${RUN}`,
        resultStatus: 'FINISHED' as const,
        finishPosition: expectDefined(finish[runner]),
        startPosition: null,
        riderName: null,
      }));
      expect((await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } })).response.status).toBe(200);
      expect((await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'COMPLETED' } })).data?.event.status).toBe('COMPLETED');
      return contestId;
    };

    // --- The first race: the member's Abdi 3rd beats the commissioner's Tola 4th ---------------
    const harbour = await releaseRace('Harbour Marathon', `${SEASON}-04-19T13:30:00.000Z`);
    const valley = await releaseRace('Valley Marathon', `${SEASON}-10-11T13:30:00.000Z`);
    const harbourContest = await runContest(harbour, `Harbour Picks ${RUN}`, { Kiplimo: 1, Kipruto: 2, Abdi: 3, Tola: 4, Lemma: 5 });

    const afterOne = CupListResponseSchema.parse(expectDefined((await listCups({
      client: member.client,
      path: { id: league.id },
      query: { seasonYear: SEASON },
    })).data));
    expect(afterOne.cups).toHaveLength(1);
    const cupId = expectDefined(afterOne.cups[0]).id;
    expect(afterOne.cups[0]?.name).toBe(`${SEASON} World Marathon Majors (men) Cup`);
    expect(afterOne.cups[0]?.standings.map((row) => [row.displayPosition, row.points, row.wins, row.movement])).toEqual([
      ['1', 1000, 1, null],
      ['2', 800, 0, null],
    ]);
    const memberSquadId = expectDefined(afterOne.cups[0]?.standings[0]).squadId;

    // --- The second race goes the other way: level on everything, so they share 1st -----------
    const valleyContest = await runContest(valley, `Valley Picks ${RUN}`, { Kiplimo: 1, Kipruto: 2, Tola: 3, Abdi: 4, Lemma: 5 });

    const cup = CupResponseSchema.parse(expectDefined((await getCup({ client: member.client, path: { id: league.id, cupId } })).data)).cup;
    expect(cup.standings.map((row) => [row.displayPosition, row.points, row.wins, row.podiums, row.contestsCounted])).toEqual([
      ['T1', 1800, 1, 2, 2],
      ['T1', 1800, 1, 2, 2],
    ]);
    // The commissioner's squad climbed from 2nd to T1; the member's held 1st.
    expect(Object.fromEntries(cup.standings.map((row) => [row.squadId === memberSquadId ? 'member' : 'commissioner', row.movement])))
      .toEqual({ member: 0, commissioner: 1 });
    expect(cup.contests.map((row) => [row.contestId, row.count, row.cupWeight, row.winners.length])).toEqual([
      [harbourContest, CupContestCount.COUNTED, CupWeight.NORMAL, 1],
      [valleyContest, CupContestCount.COUNTED, CupWeight.NORMAL, 1],
    ]);

    const breakdown = CupSquadPointsResponseSchema.parse(expectDefined((await getCupSquadPoints({
      client: commissioner.client,
      path: { id: league.id, cupId, squadId: memberSquadId },
    })).data)).squadPoints;
    expect(breakdown.points).toBe(1800);
    expect(breakdown.contests.map((row) => [row.contestId, row.displayPlace, row.points])).toEqual([
      [harbourContest, '1', 1000],
      [valleyContest, '2', 800],
    ]);

    // --- The league championship: both races went final this year (an event completed by hand ends
    // when it is completed), so the year is level the same way ---
    const year = championshipYear(new Date());
    const championship = ChampionshipResponseSchema.parse(expectDefined((await getChampionship({
      client: member.client,
      path: { id: league.id, year },
    })).data)).championship;
    expect(championship).toMatchObject({ year, cupName: `Cup Harriers ${RUN} Cup`, name: `${year} Cup Harriers ${RUN} Cup`, isOver: false, contestsCounted: 2, contestsToGo: 0 });
    expect(championship.standings.map((row) => [row.displayPosition, row.points, row.finishes.slice(0, 2), row.played])).toEqual([
      ['T1', 1800, [1, 1], 2],
      ['T1', 1800, [1, 1], 2],
    ]);
    const years = ChampionshipYearListResponseSchema.parse(expectDefined((await listChampionshipYears({
      client: commissioner.client,
      path: { id: league.id },
    })).data)).years;
    expect(years.map((row) => [row.year, row.isOver, row.leaders.length])).toEqual([[year, false, 2]]);
  });
});
