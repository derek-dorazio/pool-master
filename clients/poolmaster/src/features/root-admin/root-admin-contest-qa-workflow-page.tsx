import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminListProviders,
  adminRunContestQaWorkflow,
  listEvents,
  type ListEventsResponses,
} from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import {
  Alert,
  Button,
  FormField,
  LinkButton,
  MetricGrid,
  MetricTile,
  Select,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import {
  formatJsonPayload,
  getSupportedSyncSports,
  type ContestQaWorkflowSubmission,
  type ProviderSummary,
  type SyncSport,
} from './root-admin-sync-utils';

type WorkflowMode = 'PREPARE_CONTEST_EVENT_DATA' | 'DRIVE_EVENT_LIVE_TEST';
type MockEventState = 'open' | 'locked' | 'live' | 'completed';
type EventSyncEvent = ListEventsResponses[200]['events'][number];

const WORKFLOW_MODE_OPTIONS: Array<{ value: WorkflowMode; label: string }> = [
  { value: 'PREPARE_CONTEST_EVENT_DATA', label: 'Prepare contest event data' },
  { value: 'DRIVE_EVENT_LIVE_TEST', label: 'Drive event live test' },
];

const MOCK_EVENT_STATE_OPTIONS: Array<{ value: MockEventState | ''; label: string }> = [
  { value: '', label: 'Choose event state' },
  { value: 'open', label: 'Open' },
  { value: 'locked', label: 'Locked' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
];

function formatEventOptionLabel(event: EventSyncEvent) {
  return [
    event.name,
    event.status,
    event.readinessStatus,
    event.externalId,
  ].join(' · ');
}

function getStepTone(status: ContestQaWorkflowSubmission['steps'][number]['status']) {
  switch (status) {
    case 'SUBMITTED':
      return 'warning';
    case 'BLOCKED':
      return 'danger';
    case 'SKIPPED':
      return 'neutral';
  }
}

export function RootAdminContestQaWorkflowPage() {
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('PREPARE_CONTEST_EVENT_DATA');
  const [sport, setSport] = useState<SyncSport>('GOLF');
  const [eventId, setEventId] = useState('');
  const [mockEventState, setMockEventState] = useState<MockEventState | ''>('live');

  const providersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async (): Promise<ProviderSummary[]> => {
      const response = await adminListProviders();
      if (!response.data?.items) {
        throw response.error ?? new Error('Provider list response is missing data.');
      }
      return response.data.items;
    },
    retry: false,
  });

  const supportedSyncSports = useMemo(
    () => getSupportedSyncSports(providersQuery.data),
    [providersQuery.data],
  );

  const eventsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.eventSyncEvents(sport),
    queryFn: async (): Promise<EventSyncEvent[]> => {
      const response = await listEvents({
        query: {
          sport,
          limit: 100,
        },
      });

      if (!response.data?.events) {
        throw response.error ?? new Error('Event list response is missing data.');
      }

      return response.data.events;
    },
    enabled: supportedSyncSports.includes(sport),
    retry: false,
  });

  const selectableEvents = eventsQuery.data ?? [];
  const isLiveTest = workflowMode === 'DRIVE_EVENT_LIVE_TEST';
  const supportsSelectedSport = supportedSyncSports.includes(sport);
  const canSubmit =
    !providersQuery.isLoading
    && !eventsQuery.isLoading
    && supportsSelectedSport
    && (!isLiveTest || (eventId.trim().length > 0 && mockEventState !== ''));

  const workflowMutation = useInvalidatingMutation({
    mutationFn: async (): Promise<ContestQaWorkflowSubmission> => {
      const response = await adminRunContestQaWorkflow({
        body: {
          mode: workflowMode,
          sport,
          ...(eventId ? { eventId } : {}),
          ...(isLiveTest && mockEventState ? { mockEventState } : {}),
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Contest QA workflow response is missing data.');
      }

      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.providerSyncRuns],
  });

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-contest-qa-workflow-page"
    >
      <Tile>
        <div className="flex flex-wrap gap-3">
          <LinkButton to="/manage/sync" variant="subtle">
            Back to Sync dashboard
          </LinkButton>
          <LinkButton to="/manage/sync/run-sport-sync" variant="subtle">
            Low-level sport sync
          </LinkButton>
          <LinkButton to="/manage/sync/run-event-sync" variant="subtle">
            Low-level event sync
          </LinkButton>
        </div>
      </Tile>

      <Tile>
        <div className="space-y-3">
          <FormField label="Workflow">
            <Select
              data-testid="root-admin-contest-qa-workflow-mode"
              disabled={workflowMutation.isPending}
              onChange={(event) => setWorkflowMode(event.target.value as WorkflowMode)}
              value={workflowMode}
            >
              {WORKFLOW_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Sport">
            <Select
              data-testid="root-admin-contest-qa-sport"
              disabled={workflowMutation.isPending}
              onChange={(event) => setSport(event.target.value as SyncSport)}
              value={sport}
            >
              {supportedSyncSports.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Event">
            <Select
              data-testid="root-admin-contest-qa-event-id"
              disabled={workflowMutation.isPending || eventsQuery.isLoading}
              onChange={(event) => setEventId(event.target.value)}
              value={eventId}
            >
              <option value="">
                {isLiveTest ? 'Select event for live test' : 'Optional: select event to hydrate'}
              </option>
              {selectableEvents.map((event) => (
                <option key={event.id} value={event.externalId}>
                  {formatEventOptionLabel(event)}
                </option>
              ))}
            </Select>
          </FormField>

          {isLiveTest ? (
            <FormField label="Mock event state">
              <Select
                data-testid="root-admin-contest-qa-mock-event-state"
                disabled={workflowMutation.isPending}
                onChange={(event) => setMockEventState(event.target.value as MockEventState | '')}
                value={mockEventState}
              >
                {MOCK_EVENT_STATE_OPTIONS.map((option) => (
                  <option key={option.value || 'empty'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}

          {providersQuery.isError ? (
            <Alert>
              {extractErrorMessage(
                providersQuery.error,
                { fallback: 'Provider health context is unavailable right now.' },
              )}
            </Alert>
          ) : null}

          {eventsQuery.isError ? (
            <Alert>
              {extractErrorMessage(
                eventsQuery.error,
                { fallback: 'Loaded events are unavailable right now.' },
              )}
            </Alert>
          ) : null}

          {!providersQuery.isLoading && !supportsSelectedSport ? (
            <Alert tone="warning">
              No configured provider currently supports guided sync for {sport}.
            </Alert>
          ) : null}

          <Button
            data-testid="root-admin-contest-qa-run"
            disabled={workflowMutation.isPending || !canSubmit}
            onClick={() => workflowMutation.mutate()}
            type="button"
          >
            {workflowMutation.isPending ? 'Submitting...' : 'Run guided workflow'}
          </Button>
        </div>
      </Tile>

      {workflowMutation.isError ? (
        <Alert tone="danger">
          {extractErrorMessage(
            workflowMutation.error,
            { fallback: 'We could not submit the guided workflow right now.' },
          )}
        </Alert>
      ) : null}

      {workflowMutation.isSuccess ? (
        <Tile data-testid="root-admin-contest-qa-response">
          <div className="space-y-4">
            <div>
              <p className="font-medium text-foreground">Workflow submitted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {workflowMutation.data.workflowId}
              </p>
            </div>

            <MetricGrid className="md:grid-cols-3">
              <MetricTile label="Steps" value={workflowMutation.data.steps.length} />
              <MetricTile label="Known future events" value={workflowMutation.data.eventCandidates.length} />
              <MetricTile label="Warnings" value={workflowMutation.data.warnings.length} />
            </MetricGrid>

            <div className="space-y-3">
              {workflowMutation.data.steps.map((step) => (
                <div
                  className="rounded-2xl border border-border bg-background p-4"
                  key={step.id}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone={getStepTone(step.status)}>
                      {step.status}
                    </StatusBadge>
                    <p className="font-medium text-foreground">{step.label}</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{step.summary}</p>
                  {step.syncRunIds.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sync runs: {step.syncRunIds.join(', ')}
                    </p>
                  ) : null}
                  {step.nextActions.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                      {step.nextActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>

            {workflowMutation.data.nextActions.length > 0 ? (
              <Alert tone="warning">
                {workflowMutation.data.nextActions.join(' ')}
              </Alert>
            ) : null}

            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
              {formatJsonPayload(workflowMutation.data)}
            </pre>
          </div>
        </Tile>
      ) : null}
    </section>
  );
}
