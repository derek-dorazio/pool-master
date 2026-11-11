import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { EmptyState, ErrorState, InlineError, LoadingState, QueryState } from "./state";
import { Text } from "./text";

const meta = {
  title: "Feedback/QueryState",
  component: LoadingState,
} satisfies Meta<typeof LoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const LoadingInline: Story = { args: { size: "inline" } };

export const Empty: StoryObj = {
  render: () => <EmptyState action={<Button size="sm">Create contest</Button>} body="Create one to get the league playing." title="No contests yet" />,
};

export const Error: StoryObj = {
  render: () => <ErrorState action={<Button size="sm" variant="secondary">Retry</Button>} body="Check your connection and try again." title="We couldn't load the leaderboard" />,
};

export const InlineErrorLine: StoryObj = {
  render: () => <InlineError>That name is already taken.</InlineError>,
};

/** One component for a query's loading, error, empty and data branches. */
export const QueryBranches: StoryObj = {
  render: () => (
    <div className="grid gap-6">
      <QueryState query={{ data: undefined, isError: false }}>{() => null}</QueryState>
      <QueryState query={{ data: undefined, isError: true }}>{() => null}</QueryState>
      <QueryState empty={<Text>No entries yet.</Text>} isEmpty={(rows: string[]) => rows.length === 0} query={{ data: [], isError: false }}>
        {() => null}
      </QueryState>
      <QueryState query={{ data: ["Scheffler", "McIlroy"], isError: false }}>
        {(rows) => <Text>{rows.join(", ")}</Text>}
      </QueryState>
    </div>
  ),
};
