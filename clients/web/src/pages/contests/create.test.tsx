import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as CreateContestPage } from './create';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'my-leagues') {
        return {
          data: {
            leagues: [
              { id: 'league-1', name: 'Spring League', role: 'owner' },
            ],
          },
          isLoading: false,
        };
      }

      if (queryKey[0] === 'selection-templates') {
        return {
          data: [
            {
              id: 'template-1',
              name: 'Masters Pick 6',
              description: 'Pick one golfer from each tier.',
              sport: 'NFL',
              contestType: 'SINGLE_EVENT',
              selectionType: 'TIERED',
              config: { tierCount: 6, tierSize: 10, picksPerTier: 1, tierAssignmentMethod: 'WORLD_RANKING' },
            },
            {
              id: 'template-2',
              name: 'Budget Pick 6',
              description: 'Build a roster under a salary cap.',
              sport: 'NFL',
              contestType: 'SINGLE_EVENT',
              selectionType: 'BUDGET_PICK',
              config: { budget: 5000000, rosterSize: 6, pricingMethod: 'WORLD_RANKING' },
            },
          ],
          isLoading: false,
        };
      }

      if (queryKey[0] === 'events') {
        return {
          data: {
            events: [
              {
                id: 'event-1',
                sport: 'NFL',
                name: 'Championship Weekend',
                venue: 'Main Venue',
                location: 'Atlanta, GA',
                status: 'SCHEDULED',
                startDate: '2026-04-10T15:00:00.000Z',
                endDate: '2026-04-12T15:00:00.000Z',
                participantCount: 16,
                fieldLocked: false,
              },
            ],
          },
          isLoading: false,
        };
      }

      if (queryKey[0] === 'scoring-templates') {
        return {
          data: { templates: [{ key: 'pickem-default', sport: 'NFL' }] },
          isLoading: false,
        };
      }

      return { data: undefined, isLoading: false };
    },
  };
});

describe('CreateContestPage', () => {
  it('renders the honest event-backed setup instead of the old fake event wizard', () => {
    render(
      <MemoryRouter>
        <CreateContestPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/draft-once tournament contests only/i)).toBeInTheDocument();
    expect(screen.getByText('Select Event')).toBeInTheDocument();
    expect(screen.getByText(/Choose a sport first to load ingested tournament events/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Contest Name')).toBeInTheDocument();
    expect(screen.queryByText('Season Long')).not.toBeInTheDocument();
    expect(screen.queryByText('Create custom event')).not.toBeInTheDocument();
    expect(screen.queryByText('Participant pool customization')).not.toBeInTheDocument();
  });

  it('lets commissioners customize tier setup before review', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CreateContestPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /spring league/i }));
    await user.click(screen.getByRole('button', { name: /nfl/i }));
    await user.click(screen.getByRole('button', { name: /championship weekend/i }));
    await user.type(screen.getByLabelText('Contest Name'), 'Championship Pick 6');
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText(/tier count: 6/i)).toBeInTheDocument();
    expect(screen.getByText(/picks per tier: 1/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /masters pick 6/i }));
    expect(screen.getByLabelText('Tier Count')).toHaveValue(6);
    expect(screen.getByLabelText('Tier Size')).toHaveValue(10);

    fireEvent.change(screen.getByLabelText('Tier Count'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Tier Size'), { target: { value: '12' } });
    await user.selectOptions(screen.getByLabelText('Tier Assignment'), 'ODDS');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByRole('button', { name: /pickem-default/i }));
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Contestant Setup')).toBeInTheDocument();
    expect(screen.getByText(/tier count: 8/i)).toBeInTheDocument();
    expect(screen.getByText(/tier size: 12/i)).toBeInTheDocument();
    expect(screen.getByText(/picks per tier: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/tier assignment: Odds/i)).toBeInTheDocument();
  }, 10000);

  it('lets commissioners customize budget pricing inputs before review', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CreateContestPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /spring league/i }));
    await user.click(screen.getByRole('button', { name: /nfl/i }));
    await user.click(screen.getByRole('button', { name: /championship weekend/i }));
    await user.type(screen.getByLabelText('Contest Name'), 'Championship Budget 6');
    await user.click(screen.getByRole('button', { name: /next/i }));

    await user.click(screen.getByRole('button', { name: /budget pick 6/i }));
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '3500000' } });
    fireEvent.change(screen.getByLabelText('Roster Size'), { target: { value: '5' } });
    await user.selectOptions(screen.getByLabelText('Pricing Formula'), 'ODDS');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await user.click(screen.getByRole('button', { name: /pickem-default/i }));
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Contestant Setup')).toBeInTheDocument();
    expect(screen.getByText(/budget: \$3,500,000/i)).toBeInTheDocument();
    expect(screen.getByText(/roster size: 5/i)).toBeInTheDocument();
    expect(screen.getByText(/pricing: Odds/i)).toBeInTheDocument();
  }, 10000);
});
