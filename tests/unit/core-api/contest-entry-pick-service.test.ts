/**
 * ContestEntryPickService: what one locked pick change, one locked submit and one draw write,
 * judged against a recording transaction. The locks and the unique indexes themselves are tested
 * against Postgres in the selection integration suites.
 */
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { ContestEntryStatus } from '@poolmaster/shared/domain';
import {
  ContestDrawAlreadyRunError,
  ContestDrawEntriesChangedError,
  ContestEntryPickContestMissingError,
  ContestEntryPickEntryMissingError,
  ContestEntryPickService,
} from '../../../packages/core-api/src/modules/contest-entry-picks/service';
import { asPrismaClient } from '../../support/prisma-double';

const AT = new Date('2026-11-09T18:00:00.000Z');
const DRAWN_AT = new Date('2026-11-09T18:05:00.000Z');

interface EntryRow {
  contestId: string;
  contest: { contestFormat: string };
  events: Array<{ status: ContestEntryStatus; submittedAt: Date | null }>;
}

function fakeTx(options: {
  entry?: EntryRow | null;
  picks?: Array<{ id: string; sportEventParticipantId: string; lineupSlot: number | null; sportEventParticipant: { participantId: string } }>;
  contestPickCount?: number;
  contest?: { contestFormat: string } | null;
  contestEntries?: Array<{ id: string }>;
  drawCreate?: () => Promise<{ drawnAt: Date }>;
} = {}) {
  return {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    contestEntry: {
      findUnique: jest.fn(() => Promise.resolve(options.entry === undefined ? null : options.entry)),
      findMany: jest.fn(() => Promise.resolve(options.contestEntries ?? [])),
    },
    contestEntryPick: {
      findMany: jest.fn(() => Promise.resolve(options.picks ?? [])),
      delete: jest.fn(() => Promise.resolve({})),
      count: jest.fn(() => Promise.resolve(options.contestPickCount ?? 0)),
      create: jest.fn(() => Promise.resolve({ id: 'pick-new' })),
      createMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    contestEntryEvent: {
      upsert: jest.fn(() => Promise.resolve({})),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    contest: { findUnique: jest.fn(() => Promise.resolve(options.contest === undefined ? null : options.contest)) },
    contestDraw: { create: jest.fn(options.drawCreate ?? (() => Promise.resolve({ drawnAt: DRAWN_AT }))) },
  };
}

function serviceOver(tx: ReturnType<typeof fakeTx>) {
  const logger = { info: jest.fn((_entry: { action: string; data: Record<string, unknown> }, _message: string) => undefined) };
  const prisma = asPrismaClient({ $transaction: jest.fn((work: (client: unknown) => Promise<unknown>) => work(tx)) });
  return { service: new ContestEntryPickService(prisma, logger as unknown as FastifyBaseLogger), logger };
}

const draftEntry: EntryRow = { contestId: 'contest-1', contest: { contestFormat: 'ROSTER' }, events: [] };
const heldPick = { id: 'pick-old', sportEventParticipantId: 'sep-old', lineupSlot: 1, sportEventParticipant: { participantId: 'p-old' } };

describe('ContestEntryPickService.changeEntryPick', () => {
  it('swaps a pick: deletes the old one, adds the new one with the contest format and the next contest pick sequence, submits the entry at the given time and logs the change', async () => {
    const tx = fakeTx({ entry: draftEntry, picks: [heldPick], contestPickCount: 7 });
    const { service, logger } = serviceOver(tx);
    const settle = jest.fn(() => ContestEntryStatus.SUBMITTED);

    const result = await service.changeEntryPick({
      entryId: 'entry-1',
      sportEventId: 'event-1',
      at: AT,
      decide: () => ({ removePickId: 'pick-old', add: { sportEventParticipantId: 'sep-new', participantId: 'p-new', lineupSlot: 1 } }),
      settle,
    });

    expect(result).toEqual({ picksChanged: true, status: ContestEntryStatus.SUBMITTED, submittedAt: AT, statusChanged: true });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.contestEntryPick.delete).toHaveBeenCalledWith({ where: { id: 'pick-old' } });
    expect(tx.contestEntryPick.create).toHaveBeenCalledWith({
      data: { entryId: 'entry-1', sportEventParticipantId: 'sep-new', contestFormat: 'ROSTER', lineupSlot: 1, pickSequence: 8, isAutoPicked: false },
      select: { id: true },
    });
    expect(settle).toHaveBeenCalledWith({
      picks: [{ id: 'pick-new', sportEventParticipantId: 'sep-new', participantId: 'p-new', lineupSlot: 1 }],
      status: ContestEntryStatus.DRAFT,
      picksChanged: true,
    });
    expect(tx.contestEntryEvent.upsert).toHaveBeenCalledWith({
      where: { contestEntryId_sportEventId: { contestEntryId: 'entry-1', sportEventId: 'event-1' } },
      create: { contestEntryId: 'entry-1', sportEventId: 'event-1', status: ContestEntryStatus.SUBMITTED, submittedAt: AT },
      update: { status: ContestEntryStatus.SUBMITTED, submittedAt: AT },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'contestEntryPick.change.success', data: { entryId: 'entry-1', contestId: 'contest-1', removedPickId: 'pick-old', addedSportEventParticipantId: 'sep-new' } },
      'Changed a contest entry pick',
    );
  });

  it('a removal alone deletes the pick, adds none, logs the added pick as null, and an unchanged status writes no status', async () => {
    const submittedAt = new Date('2026-11-08T12:00:00.000Z');
    const tx = fakeTx({ entry: { ...draftEntry, events: [{ status: ContestEntryStatus.SUBMITTED, submittedAt }] }, picks: [heldPick] });
    const { service, logger } = serviceOver(tx);

    const result = await service.changeEntryPick({
      entryId: 'entry-1',
      sportEventId: 'event-1',
      at: AT,
      decide: () => ({ removePickId: 'pick-old', add: null }),
      settle: ({ status }) => status,
    });

    expect(result).toEqual({ picksChanged: true, status: ContestEntryStatus.SUBMITTED, submittedAt, statusChanged: false });
    expect(tx.contestEntryPick.create).not.toHaveBeenCalled();
    expect(tx.contestEntryEvent.upsert).not.toHaveBeenCalled();
    expect(logger.info.mock.calls[0][0].data).toEqual({ entryId: 'entry-1', contestId: 'contest-1', removedPickId: 'pick-old', addedSportEventParticipantId: null });
  });

  it('when decide answers null nothing is written or logged, and a status settled back to DRAFT clears the submit time', async () => {
    const tx = fakeTx({ entry: { ...draftEntry, events: [{ status: ContestEntryStatus.SUBMITTED, submittedAt: AT }] }, picks: [heldPick] });
    const { service, logger } = serviceOver(tx);
    const decide = jest.fn(() => null);

    const result = await service.changeEntryPick({
      entryId: 'entry-1',
      sportEventId: 'event-1',
      at: AT,
      decide,
      settle: () => ContestEntryStatus.DRAFT,
    });

    expect(decide).toHaveBeenCalledWith([{ id: 'pick-old', sportEventParticipantId: 'sep-old', participantId: 'p-old', lineupSlot: 1 }]);
    expect(result).toEqual({ picksChanged: false, status: ContestEntryStatus.DRAFT, submittedAt: null, statusChanged: true });
    expect(tx.contestEntryPick.delete).not.toHaveBeenCalled();
    expect(tx.contestEntryPick.create).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('an addition with no removal logs the removed pick as null', async () => {
    const tx = fakeTx({ entry: draftEntry });
    const { service, logger } = serviceOver(tx);

    await service.changeEntryPick({
      entryId: 'entry-1',
      sportEventId: 'event-1',
      at: AT,
      decide: () => ({ removePickId: null, add: { sportEventParticipantId: 'sep-new', participantId: 'p-new', lineupSlot: 2 } }),
      settle: () => null,
    });

    expect(tx.contestEntryPick.delete).not.toHaveBeenCalled();
    expect(logger.info.mock.calls[0][0].data).toMatchObject({ removedPickId: null, addedSportEventParticipantId: 'sep-new' });
  });

  it('refuses with ContestEntryPickEntryMissingError when the entry is gone', async () => {
    const { service } = serviceOver(fakeTx({ entry: null }));

    await expect(service.changeEntryPick({ entryId: 'entry-gone', sportEventId: 'event-1', at: AT, decide: () => null, settle: () => null }))
      .rejects.toBeInstanceOf(ContestEntryPickEntryMissingError);
  });
});

describe('ContestEntryPickService.settleEntryEvent', () => {
  it('reads an entry with no event row as DRAFT, and a submit stamps it SUBMITTED at the given time without changing picks', async () => {
    const tx = fakeTx({ entry: draftEntry, picks: [heldPick] });
    const { service } = serviceOver(tx);
    const settle = jest.fn(() => ContestEntryStatus.SUBMITTED);

    const result = await service.settleEntryEvent({ entryId: 'entry-1', sportEventId: 'event-1', at: AT, settle });

    expect(settle).toHaveBeenCalledWith({ picks: [{ id: 'pick-old', sportEventParticipantId: 'sep-old', participantId: 'p-old', lineupSlot: 1 }], status: ContestEntryStatus.DRAFT });
    expect(result).toEqual({ picksChanged: false, status: ContestEntryStatus.SUBMITTED, submittedAt: AT, statusChanged: true });
    expect(tx.contestEntryEvent.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('ContestEntryPickService.recordDraw', () => {
  const input = {
    contestId: 'contest-1',
    seed: 'seed-1',
    fieldOrder: ['sep-a', 'sep-b', 'sep-c', 'sep-d'],
    entryOrder: ['entry-1', 'entry-2'],
    drawnByUserId: 'user-1',
    sportEventId: 'event-1',
    entries: [
      { entryId: 'entry-1', sportEventParticipantIds: ['sep-a', 'sep-c'] },
      { entryId: 'entry-2', sportEventParticipantIds: ['sep-b', 'sep-d'] },
    ],
  };
  const bothEntries = [{ id: 'entry-1' }, { id: 'entry-2' }];

  it('writes the draw row owing receipts, deals each pick its round as lineup slot and its place in the deal across the contest as pick sequence, submits every entry at the draw time and logs it', async () => {
    const tx = fakeTx({ contest: { contestFormat: 'ROSTER' }, contestEntries: bothEntries });
    const { service, logger } = serviceOver(tx);

    await expect(service.recordDraw(input)).resolves.toEqual({ drawnAt: DRAWN_AT });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.contestDraw.create).toHaveBeenCalledWith({
      data: {
        contestId: 'contest-1',
        seed: 'seed-1',
        fieldOrder: ['sep-a', 'sep-b', 'sep-c', 'sep-d'],
        entryOrder: ['entry-1', 'entry-2'],
        drawnByUserId: 'user-1',
        receiptsPendingSportEventId: 'event-1',
      },
      select: { drawnAt: true },
    });
    expect(tx.contestEntryPick.createMany).toHaveBeenCalledWith({
      data: [
        { entryId: 'entry-1', sportEventParticipantId: 'sep-a', contestFormat: 'ROSTER', lineupSlot: 1, pickSequence: 1, isAutoPicked: true },
        { entryId: 'entry-1', sportEventParticipantId: 'sep-c', contestFormat: 'ROSTER', lineupSlot: 2, pickSequence: 3, isAutoPicked: true },
        { entryId: 'entry-2', sportEventParticipantId: 'sep-b', contestFormat: 'ROSTER', lineupSlot: 1, pickSequence: 2, isAutoPicked: true },
        { entryId: 'entry-2', sportEventParticipantId: 'sep-d', contestFormat: 'ROSTER', lineupSlot: 2, pickSequence: 4, isAutoPicked: true },
      ],
    });
    expect(tx.contestEntryEvent.updateMany).toHaveBeenCalledWith({
      where: { contestEntryId: { in: ['entry-1', 'entry-2'] } },
      data: { status: ContestEntryStatus.SUBMITTED, submittedAt: DRAWN_AT },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'contestEntryPick.recordDraw.success', data: { contestId: 'contest-1', entryCount: 2, fieldSize: 4 } },
      'Recorded a random draw and its dealt picks',
    );
  });

  it('refuses with ContestEntryPickContestMissingError when the contest is gone', async () => {
    const { service } = serviceOver(fakeTx({ contest: null }));

    await expect(service.recordDraw(input)).rejects.toBeInstanceOf(ContestEntryPickContestMissingError);
  });

  it('refuses with ContestDrawEntriesChangedError, writing no draw, when an entry joined after the deal', async () => {
    const tx = fakeTx({ contest: { contestFormat: 'ROSTER' }, contestEntries: [...bothEntries, { id: 'entry-3' }] });
    const { service } = serviceOver(tx);

    await expect(service.recordDraw(input)).rejects.toBeInstanceOf(ContestDrawEntriesChangedError);
    expect(tx.contestDraw.create).not.toHaveBeenCalled();
  });

  it('refuses with ContestDrawEntriesChangedError when the same number of entries is there but one was swapped for another', async () => {
    const tx = fakeTx({ contest: { contestFormat: 'ROSTER' }, contestEntries: [{ id: 'entry-1' }, { id: 'entry-9' }] });
    const { service } = serviceOver(tx);

    await expect(service.recordDraw(input)).rejects.toBeInstanceOf(ContestDrawEntriesChangedError);
  });

  it('answers ContestDrawAlreadyRunError, dealing no picks, when the draw row already exists', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`contestId`)', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });
    const tx = fakeTx({ contest: { contestFormat: 'ROSTER' }, contestEntries: bothEntries, drawCreate: () => Promise.reject(duplicate) });
    const { service } = serviceOver(tx);

    await expect(service.recordDraw(input)).rejects.toBeInstanceOf(ContestDrawAlreadyRunError);
    expect(tx.contestEntryPick.createMany).not.toHaveBeenCalled();
  });

  it('passes any other draw-row failure through unchanged', async () => {
    const outage = new Error('connection reset');
    const tx = fakeTx({ contest: { contestFormat: 'ROSTER' }, contestEntries: bothEntries, drawCreate: () => Promise.reject(outage) });
    const { service } = serviceOver(tx);

    await expect(service.recordDraw(input)).rejects.toBe(outage);
  });
});
