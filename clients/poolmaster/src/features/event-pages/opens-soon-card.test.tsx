import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { championshipWeekendFixture, offerFixture } from './event-page-test-fixtures';
import { OpensSoonCard } from './opens-soon-card';

const { getEventPageMock } = vi.hoisted(() => ({ getEventPageMock: vi.fn() }));

bindApiMocks({ getEventPage: getEventPageMock });

function renderCard(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <OpensSoonCard leagueCode="OFFICE" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CLUTCH_CARD = '/league/OFFICE?sport=american-football&page=championship-weekend&template=template-championship-weekend-tiered-redzone';

afterEach(() => getEventPageMock.mockReset());

describe('Opens soon card', () => {
  it('tells a commissioner sent home before the contest opens when it will, and that an email follows', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });

    renderCard(CLUTCH_CARD);

    const card = await screen.findByTestId('league-opens-soon');
    expect(card).toHaveTextContent('Championship Weekend opens for contests when the four teams are set');
    expect(card).toHaveTextContent('We\'ll email you when your Clutch Card can be set up.');
  });

  it('offers the setup once the contest has opened', async () => {
    const page = championshipWeekendFixture();
    getEventPageMock.mockResolvedValue({
      data: { eventPage: { ...page, offers: [offerFixture('championship-weekend-tiered-redzone', { isPrimary: true })] } },
    });

    renderCard(CLUTCH_CARD);

    expect(await screen.findByTestId('league-opens-soon-set-up')).toHaveAttribute(
      'href',
      '/league/OFFICE/admin/contests/new?template=template-championship-weekend-tiered-redzone&event=event-championship-weekend-tiered-redzone',
    );
  });

  it('shows nothing on a league home reached any other way', () => {
    renderCard('/league/OFFICE');

    expect(screen.queryByTestId('league-opens-soon')).not.toBeInTheDocument();
    expect(getEventPageMock).not.toHaveBeenCalled();
  });
});
