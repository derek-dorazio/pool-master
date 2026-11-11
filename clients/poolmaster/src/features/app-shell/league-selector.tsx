import { ChevronDown } from "lucide-react";
import type { LeagueDto } from '@/lib/api';
import { getLogger } from "@/lib/logger";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/shared/ui";
import {
  buildLeaguePath,
  getLeagueSelectorOptions,
  rememberRecentLeagueCode,
} from "@/features/leagues/league-routing";
import { LeagueIcon } from "@/features/leagues/league-icon";


type LeagueSelectorProps = {
  activeLeagueCode?: string | null;
  /** Placement in the app bar, which gives the selector its own full-width row on a phone. */
  className?: string;
  // #202 (A8) — which of these leagues the viewer commissions travels beside the list, not on
  // each league row.
  commissionerLeagueIds: ReadonlySet<string>;
  leagues: LeagueDto[];
  onCreateLeague: () => void;
  onNavigate: (path: string) => void;
};

/**
 * The league picker in the app bar: a wide, squared control whose width never follows the
 * league's name (a long name ends in an ellipsis inside it), opening the list of the viewer's
 * leagues with the current one checked, then Create league.
 */
export function LeagueSelector({
  activeLeagueCode,
  className,
  commissionerLeagueIds,
  leagues,
  onCreateLeague,
  onNavigate,
}: LeagueSelectorProps) {
  const logger = getLogger().child({
    feature: "league-selector",
  });
  const activeLeague =
    leagues.find((league) => league.leagueCode === activeLeagueCode) ?? null;
  const selectorLeagues = getLeagueSelectorOptions(leagues, commissionerLeagueIds);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-12 min-w-0 items-center gap-2.5 rounded-md border border-inverse-border bg-on-inverse-subtle px-3.5 text-left text-on-inverse transition hover:bg-on-inverse-hover data-[state=open]:bg-on-inverse-hover lg:max-w-[34rem] lg:flex-1",
          className,
        )}
        testId="league-selector-toggle"
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-primary text-primary-foreground">
          <LeagueIcon iconKey={activeLeague?.iconKey} size="sm" />
        </span>
        <span className="flex-none font-display text-xs font-bold uppercase tracking-label text-label-on-inverse">
          League
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-base font-bold">
          {activeLeague?.name ?? "Select league"}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 flex-none opacity-70" strokeWidth={2.5} />
      </DropdownMenuTrigger>

      <DropdownMenuContent testId="league-selector-menu" width="lg">
        <DropdownMenuLabel>Your leagues</DropdownMenuLabel>
        {selectorLeagues.map((league) => {
          const isCurrent = league.leagueCode === activeLeagueCode;
          const isCommissioner = commissionerLeagueIds.has(league.id);
          return (
            <DropdownMenuItem
              data-testid={`league-selector-option-${league.leagueCode}`}
              isSelected={isCurrent}
              key={league.id}
              onSelect={() => {
                rememberRecentLeagueCode(league.leagueCode);
                logger.info(
                  {
                    action: "leagueSelector.navigate",
                    data: {
                      leagueCode: league.leagueCode,
                    },
                  },
                  "Selected league from the league selector",
                );
                onNavigate(buildLeaguePath(league.leagueCode));
              }}
            >
              <span
                className={cn(
                  "flex h-8 w-8 flex-none items-center justify-center rounded-md",
                  isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                <LeagueIcon iconKey={league.iconKey} size="sm" />
              </span>
              <DropdownMenuItemText
                detail={
                  league.isActive
                    ? [league.leagueCode, isCommissioner ? "Commissioner" : null].filter(Boolean).join(" · ")
                    : "Not currently active"
                }
                isMuted={!league.isActive}
                name={league.name}
              />
              {isCurrent ? <DropdownMenuCheck /> : null}
            </DropdownMenuItem>
          );
        })}

        {selectorLeagues.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          data-testid="league-selector-create"
          onSelect={() => {
            logger.info(
              {
                action: "leagueSelector.createRequested",
              },
              "Requested league creation from the selector",
            );
            onCreateLeague();
          }}
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-dashed border-muted-foreground text-lg text-muted-foreground">
            +
          </span>
          <DropdownMenuItemText name="Create league" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
