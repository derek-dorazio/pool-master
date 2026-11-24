import { enumLabel } from '@poolmaster/shared/display-strings';
import { DetailEditModal, type Fact } from '@/features/shared/ui';
import { mappingText, seriesText, slotLabel, type SlotDefinitionRow } from './league-structure-rows';

/**
 * A slot definition on the Structure tab (⤢, #2002): all of it to read, with its provider
 * mappings, and no Edit, because migrations own these rows.
 */
export function LeagueSlotDialog({ onClose, slot }: { onClose: () => void; slot: SlotDefinitionRow }) {
  const testId = 'root-admin-league-structure-slot';
  const facts: Fact[] = [
    { id: 'phase', label: 'Phase', value: enumLabel('LeaguePhase', slot.phase) },
    { id: 'kind', label: 'Kind', value: enumLabel('SlotKind', slot.slotKind) },
    { id: 'key', label: 'Key', value: slot.key },
    { id: 'series', label: 'Series', value: seriesText(slot) },
    { id: 'pairing', label: 'Pairing', value: enumLabel('SlotPairing', slot.pairing) },
    { id: 'trophy', label: 'Trophy', value: slot.awardsTrophy ? 'Yes' : 'No' },
    { id: 'squares', label: 'Squares', value: slot.squaresEligible ? 'Yes' : 'No' },
    {
      id: 'mappings',
      label: 'Matched by',
      value: slot.providerMappings.length === 0
        ? 'No provider'
        : (
          <ul className="space-y-1">
            {slot.providerMappings.map((mapping) => <li key={mapping.id}>{mappingText(mapping)}</li>)}
          </ul>
        ),
      testId: `${testId}-mappings`,
    },
  ];
  return (
    <DetailEditModal
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId={testId}
      title={slotLabel(slot)}
    />
  );
}
