import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip, StatusBadge } from "./status-badge";

describe("pool-master-3lo.5: shared StatusBadge and Chip primitives", () => {
  it("rule: renders lifecycle statuses through semantic tones", () => {
    render(<StatusBadge tone="active">Active</StatusBadge>);

    expect(screen.getByText("Active").className).toContain(
      "--status-active-text",
    );
  });

  it("rule: renders compact chips without uppercase transformation", () => {
    render(<Chip tone="warning">Needs review</Chip>);

    expect(screen.getByText("Needs review")).toHaveClass("normal-case");
  });
});
