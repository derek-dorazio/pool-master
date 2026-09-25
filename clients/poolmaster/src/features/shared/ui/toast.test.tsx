import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast, ToastProvider, ToastViewport } from "./toast";

describe("pool-master-3lo.15: shared Toast primitives", () => {
  it("rule: renders toast content inside the shared provider", () => {
    render(
      <ToastProvider>
        <Toast description="The profile was updated." open title="Saved" />
        <ToastViewport />
      </ToastProvider>,
    );

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("The profile was updated.")).toBeInTheDocument();
  });
});
