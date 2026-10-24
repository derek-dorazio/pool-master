import { useState } from 'react';
import {
  expandContest,
  grantContestExpansion,
  type ContestExpansionOffer,
  type ContestExpansionResponse,
} from '@/lib/api';
import { extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { Alert, Button, FormField, Input, SettingsRow, SettingsSection } from '@/features/shared/ui';
import { formatPriceCents } from './billing-format';
import { useContestExpansionQuery } from './use-contest-expansion-query';

/** Copy for the refusals Expand and a root admin's free expansion can meet. */
const EXPANSION_CODE_MESSAGES: ErrorCodeMessages = {
  CONTEST_EXPANSION_CLOSED: 'This contest has stopped taking entries, so it can no longer be expanded.',
  CONTEST_EXPANSION_BAND_UNAVAILABLE: 'That size is no longer offered for this contest. Pick another.',
  CONTEST_EXPANSION_NOT_ABOVE_CAP: 'The contest already takes that many entries. Give a larger size.',
  PAYMENTS_CHECKOUT_UNAVAILABLE: 'Paying for an expansion isn’t available yet.',
};

/** "12 of 50", or "12, no limit". */
function describeEntries(state: ContestExpansionResponse): string {
  return state.entriesPerContest === null
    ? `${state.entryCount}, no limit`
    : `${state.entryCount} of ${state.entriesPerContest}`;
}

/** What one band costs, as the commissioner reads it beside its button. */
function describeOfferPrice(offer: ContestExpansionOffer, paymentsEnabled: boolean): string {
  return paymentsEnabled
    ? formatPriceCents(offer.priceCents)
    : `${formatPriceCents(offer.priceCents)}, free while payments are off`;
}

/**
 * Commissioner tools › one contest › Entries (#987): how many entries the contest holds against
 * its cap, and the sizes it can be expanded to, from its creation until it stops taking entries.
 * While payments are off an expansion is free and applies at once; a root admin can also give
 * any size free, with a reason. Members never see this.
 */
export function ContestExpansionSection({
  leagueId,
  contestId,
  canGrant,
  isLeagueActive,
}: {
  leagueId: string;
  contestId: string;
  /** Root admins give expansions free. */
  canGrant: boolean;
  isLeagueActive: boolean;
}) {
  const expansionQuery = useContestExpansionQuery(leagueId, contestId);
  const invalidates = [
    QueryKeys.contestExpansions.detail(leagueId, contestId),
    QueryKeys.contests.detail(contestId),
    QueryKeys.contests.list({ leagueId }),
    QueryKeys.payments.all,
  ];

  const expandMutation = useInvalidatingMutation({
    mutationFn: async (entriesPerContest: number) => {
      const response = await expandContest({ path: { id: leagueId, contestId }, body: { entriesPerContest } });
      if (!response.data) {
        throwApiError(response.error, 'Contest expansion response is missing data.');
      }
      return response.data;
    },
    invalidates,
  });

  if (expansionQuery.isLoading) {
    return (
      <SettingsSection testId="contest-expansion" title="Entries">
        <div className="px-5 py-3.5 text-sm text-muted-foreground">Loading entries...</div>
      </SettingsSection>
    );
  }
  if (!expansionQuery.data) {
    return (
      <SettingsSection testId="contest-expansion" title="Entries">
        <div className="px-5 py-3.5 text-sm text-muted-foreground" data-testid="contest-expansion-error">
          {extractErrorMessage(expansionQuery.error, { fallback: 'We could not load this contest\'s entries right now.' })}
        </div>
      </SettingsSection>
    );
  }

  const state = expansionQuery.data;
  const isFull = state.entriesPerContest !== null && state.entryCount >= state.entriesPerContest;

  return (
    <SettingsSection
      description={state.expandable
        ? 'Every entry counts, drafts included. Expand the contest to take more.'
        : 'Every entry counts, drafts included.'}
      testId="contest-expansion"
      title="Entries"
    >
      <SettingsRow label="Entries" testId="contest-expansion-entries" value={describeEntries(state)} />
      {state.expandedTo !== null ? (
        <SettingsRow label="Expanded to" testId="contest-expansion-expanded-to" value={`${state.expandedTo} entries`} />
      ) : null}
      {isFull && state.expandable ? (
        <div className="px-5 py-3.5">
          <Alert data-testid="contest-expansion-full" tone="warning">
            This contest is full at {state.entriesPerContest} entries.
          </Alert>
        </div>
      ) : null}
      {state.offers.map((offer) => (
        <SettingsRow
          action={(
            <Button
              data-testid={`contest-expansion-expand-${offer.entriesPerContest}`}
              disabled={!isLeagueActive || state.paymentsEnabled || expandMutation.isPending}
              onClick={() => expandMutation.mutate(offer.entriesPerContest)}
              size="sm"
              variant="secondary"
            >
              Expand
            </Button>
          )}
          key={offer.entriesPerContest}
          label={`Up to ${offer.entriesPerContest}`}
          testId={`contest-expansion-offer-${offer.entriesPerContest}`}
          value={describeOfferPrice(offer, state.paymentsEnabled)}
        />
      ))}
      {state.paymentsEnabled && state.offers.length > 0 ? (
        <div className="px-5 py-3.5 text-sm text-muted-foreground" data-testid="contest-expansion-checkout-unavailable">
          Paying for an expansion isn&apos;t available yet.
        </div>
      ) : null}
      {expandMutation.isError ? (
        <div className="px-5 py-3.5">
          <Alert data-testid="contest-expansion-expand-error" tone="danger">
            {extractErrorMessage(expandMutation.error, {
              codeMessages: EXPANSION_CODE_MESSAGES,
              fallback: 'We could not expand this contest. Please try again.',
            })}
          </Alert>
        </div>
      ) : null}
      {canGrant ? <GrantExpansionForm contestId={contestId} invalidates={invalidates} leagueId={leagueId} /> : null}
    </SettingsSection>
  );
}

/** A root admin gives the contest any size above its cap, free, with a reason the history shows. */
function GrantExpansionForm({
  leagueId,
  contestId,
  invalidates,
}: {
  leagueId: string;
  contestId: string;
  invalidates: ReadonlyArray<readonly unknown[]>;
}) {
  const [entries, setEntries] = useState('');
  const [reason, setReason] = useState('');
  const grantMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await grantContestExpansion({
        path: { id: leagueId, contestId },
        body: { entriesPerContest: Number(entries), reason },
      });
      if (!response.data) {
        throwApiError(response.error, 'Contest expansion response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setEntries('');
      setReason('');
    },
    invalidates: [...invalidates],
  });
  const entriesValue = Number(entries);
  const isValid = Number.isInteger(entriesValue) && entriesValue >= 1 && reason.trim().length > 0;

  return (
    <form
      className="space-y-3 px-5 py-4"
      data-testid="contest-expansion-grant"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid) grantMutation.mutate();
      }}
    >
      <p className="text-sm font-medium">Give an expansion free</p>
      <div className="flex flex-wrap items-end gap-3">
        <FormField className="w-36" label="Entries">
          <Input
            data-testid="contest-expansion-grant-entries"
            min={1}
            onChange={(event) => setEntries(event.target.value)}
            step={1}
            type="number"
            value={entries}
          />
        </FormField>
        <FormField className="min-w-48 flex-1" label="Reason">
          <Input
            data-testid="contest-expansion-grant-reason"
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </FormField>
        <Button data-testid="contest-expansion-grant-submit" disabled={!isValid || grantMutation.isPending} type="submit" variant="secondary">
          {grantMutation.isPending ? 'Giving...' : 'Give free'}
        </Button>
      </div>
      {grantMutation.isError ? (
        <Alert data-testid="contest-expansion-grant-error" tone="danger">
          {extractErrorMessage(grantMutation.error, {
            codeMessages: EXPANSION_CODE_MESSAGES,
            fallback: 'We could not give that expansion. Please try again.',
          })}
        </Alert>
      ) : null}
    </form>
  );
}
