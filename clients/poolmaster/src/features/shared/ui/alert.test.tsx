import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, Button } from ".";

describe("pool-master-3lo.10: shared Alert and Callout primitives", () => {
  it("rule: renders danger alerts with alert semantics", () => {
    render(
      <Alert tone="danger" title="Invite failed">
        Two addresses bounced.
      </Alert>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invite failed");
  });

  it("rule: renders alert action slots", () => {
    render(<Alert action={<Button>Retry</Button>}>Sync failed.</Alert>);

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
