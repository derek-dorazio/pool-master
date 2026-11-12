import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebAddressBox } from "./web-address-box";

describe("WebAddressBox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a live address without its https:// as a link that opens in a new tab", () => {
    render(<WebAddressBox isLive testId="address" url="https://primetimecommissioner.com/league/BIGDAWGS" />);

    const link = screen.getByRole("link", { name: "primetimecommissioner.com/league/BIGDAWGS" });
    expect(link).toHaveAttribute("href", "https://primetimecommissioner.com/league/BIGDAWGS");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("underline", "font-bold");
  });

  it("does not open an address that isn't live yet, but still shows it in the link style", () => {
    render(<WebAddressBox isLive={false} testId="address" url="https://example.com/league/NEW" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const address = screen.getByTestId("address-link");
    expect(address).toHaveTextContent("example.com/league/NEW");
    expect(address).toHaveAttribute("aria-disabled", "true");
    expect(address).toHaveClass("underline", "font-bold");
  });

  it("copies the full address, https:// included, live or not", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<WebAddressBox isLive={false} testId="address" url="https://example.com/league/NEW" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://example.com/league/NEW"));
  });
});
