/**
 * #1171 — the lifecycle sweep's quick pick receipts step: each draw marked as owing its receipts
 * has them sent, and the marks of the draws sent are cleared in one write. A draw whose receipts
 * cannot be queued keeps its mark for the next sweep.
 */
import { DrawReceipts } from '../../../packages/core-api/src/modules/selections/draw-receipts';
import { fakeLogger } from '../../support/fake-logger';
import { fakeContestRepo } from '../../support/repo-fakes';

function setup(pending: string[], failing: readonly string[] = []) {
  const contests = fakeContestRepo({ findDrawReceiptsPending: jest.fn().mockResolvedValue(pending) });
  const sendDrawReceipts = jest.fn(async (contestId: string) => {
    if (failing.includes(contestId)) throw new Error('database unavailable');
  });
  const logger = fakeLogger();
  return { step: new DrawReceipts({ contests, selections: { sendDrawReceipts }, logger }), contests, sendDrawReceipts, logger };
}

describe('DrawReceipts.queueDue', () => {
  it('sends every pending draw\'s receipts, then clears the marks of all of them in one write', async () => {
    const { step, contests, sendDrawReceipts } = setup(['contest-1', 'contest-2']);

    await step.queueDue();

    expect(sendDrawReceipts.mock.calls).toEqual([['contest-1'], ['contest-2']]);
    expect(contests.clearDrawReceiptsPending).toHaveBeenCalledTimes(1);
    expect(contests.clearDrawReceiptsPending).toHaveBeenCalledWith(['contest-1', 'contest-2']);
  });

  it('keeps the mark of a draw whose receipts could not be queued, logging it, and still sends and clears the others', async () => {
    const { step, contests, sendDrawReceipts, logger } = setup(['contest-1', 'contest-2'], ['contest-1']);

    await step.queueDue();

    expect(sendDrawReceipts).toHaveBeenCalledTimes(2);
    expect(contests.clearDrawReceiptsPending).toHaveBeenCalledWith(['contest-2']);
    expect(logger.error).toHaveBeenCalledWith(
      { action: 'email.drawReceipts.failed', data: { contestId: 'contest-1', error: 'database unavailable' } },
      expect.any(String),
    );
  });

  it('sends nothing and writes nothing when no draw owes its receipts', async () => {
    const { step, contests, sendDrawReceipts } = setup([]);

    await step.queueDue();

    expect(sendDrawReceipts).not.toHaveBeenCalled();
    expect(contests.clearDrawReceiptsPending).not.toHaveBeenCalled();
  });
});
