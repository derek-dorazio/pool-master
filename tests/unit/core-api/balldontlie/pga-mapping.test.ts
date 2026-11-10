import { ParticipantRoundStatus, Sport } from '../../../../packages/shared/domain';
import { BalldontlieContractError } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import {
  pgaTournamentCompetitorListSchema,
  pgaTournamentListSchema,
  pgaTournamentResultListSchema,
  type PgaTournament,
  type PgaTournamentResult,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/pga-contract';
import {
  fieldPlayerIds,
  isClassifiedTournament,
  requireStrokePlay,
  toFieldParticipants,
  toGolfRoundUpdates,
  toSportEvent,
  toTourParticipant,
  UnsupportedPgaFormatError,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/pga-mapping';
import { expectDefined } from '../../../support/expect-defined';
import { readBalldontlieFixture } from '../../../support/balldontlie-vendor-spec';

const tournaments = pgaTournamentListSchema.parse(readBalldontlieFixture('pga', 'tournaments-2026.json')).data;
const tournament = (id: number): PgaTournament => expectDefined(tournaments.find((entry) => entry.id === id));
const wyndham = tournament(40);
const bmw = tournament(41);
const liveResults = pgaTournamentResultListSchema.parse(readBalldontlieFixture('pga', 'tournament-results-41-live.json')).data;
const finalResults = pgaTournamentResultListSchema.parse(readBalldontlieFixture('pga', 'tournament-results-40-final.json')).data;
const resultFor = (results: PgaTournamentResult[], playerId: number) =>
  expectDefined(results.find((result) => result.competitor.player?.id === playerId));

describe('BALLDONTLIE PGA tournament to sport event', () => {
  it('maps a final tournament with its course, place, dates, rounds and PGA TOUR tour name', () => {
    expect(toSportEvent(wyndham, 156)).toEqual({
      externalId: '40',
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: 'Wyndham Championship',
      venue: 'Sedgefield Country Club',
      location: 'Greensboro, North Carolina, United States of America',
      startDate: new Date('2026-08-06T00:00:00.000Z'),
      endDate: new Date('2026-08-09T00:00:00.000Z'),
      status: 'COMPLETED',
      rounds: 4,
      participantCount: 156,
      fieldLocked: true,
      metadata: { tour: 'PGA TOUR', season: 2026, formatType: 'STROKE_PLAY' },
    });
  });

  it('leaves the round count, end date, venue and place unset when the vendor has none yet, and keeps a scheduled field open', () => {
    const bare: PgaTournament = { ...tournament(42), rounds: [], end_date: null, course_name: null, city: null, state: null, country: null };
    const event = toSportEvent(bare);
    expect(event).toMatchObject({ status: 'SCHEDULED', fieldLocked: false });
    expect(event.rounds).toBeUndefined();
    expect(event.endDate).toBeUndefined();
    expect(event.venue).toBeUndefined();
    expect(event.location).toBeUndefined();
    expect(event.participantCount).toBeUndefined();
  });

  it.each([
    ['scheduled', 'SCHEDULED'],
    ['in_progress', 'IN_PROGRESS'],
    ['delayed', 'IN_PROGRESS'],
    ['suspended', 'IN_PROGRESS'],
    ['final', 'COMPLETED'],
    ['postponed', 'POSTPONED'],
    ['canceled', 'CANCELLED'],
    ['abandoned', 'CANCELLED'],
  ] as const)('maps lifecycle state %s to event status %s', (state, status) => {
    expect(toSportEvent({ ...bmw, status_state: state }).status).toBe(status);
  });

  it('refuses a tournament whose lifecycle the vendor marks unknown rather than inventing a status', () => {
    const unknown = tournament(43);
    expect(isClassifiedTournament(unknown)).toBe(false);
    expect(isClassifiedTournament(bmw)).toBe(true);
    expect(() => toSportEvent(unknown)).toThrow(BalldontlieContractError);
  });

  it('accepts only individual stroke play for scoring and names the format it refused', () => {
    expect(() => requireStrokePlay(bmw)).not.toThrow();
    expect(() => requireStrokePlay(tournament(44))).toThrow(new UnsupportedPgaFormatError(44, 'TEAM_STROKE'));
    expect(() => requireStrokePlay({ ...bmw, format_type: null })).toThrow('BALLDONTLIE tournament 41 is of no stated format; only STROKE_PLAY tournaments can be scored.');
  });
});

describe('BALLDONTLIE PGA field to participants', () => {
  const competitors = pgaTournamentCompetitorListSchema.parse(readBalldontlieFixture('pga', 'tournament-competitors-41.json')).data;

  it('makes one active golfer per PLAYER competitor, keyed by the vendor player id, with the world ranking given', () => {
    const rankings = new Map<number, number | null>([[185, 1], [75, 9], [10, null]]);
    const participants = toFieldParticipants(competitors, rankings);

    expect(participants.map((participant) => [participant.externalId, participant.ranking])).toEqual([
      ['10', undefined],
      ['75', 9],
      ['185', 1],
      ['3', undefined],
    ]);
    expect(participants[2]).toEqual({
      externalId: '185',
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: 'Scottie Scheffler',
      firstName: 'Scottie',
      lastName: 'Scheffler',
      nationality: 'USA',
      active: true,
      ranking: 1,
      metadata: { competitorId: 5103 },
    });
  });

  it('leaves pairings, teams and cup teams out of a field and out of the ranking lookup', () => {
    const pairing = pgaTournamentCompetitorListSchema.parse(readBalldontlieFixture('pga', 'doc-example-tournament-competitors.json')).data;
    expect(toFieldParticipants(pairing, new Map())).toEqual([]);
    expect(fieldPlayerIds(pairing)).toEqual([]);
    expect(fieldPlayerIds(competitors)).toEqual([10, 75, 185, 3]);
  });

  it('refuses a PLAYER competitor that carries no player', () => {
    const broken = [{ ...competitors[0], player: null }];
    expect(() => toFieldParticipants(broken, new Map())).toThrow('competitor 5101 is a PLAYER with no player');
    expect(() => fieldPlayerIds(broken)).toThrow(BalldontlieContractError);
  });

  it('leaves names and nationality unset where the vendor has none', () => {
    const [first] = competitors;
    const anonymous = [{ ...first, player: { ...expectDefined(first.player), first_name: null, last_name: null, country_code: null } }];
    const [participant] = toFieldParticipants(anonymous, new Map());
    expect(participant.firstName).toBeUndefined();
    expect(participant.lastName).toBeUndefined();
    expect(participant.nationality).toBeUndefined();
  });

  it('maps a tour golfer with whether they are active and their world ranking', () => {
    const player = { id: 901, first_name: 'Retired', last_name: 'Golfer', display_name: 'Retired Golfer', country: null, country_code: null, owgr: null, active: false };
    expect(toTourParticipant(player)).toMatchObject({ externalId: '901', name: 'Retired Golfer', active: false, ranking: undefined, metadata: {} });
    expect(toTourParticipant({ ...player, owgr: 12, active: true })).toMatchObject({ active: true, ranking: 12 });
  });
});

describe('BALLDONTLIE PGA results to golf round updates', () => {
  it('marks rounds before the current one COMPLETED and the current one IN_PROGRESS with the holes played', () => {
    const updates = toGolfRoundUpdates(bmw, [resultFor(liveResults, 185)]);
    expect(updates).toEqual([
      { participantExternalId: '185', round: 1, strokes: 65, scoreToPar: -5, status: ParticipantRoundStatus.COMPLETED },
      { participantExternalId: '185', round: 2, strokes: 66, scoreToPar: -4, status: ParticipantRoundStatus.COMPLETED },
      { participantExternalId: '185', round: 3, strokes: 67, scoreToPar: -3, status: ParticipantRoundStatus.IN_PROGRESS, thru: 12 },
    ]);
  });

  it('reads thru "F" as the current round finished', () => {
    const updates = toGolfRoundUpdates(bmw, [resultFor(liveResults, 75)]);
    expect(updates.at(-1)).toEqual({ participantExternalId: '75', round: 3, strokes: 67, scoreToPar: -3, status: ParticipantRoundStatus.COMPLETED });
  });

  it('reads a back-nine start ("4*") as four holes played, keeping a par-relative score that has no strokes yet', () => {
    const updates = toGolfRoundUpdates(bmw, [resultFor(liveResults, 3)]);
    expect(updates.at(-1)).toEqual({ participantExternalId: '3', round: 3, strokes: null, scoreToPar: 0, status: ParticipantRoundStatus.IN_PROGRESS, thru: 4 });
  });

  it('reads thru 18 as the round finished, and a missing thru as the round under way', () => {
    const scheffler = resultFor(liveResults, 185);
    expect(toGolfRoundUpdates(bmw, [{ ...scheffler, thru: '18' }]).at(-1)?.status).toBe(ParticipantRoundStatus.COMPLETED);
    const noThru = toGolfRoundUpdates(bmw, [{ ...scheffler, thru: null }]).at(-1);
    expect(noThru).toEqual({ participantExternalId: '185', round: 3, strokes: 67, scoreToPar: -3, status: ParticipantRoundStatus.IN_PROGRESS });
  });

  it('marks a golfer who missed the cut on their last played round and sends no unplayed rounds', () => {
    expect(toGolfRoundUpdates(bmw, [resultFor(liveResults, 10)])).toEqual([
      { participantExternalId: '10', round: 1, strokes: 74, scoreToPar: 4, status: ParticipantRoundStatus.COMPLETED },
      { participantExternalId: '10', round: 2, strokes: 73, scoreToPar: 3, status: ParticipantRoundStatus.MISSED_CUT },
    ]);
  });

  it('marks a withdrawal DNF and a disqualification DSQ on the last played round', () => {
    const henley = resultFor(finalResults, 75);
    expect(toGolfRoundUpdates(wyndham, [henley]).map((update) => update.status)).toEqual([
      ParticipantRoundStatus.COMPLETED,
      ParticipantRoundStatus.DNF,
    ]);
    expect(toGolfRoundUpdates(wyndham, [{ ...henley, position: 'DQ' }]).at(-1)?.status).toBe(ParticipantRoundStatus.DSQ);
  });

  it('marks every round COMPLETED once the tournament is final', () => {
    const updates = toGolfRoundUpdates(wyndham, [resultFor(finalResults, 10)]);
    expect(updates.map((update) => [update.round, update.status, update.strokes, update.scoreToPar])).toEqual([
      [1, ParticipantRoundStatus.COMPLETED, 64, -6],
      [2, ParticipantRoundStatus.COMPLETED, 66, -4],
      [3, ParticipantRoundStatus.COMPLETED, 67, -3],
      [4, ParticipantRoundStatus.COMPLETED, 67, -3],
    ]);
  });

  it('works a round\'s score to par out from the course par when the vendor leaves it null', () => {
    const scheffler = resultFor(liveResults, 185);
    const noRelative = { ...scheffler, rounds: scheffler.rounds.map((round) => ({ ...round, par_relative_score: null })) };
    expect(toGolfRoundUpdates(bmw, [noRelative]).map((update) => update.scoreToPar)).toEqual([-5, -4, -3]);
  });

  it('refuses a round with no score to par when no single course par can give one', () => {
    const scheffler = resultFor(liveResults, 185);
    const noRelative = { ...scheffler, rounds: scheffler.rounds.slice(0, 1).map((round) => ({ ...round, par_relative_score: null })) };
    const twoCourses: PgaTournament = { ...bmw, courses: [...bmw.courses, ...bmw.courses] };
    expect(() => toGolfRoundUpdates(twoCourses, [noRelative])).toThrow('round 1 has no par_relative_score and no single course par to work it out from');
    const noPar: PgaTournament = { ...bmw, courses: [{ ...bmw.courses[0], course: { par: null } }] };
    expect(() => toGolfRoundUpdates(noPar, [noRelative])).toThrow(BalldontlieContractError);
  });

  it('refuses a thru value that is neither "F" nor a hole count, and one past 18 holes', () => {
    const scheffler = resultFor(liveResults, 185);
    expect(() => toGolfRoundUpdates(bmw, [{ ...scheffler, thru: 'TEE 10:40' }])).toThrow('thru "TEE 10:40" is neither "F" nor a hole count');
    expect(() => toGolfRoundUpdates(bmw, [{ ...scheffler, thru: '19' }])).toThrow('thru "19" is more than 18 holes');
  });

  it('refuses a score for a round after the golfer\'s current round', () => {
    const scheffler = resultFor(liveResults, 185);
    expect(() => toGolfRoundUpdates(bmw, [{ ...scheffler, current_round: 2 }])).toThrow('has a score for round 3, after their current round 2');
  });

  it('refuses a non-PLAYER row and a PLAYER row with no player in stroke-play results', () => {
    const teamRows = pgaTournamentResultListSchema.parse(readBalldontlieFixture('pga', 'doc-example-tournament-results.json')).data;
    expect(() => toGolfRoundUpdates(bmw, teamRows)).toThrow('a STROKE_PLAY result has a TEAM competitor (62906)');
    const scheffler = resultFor(liveResults, 185);
    expect(() => toGolfRoundUpdates(bmw, [{ ...scheffler, competitor: { ...scheffler.competitor, player: null } }]))
      .toThrow('is a PLAYER with no player');
  });

  it('maps a whole live leaderboard in result order, ignoring rounds not yet started', () => {
    const updates = toGolfRoundUpdates(bmw, liveResults);
    expect(updates).toHaveLength(3 + 3 + 3 + 2);
    expect(new Set(updates.map((update) => update.participantExternalId))).toEqual(new Set(['185', '75', '3', '10']));
  });
});
