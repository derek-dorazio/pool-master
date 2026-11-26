import type { Meta, StoryObj } from '@storybook/react-vite';
import { BracketView } from './bracket-view';
import { drawBracket } from './bracket-view-model';
import { emptyBracketGames } from './test/bracket-fixtures';
import { midTournamentGames, tournamentGames } from './test/bracket-tournament-fixture';


const meta = {
  title: 'Contests/BracketView',
  component: BracketView,
  args: {
    drawing: drawBracket(midTournamentGames()),
    isOwnEntry: true,
    picking: null,
    tiebreaker: 'Tiebreaker: 148 total points in the final.',
  },
} satisfies Meta<typeof BracketView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * After the Sweet 16, read-only as the leaderboard's dialog shows it: right picks green, wrong
 * ones struck through with the real winner in grey, a later pick whose team is out struck too.
 * The whole bracket at desktop width; one region at a time, with its round row, on a phone.
 */
export const MidTournament: Story = {};

/** Before the first game: every pick still to play, nothing marked. */
export const BeforeTipOff: Story = {
  args: { drawing: drawBracket(tournamentGames({ playedRounds: 0 })), tiebreaker: undefined },
};

/** The champion went out: the trophy greys and the name is struck through. */
export const ChampionOut: Story = {
  args: { drawing: drawBracket(tournamentGames({ playedRounds: 5, realUpsets: [[5, 'Duke']] })) },
};

/** The pick page: an empty bracket, each first-round team a choice and later lines waiting. */
export const Picking: Story = {
  args: {
    drawing: drawBracket(emptyBracketGames()),
    picking: { isBusy: false, onPick: () => undefined },
    tiebreaker: undefined,
  },
};
