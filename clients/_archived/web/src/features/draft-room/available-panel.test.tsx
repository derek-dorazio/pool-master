import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvailablePanel } from './available-panel';

const mockUseAvailableParticipants = vi.fn();

vi.mock('./hooks/use-draft', () => ({
  useAvailableParticipants: (...args: unknown[]) => mockUseAvailableParticipants(...args),
}));

describe('AvailablePanel', () => {
  beforeEach(() => {
    mockUseAvailableParticipants.mockReturnValue({
      data: [
        {
          id: 'p1',
          name: 'Scottie Scheffler',
          position: '',
          team: 'USA',
          ranking: 1,
          formRating: 1,
          injuryStatus: 'HEALTHY',
          tier: 'Tier 1',
          price: 18000,
        },
        {
          id: 'p2',
          name: 'Rory McIlroy',
          position: '',
          team: 'IRL',
          ranking: 2,
          formRating: 2,
          injuryStatus: 'HEALTHY',
          tier: 'Tier 1',
          price: 17000,
        },
      ],
      isLoading: false,
    });
  });

  it('uses generic contestant copy and avoids hardcoded fantasy positions when none exist', async () => {
    const user = userEvent.setup();

    render(
      <AvailablePanel
        draftId="contest-1"
        draftedParticipantIds={[]}
        onDraft={vi.fn()}
        onSelect={vi.fn()}
        isDrafting={false}
        isMyPick
        selectionType="BUDGET_PICK"
      />,
    );

    expect(screen.getByPlaceholderText('Search contestants...')).toBeInTheDocument();
    expect(screen.getByText('2 available contestants')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filters/i }));

    expect(screen.queryByText('QB')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sort: Price' })).toBeInTheDocument();
  });

  it('shows tier badges for tiered contests', () => {
    render(
      <AvailablePanel
        draftId="contest-1"
        draftedParticipantIds={[]}
        onDraft={vi.fn()}
        onSelect={vi.fn()}
        isDrafting={false}
        isMyPick
        selectionType="TIERED"
      />,
    );

    expect(screen.getAllByText('Tier 1').length).toBeGreaterThan(0);
  });
});
