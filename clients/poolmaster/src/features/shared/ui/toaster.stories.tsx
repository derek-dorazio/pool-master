import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Toaster } from "./toaster";
import { showToast } from "./toast-store";

const meta = {
  title: "Feedback/Toaster",
  component: Toaster,
  decorators: [
    (Story) => (
      <>
        <Button onClick={() => showToast({ title: "Profile saved", tone: "success" })} type="button">
          Save
        </Button>
        <Story />
      </>
    ),
  ],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The app's one place for toasts: a save closes its dialog and confirms here. */
export const Default: Story = {};
