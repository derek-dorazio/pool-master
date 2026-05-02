import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AdminConfigPage,
  AsyncPage,
  DataGridPage,
  DetailWithActionsPage,
  EntityDetailPage,
  FormEditorSection,
  LifecycleActionSet,
  PublicInviteJoinPage,
} from "./page-templates";

type TestRow = {
  id: string;
  name: string;
  status: string;
};

const columnHelper = createColumnHelper<TestRow>();
const columns = [
  columnHelper.accessor("name", {
    header: "Name",
    cell: ({ getValue }) => getValue(),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ getValue }) => getValue(),
  }),
];

describe("pool-master-3ew: shared page templates", () => {
  it("pool-master-3ew.1: renders admin config page chrome and async states", () => {
    render(
      <AdminConfigPage
        header={{
          title: "Poll Intervals",
          description: "Configure polling.",
        }}
        loadingBody="Loading poll configuration..."
        state="loading"
      >
        <p>Loaded settings</p>
      </AdminConfigPage>,
    );

    expect(
      screen.getByRole("heading", { name: "Poll Intervals" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading poll configuration...")).toBeInTheDocument();
    expect(screen.queryByText("Loaded settings")).not.toBeInTheDocument();
  });

  it("pool-master-3ew.2: renders a management grid with client-side filters", () => {
    render(
      <DataGridPage
        columns={columns}
        data={[
          { id: "one", name: "Alpha", status: "Active" },
          { id: "two", name: "Beta", status: "Inactive" },
        ]}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        rowTestId={(row) => `row-${row.id}`}
        tableTestId="management-grid"
      />,
    );

    fireEvent.change(screen.getByTestId("data-grid-filter-name"), {
      target: { value: "Beta" },
    });

    expect(screen.queryByTestId("row-one")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-two")).toBeInTheDocument();
    expect(screen.getByTestId("management-grid")).toBeInTheDocument();
  });

  it("pool-master-pjr.1: renders async empty, forbidden, and server-error states", () => {
    const { rerender } = render(
      <AsyncPage
        emptyBody="No sync runs matched."
        emptyTitle="No runs"
        state="empty"
      >
        <p>Loaded</p>
      </AsyncPage>,
    );

    expect(screen.getByRole("heading", { name: "No runs" })).toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();

    rerender(
      <AsyncPage permissionBody="Root admin required." state="forbidden">
        <p>Loaded</p>
      </AsyncPage>,
    );

    expect(screen.getByText("Root admin required.")).toBeInTheDocument();

    rerender(
      <AsyncPage
        error={{ error: { message: "Provider health unavailable." } }}
        state="error"
      >
        <p>Loaded</p>
      </AsyncPage>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provider health unavailable.",
    );
  });

  it("pool-master-3ew.3: composes details beside action menu content", () => {
    render(
      <DetailWithActionsPage
        actions={<button type="button">Invite members</button>}
        actionsTestId="league-actions"
        details={<section aria-label="League summary">Mathworks</section>}
      />,
    );

    expect(screen.getByLabelText("League summary")).toHaveTextContent(
      "Mathworks",
    );
    expect(screen.getByTestId("league-actions")).toHaveTextContent("Actions");
    expect(
      screen.getByRole("button", { name: "Invite members" }),
    ).toBeInTheDocument();
  });

  it("pool-master-pjr.2: renders entity summary above detail/action content", () => {
    render(
      <EntityDetailPage
        actions={<button type="button">Edit</button>}
        actionsTestId="entity-actions"
        details={<section aria-label="Entity details">Account metadata</section>}
        summary={<section aria-label="Entity summary">Derek Dorazio</section>}
      />,
    );

    expect(screen.getByLabelText("Entity summary")).toHaveTextContent(
      "Derek Dorazio",
    );
    expect(screen.getByLabelText("Entity details")).toHaveTextContent(
      "Account metadata",
    );
    expect(screen.getByTestId("entity-actions")).toHaveTextContent("Actions");
  });

  it("pool-master-3ew.4: renders editable form sections with footer and errors", () => {
    render(
      <FormEditorSection
        errorMessage="Save failed"
        footer={<button type="button">Save</button>}
        title="Global Ingestion Schedule"
      >
        <label htmlFor="interval">Interval</label>
        <input id="interval" />
      </FormEditorSection>,
    );

    expect(
      screen.getByRole("heading", { name: "Global Ingestion Schedule" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Interval")).toBeInTheDocument();
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("pool-master-3ew.5: filters lifecycle actions by current status", () => {
    const handleActivate = vi.fn();

    render(
      <LifecycleActionSet
        actions={[
          {
            key: "activate",
            label: "Activate",
            onSelect: handleActivate,
            visibleForStatuses: ["Inactive"],
          },
          {
            key: "inactivate",
            label: "Inactivate",
            visibleForStatuses: ["Active"],
          },
        ]}
        currentStatus="Inactive"
        errorMessage="Lifecycle failed"
        helperText="Inactive entities can be reactivated or deleted."
        statusTone="inactive"
      />,
    );

    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Inactive entities can be reactivated or deleted.")).toBeInTheDocument();
    expect(screen.getByText("Lifecycle failed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Inactivate" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(handleActivate).toHaveBeenCalledTimes(1);
  });

  it("pool-master-3ew.6: renders public invite/join states in a focused shell", () => {
    render(
      <PublicInviteJoinPage
        context={<p>Mathworks league</p>}
        primaryAction={<button type="button">Join league</button>}
        title="Join Mathworks"
      >
        <p>Accept your invitation.</p>
      </PublicInviteJoinPage>,
    );

    expect(
      screen.getByRole("heading", { name: "Join Mathworks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mathworks league")).toBeInTheDocument();
    expect(screen.getByText("Accept your invitation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join league" })).toBeInTheDocument();
  });
});
