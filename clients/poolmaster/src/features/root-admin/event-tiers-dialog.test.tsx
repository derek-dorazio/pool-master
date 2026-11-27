import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventTiersDialog } from './event-tiers-dialog';
import { eventTiersRequestBody, eventTiersValuesOf, nextTierKey, strandedCount } from './event-tiers-form';
import { fieldEntryFixture, sportEventFixture, tierFixture, valuationFixture } from './sport-test-fixtures';

// The tier-set slot's tiers, edited from ⚙ (#1890, #2044): reorder, add and remove, each named by its place
// (Tier 1 first), with a removed tier's participants sent somewhere only once a tier was set by hand.

const { mockLogger, replaceEventSlotTiersMock } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { mockLogger: logger, replaceEventSlotTiersMock: vi.fn() };
});

bindApiMocks({ replaceEventSlotTiers: replaceEventSlotTiersMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const TIERS = [tierFixture({ tierNumber: 1 }), tierFixture({ tierNumber: 2 }), tierFixture({ tierNumber: 3 })];
const TEST_ID = 'root-admin-event-tiers-dialog';

function placed(id: string, tierId: string, source: 'MANUAL' | 'AUTO_ODDS') {
  return fieldEntryFixture({ id, valuation: valuationFixture({ id: `valuation-${id}`, sportEventTierId: tierId, tierAssignedSource: source }) });
}

function renderDialog(field = [placed('a', 'tier-3', 'AUTO_ODDS')]) {
  const onClose = vi.fn();
  replaceEventSlotTiersMock.mockResolvedValue({ data: { tiers: [] } });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EventTiersDialog event={sportEventFixture({ id: 'evt-1', name: 'Open' })} field={field} onClose={onClose} seasonSlotId="slot-1" tiers={TIERS} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('the event tiers form', () => {
  it('reads the tiers in tier order and gives a new tier a key none has, so it never takes another\'s participants', () => {
    expect(eventTiersValuesOf([TIERS[1], TIERS[0]]).tiers.map((tier) => tier.tierKey)).toEqual(['TIER_1', 'TIER_2']);
    expect(nextTierKey(['TIER_1', 'TIER_2'])).toBe('TIER_3');
    expect(nextTierKey(['TIER_1', 'TIER_3'])).toBe('TIER_4');
  });

  it('counts participants stranded in a removed tier only once a tier was set by hand', () => {
    const values = { tiers: [{ tierKey: 'TIER_1' }], reassignTo: '' };
    const field = [placed('a', 'tier-2', 'AUTO_ODDS'), placed('b', 'tier-3', 'AUTO_ODDS')];

    expect(strandedCount(values, TIERS, field)).toBe(0);
    expect(strandedCount(values, TIERS, [...field, placed('c', 'tier-1', 'MANUAL')])).toBe(2);
  });

  it('numbers the tiers in list order, and sends where stranded participants go only when some are', () => {
    const values = { tiers: [{ tierKey: 'TIER_2' }, { tierKey: 'TIER_1' }], reassignTo: 'TIER_1' };

    expect(eventTiersRequestBody(values, 0)).toEqual({
      tiers: [{ tierKey: 'TIER_2', tierNumber: 1 }, { tierKey: 'TIER_1', tierNumber: 2 }],
    });
    expect(eventTiersRequestBody(values, 3)).toMatchObject({ reassignOrphansTo: 'TIER_1' });
  });
});

describe('the event tiers dialog', () => {
  it('saves reordered, added and removed tiers in list order, each named by its place, a new tier never reusing a removed tier\'s key, then closes', async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByTestId(`${TEST_ID}-down-0`));
    expect(screen.getByTestId(`${TEST_ID}-label-0`)).toHaveTextContent('Tier 1');
    await userEvent.click(screen.getByTestId(`${TEST_ID}-remove-2`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-add`));
    expect(screen.queryByTestId(`${TEST_ID}-reassign`)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(`${TEST_ID}-save`)).toBeEnabled());
    await userEvent.click(screen.getByTestId(`${TEST_ID}-save`));

    await waitFor(() => expect(replaceEventSlotTiersMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', seasonSlotId: 'slot-1' },
      body: {
        tiers: [
          { tierKey: 'TIER_2', tierNumber: 1 },
          { tierKey: 'TIER_1', tierNumber: 2 },
          { tierKey: 'TIER_4', tierNumber: 3 },
        ],
      },
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('leaves the last tier unremovable', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId(`${TEST_ID}-remove-2`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-remove-1`));

    expect(screen.getByTestId(`${TEST_ID}-remove-0`)).toBeDisabled();
  });

  it('once a tier was set by hand, asks where a removed tier\'s participants go and keeps Save off until chosen', async () => {
    renderDialog([placed('a', 'tier-3', 'AUTO_ODDS'), placed('b', 'tier-1', 'MANUAL')]);

    await userEvent.click(screen.getByTestId(`${TEST_ID}-remove-2`));
    const reassign = await screen.findByTestId(`${TEST_ID}-reassign`);
    expect(screen.getByTestId(`${TEST_ID}-save`)).toBeDisabled();
    await userEvent.selectOptions(reassign, 'TIER_2');
    await userEvent.click(screen.getByTestId(`${TEST_ID}-save`));

    await waitFor(() => expect(replaceEventSlotTiersMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { tiers: [{ tierKey: 'TIER_1', tierNumber: 1 }, { tierKey: 'TIER_2', tierNumber: 2 }], reassignOrphansTo: 'TIER_2' },
    })));
  });

  it('shows the refusal and stays open when the save is rejected', async () => {
    const { onClose } = renderDialog();
    replaceEventSlotTiersMock.mockResolvedValue({ error: { error: { code: 'SPORT_EVENT_TIERS_LOCKED', message: 'Tiers are locked.' } } });

    await userEvent.click(screen.getByTestId(`${TEST_ID}-down-0`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-save`));

    expect(await screen.findByText('This event has been released, so its tiers and prices are locked.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says the tiers may have saved and to Save again when the save fails unexpectedly, as when placing the field fails', async () => {
    const { onClose } = renderDialog();
    replaceEventSlotTiersMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } });

    await userEvent.click(screen.getByTestId(`${TEST_ID}-down-0`));
    await userEvent.click(screen.getByTestId(`${TEST_ID}-save`));

    expect(await screen.findByText('The tiers may have saved, but placing the field in them failed. Save again to finish.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
