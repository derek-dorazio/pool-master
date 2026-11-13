import type { Meta, StoryObj } from "@storybook/react-vite";
import { PendingPage } from "./pending-page";
import { ErrorState, LoadingState } from "./state";

const meta = {
  title: "Feedback/PendingPage",
  component: PendingPage,
  args: { children: <LoadingState body="Loading this member..." /> },
} satisfies Meta<typeof PendingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const LoadingWithTabs: Story = { args: { hasTabs: true, children: <LoadingState body="Loading contest..." /> } };
export const Failed: Story = {
  args: { children: <ErrorState body="We couldn't load this contest." onRetry={() => undefined} /> },
};
