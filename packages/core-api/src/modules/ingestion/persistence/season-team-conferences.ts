/**
 * The teams' conferences and divisions for one Season (#2052, plans/league-model-redesign.md §4),
 * written from the team payload the events sync already reads with each event's field. There is
 * no separate team sync: a field sync's teams carry the feed's conference and division codes, and
 * this writes each team's Season row from them through the league's conference provider mappings.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  requireProviderCodeOfSourceId,
  type ProviderSyncFindingRaise,
} from '@poolmaster/shared/domain';
import type { ProviderParticipant } from '../core/provider-interface';

/** A team the feed placed in a conference, with its participant id in the league. */
export interface ConferenceTeam {
  participantId: string;
  participant: ProviderParticipant;
}

/** What the write did, and the codes it could not place. */
export interface SeasonTeamConferenceWrite {
  created: number;
  moved: number;
  findings: Array<Omit<ProviderSyncFindingRaise, 'providerId'>>;
}

const NOTHING: SeasonTeamConferenceWrite = { created: 0, moved: 0, findings: [] };

/**
 * Writes the teams' conference rows for the Season, in a fixed number of statements whatever the
 * number of teams: the league's codes at this provider in one read (with each conference's
 * division codes), the teams' rows in the Season in one, the new rows in one `createMany`, and only
 * a team the feed moved updated by itself, all in one transaction. A league whose mappings at this
 * provider name no conference codes has no conferences there (soccer, golf), so nothing is read
 * further and nothing is raised. Inclusion only, as for positions: a conference code with no row
 * leaves the team without a row and raises CONFERENCE_UNMAPPED, a division code with no row in the
 * team's conference writes the team with its conference alone and raises DIVISION_UNMAPPED. A team
 * the feed names no conference for keeps whatever row it has. Nothing is deleted.
 */
export async function writeSeasonTeamConferences(
  prisma: PrismaClient,
  input: { sportLeagueId: string; sportLeagueSeasonId: string; providerSourceId: string; teams: readonly ConferenceTeam[] },
): Promise<SeasonTeamConferenceWrite> {
  const { sportLeagueId, sportLeagueSeasonId, providerSourceId } = input;
  const teams = input.teams.flatMap(({ participantId, participant }) => (participant.conference === undefined
    ? []
    : [{ participantId, name: participant.name, ...participant.conference }]));
  if (teams.length === 0) return NOTHING;

  const providerCode = requireProviderCodeOfSourceId(providerSourceId);
  const codes = await prisma.sportLeagueConferenceProviderMapping.findMany({
    where: { sportLeagueId, sportLeagueProviderMapping: { providerLeague: { provider: { code: providerCode } } } },
    select: {
      providerCode: true,
      sportLeagueProviderMappingId: true,
      conference: { select: {
        id: true,
        name: true,
        divisions: { select: {
          id: true,
          providerCodes: { select: { providerCode: true, sportLeagueProviderMappingId: true } },
        } },
      } },
    },
  });
  if (codes.length === 0) return NOTHING;

  const conferenceByCode = new Map(codes.map((code) => [code.providerCode, {
    id: code.conference.id,
    name: code.conference.name,
    // A division code counts only on the mapping that named the conference's code.
    divisionByCode: new Map(code.conference.divisions.flatMap((division) => division.providerCodes
      .filter((divisionCode) => divisionCode.sportLeagueProviderMappingId === code.sportLeagueProviderMappingId)
      .map((divisionCode) => [divisionCode.providerCode, division.id] as const))),
  }]));

  // One finding per kind and code, however many teams sent it.
  const unmappedConferences = new Map<string, Omit<ProviderSyncFindingRaise, 'providerId'>>();
  const unmappedDivisions = new Map<string, Omit<ProviderSyncFindingRaise, 'providerId'>>();
  const wanted = new Map<string, { conferenceId: string; divisionId: string | null }>();
  for (const { participantId, name, providerCode: code, divisionProviderCode } of teams) {
    const conference = conferenceByCode.get(code);
    if (conference === undefined) {
      // Named by the first team the feed sent in it.
      if (!unmappedConferences.has(code)) unmappedConferences.set(code, {
        kind: ProviderSyncFindingKind.CONFERENCE_UNMAPPED,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId,
        sportEventId: null,
        providerValue: code,
        providerValueName: name,
      });
      continue;
    }
    const divisionId = divisionProviderCode === undefined ? null : conference.divisionByCode.get(divisionProviderCode) ?? null;
    if (divisionProviderCode !== undefined && divisionId === null && !unmappedDivisions.has(divisionProviderCode)) {
      unmappedDivisions.set(divisionProviderCode, {
        kind: ProviderSyncFindingKind.DIVISION_UNMAPPED,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId,
        sportEventId: null,
        providerValue: divisionProviderCode,
        providerValueName: conference.name,
      });
    }
    wanted.set(participantId, { conferenceId: conference.id, divisionId });
  }

  const findings = [...unmappedConferences.values(), ...unmappedDivisions.values()];
  if (wanted.size === 0) return { ...NOTHING, findings };
  const existing = new Map((await prisma.sportLeagueSeasonTeamConference.findMany({
    where: { sportLeagueSeasonId, participantId: { in: [...wanted.keys()] } },
    select: { id: true, participantId: true, conferenceId: true, divisionId: true },
  })).map((row) => [row.participantId, row]));

  const created: Prisma.SportLeagueSeasonTeamConferenceCreateManyInput[] = [];
  const moved: Array<{ id: string; conferenceId: string; divisionId: string | null }> = [];
  for (const [participantId, row] of wanted) {
    const stored = existing.get(participantId);
    if (stored === undefined) {
      created.push({ id: randomUUID(), sportLeagueId, sportLeagueSeasonId, participantId, ...row });
    } else if (stored.conferenceId !== row.conferenceId || stored.divisionId !== row.divisionId) {
      moved.push({ id: stored.id, ...row });
    }
  }
  if (created.length > 0 || moved.length > 0) {
    await prisma.$transaction([
      ...(created.length > 0 ? [prisma.sportLeagueSeasonTeamConference.createMany({ data: created })] : []),
      // poolmaster-allow-query-in-loop: only the teams the feed moved to another conference or division, one transaction
      ...moved.map(({ id, ...row }) => prisma.sportLeagueSeasonTeamConference.update({ where: { id }, data: row })),
    ]);
  }
  return { created: created.length, moved: moved.length, findings };
}
