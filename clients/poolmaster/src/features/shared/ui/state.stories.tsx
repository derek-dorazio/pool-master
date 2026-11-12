import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { EmptyState, ErrorState, InlineError, LoadingState, QueryState } from "./state";
import { Text } from "./text";

const refetch = () => undefined;

const meta = {
  title: "Feedback/QueryState",
  component: LoadingState,
} satisfies Meta<typeof LoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const LoadingInline: Story = { args: { size: "inline" } };
/** A list loads with faint placeholder rows under the spinner line. */
export const LoadingList: Story = { args: { body: "Loading members...", rows: 3 } };

export const Empty: StoryObj = {
  render: () => <EmptyState action={<Button size="sm">Create contest</Button>} body="Create one to get the league playing." title="No contests yet" />,
};

export const Error: StoryObj = {
  render: () => <ErrorState body="We couldn't load the leaderboard." onRetry={() => undefined} />,
};

export const InlineErrorLine: StoryObj = {
  render: () => <InlineError>That name is already taken.</InlineError>,
};

/** A failure reading again cannot fix (no access, not found) draws no Retry. */
export const ErrorPermanent: StoryObj = {
  render: () => <ErrorState body="Only members of this league can see it." onRetry={null} title="You do not have access to this league." />,
};

/** One component for a query's loading, error, empty and data branches. */
export const QueryBranches: StoryObj = {
  render: () => (
    <div className="grid gap-6">
      <QueryState query={{ data: undefined, isError: false, refetch }}>{() => null}</QueryState>
      <QueryState query={{ data: undefined, isError: true, refetch }}>{() => null}</QueryState>
      <QueryState empty={<Text>No entries yet.</Text>} isEmpty={(rows: string[]) => rows.length === 0} query={{ data: [], isError: false, refetch }}>
        {() => null}
      </QueryState>
      <QueryState query={{ data: ["Scheffler", "McIlroy"], isError: false, refetch }}>
        {(rows) => <Text>{rows.join(", ")}</Text>}
      </QueryState>
    </div>
  ),
};
