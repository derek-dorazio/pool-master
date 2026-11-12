import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { PublicInviteJoinPage } from "./page-templates";
import { Text } from "./text";

const meta = {
  title: "Page/PublicInviteJoinPage",
  component: PublicInviteJoinPage,
} satisfies Meta<typeof PublicInviteJoinPage>;

export default meta;

export const InviteJoin: StoryObj = {
  render: () => (
    <PublicInviteJoinPage
      context={<Text variant="meta">Sam Rivera invited you</Text>}
      primaryAction={<Button>Join league</Button>}
      secondaryAction={<Button variant="ghost">Not now</Button>}
      title="Join Weekend Warriors"
    >
      <Text>24 members · Golf</Text>
    </PublicInviteJoinPage>
  ),
};
