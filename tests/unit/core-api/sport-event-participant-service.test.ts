import { expect, jest } from '@jest/globals';
import { MatchEnding, MatchStatus, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { SportEventParticipantService } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { standardEventPricing } from '../../support/budget-pricing';

// The field's rules against an in-memory store: the one read every field screen uses,
// seeding from the sport league, adding anyone, the all-or-none grid save, and removal.

function setup(sportName: Sport = Sport.GOLF, status: SportEventStatus = SportEventStatus.DRAFT) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  // A draft, so its prices are still editable (#431); pass a released status to lock them.
  const event = store.addEvent({ sportLeagueId: sportLeague.id, sport: sportName, status });
  const service = new SportEventParticipantService({
    sportEvents: store.sportEventRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    affiliations: store.affiliationRepo(),
    valuations: store.valuationRepo(),
    standings: store.standingRepo(),
    participantRounds: store.participantRoundRepo(),
    golfStandings: store.golfStandingRepo(),
    golfRounds: store.golfRoundRepo(),
    raceResults: store.raceResultRepo(),
    matches: store.matchRepo(),
    random: () => 0.5,
  });
  return { store, service, sport, sportLeague, event };
}

describe('SportEventParticipantService.listEventParticipants', () => {
  it('returns each field row with its participant, valuation, standing and rounds, each carrying its golf extension', async () => {
    const { store, service, sport, event } = setup();
    const golfer = store.addParticipant(sport.id, 'Ana');
    const entry = store.addToField(event.id, golfer.id, { seedNumber: 1 });
    const [round] = await (async () => { await store.roundRepo().createMany(event.id, [{ roundNumber: 1, scheduledDate: new Date() }]); return store.roundRows; })();
    await store.golfRoundRepo().upsert({ sportEventParticipantId: entry.id, sportEventRoundId: round.id, status: 'COMPLETED', completedAt: null, strokes: 70, scoreToPar: -2, thru: 18 });
    await store.golfStandingRepo().upsert({ sportEventParticipantId: entry.id, currentRound: 1, status: 'COMPLETE', asOf: new Date(), eventScoreToPar: -2, eventStrokes: 70, currentRoundThru: 18 });
    await store.valuationRepo().assignEventPrices({
      sportEventId: event.id,
      pricingConfig: standardEventPricing(),
      assignments: [{ sportEventParticipantId: entry.id, price: 9, source: 'MANUAL' }],
    });

    const [view] = await service.listEventParticipants(event.id);

    expect(view.participant.name).toBe('Ana');
    expect(view.valuation).toMatchObject({ price: 9 });
    expect(view.standing?.golf).toMatchObject({ eventScoreToPar: -2 });
    expect(view.rounds).toEqual([expect.objectContaining({ round: expect.objectContaining({ roundNumber: 1 }), golf: expect.objectContaining({ strokes: 70 }) })]);
  });

  it('flags a participant affiliated with the event\'s sport league, and one invited from elsewhere', async () => {
    const { store, service, sport, sportLeague, event } = setup();
    const member = store.addParticipant(sport.id, 'Member');
    const guest = store.addParticipant(sport.id, 'Guest');
    store.affiliate(sportLeague.id, member.id);
    store.addToField(event.id, member.id, { seedNumber: 1 });
    store.addToField(event.id, guest.id, { seedNumber: 2 });

    const views = await service.listEventParticipants(event.id);

    expect(views.map((view) => [view.participant.name, view.affiliatedWithSportLeague])).toEqual([['Member', true], ['Guest', false]]);
  });

  it('flags nobody as affiliated on an event of another sport league\'s series, and fails with 404 for an unknown event', async () => {
    const { store, service, sport } = setup();
    const orphan = store.addEvent();
    store.addToField(orphan.id, store.addParticipant(sport.id, 'Solo').id);

    await expect(service.listEventParticipants(orphan.id)).resolves.toEqual([expect.objectContaining({ affiliatedWithSportLeague: false })]);
    await expect(service.listEventParticipants('missing')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportEventParticipantService — changing the field', () => {
  it('seeds from the sport league\'s active affiliations with derived seeds and odds, skipping ones already on the field', async () => {
    const { store, service, sport, sportLeague, event } = setup();
    const onField = store.addParticipant(sport.id, 'Already');
    const fresh = store.addParticipant(sport.id, 'Fresh');
    const retired = store.addParticipant(sport.id, 'Retired', { status: 'RETIRED' });
    for (const participant of [onField, fresh, retired]) store.affiliate(sportLeague.id, participant.id, 1);
    store.addToField(event.id, onField.id, { seedNumber: 9 });

    const result = await service.seedFromSportLeague(event.id);

    expect(result).toEqual({ added: 1, skipped: 1, total: 2, seedNumbersDerived: 1, oddsDerived: 1 });
    const added = store.field.find((entry) => entry.participantId === fresh.id);
    expect(added).toMatchObject({ seedNumber: 1, ranking: 1 });
    expect(added?.oddsToWin).toEqual(expect.any(Number));
    expect(store.field.find((entry) => entry.participantId === onField.id)?.seedNumber).toBe(9);
  });

  it('adds anyone to the field, skipping ones already on it', async () => {
    const { store, service, sport, event } = setup();
    const already = store.addParticipant(sport.id, 'A');
    const guest = store.addParticipant(sport.id, 'G');
    store.addToField(event.id, already.id);

    await expect(service.addParticipants(event.id, [already.id, guest.id])).resolves.toEqual({ added: 1, skipped: 1, total: 2 });
    expect(store.field.map((entry) => entry.participantId)).toEqual([already.id, guest.id]);
  });

  it('saves the grid all or none: a row off this event\'s field is refused with 404 before anything is written', async () => {
    const { store, service, sport, event } = setup();
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });
    const other = store.addToField(store.addEvent().id, store.addParticipant(sport.id, 'B').id);

    await expect(service.updateParticipants(event.id, [
      { sportEventParticipantId: entry.id, ranking: 1 },
      { sportEventParticipantId: other.id, ranking: 2 },
    ])).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
    expect(entry.ranking).toBe(4);

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, ranking: null, price: 11 }]);

    expect(view.entry.ranking).toBeUndefined();
    expect(view.valuation).toMatchObject({ price: 11, priceAssignedSource: 'MANUAL' });
  });

  it('refuses a price in the grid save once the event is released (409 SPORT_EVENT_TIERS_LOCKED), writing nothing', async () => {
    const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.SCHEDULED);
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: entry.id, ranking: 1, price: 11 }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_TIERS_LOCKED', statusCode: 409 });
    expect(entry.ranking).toBe(4);
    expect(store.valuationRows).toEqual([]);
  });

  it('still saves rank, odds, seed and withdrawals in the grid after the event is released', async () => {
    const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.SCHEDULED);
    const entry = store.addToField(event.id, store.addParticipant(sport.id, 'A').id, { ranking: 4 });

    const [view] = await service.updateParticipants(event.id, [
      { sportEventParticipantId: entry.id, ranking: 1, oddsToWin: 12.5, seedNumber: 3, isActive: false, inactiveReason: 'WITHDRAWN' },
    ]);

    expect(view.entry).toMatchObject({ ranking: 1, oddsToWin: 12.5, seedNumber: 3, isActive: false, inactiveReason: 'WITHDRAWN' });
  });

  it('removes a field row, refusing one a contest entry has picked (409) or one on another event (404)', async () => {
    const { store, service, sport, event } = setup();
    const free = store.addToField(event.id, store.addParticipant(sport.id, 'Free').id);
    const picked = store.addToField(event.id, store.addParticipant(sport.id, 'Picked').id);
    store.picksByEntry.set(picked.id, 2);

    await service.removeParticipant(event.id, free.id);

    expect(store.field.map((entry) => entry.id)).toEqual([picked.id]);
    await expect(service.removeParticipant(event.id, picked.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_HAS_PICKS', statusCode: 409 });
    await expect(service.removeParticipant('other-event', picked.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to remove a team a bracket match names (409 EVENT_PARTICIPANT_IN_BRACKET), keeping the row', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id);
    store.matchRows.push({
      id: 'match-1', sportEventId: event.id, roundNumber: 1, matchNumber: 1,
      homeSportEventParticipantId: null, awaySportEventParticipantId: duke.id, isNeutralSite: true,
      scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null, ending: MatchEnding.PLAYED,
      advancesToMatchId: null, advancesToSide: null, regionLabel: null, homeSpread: null, periodScores: [], createdAt: new Date(), updatedAt: new Date(),
    });

    await expect(service.removeParticipant(event.id, duke.id)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_IN_BRACKET', statusCode: 409 });
    expect(store.field.map((entry) => entry.id)).toEqual([duke.id]);
  });
});

// A bracket's upset bonus reads seeds as they stood at release, so release locks them there (#698).
describe('SportEventParticipantService — seeds on a released bracket', () => {
  it('refuses a seed change on a released basketball event (409 SPORT_EVENT_SEEDS_LOCKED), writing nothing', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.SCHEDULED);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1, ranking: 1 });

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 2, ranking: 3 }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_SEEDS_LOCKED', statusCode: 409 });
    expect(duke).toMatchObject({ seedNumber: 1, ranking: 1 });
  });

  it('still saves a released bracket\'s other values, and a seed sent unchanged', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.SCHEDULED);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1, ranking: 1 });

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 1, ranking: 2, isActive: false }]);

    expect(view.entry).toMatchObject({ seedNumber: 1, ranking: 2, isActive: false });
  });

  it('changes a bracket\'s seeds freely while the event is a draft', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.DRAFT);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { seedNumber: 1 });

    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, seedNumber: 2 }]);

    expect(view.entry.seedNumber).toBe(2);
  });
});

// The field upload adjusts golfers already on the field; it resolves rows against the field
// alone and never adds a field row or a participant.
describe('SportEventParticipantService — field upload', () => {
  function fieldWithTwo() {
    const ctx = setup();
    const { store, sport, event } = ctx;
    const ana = store.addParticipant(sport.id, 'Ana Lee', { externalId: 'ext-ana' });
    const bo = store.addParticipant(sport.id, 'Bo Kim', { externalId: 'ext-bo' });
    const anaEntry = store.addToField(event.id, ana.id, { ranking: 5, oddsToWin: 12, seedNumber: 1 });
    const boEntry = store.addToField(event.id, bo.id, { ranking: 9, seedNumber: 2 });
    return { ...ctx, ana, bo, anaEntry, boEntry };
  }

  it('matches a row by participantId, by externalId, and by case-insensitive playerName, each to its field row', async () => {
    const { service, event, ana, bo, anaEntry, boEntry } = fieldWithTwo();

    const rows = await service.previewUpload(event.id, [
      { participantId: ana.id, ranking: 1 },
      { externalId: 'ext-bo', ranking: 2 },
    ]);
    const byName = await service.previewUpload(event.id, [{ playerName: 'bo KIM', ranking: 2 }]);

    expect(rows.map((row) => [row.resolution, row.participantId, row.sportEventParticipantId])).toEqual([
      ['MATCHED', ana.id, anaEntry.id],
      ['MATCHED', bo.id, boEntry.id],
    ]);
    expect(byName[0]).toMatchObject({ resolution: 'MATCHED', participantName: 'Bo Kim', sportEventParticipantId: boEntry.id });
  });

  it('uses only the first identifier present: a participantId that matches nothing is unresolved even when the playerName would match', async () => {
    const { service, event } = fieldWithTwo();

    const [row] = await service.previewUpload(event.id, [{ participantId: 'nobody', playerName: 'Ana Lee', ranking: 1 }]);

    expect(row).toMatchObject({ resolution: 'UNRESOLVED', participantId: null, change: null, after: null });
  });

  it('reports a playerName shared by two golfers on the field as ambiguous, with no change', async () => {
    const { store, service, sport, event } = fieldWithTwo();
    store.addToField(event.id, store.addParticipant(sport.id, 'Ana Lee').id);

    const [row] = await service.previewUpload(event.id, [{ playerName: 'Ana Lee', ranking: 1 }]);

    expect(row).toMatchObject({ resolution: 'AMBIGUOUS', sportEventParticipantId: null, change: null });
    expect(row.message).toMatch(/Several participants/);
  });

  it('reports a catalog golfer who is not on the field as unresolved, telling the admin to refresh the field first', async () => {
    const { store, service, sport, event } = fieldWithTwo();
    store.addParticipant(sport.id, 'Cy Park', { externalId: 'ext-cy' });

    const [row] = await service.previewUpload(event.id, [{ externalId: 'ext-cy', ranking: 3 }]);

    expect(row).toMatchObject({ resolution: 'UNRESOLVED', participantId: null, sportEventParticipantId: null, change: null });
    expect(row.message).toMatch(/refresh the field from the provider first/);
  });

  it('flags every row that names the same participant as a DUPLICATE_PARTICIPANT row error, by different identifiers alike', async () => {
    const { service, event, ana } = fieldWithTwo();

    const rows = await service.previewUpload(event.id, [
      { participantId: ana.id, ranking: 1 },
      { externalId: 'ext-bo', ranking: 2 },
      { playerName: 'Ana Lee', ranking: 3 },
    ]);

    expect(rows.map((row) => [row.resolution, row.rowError, row.change])).toEqual([
      ['MATCHED', 'DUPLICATE_PARTICIPANT', null],
      ['MATCHED', null, 'UPDATE'],
      ['MATCHED', 'DUPLICATE_PARTICIPANT', null],
    ]);
    expect(rows[0].message).toMatch(/rows 1, 3/);
  });

  it('classifies a row that changes a value as UPDATE and one that restates stored values as UNCHANGED', async () => {
    const { service, event } = fieldWithTwo();

    const [changed, same] = await service.previewUpload(event.id, [
      { externalId: 'ext-ana', oddsToWin: 15 },
      { externalId: 'ext-bo', ranking: 9, seedNumber: 2, isActive: true },
    ]);

    expect(changed).toMatchObject({ change: 'UPDATE', before: { oddsToWin: 12 }, after: { oddsToWin: 15, ranking: 5 } });
    expect(same).toMatchObject({ change: 'UNCHANGED' });
    expect(same.after).toEqual(same.before);
  });

  it('leaves an omitted value untouched and clears a value sent as null, in preview and on apply', async () => {
    const { store, service, event, anaEntry } = fieldWithTwo();
    const row = { externalId: 'ext-ana', oddsToWin: null, isActive: false, inactiveReason: 'WITHDRAWN' as const };

    const [preview] = await service.previewUpload(event.id, [row]);

    expect(preview.after).toEqual({ isActive: false, inactiveReason: 'WITHDRAWN', ranking: 5, oddsToWin: null, seedNumber: 1 });
    expect(anaEntry.oddsToWin).toBe(12);

    await service.applyUpload(event.id, [row]);

    const stored = store.field.find((entry) => entry.id === anaEntry.id);
    expect(stored).toMatchObject({ ranking: 5, seedNumber: 1, isActive: false, inactiveReason: 'WITHDRAWN' });
    expect(stored?.oddsToWin).toBeUndefined();
  });

  it('applies every changed row and returns the field, without adding a field row or a participant', async () => {
    const { store, service, event, anaEntry, boEntry } = fieldWithTwo();
    const participantsBefore = store.participants.length;

    const field = await service.applyUpload(event.id, [
      { externalId: 'ext-ana', ranking: 2 },
      { playerName: 'Bo Kim', ranking: 9 },
    ]);

    expect(field.map((view) => [view.entry.id, view.entry.ranking])).toEqual([[anaEntry.id, 2], [boEntry.id, 9]]);
    expect(store.field).toHaveLength(2);
    expect(store.participants).toHaveLength(participantsBefore);
  });

  it('refuses to apply (422 EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED) and writes nothing when any row is unresolved or a duplicate', async () => {
    const { store, event, anaEntry } = fieldWithTwo();
    const fieldRepo = store.fieldRepo();
    const updateMany = jest.spyOn(fieldRepo, 'updateMany');
    const guarded = new SportEventParticipantService({
      sportEvents: store.sportEventRepo(),
      field: fieldRepo,
      participants: store.participantRepo(),
      affiliations: store.affiliationRepo(),
      valuations: store.valuationRepo(),
      standings: store.standingRepo(),
      participantRounds: store.participantRoundRepo(),
      golfStandings: store.golfStandingRepo(),
      golfRounds: store.golfRoundRepo(),
      raceResults: store.raceResultRepo(),
      matches: store.matchRepo(),
    });

    for (const rows of [
      [{ externalId: 'ext-ana', ranking: 1 }, { externalId: 'ext-nobody', ranking: 2 }],
      [{ externalId: 'ext-ana', ranking: 1 }, { playerName: 'ana lee', ranking: 2 }],
    ]) {
      await expect(guarded.applyUpload(event.id, rows)).rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED', statusCode: 422 });
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(anaEntry.ranking).toBe(5);
  });

  it('fails a preview for an unknown event with 404 EVENT_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(service.previewUpload('missing', [{ externalId: 'x' }])).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND', statusCode: 404 });
  });
});

// A play-in place stands for a pairing until its winner fills it (#709): marked before release.
describe('SportEventParticipantService — play-in places', () => {
  it('marks and unmarks a bracket draft\'s field row as a play-in place', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.DRAFT);
    const pairing = store.addToField(event.id, store.addParticipant(sport.id, 'Texas / Xavier').id);

    const [marked] = await service.updateParticipants(event.id, [{ sportEventParticipantId: pairing.id, isPlayInPlace: true }]);
    expect(marked.entry.isPlayInPlace).toBe(true);
    const [unmarked] = await service.updateParticipants(event.id, [{ sportEventParticipantId: pairing.id, isPlayInPlace: false }]);
    expect(unmarked.entry.isPlayInPlace).toBe(false);
  });

  it('refuses a play-in place change once the bracket is released (409 SPORT_EVENT_BRACKET_LOCKED), but saves one sent unchanged', async () => {
    const { store, service, sport, event } = setup(Sport.BASKETBALL, SportEventStatus.SCHEDULED);
    const duke = store.addToField(event.id, store.addParticipant(sport.id, 'Duke').id, { ranking: 1 });

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, isPlayInPlace: true }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_BRACKET_LOCKED', statusCode: 409 });
    expect(duke.isPlayInPlace).toBe(false);
    const [view] = await service.updateParticipants(event.id, [{ sportEventParticipantId: duke.id, isPlayInPlace: false, ranking: 2 }]);
    expect(view.entry.ranking).toBe(2);
  });

  it('refuses a play-in place on an event that plays no bracket (422 SPORT_EVENT_NOT_BRACKET)', async () => {
    const { store, service, sport, event } = setup(Sport.GOLF, SportEventStatus.DRAFT);
    const golfer = store.addToField(event.id, store.addParticipant(sport.id, 'Golfer').id);

    await expect(service.updateParticipants(event.id, [{ sportEventParticipantId: golfer.id, isPlayInPlace: true }]))
      .rejects.toMatchObject({ code: 'SPORT_EVENT_NOT_BRACKET', statusCode: 422 });
  });
});
