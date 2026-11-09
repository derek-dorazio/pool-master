/**
 * The contest route handlers (#1482), called with stand-in contest and contest management
 * services: the reads and writes a contest answers, the ETag a polled leaderboard carries, the
 * status each refusal is sent with, and that an error the handler does not own reaches the global
 * error handler unchanged.
 */
import { expect } from '@jest/globals';
import { ContestFormat, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { ZodError } from 'zod';
import { ContestManagementError, type ContestManagementService } from '../../../packages/core-api/src/modules/contest-management/service';
import {
  createContestHandlers,
  createCreateContestHandler,
  createGetLeaguePlanUsageHandler,
  createListSportLeaguesUsedHandler,
} from '../../../packages/core-api/src/modules/contests/handler';
import {
  ContestEntryAccessError,
  ContestEntryNotFoundError,
  ContestEntryOperationError,
  ContestNotFoundError,
  ContestOperationError,
  type ContestService,
} from '../../../packages/core-api/src/modules/contests/service';
import { buildContest } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const AT = new Date('2026-04-10T12:00:00.000Z');
const boom = new Error('database down');
const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', sportEventIds: ['event-1'] });
const masters = { id: 'event-1', name: 'The Masters', startDate: AT, status: SportEventStatus.SCHEDULED };
const entry = { id: 'entry-1', contestId: 'contest-1', name: 'Mine' };
const totals = { submittedEntryCount: 2, enteredSquadCount: 2, allEntryCount: 3 };
const me = authUser('user-1');
const read = <Board>(board: Board) => ({ version: 4, computedFrom: AT, board });
const etag = `"lb-4-${AT.getTime()}"`;

function contestService(overrides: Record<string, unknown> = {}) {
  return {
    listByLeague: jest.fn((..._args: unknown[]) => Promise.resolve([contest])),
    countEntriesByContest: jest.fn((..._args: unknown[]) => Promise.resolve(new Map([['contest-1', 3]]))),
    findEventsForContests: jest.fn((..._args: unknown[]) => Promise.resolve(new Map([['event-1', masters]]))),
    findEntryCaps: jest.fn((..._args: unknown[]) => Promise.resolve(new Map([['contest-1', 50]]))),
    listFinishedYears: jest.fn((..._args: unknown[]) => Promise.resolve([2026, 2025])),
    listMyLeagueEntries: jest.fn((..._args: unknown[]) => Promise.resolve([entry])),
    getContest: jest.fn((..._args: unknown[]) => Promise.resolve(contest)),
    getContestEntrySummary: jest.fn((..._args: unknown[]) => Promise.resolve({ totals, myEntryIds: ['entry-1'] })),
    listEntries: jest.fn((..._args: unknown[]) => Promise.resolve({ entries: [entry], picksRevealed: false })),
    getEntryDetail: jest.fn((..._args: unknown[]) => Promise.resolve({ entry, picksRevealed: true })),
    getLeaderboard: jest.fn((..._args: unknown[]) => Promise.resolve(read({ entries: [], participants: [] }))),
    getBracketLeaderboard: jest.fn((..._args: unknown[]) => Promise.resolve(read({ entries: [] }))),
    getPickEmLeaderboard: jest.fn((..._args: unknown[]) => Promise.resolve(read({ entries: [], weeks: [] }))),
    getSurvivorLeaderboard: jest.fn((..._args: unknown[]) => Promise.resolve(read({ entries: [], weeks: [] }))),
    createEntry: jest.fn((..._args: unknown[]) => Promise.resolve(entry)),
    deleteMyEntry: jest.fn((..._args: unknown[]) => Promise.resolve()),
    updateEntry: jest.fn((..._args: unknown[]) => Promise.resolve(entry)),
    updateContest: jest.fn((..._args: unknown[]) => Promise.resolve(contest)),
    deleteContest: jest.fn((..._args: unknown[]) => Promise.resolve()),
    listOpenContestUsage: jest.fn((..._args: unknown[]) => Promise.resolve([{ contestId: 'contest-1', entryCount: 3 }])),
    ...overrides,
  };
}
function managementService(overrides: Record<string, unknown> = {}) {
  return {
    createContest: jest.fn((..._args: unknown[]) => Promise.resolve('contest-1')),
    listSportLeaguesUsed: jest.fn((..._args: unknown[]) => Promise.resolve(['sl-1'])),
    ...overrides,
  };
}
const handlersOver = (fake = contestService()) => createContestHandlers(fake as unknown as ContestService);
const asContests = (fake: ReturnType<typeof contestService>) => fake as unknown as ContestService;
const asManagement = (fake: ReturnType<typeof managementService>) => fake as unknown as ContestManagementService;

const contestParams = { contestId: 'contest-1' };
const entryParams = { contestId: 'contest-1', entryId: 'entry-1' };

describe('contest read handlers', () => {
  it('lists a league\'s contests for the reader, with entry counts, events and entry caps', async () => {
    const fake = contestService();

    const reply = await callHandler(handlersOver(fake).listContests, stubRequest({ params: { id: 'league-1' }, query: { finishedYear: 2025 }, authUser: me }));

    expect(fake.listByLeague).toHaveBeenCalledWith('league-1', { userId: 'user-1', isRootAdmin: false }, 2025);
    expect(reply.body).toMatchObject({ contests: [{ id: 'contest-1', entryCount: 3, entriesPerContest: 50, sportEvents: [{ name: 'The Masters' }] }] });
  });

  it('lists the years a league finished contests in, and the caller\'s own entries in it', async () => {
    const fake = contestService();
    const handlers = handlersOver(fake);

    const years = await callHandler(handlers.listFinishedYears, stubRequest({ params: { id: 'league-1' } }));
    const mine = await callHandler(handlers.listMyEntries, stubRequest({ params: { id: 'league-1' }, authUser: me }));

    expect(years.body).toEqual({ years: [2026, 2025] });
    expect(fake.listMyLeagueEntries).toHaveBeenCalledWith('league-1', 'user-1');
    expect(mine.body).toEqual({ entries: [entry] });
  });

  it('answers a contest with its events, entry cap and the reader\'s entry summary', async () => {
    const fake = contestService();

    const reply = await callHandler(handlersOver(fake).getContest, stubRequest({ params: contestParams, authUser: me }));

    expect(fake.getContestEntrySummary).toHaveBeenCalledWith(contest, 'user-1');
    expect(reply).toMatchObject({ statusCode: 200, body: { contest: { id: 'contest-1', entriesPerContest: 50, sportEvents: [{ sportEventId: 'event-1' }] } } });
  });

  it('answers a contest with no entry cap with none', async () => {
    const reply = await callHandler(handlersOver(contestService({ findEntryCaps: () => Promise.resolve(new Map()) })).getContest, stubRequest({ params: contestParams, authUser: me }));

    expect(reply.body).toMatchObject({ contest: { entriesPerContest: null } });
  });

  it('answers a missing contest with 404 CONTEST_NOT_FOUND', async () => {
    const reply = await callHandler(handlersOver(contestService({ getContest: () => Promise.resolve(null) })).getContest, stubRequest({ params: contestParams, authUser: me }));

    expect(reply).toMatchObject({ statusCode: 404, body: { error: { code: 'CONTEST_NOT_FOUND' } } });
  });

  it('lists a contest\'s entries, counting them, and answers one entry with whether its picks show', async () => {
    const handlers = handlersOver();

    const list = await callHandler(handlers.listEntries, stubRequest({ params: contestParams, authUser: me }));
    const one = await callHandler(handlers.getEntry, stubRequest({ params: entryParams, authUser: me }));

    expect(list.body).toEqual({ contestId: 'contest-1', total: 1, picksRevealed: false, entries: [entry] });
    expect(one.body).toEqual({ contestId: 'contest-1', picksRevealed: true, entry });
  });
});

describe.each([
  ['getLeaderboard', 'getLeaderboard'],
  ['getBracketLeaderboard', 'getBracketLeaderboard'],
  ['getPickEmLeaderboard', 'getPickEmLeaderboard'],
  ['getSurvivorLeaderboard', 'getSurvivorLeaderboard'],
] as const)('leaderboard handler %s', (handler, method) => {
  it('answers with the stored board and its ETag', async () => {
    const fake = contestService();

    const reply = await callHandler(handlersOver(fake)[handler], stubRequest({ params: contestParams, query: {}, authUser: me }));

    expect(reply).toMatchObject({ statusCode: 200, headers: { etag }, body: { entries: [] } });
  });

  it('answers a poll that already holds this board with 304 and no body', async () => {
    const reply = await callHandler(handlersOver()[handler], stubRequest({ params: contestParams, query: {}, headers: { 'if-none-match': etag }, authUser: me }));

    expect(reply.statusCode).toBe(304);
    expect(reply.body).toBeUndefined();
  });

  it('answers a missing contest with 404 CONTEST_NOT_FOUND, a refused read with 400 and its code, and passes anything else on', async () => {
    const request = () => stubRequest({ params: contestParams, query: {}, authUser: me });
    const over = (error: Error) => handlersOver(contestService({ [method]: () => Promise.reject(error) }))[handler];

    expect(await callHandler(over(new ContestNotFoundError('contest-1')), request())).toMatchObject({ statusCode: 404, body: { error: { code: 'CONTEST_NOT_FOUND' } } });
    expect(await callHandler(over(new ContestOperationError('Not yet', 'CONTEST_OPERATION_INVALID')), request())).toMatchObject({ statusCode: 400, body: { error: { code: 'CONTEST_OPERATION_INVALID' } } });
    await expect(callHandler(over(boom), request())).rejects.toBe(boom);
  });
});

describe('contest leaderboard event filter', () => {
  it('reads the leaderboard for the event the query names', async () => {
    const fake = contestService();

    await callHandler(handlersOver(fake).getLeaderboard, stubRequest({ params: contestParams, query: { sportEventId: 'event-1' }, authUser: me }));

    expect(fake.getLeaderboard).toHaveBeenCalledWith('contest-1', 'user-1', 'event-1');
  });

  it('answers a refused entry read on the leaderboard with 400 and its code', async () => {
    const handlers = handlersOver(contestService({ getLeaderboard: () => Promise.reject(new ContestEntryOperationError('Hidden', 'CONTEST_ENTRY_LOCKED')) }));

    expect(await callHandler(handlers.getLeaderboard, stubRequest({ params: contestParams, query: {}, authUser: me })))
      .toMatchObject({ statusCode: 400, body: { error: { code: 'CONTEST_ENTRY_LOCKED' } } });
  });
});

const entryHandlers = {
  listEntries: { method: 'listEntries', request: () => stubRequest({ params: contestParams, authUser: me }) },
  getEntry: { method: 'getEntryDetail', request: () => stubRequest({ params: entryParams, authUser: me }) },
  createMyEntry: { method: 'createEntry', request: () => stubRequest({ params: contestParams, authUser: me }) },
  deleteMyEntry: { method: 'deleteMyEntry', request: () => stubRequest({ params: contestParams, authUser: me }) },
  updateEntry: { method: 'updateEntry', request: () => stubRequest({ params: entryParams, body: { name: 'Renamed' }, authUser: me }) },
} as const;
type EntryHandler = keyof typeof entryHandlers;
const notFound = new ContestNotFoundError('contest-1');
const entryNotFound = new ContestEntryNotFoundError('contest-1', 'squad-1');
const denied = new ContestEntryAccessError('Not your squad', 'SQUAD_OWNER_REQUIRED');
const refused = new ContestEntryOperationError('Locked', 'CONTEST_ENTRY_LOCKED');

describe('contest entry handlers', () => {
  it('creates the caller\'s entry with 201, deletes it, and renames it', async () => {
    const fake = contestService();
    const handlers = handlersOver(fake);

    const created = await callHandler(handlers.createMyEntry, entryHandlers.createMyEntry.request());
    const deleted = await callHandler(handlers.deleteMyEntry, entryHandlers.deleteMyEntry.request());
    const updated = await callHandler(handlers.updateEntry, stubRequest({ params: entryParams, body: { name: ' Renamed ', tiebreakerValue: 140 }, authUser: me }));

    expect(created).toMatchObject({ statusCode: 201, body: { contestId: 'contest-1', entry } });
    expect(deleted.body).toEqual({ contestId: 'contest-1', deleted: true });
    expect(fake.updateEntry).toHaveBeenCalledWith('contest-1', 'entry-1', 'user-1', { name: 'Renamed', tiebreakerValue: 140 });
    expect(updated.body).toEqual({ contestId: 'contest-1', entry });
  });

  it.each([
    ['listEntries', notFound, 404, 'CONTEST_NOT_FOUND'],
    ['listEntries', refused, 400, 'CONTEST_ENTRY_LOCKED'],
    ['getEntry', notFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['getEntry', entryNotFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['getEntry', refused, 400, 'CONTEST_ENTRY_LOCKED'],
    ['createMyEntry', notFound, 404, 'CONTEST_NOT_FOUND'],
    ['createMyEntry', entryNotFound, 404, 'CONTEST_NOT_FOUND'],
    ['createMyEntry', denied, 403, 'SQUAD_OWNER_REQUIRED'],
    ['createMyEntry', refused, 400, 'CONTEST_ENTRY_LOCKED'],
    ['createMyEntry', new ContestEntryOperationError('No more', 'CONTEST_ENTRY_LIMIT_REACHED'), 409, 'CONTEST_ENTRY_LIMIT_REACHED'],
    ['createMyEntry', new ContestEntryOperationError('Full', 'CONTEST_FULL'), 409, 'CONTEST_FULL'],
    ['deleteMyEntry', notFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['deleteMyEntry', entryNotFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['deleteMyEntry', denied, 403, 'SQUAD_OWNER_REQUIRED'],
    ['deleteMyEntry', refused, 400, 'CONTEST_ENTRY_LOCKED'],
    ['updateEntry', notFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['updateEntry', entryNotFound, 404, 'CONTEST_ENTRY_NOT_FOUND'],
    ['updateEntry', denied, 403, 'SQUAD_OWNER_REQUIRED'],
    ['updateEntry', refused, 400, 'CONTEST_ENTRY_LOCKED'],
  ] as Array<[EntryHandler, Error, number, string]>)('%s answers %p with %i and code %s', async (handler, error, status, code) => {
    const { method, request } = entryHandlers[handler];
    const handlers = handlersOver(contestService({ [method]: () => Promise.reject(error) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it.each(Object.keys(entryHandlers) as EntryHandler[])('%s passes an unexpected failure on to the global error handler', async (handler) => {
    const { method, request } = entryHandlers[handler];
    const handlers = handlersOver(contestService({ [method]: () => Promise.reject(boom) }));

    await expect(callHandler(handlers[handler], request())).rejects.toBe(boom);
  });

  it('passes an entry change that names no field on as a validation error, changing nothing', async () => {
    const fake = contestService();

    await expect(callHandler(handlersOver(fake).updateEntry, stubRequest({ params: entryParams, body: {}, authUser: me }))).rejects.toBeInstanceOf(ZodError);
    expect(fake.updateEntry).not.toHaveBeenCalled();
  });
});

describe('contest update and delete handlers', () => {
  it('updates a contest\'s name and dates, reading the dates as dates, and answers with the contest', async () => {
    const fake = contestService();
    const handlers = handlersOver(fake);

    const reply = await callHandler(handlers.updateContest, stubRequest({
      params: contestParams, body: { name: 'Majors', startsAt: '2026-04-09T12:00:00.000Z', endsAt: '2026-04-12T23:00:00.000Z' },
    }));
    await callHandler(handlers.updateContest, stubRequest({ params: contestParams, body: { name: 'Majors' } }));

    expect(fake.updateContest.mock.calls).toEqual([
      ['contest-1', { name: 'Majors', startsAt: new Date('2026-04-09T12:00:00.000Z'), endsAt: new Date('2026-04-12T23:00:00.000Z') }],
      ['contest-1', { name: 'Majors', startsAt: undefined, endsAt: undefined }],
    ]);
    expect(reply.body).toMatchObject({ contest: { id: 'contest-1', entriesPerContest: 50 } });
  });

  it('answers an updated contest with no entry cap with none', async () => {
    const reply = await callHandler(handlersOver(contestService({ findEntryCaps: () => Promise.resolve(new Map()) })).updateContest, stubRequest({ params: contestParams, body: {} }));

    expect(reply.body).toMatchObject({ contest: { entriesPerContest: null } });
  });

  it('deletes a contest with 204 and no body', async () => {
    const reply = await callHandler(handlersOver().deleteContest, stubRequest({ params: contestParams }));

    expect(reply.statusCode).toBe(204);
    expect(reply.body).toBeUndefined();
  });

  it.each([
    ['updateContest', 'updateContest'],
    ['deleteContest', 'deleteContest'],
  ] as const)('%s answers a missing contest with 404, a refused change with 400 and its code, and passes anything else on', async (handler, method) => {
    const request = () => stubRequest({ params: contestParams, body: { name: 'Majors' } });
    const over = (error: Error) => handlersOver(contestService({ [method]: () => Promise.reject(error) }))[handler];

    expect(await callHandler(over(notFound), request())).toMatchObject({ statusCode: 404, body: { error: { code: 'CONTEST_NOT_FOUND' } } });
    expect(await callHandler(over(new ContestOperationError('Started', 'CONTEST_DELETE_STATUS_INVALID')), request()))
      .toMatchObject({ statusCode: 400, body: { error: { code: 'CONTEST_DELETE_STATUS_INVALID' } } });
    await expect(callHandler(over(boom), request())).rejects.toBe(boom);
  });
});

describe('contest create handler', () => {
  const valid = {
    name: 'Majors',
    sportEventIds: ['3f1c4a62-9d1e-4b1a-8f7e-2c5d6e7f8a9b'],
    contestFormat: ContestFormat.ROSTER,
    selectionType: SelectionType.TIERED,
    templateId: '7a2b3c4d-5e6f-4a1b-9c8d-0e1f2a3b4c5d',
  };
  const createOver = (contests = contestService(), management = managementService()) => createCreateContestHandler(asContests(contests), asManagement(management));

  it('creates a contest in the league with 201 and the contest as a read answers it', async () => {
    const management = managementService();

    const reply = await callHandler(createOver(contestService(), management), stubRequest({ params: { id: 'league-1' }, body: valid }));

    expect(management.createContest).toHaveBeenCalledWith({ leagueId: 'league-1' }, valid);
    expect(reply).toMatchObject({ statusCode: 201, body: { contest: { id: 'contest-1', entriesPerContest: 50 } } });
  });

  it('answers a created contest with no entry cap with none', async () => {
    const reply = await callHandler(createOver(contestService({ findEntryCaps: () => Promise.resolve(new Map()) })), stubRequest({ params: { id: 'league-1' }, body: valid }));

    expect(reply.body).toMatchObject({ contest: { entriesPerContest: null } });
  });

  it('refuses a create naming neither a template nor a configuration with 400 CONTEST_CONFIGURATION_REQUIRED, creating nothing', async () => {
    const management = managementService();

    const reply = await callHandler(createOver(contestService(), management), stubRequest({ params: { id: 'league-1' }, body: { ...valid, templateId: undefined } }));

    expect(reply).toMatchObject({ statusCode: 400, body: { error: { code: 'CONTEST_CONFIGURATION_REQUIRED' } } });
    expect(management.createContest).not.toHaveBeenCalled();
  });

  it('refuses a malformed create with 400 FST_ERR_VALIDATION', async () => {
    const reply = await callHandler(createOver(), stubRequest({ params: { id: 'league-1' }, body: { ...valid, name: '' } }));

    expect(reply).toMatchObject({ statusCode: 400, body: { error: { code: 'FST_ERR_VALIDATION' } } });
  });

  it('answers a refused create with the error\'s own status and code', async () => {
    const management = managementService({ createContest: () => Promise.reject(new ContestManagementError('Locked', 'CONTEST_CONFIGURATION_LOCKED', 409)) });

    expect(await callHandler(createOver(contestService(), management), stubRequest({ params: { id: 'league-1' }, body: valid })))
      .toMatchObject({ statusCode: 409, body: { error: { code: 'CONTEST_CONFIGURATION_LOCKED' } } });
  });

  it('passes a created contest that cannot be read back, and any unexpected failure, on to the global error handler', async () => {
    const request = () => stubRequest({ params: { id: 'league-1' }, body: valid });

    await expect(callHandler(createOver(contestService({ getContest: () => Promise.resolve(null) })), request())).rejects.toBeInstanceOf(ContestNotFoundError);
    await expect(callHandler(createOver(contestService(), managementService({ createContest: () => Promise.reject(boom) })), request())).rejects.toBe(boom);
  });
});

describe('league plan usage handlers', () => {
  it('lists the sports leagues a league\'s contests use in the season the query names', async () => {
    const management = managementService();

    const reply = await callHandler(createListSportLeaguesUsedHandler(asManagement(management)), stubRequest({ params: { id: 'league-1' }, query: { seasonYear: 2026 } }));

    expect(management.listSportLeaguesUsed).toHaveBeenCalledWith('league-1', 2026);
    expect(reply.body).toEqual({ seasonYear: 2026, sportLeagueIds: ['sl-1'] });
  });

  it('answers a league\'s plan usage with this year\'s sports leagues and its open contests', async () => {
    const management = managementService();
    const year = new Date().getUTCFullYear();

    const reply = await callHandler(createGetLeaguePlanUsageHandler(asContests(contestService()), asManagement(management)), stubRequest({ params: { id: 'league-1' } }));

    expect(management.listSportLeaguesUsed).toHaveBeenCalledWith('league-1', year);
    expect(reply.body).toEqual({ seasonYear: year, sportLeagueIds: ['sl-1'], openContests: [{ contestId: 'contest-1', entryCount: 3 }] });
  });
});
