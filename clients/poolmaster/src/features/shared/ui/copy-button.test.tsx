import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "./copy-button";

/** How long the button shows "Copied" before it resets. */
const COPIED_RESET_MS = 2000;

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.assign(navigator, { clipboard: { writeText } });
}

describe("CopyButton", () => {
  it("puts the text on the clipboard and swaps its label for the copied label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CopyButton copiedLabel="Link copied" label="Share" testId="share" text="https://example.com/x" />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://example.com/x");
  });

  it("goes back to its label a moment after copying, so a second copy reads the same as the first", async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton label="Share" testId="share" text="x" />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("share")).toHaveTextContent("Share"), {
      timeout: COPIED_RESET_MS + 1000,
    });
  });

  it("says the copy failed, under the button, when the browser refuses the clipboard", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyButton failedMessage="Copy it by hand." label="Share" testId="share" text="x" />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Copy it by hand.");
    expect(screen.getByTestId("share")).toHaveTextContent("Share");
  });

  it("treats a page with no Clipboard API, such as a plain-http one, as a refused copy instead of doing nothing", async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CopyButton label="Share" text="x" />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy");
  });

  it("names an icon-only button by its label and announces Copied to screen readers", async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton iconOnly label="Copy league code" text="GOLF-1234" />);

    const button = screen.getByRole("button", { name: "Copy league code" });
    expect(button).not.toHaveTextContent("Copy league code");
    fireEvent.click(button);

    expect(await screen.findByText("Copied")).toHaveAttribute("role", "status");
  });
});
