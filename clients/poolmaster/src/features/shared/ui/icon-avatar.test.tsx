import { Trophy } from "lucide-react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconAvatar, IconBadge } from "./icon-avatar";

describe("pool-master-3lo.14: shared IconAvatar and IconBadge primitives", () => {
  it("rule: renders accessible icon avatars when labels are provided", () => {
    render(
      <IconAvatar label="League icon">
        <Trophy aria-hidden size={18} />
      </IconAvatar>,
    );

    expect(screen.getByLabelText("League icon")).toHaveClass("h-12");
  });

  it("rule: renders compact icon badges", () => {
    render(
      <IconBadge label="Team icon">
        <Trophy aria-hidden size={14} />
      </IconBadge>,
    );

    expect(screen.getByLabelText("Team icon")).toHaveClass("h-9");
  });
});
