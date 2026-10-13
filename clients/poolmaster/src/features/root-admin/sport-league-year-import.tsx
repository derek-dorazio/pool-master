import { useState } from 'react';
import { importEventYearFromProvider } from '@/lib/api';
import { Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { ImportSportEventYearFromProviderResponse, SportLeagueDto } from '@/lib/api';
import { useSportProviderId } from './use-provider-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * #385 — one action creates a tour's year of tournaments from the golf provider, each
 * linked for scores. Tournaments the tour already has are skipped, so it is safe to run
 * again; the result says how many were created and skipped. No preview: the confirm says
 * what will happen and the skip rule makes a repeat harmless.
 */
export function SportLeagueYearImport({ eventYear, tour }: { eventYear: number; tour: SportLeagueDto }) {
  const logger = getLogger().child({ feature: 'sport-league-year-import' });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ImportSportEventYearFromProviderResponse | null>(null);
  const { sport, definition } = useManagedSport();
  const { event, sportLeague } = definition.vocabulary;
  const { providerId, isSuccess: providersLoaded } = useSportProviderId(true, sport);

  const importMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!providerId) {
        throw new Error('No provider is configured for this sport.');
      }
      const response = await importEventYearFromProvider({
        body: { sportLeagueId: tour.id, eventYear, providerId },
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
          action: 'golf.tour.importYear',
          data: { sportLeagueId: tour.id, eventYear, created: imported.created.length, skipped: imported.skipped.length },
        },
        'Imported golf tour year from provider',
      );
      setResult(imported);
      setOpen(false);
    },
    onError: (error) => {
      logger.warn({ action: 'golf.tour.importYear.failed', err: error }, 'Golf tour year import was rejected');
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
            ? `The provider lists no ${eventYear} ${event.many} for the ${sportLeague.one} “${tour.matchKeyword ?? ''}”. Check that ${tour.name}’s match keyword is the provider’s ${sportLeague.one} name.`
            : `Created ${result.created.length} ${result.created.length === 1 ? event.one : event.many}; skipped ${result.skipped.length} already here.`}
        </p>
      ) : null}

      <ConfirmationModal
        confirmLabel={`Import ${eventYear}`}
        confirmTestId="root-admin-sport-league-calendar-import-confirm"
        description={`Every ${eventYear} ${event.one} the provider lists for ${tour.name} that isn’t here yet is created and linked for results. ${event.many.charAt(0).toUpperCase()}${event.many.slice(1)} already here are skipped, and no fields are loaded.`}
        errorMessage={
          importMutation.isError
            ? extractErrorMessage(importMutation.error, {
                codeMessages: {
                  SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD: `${tour.name} has no match keyword. Set it to the provider’s ${sportLeague.one} name.`,
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
      />
    </>
  );
}
