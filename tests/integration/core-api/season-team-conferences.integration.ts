/**
 * Conferences and divisions (#2052) against real Postgres: the migration's rows for the
 * professional leagues, the database checks that keep a division in its conference and a
 * competition's conference in a POSTSEASON_CONFERENCE phase, and the events sync's write of each
 * team's Season row from the feed's codes. Only the provider is stood in for.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { LeaguePhase, ParticipantType, ProviderCode, ProviderSyncFindingKind, Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import type { ProviderParticipant, SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { writeSeasonTeamConferences } from '../../../packages/core-api/src/modules/ingestion/persistence/season-team-conferences';
import { testDomainEvents } from '../../support/domain-events';
import { linkedProviderEvent } from '../../support/event-edition';
import { syncLeagueTo } from '../../support/league-sync';
import { insertTestSportLeague } from '../../support/test-sport-league';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { expectSameStatementCount } from '../query-scaling';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const NFL_LEAGUE_ID = 'f91f2566-1978-4171-a706-ae417c4d601a';
const NBA_LEAGUE_ID = '09f45f12-11be-43ac-bfa6-70a53f6e0169';

/**
 * A synced football league of the test's own with its BALLDONTLIE mapping: the AFC (East, North)
 * and the NFC (East), coded as the feed codes them, and `teams` teams mapped from feed ids 1 on.
 */
async function conferenceLeague(teams = 2, { codes = true } = {}) {
  const prisma = getPrisma();
  const league = await insertTestSportLeague(prisma, { sport: Sport.FOOTBALL, name: `Conferences ${randomUUID().slice(0, 8)}`, championshipYear: 2026 });
  const { currentSeasonId } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: league.id }, select: { currentSeasonId: true } });
  if (currentSeasonId === null) throw new Error('the test league has no current Season');
  const mappingId = await syncLeagueTo(prisma, league.id, 'nfl');
  const conference = async (code: string, displayOrder: number, divisions: string[]) => {
    const row = await prisma.sportLeagueConference.create({ data: { sportLeagueId: league.id, code, name: `${code} name`, displayOrder } });
    if (codes) await prisma.sportLeagueConferenceProviderMapping.create({ data: { sportLeagueId: league.id, conferenceId: row.id, sportLeagueProviderMappingId: mappingId, providerCode: code } });
    const divisionIds: Record<string, string> = {};
    for (const [index, division] of divisions.entries()) {
      // poolmaster-allow-query-in-loop: three fixture divisions
      const divisionRow = await prisma.sportLeagueConferenceDivision.create({ data: { sportLeagueId: league.id, conferenceId: row.id, code: division, name: `${code} ${division}`, displayOrder: index + 1 } });
      // poolmaster-allow-query-in-loop: three fixture divisions
      if (codes) await prisma.sportLeagueConferenceDivisionProviderMapping.create({ data: { sportLeagueId: league.id, conferenceId: row.id, divisionId: divisionRow.id, sportLeagueProviderMappingId: mappingId, providerCode: division } });
      divisionIds[division] = divisionRow.id;
    }
    return { id: row.id, divisions: divisionIds };
  };
  const afc = await conference('AFC', 1, ['EAST', 'NORTH']);
  const nfc = await conference('NFC', 2, ['EAST']);
  const provider = await prisma.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE }, select: { id: true } });
  const participantIds: string[] = [];
  for (let index = 0; index < teams; index += 1) {
    // poolmaster-allow-query-in-loop: fixture teams
    const team = await prisma.participant.create({ data: { sportLeagueId: league.id, name: `Team ${String(index + 1)}`, participantType: ParticipantType.TEAM } });
    // poolmaster-allow-query-in-loop: fixture teams
    await prisma.participantProviderMapping.create({ data: { participantId: team.id, sportLeagueId: league.id, participantType: ParticipantType.TEAM, providerId: provider.id, externalId: String(index + 1) } });
    participantIds.push(team.id);
  }
  return { sportLeagueId: league.id, seasonId: currentSeasonId, afc, nfc, participantIds };
}

/** A team as the feed sends it, in `conference` and, where given, `division`. */
function feedTeam(externalId: string, conference?: string, division?: string): ProviderParticipant {
  return {
    externalId,
    providerId: 'balldontlie',
    sport: Sport.FOOTBALL,
    name: `Team ${externalId}`,
    status: SportEventParticipantStatus.ACTIVE,
    ...(conference === undefined ? {} : { conference: division === undefined ? { providerCode: conference } : { providerCode: conference, divisionProviderCode: division } }),
    metadata: {},
  };
}

const rowsOf = (sportLeagueSeasonId: string) => getPrisma().sportLeagueSeasonTeamConference.findMany({
  where: { sportLeagueSeasonId },
  select: { participantId: true, conferenceId: true, divisionId: true },
  orderBy: { team: { name: 'asc' } },
});

describe('the migration\'s conferences and divisions', () => {
  it('gives the NFL the AFC and NFC, four divisions each, with BALLDONTLIE\'s codes for them, and the NBA its East and West by the feed\'s words', async () => {
    const prisma = getPrisma();
    const nfl = await prisma.sportLeagueConference.findMany({
      where: { sportLeagueId: NFL_LEAGUE_ID },
      orderBy: { displayOrder: 'asc' },
      select: { code: true, providerCodes: { select: { providerCode: true } }, divisions: { orderBy: { displayOrder: 'asc' }, select: { code: true, providerCodes: { select: { providerCode: true } } } } },
    });
    const nba = await prisma.sportLeagueConference.findMany({ where: { sportLeagueId: NBA_LEAGUE_ID }, orderBy: { displayOrder: 'asc' }, select: { code: true, providerCodes: { select: { providerCode: true } } } });

    const divisions = ['EAST', 'NORTH', 'SOUTH', 'WEST'].map((code) => ({ code, providerCodes: [{ providerCode: code }] }));
    expect(nfl).toEqual([
      { code: 'AFC', providerCodes: [{ providerCode: 'AFC' }], divisions },
      { code: 'NFC', providerCodes: [{ providerCode: 'NFC' }], divisions },
    ]);
    expect(nba).toEqual([{ code: 'EAST', providerCodes: [{ providerCode: 'East' }] }, { code: 'WEST', providerCodes: [{ providerCode: 'West' }] }]);
  });

  it('carries each existing competition\'s phase onto it, so none disagrees with its phase', async () => {
    const competitions = await getPrisma().sportLeagueCompetition.findMany({ select: { leaguePhase: true, phase: { select: { phase: true } } } });

    expect(competitions.length).toBeGreaterThan(0);
    expect(competitions.filter((competition) => competition.leaguePhase !== competition.phase.phase)).toEqual([]);
  });
});

describe('the database checks on conferences', () => {
  it('refuse a team\'s Season row whose division is another conference\'s', async () => {
    const { sportLeagueId, seasonId, afc, nfc, participantIds } = await conferenceLeague(1);

    await expect(getPrisma().sportLeagueSeasonTeamConference.create({ data: {
      sportLeagueId, sportLeagueSeasonId: seasonId, participantId: participantIds[0], conferenceId: nfc.id, divisionId: afc.divisions['NORTH'],
    } })).rejects.toThrow(/sport_league_season_team_conferences_division_fkey/);
  });

  it('refuse a conference on a competition outside a POSTSEASON_CONFERENCE phase, and take one, or none, inside it', async () => {
    const prisma = getPrisma();
    const { sportLeagueId, afc } = await conferenceLeague(0);
    const postseason = await prisma.sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.POSTSEASON, isSynced: true } });
    const conferencePhase = await prisma.sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.POSTSEASON_CONFERENCE, isSynced: true } });
    const competitions = prisma.sportLeagueCompetition;

    await expect(competitions.create({ data: { sportLeagueId, sportLeaguePhaseId: postseason.id, leaguePhase: postseason.phase, code: 'PLAYOFF', orderIndex: 1, conferenceId: afc.id } }))
      .rejects.toThrow(/sport_league_competitions_conference_phase/);
    await expect(competitions.create({ data: { sportLeagueId, sportLeaguePhaseId: conferencePhase.id, leaguePhase: conferencePhase.phase, code: 'AFC_TOURNAMENT', orderIndex: 1, conferenceId: afc.id } }))
      .resolves.toMatchObject({ conferenceId: afc.id });
    await expect(competitions.create({ data: { sportLeagueId, sportLeaguePhaseId: conferencePhase.id, leaguePhase: conferencePhase.phase, code: 'CHAMPIONSHIPS', orderIndex: 2 } }))
      .resolves.toMatchObject({ conferenceId: null });
  });

  it('refuse a competition whose carried phase is not its phase\'s, so the conference check cannot be talked past', async () => {
    const prisma = getPrisma();
    const { sportLeagueId, afc } = await conferenceLeague(0);
    const postseason = await prisma.sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.POSTSEASON, isSynced: true } });

    await expect(prisma.sportLeagueCompetition.create({ data: {
      sportLeagueId, sportLeaguePhaseId: postseason.id, leaguePhase: LeaguePhase.POSTSEASON_CONFERENCE, code: 'PLAYOFF', orderIndex: 1, conferenceId: afc.id,
    } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });
});

describe('the Season\'s team conference write', () => {
  const write = (sportLeagueId: string, sportLeagueSeasonId: string, teams: Array<{ participantId: string; participant: ProviderParticipant }>) =>
    writeSeasonTeamConferences(getAppPrisma(), { sportLeagueId, sportLeagueSeasonId, providerSourceId: 'balldontlie', teams });

  it('writes each team\'s conference and its division within that conference, reading the NFC\'s EAST apart from the AFC\'s', async () => {
    const { sportLeagueId, seasonId, afc, nfc, participantIds: [first, second] } = await conferenceLeague(2);

    const written = await write(sportLeagueId, seasonId, [
      { participantId: first, participant: feedTeam('1', 'AFC', 'NORTH') },
      { participantId: second, participant: feedTeam('2', 'NFC', 'EAST') },
    ]);

    expect(written).toEqual({ created: 2, moved: 0, findings: [] });
    await expect(rowsOf(seasonId)).resolves.toEqual([
      { participantId: first, conferenceId: afc.id, divisionId: afc.divisions['NORTH'] },
      { participantId: second, conferenceId: nfc.id, divisionId: nfc.divisions['EAST'] },
    ]);
  });

  it('leaves a team in a conference code the league has no row for without a row, and raises one CONFERENCE_UNMAPPED for the code', async () => {
    const { sportLeagueId, seasonId, participantIds: [first, second] } = await conferenceLeague(2);

    const written = await write(sportLeagueId, seasonId, [
      { participantId: first, participant: feedTeam('1', 'XFL') },
      { participantId: second, participant: feedTeam('2', 'XFL') },
    ]);

    expect(written.findings).toEqual([expect.objectContaining({ kind: ProviderSyncFindingKind.CONFERENCE_UNMAPPED, sportLeagueId, providerValue: 'XFL', providerValueName: 'Team 1' })]);
    await expect(rowsOf(seasonId)).resolves.toEqual([]);
  });

  it('writes a team in a division code its conference has no row for with its conference alone, and raises DIVISION_UNMAPPED naming the conference', async () => {
    const { sportLeagueId, seasonId, nfc, participantIds: [first] } = await conferenceLeague(1);

    const written = await write(sportLeagueId, seasonId, [{ participantId: first, participant: feedTeam('1', 'NFC', 'NORTH') }]);

    expect(written.findings).toEqual([expect.objectContaining({ kind: ProviderSyncFindingKind.DIVISION_UNMAPPED, providerValue: 'NORTH', providerValueName: 'NFC name' })]);
    await expect(rowsOf(seasonId)).resolves.toEqual([{ participantId: first, conferenceId: nfc.id, divisionId: null }]);
  });

  it('moves a team the feed puts in another conference, leaves an unchanged one and one the feed names no conference for as they were', async () => {
    const { sportLeagueId, seasonId, afc, nfc, participantIds: [first, second] } = await conferenceLeague(2);
    await write(sportLeagueId, seasonId, [
      { participantId: first, participant: feedTeam('1', 'AFC', 'EAST') },
      { participantId: second, participant: feedTeam('2', 'AFC', 'NORTH') },
    ]);

    const written = await write(sportLeagueId, seasonId, [
      { participantId: first, participant: feedTeam('1', 'NFC', 'EAST') },
      { participantId: second, participant: feedTeam('2') },
    ]);

    expect(written).toEqual({ created: 0, moved: 1, findings: [] });
    await expect(rowsOf(seasonId)).resolves.toEqual([
      { participantId: first, conferenceId: nfc.id, divisionId: nfc.divisions['EAST'] },
      { participantId: second, conferenceId: afc.id, divisionId: afc.divisions['NORTH'] },
    ]);
  });

  it('writes nothing and raises nothing for a league whose provider mapping names no conference codes', async () => {
    const { sportLeagueId, seasonId, participantIds: [first] } = await conferenceLeague(1, { codes: false });

    await expect(write(sportLeagueId, seasonId, [{ participantId: first, participant: feedTeam('1', 'AFC', 'EAST') }])).resolves.toEqual({ created: 0, moved: 0, findings: [] });
    await expect(rowsOf(seasonId)).resolves.toEqual([]);
  });

  it('writes a Season\'s first rows in the same statements for 2 teams as for 20', async () => {
    await expectSameStatementCount({
      seed: async (teams) => conferenceLeague(teams),
      call: async ({ sportLeagueId, seasonId, participantIds }) => {
        await write(sportLeagueId, seasonId, participantIds.map((participantId, index) => (
          { participantId, participant: feedTeam(String(index + 1), index % 2 === 0 ? 'AFC' : 'NFC', 'EAST') }
        )));
        return rowsOf(seasonId);
      },
      rowsShown: (rows) => rows.length,
    });
  });
});

describe('a field sync writes its teams\' conferences into the event\'s Season', () => {
  it('writes the feed\'s teams\' rows in the Season of the event it syncs, and raises an unknown code as a finding of the feed\'s provider', async () => {
    const prisma = getPrisma();
    const { sportLeagueId, afc } = await conferenceLeague(0);
    const suffix = randomUUID().slice(0, 8);
    const detail: SportEventDetail = {
      externalId: `conference-event-${suffix}`,
      providerId: 'balldontlie',
      sport: Sport.FOOTBALL,
      name: `Conference Week ${suffix}`,
      startDate: new Date('2026-10-04T17:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerSlots: [],
      participants: [feedTeam(`${suffix}-1`, 'AFC', 'EAST'), feedTeam(`${suffix}-2`, 'UFL')],
    };
    const event = await linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId: detail.externalId, name: detail.name, startDate: detail.startDate, sportLeagueId });
    const findings = { checkEventParticipantsOfSource: jest.fn(async () => undefined), raiseOfSource: jest.fn(async (..._input: unknown[]) => undefined) };

    await new IngestionPersistence(getAppPrisma(), testDomainEvents(), undefined, undefined, undefined, findings).persistEventDetailWithDiagnostics(detail);

    const rows = await prisma.sportLeagueSeasonTeamConference.findMany({ where: { sportLeagueId }, select: { sportLeagueSeasonId: true, conferenceId: true, divisionId: true, team: { select: { name: true } } } });
    expect(rows).toEqual([{ sportLeagueSeasonId: event.sportLeagueSeasonId, conferenceId: afc.id, divisionId: afc.divisions['EAST'], team: { name: `Team ${suffix}-1` } }]);
    expect(findings.raiseOfSource).toHaveBeenCalledWith('balldontlie', [expect.objectContaining({ kind: ProviderSyncFindingKind.CONFERENCE_UNMAPPED, providerValue: 'UFL' })]);
  });
});
