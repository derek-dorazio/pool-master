import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TabbedCard } from "./tabbed-card";

function Harness({ initial = "login", radius }: { initial?: string; radius?: "panel" | "sm" }) {
  const [value, setValue] = useState(initial);
  return (
    <TabbedCard
      aria-label="Sign in or create account"
      onValueChange={setValue}
      radius={radius}
      tabs={[
        { label: "Sign in", value: "login", testId: "tab-login", content: <p>Sign-in form</p> },
        { label: "Create account", value: "register", testId: "tab-register", content: <p>Create account form</p> },
      ]}
      testId="card"
      value={value}
    />
  );
}

describe("TabbedCard", () => {

  it("draws its views as tabs and shows only the open view's body", () => {
    render(<Harness />);

    expect(screen.getByRole("tablist", { name: "Sign in or create account" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Sign-in form");
    expect(screen.queryByText("Create account form")).not.toBeInTheDocument();
  });

  it("opens on the view it is given, such as Create account from an invite link", () => {
    render(<Harness initial="register" />);

    expect(screen.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Create account form");
  });

  it("switches views on a click and with the arrow keys, as tabs do", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId("tab-register"));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Create account form");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Sign-in form");
  });

  it("takes the one 8px content corner unless it is a panel that stands apart", () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByTestId("card")).toHaveClass("rounded-lg");

    rerender(<Harness radius="panel" />);
    expect(screen.getByTestId("card")).toHaveClass("rounded-2xl");
  });
});
