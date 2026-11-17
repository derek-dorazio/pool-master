import type { Meta, StoryObj } from '@storybook/react-vite';
import { squaresScoreByPeriod } from './squares-board';
import { SquaresScoreTable } from './squares-score-table';
import { squaresGameFixture } from './test/squares-fixtures';

const meta = {
  title: 'Contests/SquaresScoreTable',
  component: SquaresScoreTable,
  args: {
    awayTeamName: 'Chiefs',
    homeTeamName: 'Eagles',
    score: squaresScoreByPeriod(squaresGameFixture({
      status: 'IN_PROGRESS',
      homeScore: 10,
      awayScore: 17,
      periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 7 }, { periodNumber: 2, homeScore: 10, awayScore: 14 }],
    }), 'QUARTERS'),
  },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof SquaresScoreTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Live in Q3: Q3 tinted, Q4 not started. */
export const Live: Story = {};

/** Before kickoff: every period and total a dash. */
export const NotStarted: Story = { args: { score: squaresScoreByPeriod(squaresGameFixture(), 'QUARTERS') } };
