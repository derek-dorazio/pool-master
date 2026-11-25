import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminMapFindingParticipantPage } from './root-admin-map-finding-participant-page';
import { RootAdminSyncFindingsPage } from './root-admin-sync-findings-page';
import { participantFixture } from './sport-test-fixtures';
import { buildLeagueOpenFindingsPath, SYNC_FINDINGS_GRID_KEY } from './sync-findings-links';

// /manage/providers/findings (#1999): every sync finding in one grid, open ones first by default,
// each opening its dialog with Details and the actions the API says it offers; an unmapped
// participant's Map participant opens its own page, which maps and resolves it.

const mocks = vi.hoisted(() => ({
  listProviderSyncFindings: vi.fn(),
  getProviderSyncFinding: vi.fn(),
  changeProviderSyncFindingStatus: vi.fn(),
  mapProviderSyncFindingParticipant: vi.fn(),
  listSportLeagueParticipants: vi.fn(),
  listProviderSyncFindingSlotChoices: vi.fn(),
  linkProviderSyncFindingSlot: vi.fn(),
}));

bindApiMocks(mocks);

const DIALOG = 'root-admin-sync-finding-dialog';
const MAP_PATH = '/manage/providers/findings/finding-1/map-participant';

function finding(overrides: Partial<ProviderSyncFindingDto> = {}): ProviderSyncFindingDto {
  return {
    id: 'finding-1',
    kind: 'UNMAPPED_PARTICIPANT',
    severity: 'WARNING',
    status: 'OPEN',
    sportLeague: { id: 'pga', name: 'PGA TOUR', sport: 'GOLF' },
    sportEvent: null,
    provider: { id: 'provider-1', name: 'BALLDONTLIE' },
    providerValue: 'golfer-77',
    providerValueName: 'Ludvig Aberg',
    waiveNote: null,
    firstSeenAt: '2026-11-20T12:00:00.000Z',
    lastSeenAt: '2026-11-23T12:00:00.000Z',
    seenCount: 4,
    statusChangedAt: '2026-11-20T12:00:00.000Z',
    statusChangedBy: null,
    actions: ['MAP_PARTICIPANT', 'RESOLVE', 'WAIVE'],
    ...overrides,
  };
}

const WEBHOOK = finding({
  id: 'finding-2', kind: 'WEBHOOK_SECRET_MISSING', severity: 'ERROR', sportLeague: { id: 'nfl', name: 'NFL', sport: 'AMERICAN_FOOTBALL' },
  providerValue: null, providerValueName: null, actions: ['RESOLVE', 'WAIVE'],
});
const NAMESAKE = finding({
  id: 'finding-4', kind: 'WEBHOOK_SECRET_MISSING', severity: 'ERROR', sportLeague: { id: 'nfl-2', name: 'NFL', sport: 'AMERICAN_FOOTBALL' },
  providerValue: null, providerValueName: null, actions: ['RESOLVE', 'WAIVE'],
});
const UNMATCHED_NAME = finding({
  id: 'finding-5', kind: 'SLOT_NAME_UNMATCHED', severity: 'INFO', providerValue: 'the new open', providerValueName: 'The 2027 New Open',
  actions: ['LINK_SLOT', 'RESOLVE', 'WAIVE'],
});
const SLOT_CHOICES = [
  { slotDefinitionId: 'slot-masters', key: 'MASTERS', slotKind: 'TOURNAMENT', weekNumber: null, name: 'Masters Tournament', patterns: ['masters tournament'] },
  { slotDefinitionId: 'slot-memorial', key: 'MEMORIAL_TOURNAMENT', slotKind: 'TOURNAMENT', weekNumber: null, name: 'the Memorial Tournament', patterns: ['the memorial tournament'] },
] as const;
const WAIVED = finding({
  id: 'finding-3', status: 'WAIVED', providerValue: 'golfer-88', providerValueName: 'An Amateur', waiveNote: 'Plays once a year',
  statusChangedBy: { id: 'admin-1', displayName: 'Root Admin' }, actions: ['REOPEN'],
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(entry = '/manage/providers/findings') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<><RootAdminSyncFindingsPage /><LocationProbe /></>} path="/manage/providers/findings" />
          <Route element={<><RootAdminMapFindingParticipantPage /><LocationProbe /></>} path="/manage/providers/findings/:findingId/map-participant" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openFinding(id: string) {
  fireEvent.click(within(await screen.findByTestId(`root-admin-sync-finding-${id}`)).getByRole('button', { name: 'Open details' }));
  return screen.findByTestId(DIALOG);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listProviderSyncFindings.mockResolvedValue({ data: { findings: [finding(), WEBHOOK, WAIVED, UNMATCHED_NAME] } });
  mocks.listProviderSyncFindingSlotChoices.mockResolvedValue({ data: { slots: SLOT_CHOICES } });
  mocks.getProviderSyncFinding.mockResolvedValue({ data: { finding: finding() } });
  mocks.listSportLeagueParticipants.mockResolvedValue({
    data: {
      participants: [
        participantFixture({ id: 'participant-1', name: 'Ludvig Åberg', nationality: 'SWE', sportLeagueId: 'pga' }),
        participantFixture({ id: 'participant-2', name: 'Tom Kim', sportLeagueId: 'pga' }),
      ],
    },
  });
});

describe('RootAdminSyncFindingsPage', () => {
  it('lists open findings by default with their severity, kind, league and what they are about, and hides the waived one', async () => {
    renderPage();

    const row = await screen.findByTestId('root-admin-sync-finding-finding-1');
    expect(row).toHaveTextContent('Warning');
    expect(row).toHaveTextContent('PGA TOUR');
    expect(row).toHaveTextContent('Ludvig Aberg (golfer-77)');
    expect(row).toHaveTextContent('BALLDONTLIE');
    expect(screen.getByTestId('root-admin-sync-finding-finding-2')).toHaveTextContent('Error');
    expect(screen.queryByTestId('root-admin-sync-finding-finding-3')).not.toBeInTheDocument();
  });

  it('says the sync has found nothing when there are no findings', async () => {
    mocks.listProviderSyncFindings.mockResolvedValue({ data: { findings: [] } });
    renderPage();

    expect(await screen.findByText('The sync has found nothing that needs a look.')).toBeInTheDocument();
  });

  it('opens a finding in view mode with its Details and the actions the API offers, Map participant linking to its page', async () => {
    renderPage();

    const dialog = within(await openFinding('finding-1'));

    expect(dialog.getByTestId(`${DIALOG}-league`)).toHaveTextContent('PGA TOUR');
    expect(dialog.getByTestId(`${DIALOG}-value`)).toHaveTextContent('golfer-77');
    expect(dialog.getByTestId(`${DIALOG}-last-seen`)).toHaveTextContent('4 times');
    expect(dialog.getByTestId(`${DIALOG}-changed`)).toHaveTextContent('By the sync');
    expect(dialog.getByTestId(`${DIALOG}-MAP_PARTICIPANT`)).toHaveAttribute('href', MAP_PATH);
    expect(dialog.getByTestId(`${DIALOG}-RESOLVE`)).toBeEnabled();
    expect(dialog.getByTestId(`${DIALOG}-WAIVE`)).toBeEnabled();
    expect(dialog.queryByTestId(`${DIALOG}-REOPEN`)).not.toBeInTheDocument();
  });

  it('offers no Map participant for a finding whose kind has no fix in the app', async () => {
    renderPage();

    const dialog = within(await openFinding('finding-2'));

    expect(dialog.queryByTestId(`${DIALOG}-MAP_PARTICIPANT`)).not.toBeInTheDocument();
    expect(dialog.getByTestId(`${DIALOG}-RESOLVE`)).toBeInTheDocument();
  });

  it('resolves a finding with one click and reloads the findings', async () => {
    mocks.changeProviderSyncFindingStatus.mockResolvedValue({ data: { finding: finding({ status: 'RESOLVED', actions: ['REOPEN'] }) } });
    renderPage();

    await openFinding('finding-1');
    fireEvent.click(screen.getByTestId(`${DIALOG}-RESOLVE`));

    await waitFor(() => expect(mocks.changeProviderSyncFindingStatus).toHaveBeenCalledWith(expect.objectContaining({
      path: { findingId: 'finding-1' }, body: { action: 'RESOLVE' },
    })));
    await waitFor(() => expect(mocks.listProviderSyncFindings).toHaveBeenCalledTimes(2));
  });

  it('waives a finding only with a note, sent with the waive', async () => {
    mocks.changeProviderSyncFindingStatus.mockResolvedValue({ data: { finding: finding({ status: 'WAIVED', waiveNote: 'An amateur', actions: ['REOPEN'] }) } });
    renderPage();

    await openFinding('finding-1');
    fireEvent.click(screen.getByTestId(`${DIALOG}-WAIVE`));
    const confirm = await screen.findByTestId(`${DIALOG}-waive-confirm`);
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId(`${DIALOG}-waive-note`), { target: { value: 'An amateur' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.changeProviderSyncFindingStatus).toHaveBeenCalledWith(expect.objectContaining({
      path: { findingId: 'finding-1' }, body: { action: 'WAIVE', waiveNote: 'An amateur' },
    })));
    await waitFor(() => expect(screen.queryByTestId(`${DIALOG}-waive`)).not.toBeInTheDocument());
  });

  it('keeps the waive confirm open with the server\'s reason when the waive is refused', async () => {
    mocks.changeProviderSyncFindingStatus.mockResolvedValue({
      error: { error: { code: 'SYNC_FINDING_ACTION_NOT_OFFERED', message: 'A RESOLVED finding does not offer WAIVE.' } },
      response: { status: 409 },
    });
    renderPage();

    await openFinding('finding-1');
    fireEvent.click(screen.getByTestId(`${DIALOG}-WAIVE`));
    fireEvent.change(await screen.findByTestId(`${DIALOG}-waive-note`), { target: { value: 'An amateur' } });
    fireEvent.click(screen.getByTestId(`${DIALOG}-waive-confirm`));

    expect(await screen.findByTestId(`${DIALOG}-waive-error`)).toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-waive`)).toBeInTheDocument();
  });

  it('shows a waived finding\'s note and who waived it, and offers only Reopen', async () => {
    renderPage(buildLeagueOpenFindingsPath('pga', 'WARNING').replace('OPEN', 'WAIVED'));

    const dialog = within(await openFinding('finding-3'));

    expect(dialog.getByTestId(`${DIALOG}-note`)).toHaveTextContent('Plays once a year');
    expect(dialog.getByTestId(`${DIALOG}-changed`)).toHaveTextContent('By Root Admin');
    expect(dialog.getByTestId(`${DIALOG}-REOPEN`)).toBeEnabled();
    expect(dialog.queryByTestId(`${DIALOG}-WAIVE`)).not.toBeInTheDocument();
  });
});

describe('Link to existing on a tournament name finding', () => {
  it('reads the slots only once it is opened, sends the chosen slot, and closes when the finding is resolved', async () => {
    mocks.linkProviderSyncFindingSlot.mockResolvedValue({ data: { finding: { ...UNMATCHED_NAME, status: 'RESOLVED', actions: ['REOPEN'] } } });
    renderPage();

    const dialog = within(await openFinding('finding-5'));
    expect(dialog.getByTestId(`${DIALOG}-value`)).toHaveTextContent('the new open');
    expect(dialog.queryByTestId(`${DIALOG}-MAP_PARTICIPANT`)).not.toBeInTheDocument();
    expect(mocks.listProviderSyncFindingSlotChoices).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByTestId(`${DIALOG}-LINK_SLOT`));

    const confirm = await screen.findByTestId(`${DIALOG}-link-confirm`);
    expect(confirm).toBeDisabled();
    const picker = await screen.findByTestId(`${DIALOG}-link-slot`);
    await waitFor(() => expect(picker).toHaveTextContent('Masters Tournament'));
    expect(mocks.listProviderSyncFindingSlotChoices).toHaveBeenCalledWith(expect.objectContaining({ path: { findingId: 'finding-5' } }));
    fireEvent.change(picker, { target: { value: 'slot-memorial' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.linkProviderSyncFindingSlot).toHaveBeenCalledWith(expect.objectContaining({
      path: { findingId: 'finding-5' }, body: { slotDefinitionId: 'slot-memorial' },
    })));
    await waitFor(() => expect(screen.queryByTestId(`${DIALOG}-link`)).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.listProviderSyncFindings).toHaveBeenCalledTimes(2));
  });

  it('keeps the link confirm open with the server\'s reason when the name already places a tournament', async () => {
    mocks.linkProviderSyncFindingSlot.mockResolvedValue({
      error: { error: { code: 'SLOT_NAME_PATTERN_TAKEN', message: '"the new open" already places a tournament on a slot of PGA TOUR.' } },
      response: { status: 409 },
    });
    renderPage();

    fireEvent.click(within(await openFinding('finding-5')).getByTestId(`${DIALOG}-LINK_SLOT`));
    const picker = await screen.findByTestId(`${DIALOG}-link-slot`);
    await waitFor(() => expect(picker).toHaveTextContent('Masters Tournament'));
    fireEvent.change(picker, { target: { value: 'slot-masters' } });
    fireEvent.click(screen.getByTestId(`${DIALOG}-link-confirm`));

    expect(await screen.findByTestId(`${DIALOG}-link-error`)).toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-link`)).toBeInTheDocument();
  });

  it('says why, with a retry, when the slots cannot be read, and offers no slot to confirm', async () => {
    mocks.listProviderSyncFindingSlotChoices.mockResolvedValue({
      error: { error: { code: 'SYNC_FINDING_ACTION_NOT_OFFERED', message: 'A RESOLVED SLOT_NAME_UNMATCHED finding does not offer LINK_SLOT.' } },
      response: { status: 409 },
    });
    renderPage();

    fireEvent.click(within(await openFinding('finding-5')).getByTestId(`${DIALOG}-LINK_SLOT`));

    expect(await screen.findByTestId(`${DIALOG}-link-slots-error`)).toBeInTheDocument();
    expect(screen.queryByTestId(`${DIALOG}-link-slot`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-link-confirm`)).toBeDisabled();
  });
});

describe('buildLeagueOpenFindingsPath', () => {
  it('opens Findings filtered to one league\'s OPEN findings of one severity, by the league\'s id, so another league of the same name stays out', async () => {
    const path = buildLeagueOpenFindingsPath('nfl', 'ERROR');
    expect(path.startsWith('/manage/providers/findings?')).toBe(true);
    expect(new URLSearchParams(path.split('?')[1]).get(SYNC_FINDINGS_GRID_KEY)).not.toBeNull();

    mocks.listProviderSyncFindings.mockResolvedValue({ data: { findings: [finding(), WEBHOOK, NAMESAKE, WAIVED] } });
    renderPage(path);
    expect(await screen.findByTestId('root-admin-sync-finding-finding-2')).toHaveTextContent('NFL');
    expect(screen.queryByTestId('root-admin-sync-finding-finding-4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sync-finding-finding-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sync-finding-finding-3')).not.toBeInTheDocument();
  });
});

describe('RootAdminMapFindingParticipantPage', () => {
  it('maps the feed\'s id to the chosen participant of the finding\'s league, then returns to Findings', async () => {
    mocks.mapProviderSyncFindingParticipant.mockResolvedValue({ data: { finding: finding({ status: 'RESOLVED', actions: ['REOPEN'] }) } });
    renderPage(MAP_PATH);

    expect(await screen.findByTestId('root-admin-map-finding-participant-page')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-map-finding-participant-save')).toBeDisabled();
    // The name box starts from the feed's spelling and narrows the league's roster.
    expect(screen.getByTestId('root-admin-map-finding-participant-search')).toHaveValue('Ludvig Aberg');
    fireEvent.change(screen.getByTestId('root-admin-map-finding-participant-search'), { target: { value: 'Ludvig' } });
    const picker = screen.getByTestId('root-admin-map-finding-participant-participant');
    await waitFor(() => expect(picker).toBeEnabled());
    expect(mocks.listSportLeagueParticipants).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'pga' } }));
    expect(picker).toHaveTextContent('Ludvig Åberg (SWE)');
    expect(picker).not.toHaveTextContent('Tom Kim');
    fireEvent.change(picker, { target: { value: 'participant-1' } });
    fireEvent.click(screen.getByTestId('root-admin-map-finding-participant-save'));

    await waitFor(() => expect(mocks.mapProviderSyncFindingParticipant).toHaveBeenCalledWith(expect.objectContaining({
      path: { findingId: 'finding-1' }, body: { participantId: 'participant-1' },
    })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/manage\/providers\/findings$/));
  });

  it('keeps the page open with the server\'s reason when the mapping is refused', async () => {
    mocks.mapProviderSyncFindingParticipant.mockResolvedValue({
      error: { error: { code: 'SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE', message: 'Tom Kim is not in PGA TOUR.' } },
      response: { status: 422 },
    });
    renderPage(MAP_PATH);

    fireEvent.change(await screen.findByTestId('root-admin-map-finding-participant-search'), { target: { value: '' } });
    const picker = screen.getByTestId('root-admin-map-finding-participant-participant');
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: 'participant-2' } });
    fireEvent.click(screen.getByTestId('root-admin-map-finding-participant-save'));

    await waitFor(() => expect(mocks.mapProviderSyncFindingParticipant).toHaveBeenCalled());
    expect(screen.getByTestId('root-admin-map-finding-participant-page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(MAP_PATH);
  });

  it('starts with an empty name box and names the league when the feed sent no name and the finding names no Provider', async () => {
    mocks.getProviderSyncFinding.mockResolvedValue({ data: { finding: finding({ providerValueName: null, provider: null }) } });
    renderPage(MAP_PATH);

    expect(await screen.findByTestId('root-admin-map-finding-participant-search')).toHaveValue('');
    const picker = screen.getByTestId('root-admin-map-finding-participant-participant');
    await waitFor(() => expect(picker).toHaveTextContent('Tom Kim'));
    expect(picker).toHaveTextContent('Ludvig Åberg (SWE)');
  });

  it('says no participant matches a name the roster does not have, and keeps Map participant off', async () => {
    renderPage(MAP_PATH);

    fireEvent.change(await screen.findByTestId('root-admin-map-finding-participant-search'), { target: { value: 'Nobody Here' } });

    await waitFor(() => expect(screen.getByTestId('root-admin-map-finding-participant-participant')).toHaveTextContent('No matching participants'));
    expect(screen.getByTestId('root-admin-map-finding-participant-participant')).toBeDisabled();
    expect(screen.getByTestId('root-admin-map-finding-participant-save')).toBeDisabled();
  });

  it('says it could not load the participants, and offers a retry, when the roster read fails', async () => {
    mocks.listSportLeagueParticipants.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Down for a moment.' } },
      response: { status: 500 },
    });
    renderPage(MAP_PATH);

    expect(await screen.findByTestId('root-admin-map-finding-participant-error')).toBeInTheDocument();
  });

  it('says there is nothing to map when the finding no longer offers Map participant', async () => {
    mocks.getProviderSyncFinding.mockResolvedValue({ data: { finding: WAIVED } });
    renderPage(MAP_PATH);

    expect(await screen.findByText('Nothing to map: this finding is no longer open.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-map-finding-participant-save')).not.toBeInTheDocument();
  });
});
