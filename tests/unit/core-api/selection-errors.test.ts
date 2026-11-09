/**
 * The selection room's refusals: each one's code and HTTP status, and the message naming what was
 * refused, so an API client can tell them apart.
 */
import { selectionErrors } from '../../../packages/core-api/src/modules/selections/selection-errors';

describe('selection room refusals', () => {
  it('answers 404 CONTEST_EVENT_NOT_IN_CONTEST naming the event and contest when the event is not one the contest covers', () => {
    expect(selectionErrors.eventNotInContest('event-1', 'contest-1')).toMatchObject({
      message: 'Event event-1 is not one contest contest-1 covers',
      code: 'CONTEST_EVENT_NOT_IN_CONTEST',
      statusCode: 404,
    });
  });

  it('answers 409 CONTEST_EVENT_REQUIRED when the contest covers no event yet', () => {
    expect(selectionErrors.contestHasNoEvent('contest-1')).toMatchObject({ code: 'CONTEST_EVENT_REQUIRED', statusCode: 409 });
  });

  it('answers 409 CONTEST_FORMAT_MISMATCH saying a roster contest picks a lineup when game picks are sent to it', () => {
    expect(selectionErrors.contestTakesRosterPicks('contest-1')).toMatchObject({
      message: 'Contest contest-1 is a roster contest; its entries pick a lineup, not the winners of games',
      code: 'CONTEST_FORMAT_MISMATCH',
      statusCode: 409,
    });
  });

  it('names the field row status in the unavailable message when it has one, and leaves it out when it has none', () => {
    expect(selectionErrors.participantUnavailable('sep-1', 'WITHDRAWN').message).toBe('SportEventParticipant sep-1 is unavailable with status WITHDRAWN');
    expect(selectionErrors.participantUnavailable('sep-1', null)).toMatchObject({
      message: 'SportEventParticipant sep-1 is unavailable',
      code: 'PARTICIPANT_UNAVAILABLE',
      statusCode: 400,
    });
  });
});
