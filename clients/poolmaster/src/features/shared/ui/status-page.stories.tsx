import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { Button, LinkButton } from "./button";
import { Notice } from "./notice";
import { StatusPage } from "./status-page";

const meta = {
  title: "Page templates/StatusPage",
  component: StatusPage,
  decorators: [(Story) => <MemoryRouter><Story /></MemoryRouter>],
  args: {
    kind: "notFound",
    title: "Page not found",
    body: "The link may be old or mistyped.",
    action: <LinkButton to="/">Go to my leagues</LinkButton>,
  },
} satisfies Meta<typeof StatusPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotFound: Story = {};
export const Crash: Story = {
  args: { kind: "error", title: "Something went wrong", body: "Reload to try again.", action: <Button>Reload</Button> },
};
export const Expired: Story = {
  args: { kind: "expired", title: "This link has expired", body: "Reset links work once, for a short time.", action: <LinkButton to="/">Send a new link</LinkButton> },
};
export const Done: Story = {
  args: { kind: "done", title: "Check your email", body: "If an account matches, a reset link is on its way.", action: <LinkButton to="/" variant="secondary">Back to sign in</LinkButton> },
};
export const ConfirmWithError: Story = {
  args: {
    kind: "confirm",
    title: "Put your email address back",
    body: "Everyone is signed out and you'll set a new password.",
    children: <Notice tone="danger">Another account uses that email address now.</Notice>,
    action: <Button>Put my address back</Button>,
  },
};
