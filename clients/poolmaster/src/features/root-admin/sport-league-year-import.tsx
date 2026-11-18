import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { importEventYearFromProvider } from '@/lib/api';
import { Button, ConfirmDialog } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { ImportSportEventYearFromProviderResponse, SportLeagueDto } from '@/lib/api';
import { useSportProviderId } from './use-provider-catalog';
import { useManagedSport } from './use-managed-sport';
import { SportProviderChoice } from './sport-provider-choice';

/**
 * #385 — one action creates a tour's year of tournaments from the golf provider, each
 * linked for scores. Tournaments the tour already has are skipped, so it is safe to run
 * again, and so are the provider's tournaments that already started, which are never created;
 * the result says how many were created and skipped, and why. No preview: the confirm says
 * what will happen and the skip rule makes a repeat harmless.
 */
export function SportLeagueYearImport({ eventYear, sportLeague }: { eventYear: number; sportLeague: SportLeagueDto }) {
  const logger = getLogger().child({ feature: 'sport-league-year-import' });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ImportSportEventYearFromProviderResponse | null>(null);
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague.noun);
  const { providerId, providers, setProviderId, isSuccess: providersLoaded } = useSportProviderId(true, sport, sportLeague.eventSyncProviderId);

  const importMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!providerId) {
        throw new Error('No provider is configured for this sport.');
      }
      const response = await importEventYearFromProvider({
        body: { sportLeagueId: sportLeague.id, eventYear, providerId },
      });
      if (!response.data?.created) {
        throwApiError(response.error, 'Import year response is missing data.');
      }
      return response.data;
    },
    // The tour's calendar sits under the `tournaments` prefix, and its event count on `tours`.
    invalidates: [QueryKeys.rootAdmin.manageSport.events, QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: (imported) => {
      logger.info(
        {
          action: 'sportLeague.importYear',
          data: { sportLeagueId: sportLeague.id, eventYear, created: imported.created.length, skipped: imported.skipped.length },
        },
        'Imported sport league year from provider',
      );
      setResult(imported);
      setOpen(false);
    },
    onError: (error) => {
      logger.warn({ action: 'sportLeague.importYear.failed', err: error }, 'Sport league year import was rejected');
    },
  });

  // A sport no provider covers (horse racing today) has nothing to import from.
  if (providersLoaded && !providerId) {
    return null;
  }

  return (
    <>
      <Button
        data-testid="root-admin-sport-league-calendar-import"
        disabled={!providerId}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        size="sm"
        variant="secondary"
      >
        Import {eventYear} from provider
      </Button>
      {result ? (
        <p className="w-full text-sm text-muted-foreground" data-testid="root-admin-sport-league-calendar-import-result" role="status">
          {result.created.length === 0 && result.skipped.length === 0
            ? `The provider lists no ${eventYear} ${event.many} for the ${sportLeagueNoun.one} “${sportLeague.matchKeyword ?? ''}”. Check that ${sportLeague.name}’s match keyword is the provider’s ${sportLeagueNoun.one} name.`
            : importSummary(result, event)}
        </p>
      ) : null}

      <ConfirmDialog
        confirmLabel={`Import ${eventYear}`}
        confirmTestId="root-admin-sport-league-calendar-import-confirm"
        description={`Every ${eventYear} ${event.one} the provider lists for ${sportLeague.name} that isn’t here yet and hasn’t started is created and linked for results. ${event.many.charAt(0).toUpperCase()}${event.many.slice(1)} already here or already started are skipped, and no fields are loaded.`}
        error={
          importMutation.isError
            ? extractErrorMessage(importMutation.error, {
                codeMessages: {
                  SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD: `${sportLeague.name} has no match keyword. Set it to the provider’s ${sportLeagueNoun.one} name.`,
                  PROVIDER_LEAGUE_REFUSED: `The provider refused ${sportLeague.name}’s ${event.many}: its current plan doesn’t include them.`,
                },
                fallback: 'We could not import this year.',
              })
            : undefined
        }
        isPending={importMutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => importMutation.mutate()}
        onOpenChange={(next) => !next && setOpen(false)}
        open={open}
        testId="root-admin-sport-league-calendar-import-modal"
        title={`Import ${eventYear} from provider`}
      >
        <SportProviderChoice
          onChange={setProviderId}
          providerId={providerId}
          providers={providers}
          testId="root-admin-sport-league-calendar-import-provider"
        />
      </ConfirmDialog>
    </>
  );
}

/** "Created 3 tournaments; skipped 2 already here", and how many already started when any did, leaving out a zero "already here" then. */
function importSummary(result: ImportSportEventYearFromProviderResponse, event: { one: string; many: string }): string {
  const started = result.skipped.filter((row) => row.reason === 'ALREADY_STARTED').length;
  const here = result.skipped.length - started;
  const created = `Created ${result.created.length} ${result.created.length === 1 ? event.one : event.many}`;
  if (started === 0) return `${created}; skipped ${here} already here.`;
  return here === 0 ? `${created}; skipped ${started} already started.` : `${created}; skipped ${here} already here and ${started} already started.`;
}
