import type { Meta, StoryObj } from '@storybook/react-vite';
import { BracketChampionCard } from './bracket-champion-card';
import { TOURNAMENT_TEAMS } from './test/bracket-tournament-fixture';

const auburn = TOURNAMENT_TEAMS.get('Auburn');
const kentucky = TOURNAMENT_TEAMS.get('Kentucky');
if (!auburn || !kentucky) throw new Error('The tournament fixture lost a team');

const meta = {
  title: 'Contests/BracketChampionCard',
  component: BracketChampionCard,
  args: { champion: { team: auburn, isOut: false }, isOwnEntry: true },
  decorators: [(Story) => <div className="w-56"><Story /></div>],
} satisfies Meta<typeof BracketChampionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Still in: the gold trophy. */
export const StillIn: Story = {};
/** Out: the trophy greys and the name is struck through in red. */
export const Out: Story = { args: { champion: { team: kentucky, isOut: true } } };
/** Another member's bracket, in the leaderboard's dialog. */
export const SomeoneElses: Story = { args: { isOwnEntry: false } };
