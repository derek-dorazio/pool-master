import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Notice } from ".";

describe("Notice", () => {
  it("a danger notice is announced as an alert with its title and sentence", () => {
    render(
      <Notice tone="danger" title="Invite failed">
        Two addresses bounced.
      </Notice>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invite failedTwo addresses bounced.");
  });

  it("a notice of any other tone is plain text, not an alert", () => {
    render(<Notice tone="warning">Picks close Thursday at 8:00 AM.</Notice>);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Picks close Thursday at 8:00 AM.")).toBeInTheDocument();
  });

  it("a notice shows its one action under the sentence", () => {
    render(<Notice action={<Button>Retry</Button>}>Sync failed.</Notice>);

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
