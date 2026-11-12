import type { Meta, StoryObj } from '@storybook/react-vite';
import { SquaresWinners } from './squares-winners';

const meta = {
  title: 'Contests/SquaresWinners',
  component: SquaresWinners,
  args: {
    awayTeamName: 'Chiefs',
    homeTeamName: 'Eagles',
    isFinal: false,
    leagueCode: 'STORY',
    leagueId: 'league-1',
    squadIdOf: () => undefined,
    moments: [
      { periodNumber: 1, label: 'Q1', winner: { periodNumber: 1, awayScore: 7, homeScore: 3, rowIndex: 7, columnIndex: 3, contestEntryId: 'e1', entryName: 'Birdie Bandits 1' } },
      { periodNumber: 2, label: 'Half', winner: { periodNumber: 2, awayScore: 14, homeScore: 10, rowIndex: 4, columnIndex: 0, contestEntryId: null, entryName: null } },
      { periodNumber: 3, label: 'Q3', winner: null },
      { periodNumber: 4, label: 'Final', winner: null },
    ],
  },
} satisfies Meta<typeof SquaresWinners>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-game: two quarters scored (one box unclaimed, "No winner"), two still to play. */
export const SoFar: Story = {};
