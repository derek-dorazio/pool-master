import type { Meta, StoryObj } from "@storybook/react-vite";
import { SimpleTable, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "./simple-table";

const ROWS = [
  { place: 1, name: "Weekend Warriors 2", points: "-14" },
  { place: 2, name: "Fore Play", points: "-12" },
  { place: 3, name: "Bogey Men", points: "-9" },
];

function Board(props: { density?: "default" | "compact"; surface?: "default" | "inverse" }) {
  return (
    <SimpleTable {...props}>
      <TableHead>
        <TableRow>
          <TableHeaderCell numeric>Place</TableHeaderCell>
          <TableHeaderCell>Entry</TableHeaderCell>
          <TableHeaderCell numeric>Score</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow isHighlighted={row.place === 2} key={row.place}>
            <TableCell numeric>{row.place}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell numeric>{row.points}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </SimpleTable>
  );
}

const meta = {
  title: "Tables/SimpleTable",
  component: Board,
} satisfies Meta<typeof Board>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A small table; `isHighlighted` marks the viewer's row. */
export const Default: Story = {};
export const Compact: Story = { args: { density: "compact" } };
export const Inverse: Story = {
  args: { surface: "inverse" },
  decorators: [(Story) => <div className="bg-surface-inverse p-4"><Story /></div>],
};
