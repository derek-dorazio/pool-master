/** Base event type for all domain events published to the message bus. */

export interface DomainEvent {
  id: string;
  type: string;
  sourceService: string;
  timestamp: string; // ISO 8601
  tenantId: string;
}
