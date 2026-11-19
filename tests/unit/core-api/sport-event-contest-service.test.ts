import { jest } from '@jest/globals';
import type { SportEventContestReader } from '@poolmaster/shared/db';
import { ContestStatus, type SportEvent, type SportEventContest } from '@poolmaster/shared/domain';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { SportEventContestService } from '../../../packages/core-api/src/modules/events/sport-event-contest-service';

// The contests on one event (#1889): the event must exist, and then its contests are read whole.

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CONTEST: SportEventContest = {
  id: 'c1', name: 'Sentry pick 6', status: ContestStatus.OPEN, league: { id: 'l1', name: 'Office Hoops' },
  contestTemplate: { id: 't1', name: 'Pick 6' }, entryCount: 3, createdAt: new Date('2026-11-18T15:00:00.000Z'),
};

function setup(requireEvent: (id: string) => Promise<SportEvent>) {
  const findContests = jest.fn<SportEventContestReader['findContests']>(async () => [CONTEST]);
  const service = new SportEventContestService({ sportEvents: { requireEvent }, reader: { findContests } });
  return { service, findContests };
}

describe('SportEventContestService.listContests', () => {
  it('reads the contests of an event that exists', async () => {
    const { service, findContests } = setup(async () => ({ id: EVENT_ID }) as SportEvent);

    await expect(service.listContests(EVENT_ID)).resolves.toEqual([CONTEST]);
    expect(findContests).toHaveBeenCalledWith(EVENT_ID);
  });

  it('refuses an unknown event before reading any contest', async () => {
    const missing = new SportEventError('Sport event x was not found.', 'EVENT_NOT_FOUND', 404);
    const { service, findContests } = setup(async () => {
      throw missing;
    });

    await expect(service.listContests(EVENT_ID)).rejects.toBe(missing);
    expect(findContests).not.toHaveBeenCalled();
  });
});
