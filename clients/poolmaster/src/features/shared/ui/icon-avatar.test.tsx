import { Trophy } from "lucide-react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconAvatar } from "./icon-avatar";

describe("pool-master-3lo.14: shared IconAvatar primitive", () => {
  it("rule: renders accessible icon avatars when labels are provided", () => {
    render(
      <IconAvatar label="League icon">
        <Trophy aria-hidden size={18} />
      </IconAvatar>,
    );

    expect(screen.getByLabelText("League icon")).toHaveClass("h-12");
  });
});
