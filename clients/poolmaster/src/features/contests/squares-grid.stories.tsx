import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SquaresBoxDto, SquaresWinnerDto } from '@/lib/api';
import { SquaresGrid, type SquaresGridBoard } from './squares-grid';
import { DRAWN_DIGITS, squaresGameFixture } from './test/squares-fixtures';

const NAMES = ['Sharks 1', 'Big Hitters', 'Bay Hawks', 'Mile High', 'Lakers 2', 'Mom'];

/** Most of the board claimed, by six entries in turn; the viewer's is Sharks 1 (e0). */
const BOXES: SquaresBoxDto[] = Array.from({ length: 100 }, (_, index) => index)
  .filter((index) => index % 7 !== 3)
  .map((index) => ({
    rowIndex: Math.floor(index / 10),
    columnIndex: index % 10,
    contestEntryId: `e${index % NAMES.length}`,
    entryName: NAMES[index % NAMES.length] ?? '',
  }));

const winner = (periodNumber: number, homeScore: number, awayScore: number): SquaresWinnerDto => {
  const rowIndex = DRAWN_DIGITS.rowDigits.indexOf(awayScore % 10);
  const columnIndex = DRAWN_DIGITS.columnDigits.indexOf(homeScore % 10);
  const box = BOXES.find((each) => each.rowIndex === rowIndex && each.columnIndex === columnIndex);
  return { periodNumber, homeScore, awayScore, rowIndex, columnIndex, contestEntryId: box?.contestEntryId ?? null, entryName: box?.entryName ?? null };
};

const BEFORE_DRAW: SquaresGridBoard = {
  awayTeamName: 'Chiefs',
  homeTeamName: 'Eagles',
  boxes: BOXES,
  digits: null,
  entries: NAMES.map((entryName, index) => ({ contestEntryId: `e${index}`, entryName, squadId: `s${index}`, boxCount: 0, periodsWon: 0, displayPosition: null })),
  game: squaresGameFixture(),
  periodLayout: 'QUARTERS',
  winners: [],
};

const meta = {
  title: 'Contests/SquaresGrid',
  component: SquaresGrid,
  args: {
    actionFor: (box) => (box === null ? 'claim' : box.contestEntryId === 'e0' ? 'clear' : null),
    board: BEFORE_DRAW,
    isBusy: false,
    myEntryIds: ['e0'],
    onBoxAction: () => undefined,
  },
  decorators: [(Story) => <div className="max-w-sm"><Story /></div>],
} satisfies Meta<typeof SquaresGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the draw: "?" digits; open boxes claim on a tap, the viewer's own clear. */
export const BeforeDraw: Story = {};

/** Drawn, before kickoff: digits along both bands; every box opens its holder's name and numbers. */
export const Drawn: Story = {
  args: { actionFor: () => null, board: { ...BEFORE_DRAW, digits: DRAWN_DIGITS } },
};

/** Live in Q3: Q1 and Q2 won (gold, tagged), the score's row and column tinted, the box winning now outlined green. */
export const Live: Story = {
  args: {
    actionFor: () => null,
    board: {
      ...BEFORE_DRAW,
      digits: DRAWN_DIGITS,
      game: squaresGameFixture({
        status: 'IN_PROGRESS',
        homeScore: 10,
        awayScore: 17,
        periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 7 }, { periodNumber: 2, homeScore: 10, awayScore: 14 }],
      }),
      winners: [winner(1, 3, 7), winner(2, 10, 14)],
    },
  },
};

/** Final: four winners, one box winning twice (Q1/F). */
export const Final: Story = {
  args: {
    actionFor: () => null,
    board: {
      ...BEFORE_DRAW,
      digits: DRAWN_DIGITS,
      game: squaresGameFixture({
        status: 'COMPLETED',
        homeScore: 23,
        awayScore: 17,
        periodScores: [
          { periodNumber: 1, homeScore: 3, awayScore: 7 },
          { periodNumber: 2, homeScore: 10, awayScore: 14 },
          { periodNumber: 3, homeScore: 17, awayScore: 14 },
        ],
      }),
      winners: [winner(1, 3, 7), winner(2, 10, 14), winner(3, 17, 14), winner(4, 23, 17)],
    },
  },
};
