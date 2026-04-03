import { render, screen } from '@testing-library/react';
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
              name: 'Weekly Pickem',
              description: 'Pick game winners each week.',
              sport: 'NFL',
              contestType: 'SINGLE_EVENT',
              selectionType: 'PICK_EM',
              config: { picksPerPeriod: 5 },
            },
          ],
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
  it('renders the honest single-event setup instead of the old fake event wizard', () => {
    render(
      <MemoryRouter>
        <CreateContestPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/This flow creates single-event contests only/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Contest Name')).toBeInTheDocument();
    expect(screen.queryByText('Season Long')).not.toBeInTheDocument();
    expect(screen.queryByText('Create custom event')).not.toBeInTheDocument();
    expect(screen.queryByText('Participant pool customization')).not.toBeInTheDocument();
  });
});
