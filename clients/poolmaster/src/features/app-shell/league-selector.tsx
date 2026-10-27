import { useEffect, useRef, useState } from "react";
import type { LeagueDto } from '@/lib/api';
import { getLogger } from "@/lib/logger";
import { Button, cn, Tile } from "@/features/shared/ui";
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeLeague =
    leagues.find((league) => league.leagueCode === activeLeagueCode) ?? null;
  const selectorLeagues = getLeagueSelectorOptions(leagues, commissionerLeagueIds);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className={cn("relative min-w-0", className)} ref={containerRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex w-full cursor-pointer items-center justify-start gap-3 rounded-3xl border border-inverse-border bg-on-inverse-subtle px-4 py-3 text-left shadow-sm sm:w-auto sm:max-w-xs lg:max-w-none"
        data-testid="league-selector-toggle"
        onClick={() => setIsOpen((current) => !current)}
        size="auto"
        type="button"
      >
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
          <LeagueIcon iconKey={activeLeague?.iconKey} size="md" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-xs font-bold uppercase text-on-inverse-muted">
            League
          </div>
          <div className="truncate text-sm font-semibold text-on-inverse">
            {activeLeague?.name ?? "Select league"}
          </div>
        </div>
      </Button>

      {isOpen ? (
        <Tile
          className="absolute left-0 z-20 mt-3 w-72 max-w-[calc(100vw-2rem)] shadow-xl lg:left-auto lg:right-0"
          padding="sm"
          radius="lg"
        >
          <div className="space-y-2">
            {selectorLeagues.map((league) => (
              <Button
                className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                  league.leagueCode === activeLeagueCode
                    ? league.isActive
                      ? "border-primary/20 bg-primary/10"
                      : "border-border bg-muted/40"
                    : league.isActive
                      ? "border-transparent hover:bg-muted/50"
                      : "border-border bg-muted/30 hover:bg-muted/50"
                }`}
                data-testid={`league-selector-option-${league.leagueCode}`}
                key={league.id}
                onClick={() => {
                  rememberRecentLeagueCode(league.leagueCode);
                  setIsOpen(false);
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
                size="auto"
                type="button"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <LeagueIcon iconKey={league.iconKey} size="sm" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {league.name}
                  </div>
                  <div className="truncate text-xs uppercase text-muted-foreground">
                    {league.isActive
                      ? league.leagueCode
                      : "Not currently active"}
                  </div>
                </div>
              </Button>
            ))}

            <Button
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-muted/50"
              data-testid="league-selector-create"
              onClick={() => {
                setIsOpen(false);
                logger.info(
                  {
                    action: "leagueSelector.createRequested",
                  },
                  "Requested league creation from the selector",
                );
                onCreateLeague();
              }}
              type="button"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border text-lg text-muted-foreground">
                +
              </div>
              <div className="font-medium text-foreground">Create league</div>
            </Button>
          </div>
        </Tile>
      ) : null}
    </div>
  );
}
