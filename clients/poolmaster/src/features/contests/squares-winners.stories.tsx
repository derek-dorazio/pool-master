import type { Meta, StoryObj } from '@storybook/react-vite';
import { SquaresWinners } from './squares-winners';

const meta = {
  title: 'Contests/SquaresWinners',
  component: SquaresWinners,
  args: {
    awayTeamName: 'Chiefs',
    homeTeamName: 'Eagles',
    leagueCode: 'STORY',
    leagueId: 'league-1',
    myEntryIds: ['e1'],
    squadIdOf: () => undefined,
    moments: [
      { periodNumber: 1, tag: 'Q1', winner: { periodNumber: 1, awayScore: 7, homeScore: 3, rowIndex: 7, columnIndex: 3, contestEntryId: 'e1', entryName: 'Birdie Bandits 1' } },
      { periodNumber: 2, tag: 'Q2', winner: { periodNumber: 2, awayScore: 14, homeScore: 10, rowIndex: 4, columnIndex: 0, contestEntryId: null, entryName: null } },
      { periodNumber: 3, tag: 'Q3', winner: null },
      { periodNumber: 4, tag: 'Final', winner: null },
    ],
  },
} satisfies Meta<typeof SquaresWinners>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-game: Q1 won by the viewer (Yours and a tick), Q2's box unclaimed ("No winner"), two still to play. */
export const SoFar: Story = {};
