import { zodResolver } from '@hookform/resolvers/zod';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  chooseEventSlotTiebreakerGame,
  type SlotTiebreakerGameDto,
  type SportEventSlotTiebreakerDto,
  type SportLeagueSeasonSlotDto,
} from '@/lib/api';
import {
  DetailEditModal,
  formatDateTimeDisplay,
  FormField,
  LoadingState,
  Select,
  useDisplayPreferences,
  type DisplayPreferences,
  type Fact,
} from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { eventMatchRows } from './event-match-rows';
import { useDetailEditDialog } from './use-detail-edit-dialog';
import {
  useSportEventBracketQuery,
  useSportEventFieldQuery,
  useSportEventSlotTiebreakersQuery,
} from './use-sport-event';

const logger = getLogger().child({ feature: 'root-admin-event-slot' });

const tiebreakerSchema = z.object({ gameId: z.string().min(1, 'Choose a game.') });
type TiebreakerValues = z.infer<typeof tiebreakerSchema>;

/**
 * A slot on the Event page's Slots tab (⤢, #2004): all of it to read, with its tiebreaker game
 * (#2048), the one game whose combined score every contest covering the slot guesses. Edit chooses
 * another of the slot's games until the chosen one starts; the API says which can be chosen. The
 * slot itself is the sync's, or fixed once a test slot is made, so nothing else here edits.
 */
export function EventSlotDialog({ eventId, onClose, slot }: { eventId: string; onClose: () => void; slot: SportLeagueSeasonSlotDto }) {
  const preferences = useDisplayPreferences();
  const tiebreakers = useSportEventSlotTiebreakersQuery(eventId);
  const bracket = useSportEventBracketQuery(eventId);
  const field = useSportEventFieldQuery(eventId);
  // poolmaster-allow-list-lookup: the event's slots' tiebreaker games come in one read, with no read of one slot's
  const tiebreaker = tiebreakers.data?.find((each) => each.seasonSlotId === slot.id);
  const matchLabel = new Map(eventMatchRows(bracket.data ?? [], field.data ?? []).map((row) => [row.id, row.pairingLabel]));
  const gameText = (game: SlotTiebreakerGameDto) => {
    const pairing = matchLabel.get(game.sportEventRoundMatchId) ?? '';
    const numbered = slot.seriesGames > 1 ? `${pairing} · Game ${String(game.gameNumber)}` : pairing;
    return `${numbered} · ${formatDateTimeDisplay(game.scheduledDate, preferences, 'No start yet')}`;
  };

  const current = { gameId: tiebreaker?.tiebreakerGameId ?? '' };
  const form = useForm<TiebreakerValues>({ resolver: zodResolver(tiebreakerSchema), values: current, mode: 'onChange' });
  const dialog = useDetailEditDialog(form, current, onClose);
  const saveMutation = useInvalidatingMutation({
    mutationFn: async (values: TiebreakerValues) => {
      const response = await chooseEventSlotTiebreakerGame({ path: { eventId, seasonSlotId: slot.id }, body: { gameId: values.gameId } });
      if (!response.data?.slot) throwApiError(response.error, 'The tiebreaker game response is missing data.');
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.slotTiebreakers(eventId)],
    onSuccess: () => dialog.saved(),
    onError: (error) =>
      logger.warn({ action: 'event.slot.tiebreaker.choose.failed', data: { eventId, seasonSlotId: slot.id }, err: error }, 'Choosing the slot\'s tiebreaker game was rejected'),
  });

  const testId = 'root-admin-event-slot-dialog';
  const facts: Fact[] = [
    { id: 'slot', label: 'Slot', value: slotLabel(slot), testId: `${testId}-slot` },
    { id: 'kind', label: 'Kind', value: enumLabel('SlotKind', slot.slotKind), testId: `${testId}-kind` },
    { id: 'starts', label: 'Starts', value: formatDateTimeDisplay(slot.startsAt, preferences, 'Not known yet'), testId: `${testId}-starts` },
    { id: 'ends', label: 'Ends', value: formatDateTimeDisplay(slot.endsAt, preferences, 'Not known yet'), testId: `${testId}-ends` },
    { id: 'status', label: 'Status', value: enumLabel('SeasonSlotStatus', slot.status), testId: `${testId}-status` },
    { id: 'series', label: 'Series', value: `${enumLabel('SeriesFormat', slot.seriesFormat)} · ${String(slot.seriesGames)}`, testId: `${testId}-series` },
    { id: 'pairing', label: 'Pairing', value: enumLabel('SlotPairing', slot.pairing), testId: `${testId}-pairing` },
    { id: 'test', label: 'Test label', value: slot.label ?? 'Synced slot', testId: `${testId}-label` },
    { id: 'tiebreaker', label: 'Tiebreaker game', value: tiebreakerText(tiebreaker, gameText), testId: `${testId}-tiebreaker` },
    { id: 'chosen', label: 'Chosen', value: chosenText(tiebreaker, preferences), testId: `${testId}-tiebreaker-chosen` },
  ];
  const choosable = tiebreaker?.games.filter((game) => game.choosable || game.id === tiebreaker.tiebreakerGameId) ?? [];
  const canChoose = tiebreaker !== undefined && tiebreaker.editable && tiebreaker.games.some((game) => game.choosable);
  const modal = dialog.modalProps(saveMutation);

  return (
    <DetailEditModal
      {...modal}
      canSave={form.formState.isValid && form.formState.isDirty}
      errorFallback="We could not save the tiebreaker game."
      facts={facts}
      onEdit={canChoose ? modal.onEdit : undefined}
      saveLabel="Save tiebreaker game"
      testId={testId}
      title={dialog.mode === 'view' ? slotLabel(slot) : `${slotLabel(slot)} · Edit`}
    >
      <FormField
        error={form.formState.errors.gameId?.message}
        help="Every contest covering the slot guesses this game's combined score. It can change until the game starts."
        label="Tiebreaker game"
      >
        <Select data-testid={`${testId}-tiebreaker-input`} {...form.register('gameId')}>
          {tiebreaker?.tiebreakerGameId === null ? <option value="">Not chosen yet</option> : null}
          {choosable.map((game) => <option key={game.id} value={game.id}>{gameText(game)}</option>)}
        </Select>
      </FormField>
    </DetailEditModal>
  );
}

function tiebreakerText(tiebreaker: SportEventSlotTiebreakerDto | undefined, gameText: (game: SlotTiebreakerGameDto) => string): ReactNode {
  if (tiebreaker === undefined) return <LoadingState size="plain" />;
  const game = tiebreaker.games.find((each) => each.id === tiebreaker.tiebreakerGameId);
  return game === undefined ? 'Not chosen yet: no game of the slot is scheduled' : gameText(game);
}

function chosenText(tiebreaker: SportEventSlotTiebreakerDto | undefined, preferences: DisplayPreferences): string {
  if (tiebreaker?.tiebreakerGameId == null) return '';
  return tiebreaker.chosenAt === null
    ? 'By the rule: the latest start'
    : `By a root admin, ${formatDateTimeDisplay(tiebreaker.chosenAt, preferences)}`;
}
