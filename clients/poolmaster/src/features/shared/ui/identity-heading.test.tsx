import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityHeading } from "./identity-heading";

describe("IdentityHeading", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("shows the entity's name as the page heading with its code and meta line", () => {
    render(
      <IdentityHeading
        code={{ label: "league code", value: "GOLF-1234" }}
        icon={<span>icon</span>}
        meta={<span>12 members</span>}
        name="Saturday Golf League"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Saturday Golf League" }),
    ).toBeInTheDocument();
    expect(screen.getByText("GOLF-1234")).toBeInTheDocument();
    expect(screen.getByText("12 members")).toBeInTheDocument();
  });

  it("renders no copy button when there is no code to share", () => {
    render(<IdentityHeading icon={<span>icon</span>} name="Saturday Golf League" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the code to the clipboard and announces Copied", async () => {
    render(
      <IdentityHeading
        code={{ label: "league code", value: "GOLF-1234" }}
        icon={<span>icon</span>}
        name="Saturday Golf League"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy league code" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Copied");
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- assertion only, never invoked unbound; navigator.clipboard.writeText is a vi.fn() mock here.
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("GOLF-1234");
  });

  it("announces Copy failed as an alert when the clipboard write is refused", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    render(
      <IdentityHeading
        code={{ label: "league code", value: "GOLF-1234" }}
        icon={<span>icon</span>}
        name="Saturday Golf League"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy league code" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Copy failed");
    });
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
