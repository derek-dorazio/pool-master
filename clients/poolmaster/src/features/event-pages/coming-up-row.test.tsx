import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ComingUpRow } from './coming-up-row';
import { formatStartsIn } from './event-page-copy';
import { championshipWeekendFixture } from './event-page-test-fixtures';

const { listEventPagesMock } = vi.hoisted(() => ({ listEventPagesMock: vi.fn() }));

bindApiMocks({ listEventPages: listEventPagesMock });

function renderRow(sport?: 'AMERICAN_FOOTBALL') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ComingUpRow sport={sport} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listEventPagesMock.mockReset();
});

describe('Coming up row', () => {
  it('asks only for the pages with an edition coming and shows a card for each in the order the server sends, soonest first, naming its contest types and linking to the page', async () => {
    const superBowl = championshipWeekendFixture({
      id: 'page-sb',
      slug: 'super-bowl',
      offers: [{ ...championshipWeekendFixture().offers[0], edition: { sportEventId: 'sb', name: 'Super Bowl', eventYear: 2027, startDate: '2027-02-07T23:30:00.000Z', endDate: null } }],
    });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture(), superBowl] } });
    renderRow('AMERICAN_FOOTBALL');

    const row = await screen.findByTestId('coming-up');
    const cards = within(row).getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual(['/play/american-football/championship-weekend', '/play/american-football/super-bowl']);
    expect(cards[0]).toHaveTextContent('Championship Weekend');
    expect(cards[0]).toHaveTextContent('Clutch Card · Bracket · Squares');
    expect(listEventPagesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sport: 'AMERICAN_FOOTBALL', upcoming: 'true' } }));
  });

  it('shows every sport\'s next three pages, asking for the upcoming pages of every sport', async () => {
    const pages = ['one', 'two', 'three', 'four'].map((slug) => championshipWeekendFixture({ id: `page-${slug}`, slug }));
    listEventPagesMock.mockResolvedValue({ data: { eventPages: pages } });
    renderRow();

    const row = await screen.findByTestId('coming-up');
    expect(within(row).getAllByRole('link').map((card) => card.getAttribute('href'))).toEqual([
      '/play/american-football/one',
      '/play/american-football/two',
      '/play/american-football/three',
    ]);
    expect(listEventPagesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { upcoming: 'true' } }));
  });

  it('leaves out a page between seasons, and shows nothing when no page has an edition coming', async () => {
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture({ offers: [] })] } });
    renderRow();

    await vi.waitFor(() => expect(listEventPagesMock).toHaveBeenCalled());
    expect(screen.queryByTestId('coming-up')).not.toBeInTheDocument();
  });
});

describe('formatStartsIn', () => {
  const NOW = new Date('2027-01-01T12:00:00.000Z');

  it('says how far off an edition starts: tomorrow, in days under two weeks, else in weeks, and under way once started', () => {
    expect(formatStartsIn('2027-01-02T12:00:00.000Z', NOW)).toBe('Tomorrow');
    expect(formatStartsIn('2027-01-06T12:00:00.000Z', NOW)).toBe('In 5 days');
    expect(formatStartsIn('2027-01-22T12:00:00.000Z', NOW)).toBe('In 3 weeks');
    expect(formatStartsIn('2026-12-31T12:00:00.000Z', NOW)).toBe('Under way');
  });
});
