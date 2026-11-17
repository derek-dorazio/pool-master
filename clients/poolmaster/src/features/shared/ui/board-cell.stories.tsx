import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoardBand, BoardCellContent } from "./board-cell";
import { boardAxisClassName, boardCellClassName, type BoardCellState } from "./board-cell-styles";

const PLAIN: BoardCellState = { isEmpty: false, isMine: false, isWon: false, isNow: false, isOnLiveLine: false };

const CELLS: { label: string; state: BoardCellState; code: string; tag?: { label: string; tone: "won" | "now" } }[] = [
  { label: "Empty", state: { ...PLAIN, isEmpty: true }, code: "" },
  { label: "Held", state: PLAIN, code: "BH" },
  { label: "Yours", state: { ...PLAIN, isMine: true }, code: "S1" },
  { label: "Won", state: { ...PLAIN, isWon: true }, code: "MH", tag: { label: "Q1", tone: "won" } },
  { label: "Yours, won twice", state: { ...PLAIN, isMine: true, isWon: true }, code: "S1", tag: { label: "Q1/F", tone: "won" } },
  { label: "Live line", state: { ...PLAIN, isOnLiveLine: true }, code: "L2" },
  { label: "Winning now", state: { ...PLAIN, isNow: true, isOnLiveLine: true }, code: "MO", tag: { label: "Now", tone: "now" } },
];

function BoardCellGallery() {
  return (
    <div className="max-w-sm space-y-4 p-4">
      <BoardBand name="Eagles" side="top" testId="story-band" />
      <div className="flex gap-1">
        <div className={boardAxisClassName(false)}>3</div>
        <div className={boardAxisClassName(true)}>7</div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {CELLS.map(({ code, label, state, tag }) => (
          <div className="space-y-1" key={label}>
            <div className={boardCellClassName(state)}><BoardCellContent code={code} tag={tag} /></div>
            <span className="block text-center">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Tables/Board cells",
  component: BoardCellGallery,
} satisfies Meta<typeof BoardCellGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every cell state a board draws (#1758): empty, held, yours, won, won twice, the live line and the cell winning now. */
export const States: Story = {};
