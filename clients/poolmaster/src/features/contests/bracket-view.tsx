import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button, PageTabs, Tabs, TabsContent, Text, WIDE_SCREEN_QUERY, useMediaQuery } from '@/features/shared/ui';
import { BracketMiddle } from './bracket-middle';
import { BracketTree, type BracketPicking } from './bracket-tree';
import {
  PHONE_ROUNDS_SHOWN,
  bracketHalves,
  openingRoundIndex,
  type BracketDrawing,
  type BracketGroup,
} from './bracket-view-model';

/** How far a finger must travel sideways for a swipe to change rounds. */
const SWIPE_PX = 40;

/** A desktop column: wide enough for a seed and a school's short name. */
const DESKTOP_COLUMN = 'w-40 shrink-0';
/** A phone column: an even share of the screen. */
const PHONE_COLUMN = 'min-w-0 flex-1';

export interface BracketViewProps {
  drawing: BracketDrawing;
  /** Tapping a team picks it; null when the bracket is read-only. */
  picking: BracketPicking | null;
  /** Whether the bracket is the viewer's own, so its champion is "Your champion". */
  isOwnEntry: boolean;
  /** The tiebreaker line under the middle, when the bracket shows it. */
  tiebreaker?: ReactNode;
}

/**
 * The whole bracket on a desktop (#1753): the first and third regions on the left, the second
 * and fourth mirrored on the right, and where they meet the semifinals, the final, the champion
 * and the tiebreaker. Wider than its column, it scrolls sideways inside itself.
 */
function DesktopBracket({ drawing, isOwnEntry, picking, tiebreaker }: BracketViewProps) {
  const { left, right } = bracketHalves(drawing);
  const half = (groups: BracketGroup[], isMirrored: boolean) => (groups.length > 0 ? (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section aria-label={group.label} className="flex flex-col gap-2" data-testid={`bracket-region-${group.label}`} key={group.label}>
          <Text className={isMirrored ? 'text-right' : undefined} size="sm" variant="label">{group.label}</Text>
          <BracketTree columnClassName={DESKTOP_COLUMN} isMirrored={isMirrored} picking={picking} rounds={group.rounds} showHeaders />
        </section>
      ))}
    </div>
  ) : null);
  return (
    <div className="overflow-x-auto pb-2" data-layout="desktop" data-testid="bracket-board">
      <div className="mx-auto flex w-max items-center gap-6">
        {half(left, false)}
        {drawing.middle ? (
          <BracketMiddle
            champion={drawing.champion}
            columnClassName={DESKTOP_COLUMN}
            isOwnEntry={isOwnEntry}
            middle={drawing.middle}
            picking={picking}
            tiebreaker={tiebreaker}
          />
        ) : null}
        {half(right, true)}
      </div>
    </div>
  );
}

/**
 * One region on a phone: two rounds side by side plus the region's winner once the last round is
 * on screen, under a row of round names. The rounds on screen read as plain names; the round just
 * off screen on either side is a link that moves to it, as a swipe does.
 */
function PhoneRegion({ group, picking }: { group: BracketGroup; picking: BracketPicking | null }) {
  const [start, setStart] = useState(() => openingRoundIndex(group));
  const touchStartX = useRef<number | null>(null);
  const lastStart = Math.max(group.rounds.length - PHONE_ROUNDS_SHOWN, 0);
  const shown = group.rounds.slice(start, start + PHONE_ROUNDS_SHOWN);
  const before = start > 0 ? group.rounds[start - 1] : null;
  const after = start < lastStart ? group.rounds[start + PHONE_ROUNDS_SHOWN] : null;
  const showsWinner = start === lastStart;
  const move = (step: number) => setStart((current) => Math.min(Math.max(current + step, 0), lastStart));
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label={`${group.label} rounds`} className="flex items-center gap-2" data-testid="bracket-round-nav">
        {before ? (
          <Button className="shrink-0" data-testid="bracket-round-nav-back" onClick={() => move(-1)} size="xs" type="button" variant="link">
            <ChevronLeft aria-hidden size={14} />
            {before.label}
          </Button>
        ) : null}
        {shown.map((round) => (
          <Text className="min-w-0 flex-1" data-testid="bracket-round-nav-shown" key={round.roundNumber} truncate variant="label">{round.label}</Text>
        ))}
        {showsWinner ? <Text className="min-w-0 flex-1" truncate variant="label">Winner</Text> : null}
        {after ? (
          <Button className="shrink-0" data-testid="bracket-round-nav-next" onClick={() => move(1)} size="xs" type="button" variant="link">
            {after.label}
            <ChevronRight aria-hidden size={14} />
          </Button>
        ) : null}
      </nav>
      <div
        data-testid="bracket-region-rounds"
        onTouchEnd={(event) => {
          const from = touchStartX.current;
          touchStartX.current = null;
          const to = event.changedTouches.length > 0 ? event.changedTouches[0].clientX : null;
          if (from === null || to === null || Math.abs(to - from) < SWIPE_PX) return;
          // A swipe to the left brings the later rounds in, as turning a page does.
          move(to < from ? 1 : -1);
        }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches.length > 0 ? event.touches[0].clientX : null;
        }}
      >
        <BracketTree
          columnClassName={PHONE_COLUMN}
          picking={picking}
          rounds={shown}
          showHeaders={false}
          winner={showsWinner ? { line: group.winner, testId: 'bracket-region-winner' } : undefined}
        />
      </div>
    </div>
  );
}

/**
 * The bracket on a phone (#1753): one region at a time under region tabs on one line, the same
 * underlined tabs as the app's other pages, and a last tab for where the regions meet. A bracket
 * with no regions is that middle alone.
 */
function PhoneBracket({ drawing, isOwnEntry, picking, tiebreaker }: BracketViewProps) {
  const middle = drawing.middle ? (
    <div className="overflow-x-auto">
      <BracketMiddle
        champion={drawing.champion}
        columnClassName={PHONE_COLUMN}
        isOwnEntry={isOwnEntry}
        middle={drawing.middle}
        picking={picking}
        tiebreaker={tiebreaker}
      />
    </div>
  ) : null;
  if (drawing.regions.length === 0) {
    return <div data-layout="phone" data-testid="bracket-board">{middle}</div>;
  }
  const tabs = [
    ...drawing.regions.map((group, index) => ({ label: group.label, value: `region-${index}`, testId: `bracket-tab-region-${index}` })),
    ...(drawing.middle ? [{ label: drawing.middle.label, value: 'middle', testId: 'bracket-tab-middle' }] : []),
  ];
  return (
    <Tabs className="flex flex-col gap-3" data-layout="phone" data-testid="bracket-board" defaultValue="region-0">
      <PageTabs aria-label="Bracket regions" items={tabs} variant="state" />
      {drawing.regions.map((group, index) => (
        <TabsContent key={group.label} value={`region-${index}`}>
          <PhoneRegion group={group} picking={picking} />
        </TabsContent>
      ))}
      {middle ? <TabsContent value="middle">{middle}</TabsContent> : null}
    </Tabs>
  );
}

/**
 * One bracket drawing everywhere a bracket is shown (#1753): the pick page, where tapping a team
 * picks it, and the read-only bracket dialog the leaderboard opens. The whole bracket on a
 * desktop; one region at a time on a phone.
 */
export function BracketView(props: BracketViewProps) {
  const isWide = useMediaQuery(WIDE_SCREEN_QUERY);
  return isWide ? <DesktopBracket {...props} /> : <PhoneBracket {...props} />;
}
