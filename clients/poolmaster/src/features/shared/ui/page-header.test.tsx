import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { PageHeader } from "./page-header";

describe("pool-master-3lo.6: shared PageHeader primitive", () => {
  it("rule: renders title, breadcrumbs, description, and actions", () => {
    render(
      <MemoryRouter>
        <PageHeader
          actions={<Button>Invite</Button>}
          breadcrumbs={[
            { href: "/manage", label: "Manage" },
            { label: "Users" },
          ]}
          description="Manage account access."
          title="Users"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      "/manage",
    );
    expect(screen.getByText("Manage account access.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });
});
