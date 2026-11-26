import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setDeviceWidth } from '@/test/device-color-scheme';
import { BracketView } from './bracket-view';
import { drawBracket } from './bracket-view-model';
import { TEAMS, emptyBracketGames } from './test/bracket-fixtures';
import { midTournamentGames, tournamentGames } from './test/bracket-tournament-fixture';


function renderView(games = midTournamentGames(), picking: Parameters<typeof BracketView>[0]['picking'] = null) {
  render(<BracketView drawing={drawBracket(games)} isOwnEntry picking={picking} tiebreaker="Tiebreaker: 148 total points in the final." />);
}

/** Radix tabs switch on the press, as a tap does. */
function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

const shownRounds = () => screen.getAllByTestId('bracket-round-nav-shown').map((label) => label.textContent);

describe('BracketView on a phone', () => {
  it('shows one region at a time under region tabs, the regions in bracket order then the Final Four', () => {
    renderView();

    expect(screen.getByTestId('bracket-board')).toHaveAttribute('data-layout', 'phone');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['South', 'East', 'West', 'Midwest', 'Final Four']);
    expect(screen.getByRole('tab', { name: 'South' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('bracket-game-4-1')).toBeInTheDocument();
    expect(screen.queryByTestId('bracket-game-4-2')).not.toBeInTheDocument();
  });

  it('opens a region at the round being played, two rounds and the region\'s winner, with the round before as a link back', () => {
    renderView();

    expect(shownRounds()).toEqual(['Sweet 16', 'Elite Eight']);
    expect(screen.getByTestId('bracket-round-nav-back')).toHaveTextContent('Round of 32');
    expect(screen.queryByTestId('bracket-round-nav-next')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-region-winner')).toHaveTextContent('Auburn');
    expect(screen.queryByTestId('bracket-champion')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bracket-view-tiebreaker')).not.toBeInTheDocument();
  });

  it('moves a round at a time with the round links, dropping the winner until the last round is back on screen', () => {
    renderView();

    fireEvent.click(screen.getByTestId('bracket-round-nav-back'));
    expect(shownRounds()).toEqual(['Round of 32', 'Sweet 16']);
    expect(screen.getByTestId('bracket-round-nav-back')).toHaveTextContent('First Round');
    expect(screen.getByTestId('bracket-round-nav-next')).toHaveTextContent('Elite Eight');
    expect(screen.queryByTestId('bracket-region-winner')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bracket-round-nav-back'));
    expect(shownRounds()).toEqual(['First Round', 'Round of 32']);
    expect(screen.queryByTestId('bracket-round-nav-back')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bracket-round-nav-next'));
    fireEvent.click(screen.getByTestId('bracket-round-nav-next'));
    expect(shownRounds()).toEqual(['Sweet 16', 'Elite Eight']);
    expect(screen.getByTestId('bracket-region-winner')).toBeInTheDocument();
  });

  it('moves rounds with a swipe, as the links do, and ignores a touch that barely moves', () => {
    renderView();
    const rounds = screen.getByTestId('bracket-region-rounds');
    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(rounds, { touches: [{ clientX: from }] });
      fireEvent.touchEnd(rounds, { changedTouches: [{ clientX: to }] });
    };

    swipe(100, 300);
    expect(shownRounds()).toEqual(['Round of 32', 'Sweet 16']);
    swipe(100, 120);
    expect(shownRounds()).toEqual(['Round of 32', 'Sweet 16']);
    swipe(300, 100);
    expect(shownRounds()).toEqual(['Sweet 16', 'Elite Eight']);
  });

  it('opens before the tournament at the first round', () => {
    renderView(tournamentGames({ playedRounds: 0 }));

    expect(shownRounds()).toEqual(['First Round', 'Round of 32']);
    expect(screen.getByTestId('bracket-round-nav-next')).toHaveTextContent('Sweet 16');
  });

  it('lays the Final Four tab out like the desktop middle, with no round row: semifinals either side, the final with the champion, then the tiebreaker', () => {
    renderView();
    openTab('Final Four');

    const middle = screen.getByTestId('bracket-middle');
    expect(screen.queryByTestId('bracket-round-nav')).not.toBeInTheDocument();
    expect(within(middle).getByTestId('bracket-game-5-1')).toHaveTextContent('Auburn');
    expect(within(middle).getByTestId('bracket-game-5-2')).toHaveTextContent('Kentucky');
    expect(within(middle).getByTestId('bracket-game-6-1')).toBeInTheDocument();
    expect(within(middle).getByTestId('bracket-champion')).toHaveTextContent('Your champion');
    expect(within(middle).getByTestId('bracket-champion-name')).toHaveTextContent('Auburn');
    expect(within(middle).getByTestId('bracket-view-tiebreaker')).toHaveTextContent('Tiebreaker: 148 total points in the final.');
    const [semifinalOne, final, semifinalTwo] = ['bracket-game-5-1', 'bracket-game-6-1', 'bracket-game-5-2'].map((id) => screen.getByTestId(id));
    expect(semifinalOne.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(final.compareDocumentPosition(semifinalTwo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('greys the champion card and strikes the name once the champion is out', () => {
    renderView(tournamentGames({ playedRounds: 5, realUpsets: [[5, 'Duke']] }));
    openTab('Final Four');

    expect(screen.getByTestId('bracket-champion')).toHaveAttribute('data-out', 'true');
    expect(screen.getByTestId('bracket-champion-name')).toHaveClass('line-through');
    expect(screen.getByLabelText('Out')).toBeInTheDocument();
  });

  it('picks a team when its line is tapped on the pick page, region by region', () => {
    const onPick = vi.fn();
    render(
      <BracketView
        drawing={drawBracket(emptyBracketGames())}
        isOwnEntry
        picking={{ isBusy: false, onPick }}
      />,
    );

    fireEvent.click(screen.getByTestId(`bracket-game-1-1-team-${TEAMS.vermont.sportEventParticipantId}`));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ matchNumber: 1 }), TEAMS.vermont);
    expect(screen.getByTestId('bracket-game-2-1-open-home')).toHaveTextContent('Elite Eight winner');
  });

  it('holds every pick while one is saving', () => {
    render(
      <BracketView
        drawing={drawBracket(emptyBracketGames())}
        isOwnEntry
        picking={{ isBusy: true, onPick: vi.fn() }}
      />,
    );

    expect(screen.getByTestId(`bracket-game-1-1-team-${TEAMS.duke.sportEventParticipantId}`)).toBeDisabled();
  });

  it('draws a bracket with no regions as its middle alone, with no tabs', () => {
    renderView(emptyBracketGames().map((game) => ({ ...game, regionLabel: null })));

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('bracket-middle')).toBeInTheDocument();
  });
});

describe('BracketView on a desktop', () => {
  it('draws every region and the middle at once, with no tabs or round row', () => {
    setDeviceWidth(1280);
    renderView();

    expect(screen.getByTestId('bracket-board')).toHaveAttribute('data-layout', 'desktop');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bracket-round-nav')).not.toBeInTheDocument();
    for (const region of ['South', 'East', 'West', 'Midwest']) {
      expect(screen.getByRole('region', { name: region })).toBeInTheDocument();
    }
    expect(screen.getByTestId('bracket-champion-name')).toHaveTextContent('Auburn');
    expect(screen.getByTestId('bracket-view-tiebreaker')).toBeInTheDocument();
  });

  it('switches to one region at a time when the window narrows to a phone', () => {
    setDeviceWidth(1280);
    renderView();
    expect(screen.getByTestId('bracket-board')).toHaveAttribute('data-layout', 'desktop');

    act(() => setDeviceWidth(390));
    expect(screen.getByTestId('bracket-board')).toHaveAttribute('data-layout', 'phone');
  });
});
