import type { ReactNode } from "react";
import { SimpleTable, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./simple-table";

type UploadPreviewChange<Row> = {
  /** The value on the site now. */
  before: (row: Row) => ReactNode;
  /** The value the upload would set. */
  after: (row: Row) => ReactNode;
  /** What applying the row would do, as a badge. */
  badge: (row: Row) => ReactNode;
};

export type UploadPreviewTableProps<Row> = {
  /** Present when the upload changes values; a list upload, such as a roster, leaves it out. */
  change?: UploadPreviewChange<Row>;
  /** How the file's row is named, such as "Row 3". */
  describeRow: (row: Row) => string;
  /** The column naming what each row matched, such as "Golfer". */
  matchHeader: ReactNode;
  match: (row: Row) => ReactNode;
  /** How each row was resolved against the site, as a badge. */
  resolution: (row: Row) => ReactNode;
  resolutionHeader?: ReactNode;
  rowTestId?: (index: number) => string;
  rows: readonly Row[];
  testId: string;
};

/** The table a `BulkUploadPanel` preview shows: each file row, how it matched, and what applying it would change. */
export function UploadPreviewTable<Row>({
  change,
  describeRow,
  match,
  matchHeader,
  resolution,
  resolutionHeader = "Resolution",
  rowTestId,
  rows,
  testId,
}: UploadPreviewTableProps<Row>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <SimpleTable className="min-w-full" data-testid={testId}>
        <TableHead>
          <tr>
            <TableHeaderCell>Row</TableHeaderCell>
            <TableHeaderCell>{resolutionHeader}</TableHeaderCell>
            <TableHeaderCell>{matchHeader}</TableHeaderCell>
            {change ? (
              <>
                <TableHeaderCell>Before → After</TableHeaderCell>
                <TableHeaderCell>Change</TableHeaderCell>
              </>
            ) : null}
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow data-testid={rowTestId?.(index)} key={`${describeRow(row)}-${index}`}>
              <TableCell>{describeRow(row)}</TableCell>
              <TableCell>{resolution(row)}</TableCell>
              <TableCell>{match(row)}</TableCell>
              {change ? (
                <>
                  <TableCell className="text-muted-foreground">
                    {change.before(row)}
                    {" → "}
                    <span className="text-foreground">{change.after(row)}</span>
                  </TableCell>
                  <TableCell>{change.badge(row)}</TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </SimpleTable>
    </div>
  );
}
