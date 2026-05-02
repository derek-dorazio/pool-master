import { render, screen, within } from "@testing-library/react";
import { UserAccountSummary } from "./user-account-summary";

describe("pool-master-pjr.6: user account summary component", () => {
  it("rule: renders identity and account detail metadata in reusable summary tiles", () => {
    render(
      <UserAccountSummary
        email="derek@example.test"
        memberSince="03/28/2026"
        method="EMAIL"
        name="Derek Dorazio"
        role="Member"
        status="Active"
        username="derek"
      />,
    );

    const identity = screen.getByTestId("user-page-identity-summary");
    expect(within(identity).getByText("Account summary")).toBeInTheDocument();
    expect(within(identity).getByText("Derek Dorazio")).toBeInTheDocument();
    expect(within(identity).getByText("derek@example.test")).toBeInTheDocument();
    expect(within(identity).getByText("derek")).toBeInTheDocument();

    const details = screen.getByTestId("user-page-account-details");
    expect(within(details).getByText("Member since")).toBeInTheDocument();
    expect(within(details).getByText("03/28/2026")).toBeInTheDocument();
    expect(within(details).getByText("Active")).toBeInTheDocument();
    expect(within(details).getByText("EMAIL")).toBeInTheDocument();
  });
});
