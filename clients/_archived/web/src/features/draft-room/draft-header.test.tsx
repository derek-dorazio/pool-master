import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DraftHeader } from './draft-header';
import type { DraftState } from './hooks/use-draft';

function makeDraft(overrides: Partial<DraftState> = {}): DraftState {
  return {
    contestName: 'NFL Fantasy Draft 2026',
    selectionType: 'SNAKE_DRAFT',
    isTurnBased: true,
    rosterSize: 15,
    selectionConfig: { isExclusive: true, rounds: 15, rosterSize: 15 },
    status: 'LIVE',
    currentRound: 3,
    currentPickNumber: 7,
    totalPicks: 120,
    isMyPick: false,
    pickDeadline: new Date(Date.now() + 90_000).toISOString(),
    ...overrides,
  } as DraftState;
}

function renderHeader(draft: DraftState) {
  return render(
    <MemoryRouter>
      <DraftHeader draft={draft} />
    </MemoryRouter>,
  );
}

describe('DraftHeader', () => {
  it('renders contest name', () => {
    renderHeader(makeDraft());

    expect(screen.getByText('NFL Fantasy Draft 2026')).toBeInTheDocument();
  });

  it('shows status badge with correct text', () => {
    renderHeader(makeDraft({ status: 'LIVE' }));
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows PAUSED status badge', () => {
    renderHeader(makeDraft({ status: 'PAUSED' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('shows "Your Pick!" when isMyPick is true', () => {
    renderHeader(makeDraft({ isMyPick: true }));

    expect(screen.getByText('Your Pick!')).toBeInTheDocument();
  });

  it('does not show "Your Pick!" when isMyPick is false', () => {
    renderHeader(makeDraft({ isMyPick: false }));

    expect(screen.queryByText('Your Pick!')).not.toBeInTheDocument();
  });

  it('shows timer value', () => {
    // With a deadline 90 seconds from now, timer should show 1:30 or 1:29
    renderHeader(makeDraft());

    // The timer renders as a span with a time format like "1:30"
    expect(screen.getByText(/\d:\d{2}/)).toBeInTheDocument();
  });

  it('shows round and pick info', () => {
    renderHeader(makeDraft({ currentRound: 3, currentPickNumber: 7, totalPicks: 120 }));

    expect(screen.getByText('Round 3, Pick 7 of 120')).toBeInTheDocument();
  });

  it('has Leave button', () => {
    renderHeader(makeDraft());

    expect(screen.getByText('Leave')).toBeInTheDocument();
  });

  it('shows contestant setup summary for budget and tiered contests', () => {
    renderHeader(makeDraft({
      selectionType: 'BUDGET_PICK',
      isTurnBased: false,
      selectionConfig: {
        isExclusive: false,
        rosterSize: 6,
        budget: 50000,
        pricingMethod: 'ODDS',
      },
    }));

    expect(screen.getByText(/Budget: \$50,000/)).toBeInTheDocument();
    expect(screen.getByText(/Pricing: Odds/)).toBeInTheDocument();
  });
});
