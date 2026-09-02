import type { AdminProviderCatalogEventDto } from '@poolmaster/shared/dto';
import type { ProviderCatalogEventRow } from '../modules/events/event-score-source-service';

export function toAdminProviderCatalogEventDto(row: ProviderCatalogEventRow): AdminProviderCatalogEventDto {
  return {
    externalId: row.externalId,
    name: row.name,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    status: row.status,
  };
}

export function toAdminProviderCatalogEventDtoList(rows: ProviderCatalogEventRow[]): AdminProviderCatalogEventDto[] {
  return rows.map(toAdminProviderCatalogEventDto);
}
