import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicInviteJoinPage } from "./page-templates";

describe("pool-master-3ew: shared page templates", () => {
  it("pool-master-3ew.6: renders public invite/join states in a focused shell", () => {
    render(
      <PublicInviteJoinPage
        context={<p>Mathworks league</p>}
        primaryAction={<button type="button">Join league</button>}
        title="Join Mathworks"
      >
        <p>Accept your invitation.</p>
      </PublicInviteJoinPage>,
    );

    expect(
      screen.getByRole("heading", { name: "Join Mathworks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mathworks league")).toBeInTheDocument();
    expect(screen.getByText("Accept your invitation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join league" })).toBeInTheDocument();
  });
});
