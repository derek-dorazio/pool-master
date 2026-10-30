import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getSportDefinition, Sport } from '@poolmaster/shared/domain';
import { PlayInPlacesCard } from './play-in-places-card';
import { fieldEntryFixture, participantFixture, sportEventFixture } from './sport-test-fixtures';

// #704: a tennis draw's places filled after qualifying are qualifier places, in the sport's own word.
describe('PlayInPlacesCard wording', () => {
  const sinner = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Jannik Sinner' }) });
  const qualifier = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', isPlayInPlace: true, participant: participantFixture({ id: 'p-2', name: 'Qualifier 1' }) });

  function renderCard(sport: Sport) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <PlayInPlacesCard event={sportEventFixture({ status: 'DRAFT' })} field={[sinner, qualifier]} vocabulary={getSportDefinition(sport).vocabulary} />
      </QueryClientProvider>,
    );
  }

  it('calls a tennis draw\'s places qualifier places in the heading, the help text and every button', () => {
    renderCard(Sport.TENNIS);

    const card = screen.getByTestId('root-admin-play-in-places');
    expect(card).toHaveTextContent('Qualifier places');
    expect(card).toHaveTextContent('Mark each place a qualifier fills later. Its player is named after the draw is released.');
    expect(screen.getByTestId('root-admin-play-in-unmark-sep-2')).toHaveTextContent('Remove qualifier mark');
    expect(card).toHaveTextContent('Mark a qualifier place');
    expect(screen.getByTestId('root-admin-play-in-mark')).toHaveTextContent('Mark as qualifier place');
    expect(card).not.toHaveTextContent(/play-in/i);
  });

  it('titles the card with the sport\'s word for its places, as Qualifier places for a tennis draw', () => {
    renderCard(Sport.TENNIS);

    expect(screen.getByRole('region', { name: 'Qualifier places' })).toHaveAttribute('data-testid', 'root-admin-play-in-places');
  });

  it('keeps play-in places for a sport with no word of its own, as basketball\'s First Four places', () => {
    renderCard(Sport.BASKETBALL);

    const card = screen.getByTestId('root-admin-play-in-places');
    expect(card).toHaveTextContent('Play-in places');
    expect(card).toHaveTextContent('Mark each place a play-in fills later. Its team is named after the tournament is released.');
    expect(screen.getByTestId('root-admin-play-in-mark')).toHaveTextContent('Mark as play-in place');
  });
});
