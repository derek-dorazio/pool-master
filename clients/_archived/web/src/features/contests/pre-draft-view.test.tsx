import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PreDraftView } from './pre-draft-view';

const contest = {
  id: 'contest-1',
  name: 'Masters Pool',
  status: 'OPEN',
  contestType: 'ROSTER',
  selectionType: 'BUDGET_PICK',
  scoringEngine: 'STROKE_PLAY',
  leagueId: 'league-1',
  entryCount: 12,
  startsAt: '2026-04-10T15:00:00Z',
  lockAt: '2026-04-10T14:30:00Z',
  sport: 'GOLF',
};

describe('PreDraftView', () => {
  it('renders contest labels from the shared contest enums and optional real metadata', () => {
    render(
      <MemoryRouter>
        <PreDraftView
          contest={contest}
          league={{ id: 'league-1', name: 'Spring League' }}
          eventName="The Masters 2026"
          selectionConfig={{
            budget: 50000,
            rosterSize: 6,
            bestBallN: 4,
            pricingMethod: 'ODDS',
            tierCount: 6,
          }}
          entryMeta={{
            currentEntries: 12,
            maxEntries: 20,
            entries: [
              { id: 'entry-1', name: 'Team Alpha', ownerName: 'Alice' },
            ],
          }}
          joinMeta={{ entryFeeCents: 2500, prizePoolCents: 120000 }}
          onJoin={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Budget Pick')).toHaveLength(2);
    expect(screen.getByText('Stroke Play')).toBeInTheDocument();
    expect(screen.getByText('Spring League')).toBeInTheDocument();
    expect(screen.getByText('The Masters 2026')).toBeInTheDocument();
    expect(screen.getByText('$50,000')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Odds')).toBeInTheDocument();
    expect(screen.getByText('Tier Count')).toBeInTheDocument();
    expect(screen.getByText('Best 4 count')).toBeInTheDocument();
    expect(screen.getByText('8 spots left')).toBeInTheDocument();
    expect(screen.getByText('Enter Contest')).toBeInTheDocument();
  });

  it('does not invent join state when no real join metadata is provided', () => {
    render(
      <MemoryRouter>
        <PreDraftView contest={contest} />
      </MemoryRouter>,
    );

    expect(screen.queryByText("You're entered!")).not.toBeInTheDocument();
    expect(screen.queryByText('Enter Contest')).not.toBeInTheDocument();
    expect(screen.getByText('No entry roster is available from this view yet.')).toBeInTheDocument();
  });

  it('uses entry-room wording for non-snake joined contests', () => {
    render(
      <MemoryRouter>
        <PreDraftView
          contest={contest}
          joinMeta={{ isJoined: true }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("You're entered!")).toBeInTheDocument();
    expect(screen.getByText('Entry room opens 5 min before start')).toBeInTheDocument();
    expect(screen.queryByText('Draft room opens 5 min before start')).not.toBeInTheDocument();
  });

  it("uses pick'em wording for non-snake countdown and entry actions", () => {
    render(
      <MemoryRouter>
        <PreDraftView
          contest={{ ...contest, selectionType: 'PICK_EM' }}
          entryMeta={{ currentEntries: 12, maxEntries: 20 }}
          onJoin={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Contest opens in')).toBeInTheDocument();
    expect(screen.getByText('Predictions (12 / 20)')).toBeInTheDocument();
    expect(screen.getByText('8 prediction slots left')).toBeInTheDocument();
    expect(screen.getByText("Enter Pick'em Contest")).toBeInTheDocument();
  });
});
