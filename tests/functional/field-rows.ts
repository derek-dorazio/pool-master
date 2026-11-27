/**
 * Test-only helpers that name a test event's field rows by their participant's name. The field
 * upload and the result rows that matched a participant by name are gone (#2008, #2114): the feed
 * sends rankings, seeds and results by id. A functional test names its own participants, so the
 * name lookup lives here, in test code, and the API is sent ids.
 */
import { listEventParticipants, updateEventParticipants } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import type { UpdateSportEventParticipantsRequest } from '@poolmaster/shared/dto/events.dto';

type FieldRowPatch = Omit<UpdateSportEventParticipantsRequest['participants'][number], 'sportEventParticipantId'>;

/** The event's field rows by participant name; throws for a name the field lacks. */
async function fieldByName(client: Client, eventId: string) {
  const read = await listEventParticipants({ client, path: { eventId } });
  const rows = read.data?.participants ?? [];
  const byName = new Map(rows.map((row) => [row.participant.name, row]));
  return (name: string) => {
    const row = byName.get(name);
    if (!row) throw new Error(`${name} is not on the field of event ${eventId}`);
    return row;
  };
}

/** Sets values on field rows already on the event, each named by its participant: one field read, then the grid save. */
export async function setFieldRows({ client, path, body }: {
  client: Client;
  path: { eventId: string };
  body: { rows: ReadonlyArray<{ playerName: string } & FieldRowPatch> };
}) {
  const rowOf = await fieldByName(client, path.eventId);
  return updateEventParticipants({
    client,
    path,
    body: { participants: body.rows.map(({ playerName, ...patch }) => ({ sportEventParticipantId: rowOf(playerName).id, ...patch })) },
  });
}

/** Result rows named by participant, sent instead by participant id (golf round scores, race results). */
export async function byParticipantId<Row extends { playerName: string }>(
  client: Client,
  eventId: string,
  rows: readonly Row[],
): Promise<Array<Omit<Row, 'playerName'> & { participantId: string }>> {
  const rowOf = await fieldByName(client, eventId);
  return rows.map(({ playerName, ...row }) => ({ ...row, participantId: rowOf(playerName).participantId }));
}
