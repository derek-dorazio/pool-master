import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TabbedCard } from "./tabbed-card";
import { Text } from "./text";

function SignInCard() {
  const [value, setValue] = useState("login");
  return (
    <div className="max-w-md">
      <TabbedCard
        aria-label="Sign in or create account"
        onValueChange={setValue}
        radius="panel"
        tabs={[
          { label: "Sign in", value: "login", content: <Text>The sign-in form goes here.</Text> },
          { label: "Create account", value: "register", content: <Text>The create account form goes here.</Text> },
        ]}
        value={value}
      />
    </div>
  );
}

const meta = {
  title: "Navigation/TabbedCard",
  component: SignInCard,
} satisfies Meta<typeof SignInCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sign in / Create account on the signed-out home: tabs along the top, one view at a time. */
export const Default: Story = {};
