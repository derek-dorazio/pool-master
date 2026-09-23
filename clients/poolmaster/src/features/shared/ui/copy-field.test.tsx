import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopyField } from "./copy-field";

describe("pool-master-3lo.12: shared CopyField primitive", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("rule: copies readonly field values to the clipboard", async () => {
    render(
      <CopyField aria-label="Join URL" value="https://example.test/join" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Join URL" }));

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion only, never invoked unbound; navigator.clipboard.writeText is a vi.fn() mock here.
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://example.test/join",
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });
});
