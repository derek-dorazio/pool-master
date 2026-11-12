import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormEditorSection, PublicInviteJoinPage } from "./page-templates";

describe("pool-master-3ew: shared page templates", () => {
  it("pool-master-3ew.4: renders editable form sections with footer and errors", () => {
    render(
      <FormEditorSection
        errorMessage="Save failed"
        footer={<button type="button">Save</button>}
        title="Global Ingestion Schedule"
      >
        <label htmlFor="interval">Interval</label>
        <input id="interval" />
      </FormEditorSection>,
    );

    expect(
      screen.getByRole("heading", { name: "Global Ingestion Schedule" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Interval")).toBeInTheDocument();
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

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
