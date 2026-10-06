import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import { SportEventParticipantService } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The field's rules against an in-memory store: the one read every field screen uses,
// seeding from the sport league, adding anyone, the all-or-none grid save, and removal.

function setup(sportName: Sport = Sport.GOLF) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(sportName);
  const sportLeague = store.addSportLeague(sport.id);
  const event = store.addEvent({ sportLeagueId: sportLeague.id, sport: sportName });
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
    await store.valuationRepo().assignPrices([{ sportEventParticipantId: entry.id, price: 9, source: 'MANUAL' }]);

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

  // plans/147 — every event reaches its sport league through its series, so there is no
  // "event with no sport league" case left to refuse; only the sport is checked.
  it('refuses to seed a non-golf event (422)', async () => {
    const nba = setup(Sport.NBA);
    await expect(nba.service.seedFromSportLeague(nba.event.id)).rejects.toMatchObject({ code: 'SPORT_NOT_SUPPORTED', statusCode: 422 });
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
});
