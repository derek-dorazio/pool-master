import { CalendarCheck, Grid3x3, ListOrdered, Network, ShieldCheck, Shuffle, Wallet, type LucideIcon } from 'lucide-react';
import { SelectionType } from '@poolmaster/shared/domain';

/** Each way of picking's icon, wherever a contest type is shown: Create contest, the contest types pages. */
export const SELECTION_TYPE_ICONS: Record<SelectionType, LucideIcon> = {
  [SelectionType.TIERED]: ListOrdered,
  [SelectionType.BUDGET_PICK]: Wallet,
  [SelectionType.RANDOM_DRAW]: Shuffle,
  [SelectionType.PICK_EM]: CalendarCheck,
  [SelectionType.BRACKET]: Network,
  [SelectionType.SURVIVOR]: ShieldCheck,
  [SelectionType.SQUARES]: Grid3x3,
};
