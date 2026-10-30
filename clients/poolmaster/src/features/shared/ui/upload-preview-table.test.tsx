import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UploadPreviewTable } from "./upload-preview-table";

type Row = { line: number; name: string; status: string; before: string; after: string };

const rows: Row[] = [
  { line: 2, name: "Scottie Scheffler", status: "Matched", before: "68", after: "67" },
  { line: 3, name: "Rory McIlroy", status: "New", before: "–", after: "70" },
];

const common = {
  describeRow: (row: Row) => `Row ${row.line}`,
  match: (row: Row) => row.name,
  matchHeader: "Golfer",
  resolution: (row: Row) => row.status,
  rowTestId: (index: number) => `preview-row-${index}`,
  rows,
  testId: "preview",
};

describe("UploadPreviewTable", () => {
  it("shows Row, Resolution and the match column, then Before → After and Change when the upload changes values", () => {
    render(
      <UploadPreviewTable
        {...common}
        change={{ after: (row) => row.after, badge: () => "Update", before: (row) => row.before }}
      />,
    );

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Row",
      "Resolution",
      "Golfer",
      "Before → After",
      "Change",
    ]);
    const first = screen.getByTestId("preview-row-0");
    expect(within(first).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Row 2",
      "Matched",
      "Scottie Scheffler",
      "68 → 67",
      "Update",
    ]);
  });

  it("leaves out the change columns for a list upload such as a roster, and takes its own resolution heading", () => {
    render(<UploadPreviewTable {...common} resolutionHeader="Status" />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Row", "Status", "Golfer"]);
    expect(within(screen.getByTestId("preview-row-1")).getAllByRole("cell")).toHaveLength(3);
  });
});
