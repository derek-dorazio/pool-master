import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { DataGrid, DetailEditModal, SectionCard, type Fact } from '@/features/shared/ui';
import type { SportLeagueConferenceDivisionDto, SportLeagueConferenceDto } from '@/lib/api';
import { providerCodeText } from './league-structure-rows';

const columnHelper = createColumnHelper<SportLeagueConferenceDto>();

/** Each provider code of a conference or division in one line; "No provider" where no feed names it. */
function providerCodesText(row: Pick<SportLeagueConferenceDto, 'providerCodes'>): string {
  return row.providerCodes.length === 0 ? 'No provider' : row.providerCodes.map(providerCodeText).join(', ');
}

/** A division in one line, with its code and each provider's code for it. */
function divisionText(division: SportLeagueConferenceDivisionDto): string {
  return `${division.name} (${division.code}) · ${providerCodesText(division)}`;
}

/** The Conferences grid's columns, each explained behind its (i). */
const conferenceColumns = [
  columnHelper.accessor('name', {
    header: 'Conference',
    meta: { info: 'The conference\'s name, listed in the league\'s own order. ⤢ opens it with its divisions.', type: { kind: 'text' } },
  }),
  columnHelper.accessor('code', {
    header: 'Code',
    meta: { info: 'The conference\'s code in its league. A postseason conference competition names its conference by this row.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((conference) => conference.divisions.map((division) => division.name).join(', '), {
    id: 'divisions',
    header: 'Divisions',
    meta: { info: 'The conference\'s divisions in order. Blank: the conference has none.', type: { kind: 'text' } },
  }),
  columnHelper.accessor((conference) => conference.providerCodes.map(providerCodeText).join(', '), {
    id: 'providerCodes',
    header: 'Provider codes',
    meta: { info: 'Each provider\'s code for the conference. The events sync places each team in its conference for the Season from these. Blank: no feed names it.', type: { kind: 'text' } },
  }),
];

/**
 * The Structure tab's Conferences section (#2052): the league's conferences by display order,
 * set by migration; ⤢ opens one to read with its description and its divisions' provider codes.
 */
export function LeagueStructureConferencesSection({ conferences }: { conferences: readonly SportLeagueConferenceDto[] }) {
  const [openConferenceId, setOpenConferenceId] = useState<string | null>(null);
  const openConference = conferences.find((conference) => conference.id === openConferenceId);

  return (
    <SectionCard padded testId="root-admin-league-structure-conferences" title="Conferences">
      <DataGrid
        columns={conferenceColumns}
        data={[...conferences]}
        emptyMessage="No conferences for this league."
        filterTestIdPrefix="root-admin-league-structure-conferences-filter"
        getRowId={(conference) => conference.id}
        openRowDialog={(conference) => setOpenConferenceId(conference.id)}
        rowTestId={(conference) => `root-admin-league-structure-conference-${conference.code}`}
        tableTestId="root-admin-league-structure-conferences-table"
        urlKey="conferences"
      />
      {openConference ? <ConferenceDialog conference={openConference} onClose={() => setOpenConferenceId(null)} /> : null}
    </SectionCard>
  );
}

/** A conference to read, with no Edit: migrations own these rows. */
function ConferenceDialog({ conference, onClose }: { conference: SportLeagueConferenceDto; onClose: () => void }) {
  const facts: Fact[] = [
    { id: 'code', label: 'Code', value: conference.code },
    { id: 'description', label: 'Description', value: conference.description },
    { id: 'provider-codes', label: 'Provider codes', testId: 'root-admin-league-structure-conference-codes', value: providerCodesText(conference) },
    {
      id: 'divisions',
      label: 'Divisions',
      testId: 'root-admin-league-structure-conference-divisions',
      value: conference.divisions.length === 0
        ? 'No divisions'
        : (
            <ul className="space-y-1">
              {conference.divisions.map((division) => (
                <li data-testid={`root-admin-league-structure-division-${division.code}`} key={division.id}>{divisionText(division)}</li>
              ))}
            </ul>
          ),
    },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId="root-admin-league-structure-conference"
      title={conference.name}
    />
  );
}
