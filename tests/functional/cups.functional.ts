import {
  acceptInvitation,
  addEventParticipants,
  applyEventParticipantUpload,
  applyEventRaceResults,
  autoAssignEventPrices,
  autoAssignEventTiers,
  createContest,
  crownCup,
  createEvent,
  createParticipant,
  enterContest,
  generateInviteLink,
  getChampionship,
  getCup,
  getCupProjection,
  getCupSquadPoints,
  listChampionshipYears,
  listContestConfigTemplates,
  listCups,
  listEventParticipants,
  listSportLeagues,
  listSports,
  openContest,
  releaseEvent,
  setContestCupWeight,
  submitContestEntry,
  submitContestSelection,
  transitionEvent,
  updateLeagueCupSettings,
} from '@poolmaster/shared/generated/hey-api';
import { ContestFormat, CupContestCount, CupPointsScale, CupStatus, CupTrophy, CupWeight, SelectionType, Sport, championshipYear, findSportRow } from '@poolmaster/shared/domain';
import {
  ChampionshipResponseSchema,
  ContestManagementResponseSchema,
  ChampionshipYearListResponseSchema,
  CupListResponseSchema,
  CupProjectionResponseSchema,
  CupResponseSchema,
  CupSquadPointsResponseSchema,
  LeagueResponseSchema,
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
// Then the commissioner's settings (#841 slice 3): a third race's open contest is set to count
// double, the settled ones refuse a new weight, and a custom points table rescores the cup at
// once while the championship keeps the points its contests earned when they settled. Then
// the third race goes live and the cup's projection (#841 slice 5) counts it as if it ended now.
// Last, crowning (#841 slice 4): refused while a counted contest is live, then the cup is crowned
// with both squads sharing the trophy, has no projection, and keeps its points when the table
// changes again.

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
  it('makes the season\'s cup with its first contest, then ranks squads on STANDARD points from settled races, sharing 1st on a tie and moving the climber, and writes the league championship year alike; a new points table rescores the cup but not the settled championship', async () => {
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

    /** Both squads' entries in an open contest on the race, submitted. */
    const enterSquads = async (eventId: string, contestId: string) => {
      const field = expectDefined((await listEventParticipants({ client: a, path: { eventId } })).data).participants;
      const fieldRowOf = (runner: string) => expectDefined(field.find((row) => row.participant.name === `${runner} ${RUN}`)).id;
      for (const [client, lineup] of [[commissioner.client, COMMISSIONER_LINEUP], [member.client, MEMBER_LINEUP]] as const) {
        const entryId = expectDefined((await enterContest({ client, path: { contestId } })).data).entry.id;
        for (const runner of lineup) {
          await submitContestSelection({ client, path: { contestId }, body: { entryId, participantId: fieldRowOf(runner) } });
        }
        expect((await submitContestEntry({ client, path: { contestId, entryId, sportEventId: eventId } })).response.status).toBe(200);
      }
    };

    /** The race's official result: `finish` is runner to place. */
    const applyResults = async (eventId: string, finish: Record<string, number>) => {
      const rows = RUNNERS.map((runner) => ({
        playerName: `${runner} ${RUN}`,
        resultStatus: 'FINISHED' as const,
        finishPosition: expectDefined(finish[runner]),
        startPosition: null,
        riderName: null,
      }));
      expect((await applyEventRaceResults({ client: a, path: { eventId }, body: { isOfficial: true, rows } })).response.status).toBe(200);
    };

    /** A contest on the race, both squads entered, settled on `finish` (runner to place). */
    const runContest = async (eventId: string, name: string, finish: Record<string, number>) => {
      const contestId = expectDefined((await createContest({
        client: commissioner.client,
        path: { id: league.id },
        body: { name, sportEventIds: [eventId], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tieredTemplate.id },
      })).data).contest.id;
      await openContest({ client: commissioner.client, path: { id: league.id, contestId } });
      await enterSquads(eventId, contestId);
      await transitionEvent({ client: a, path: { eventId }, body: { toStatus: 'IN_PROGRESS' } });
      await applyResults(eventId, finish);
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
    // The race chart's lines: each squad's running total after each counted contest.
    expect(Object.fromEntries(cup.standings.map((row) => [row.squadId === memberSquadId ? 'member' : 'commissioner', row.pointsAfter])))
      .toEqual({ member: [1000, 1800], commissioner: [800, 1800] });
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

    // --- Cup weight: an open contest takes one; a final contest refuses it -------------------
    const coast = await releaseRace('Coast Marathon', `${SEASON}-11-01T13:30:00.000Z`);
    const coastContest = expectDefined((await createContest({
      client: commissioner.client,
      path: { id: league.id },
      body: { name: `Coast Picks ${RUN}`, sportEventIds: [coast], contestFormat: ContestFormat.ROSTER, selectionType: SelectionType.TIERED, templateId: tieredTemplate.id },
    })).data).contest.id;
    await openContest({ client: commissioner.client, path: { id: league.id, contestId: coastContest } });
    const doubled = await setContestCupWeight({
      client: commissioner.client,
      path: { id: league.id, contestId: coastContest },
      body: { cupWeight: CupWeight.DOUBLE },
    });
    expect(ContestManagementResponseSchema.parse(expectDefined(doubled.data)).contest.cupWeight).toBe(CupWeight.DOUBLE);
    const settledWeight = await setContestCupWeight({
      client: commissioner.client,
      path: { id: league.id, contestId: harbourContest },
      body: { cupWeight: CupWeight.NOT_COUNTED },
    });
    expect(settledWeight.response.status).toBe(409);
    expect(settledWeight.error?.error.code).toBe('CONTEST_FINAL');
    const memberWeight = await setContestCupWeight({
      client: member.client,
      path: { id: league.id, contestId: coastContest },
      body: { cupWeight: CupWeight.NORMAL },
    });
    expect(memberWeight.response.status).toBe(403);

    // --- Points table: CUSTOM 10 for 1st, 5 for 2nd; each squad has one of each -------------
    const custom = await updateLeagueCupSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { cupName: '  Harriers Shield  ', cupPointsScale: CupPointsScale.CUSTOM, cupCustomPoints: [10, 5] },
    });
    expect(LeagueResponseSchema.parse(expectDefined(custom.data)).league).toMatchObject({
      cupName: 'Harriers Shield',
      cupPointsScale: CupPointsScale.CUSTOM,
      cupCustomPoints: [10, 5],
    });
    const rescored = CupResponseSchema.parse(expectDefined((await getCup({ client: member.client, path: { id: league.id, cupId } })).data)).cup;
    expect(rescored.standings.map((row) => [row.displayPosition, row.points])).toEqual([['T1', 150], ['T1', 150]]);
    expect(rescored.contests.find((row) => row.contestId === coastContest)).toMatchObject({ count: CupContestCount.NOT_FINAL, cupWeight: CupWeight.DOUBLE });
    const keptChampionship = ChampionshipResponseSchema.parse(expectDefined((await getChampionship({
      client: member.client,
      path: { id: league.id, year },
    })).data)).championship;
    expect(keptChampionship.cupName).toBe('Harriers Shield');
    expect(keptChampionship.standings.map((row) => row.points)).toEqual([1800, 1800]);

    // --- Projected points: the Coast race's result is in with the member's Abdi in front, but
    // the race is still in progress, so its x2 contest is live. The projection counts it as if it
    // ended now: 20 more for the member, 10 for the
    // commissioner, who drops from T1 to 2nd ---
    await enterSquads(coast, coastContest);
    await transitionEvent({ client: a, path: { eventId: coast }, body: { toStatus: 'IN_PROGRESS' } });
    await applyResults(coast, { Abdi: 1, Kiplimo: 2, Kipruto: 3, Lemma: 4, Tola: 5 });
    const projection = CupProjectionResponseSchema.parse(expectDefined((await getCupProjection({
      client: member.client,
      path: { id: league.id, cupId },
    })).data)).projection;
    expect(projection.contests).toEqual([{ contestId: coastContest, name: `Coast Picks ${RUN}`, cupWeight: CupWeight.DOUBLE }]);
    expect(projection.standings.map((row) => [row.squadId === memberSquadId ? 'member' : 'commissioner', row.displayPosition, row.points, row.gained, row.movement])).toEqual([
      ['member', '1', 350, 200, 0],
      ['commissioner', '2', 250, 100, -1],
    ]);

    // --- Crowning: only the commissioner, and not while the counted Coast contest is live ------
    const crown = (client: typeof member.client) => crownCup({ client, path: { id: league.id, cupId } });
    expect((await crown(member.client)).response.status).toBe(403);
    const early = await crown(commissioner.client);
    expect(early.response.status).toBe(409);
    expect(early.error?.error).toMatchObject({
      code: 'CUP_HAS_UNFINISHED_CONTESTS',
      details: { contests: [{ contestId: coastContest, name: `Coast Picks ${RUN}`, status: 'ACTIVE' }] },
    });
    await setContestCupWeight({ client: commissioner.client, path: { id: league.id, contestId: coastContest }, body: { cupWeight: CupWeight.NOT_COUNTED } });

    const crowned = CupResponseSchema.parse(expectDefined((await crown(commissioner.client)).data)).cup;
    expect(crowned.status).toBe(CupStatus.CROWNED);
    expect(crowned.crownedAt).not.toBeNull();
    expect(crowned.standings.map((row) => [row.displayPosition, row.points, row.trophy, row.movement])).toEqual([
      ['T1', 150, CupTrophy.CHAMPION, null],
      ['T1', 150, CupTrophy.CHAMPION, null],
    ]);
    const twice = await crown(commissioner.client);
    expect(twice.response.status).toBe(409);
    expect(twice.error?.error.code).toBe('CUP_CROWNED');
    // A crowned cup's standings are final, so it has no projection.
    const crownedProjection = await getCupProjection({ client: member.client, path: { id: league.id, cupId } });
    expect(crownedProjection.response.status).toBe(409);
    expect(crownedProjection.error?.error.code).toBe('CUP_CROWNED');

    // A crowned cup keeps the points it was crowned with.
    await updateLeagueCupSettings({
      client: commissioner.client,
      path: { id: league.id },
      body: { cupName: 'Harriers Shield', cupPointsScale: CupPointsScale.STANDARD, cupCustomPoints: [] },
    });
    const kept = CupResponseSchema.parse(expectDefined((await getCup({ client: member.client, path: { id: league.id, cupId } })).data)).cup;
    expect(Object.fromEntries(kept.standings.map((row) => [row.squadId === memberSquadId ? 'member' : 'commissioner', [row.points, row.pointsAfter, row.trophy]])))
      .toEqual({ member: [150, [100, 150], CupTrophy.CHAMPION], commissioner: [150, [50, 150], CupTrophy.CHAMPION] });
  });

  it('refuses championship settings from a member with 403, and a custom table without points or past 50 places with 400', async () => {
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Steward', leagueName: `Cup Rules ${RUN}` });
    const member = await buildRegisteredUser({ displayName: 'Bystander' });
    const invite = await generateInviteLink({ client: commissioner.client, path: { id: league.id }, body: { maxUses: 1 } });
    await acceptInvitation({ client: member.client, body: { inviteCode: expectDefined(invite.data).invitation.inviteCode } });
    const update = (client: typeof member.client, cupPointsScale: CupPointsScale, cupCustomPoints: number[]) =>
      updateLeagueCupSettings({ client, path: { id: league.id }, body: { cupName: 'Rules Cup', cupPointsScale, cupCustomPoints } });

    expect((await update(member.client, CupPointsScale.TOP_TEN, [])).response.status).toBe(403);
    const empty = await update(commissioner.client, CupPointsScale.CUSTOM, []);
    expect(empty.response.status).toBe(400);
    expect(empty.error?.error.code).toBe('CUP_CUSTOM_POINTS_INVALID');
    const tooLong = await update(commissioner.client, CupPointsScale.CUSTOM, Array.from({ length: 51 }, () => 1));
    expect(tooLong.response.status).toBe(400);
    const stored = await update(commissioner.client, CupPointsScale.TOP_TEN, []);
    expect(LeagueResponseSchema.parse(expectDefined(stored.data)).league).toMatchObject({ cupName: 'Rules Cup', cupPointsScale: CupPointsScale.TOP_TEN });
  });
});
