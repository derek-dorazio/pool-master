/**
 * Manager Draft Queue — pre-draft ranked preference list for auto-pick.
 *
 * Before a snake draft, managers rank participants in order of preference.
 * When auto-pick fires (timeout or voluntary), the engine consults the queue
 * first, then falls back to best available by ranking.
 *
 * Supports:
 * - Setting and replacing the full queue
 * - Getting the next available pick (skipping already-drafted)
 * - Removing a drafted participant from all queues
 * - Drag-and-drop reordering within a queue
 */

import type { ServiceLogger } from '../../../core/logger';

export class DraftQueue {
  public constructor(private readonly logger?: ServiceLogger) {}

  private queues: Map<string, string[]> = new Map();

  /**
   * Set a manager's ranked preference list.
   * Replaces any existing queue for this entry.
   */
  setQueue(entryId: string, participantIds: string[]): void {
    this.queues.set(entryId, [...participantIds]);
    this.logger?.info(
      { action: 'draftQueue.setQueue', data: { entryId, queueLength: participantIds.length } },
      'Stored draft preference queue',
    );
  }

  /**
   * Get the queue for an entry. Returns empty array if none set.
   */
  getQueue(entryId: string): string[] {
    const queue = [...(this.queues.get(entryId) ?? [])];
    this.logger?.debug(
      { action: 'draftQueue.getQueue', data: { entryId, queueLength: queue.length } },
      'Loaded draft preference queue',
    );
    return queue;
  }

  /**
   * Get the next available pick from the queue, skipping already-drafted participants.
   * Returns null if the queue is empty or all queued participants are taken.
   */
  getNextAvailable(entryId: string, draftedParticipantIds: Set<string>): string | null {
    const queue = this.queues.get(entryId);
    if (!queue) {
      this.logger?.warn(
        { action: 'draftQueue.getNextAvailable.missingQueue', data: { entryId } },
        'No draft queue was set for auto-pick resolution',
      );
      return null;
    }

    for (const participantId of queue) {
      if (!draftedParticipantIds.has(participantId)) {
        this.logger?.info(
          { action: 'draftQueue.getNextAvailable.success', data: { entryId, participantId } },
          'Resolved next available queued participant',
        );
        return participantId;
      }
    }

    this.logger?.warn(
      { action: 'draftQueue.getNextAvailable.noneAvailable', data: { entryId, queueLength: queue.length } },
      'No queued participants remained available',
    );
    return null;
  }

  /**
   * Remove a participant from all queues (called after they are drafted).
   */
  removeFromAllQueues(participantId: string): void {
    for (const [entryId, queue] of this.queues.entries()) {
      const filtered = queue.filter((id) => id !== participantId);
      this.queues.set(entryId, filtered);
    }
    this.logger?.info(
      { action: 'draftQueue.removeFromAllQueues', data: { participantId } },
      'Removed participant from all draft queues',
    );
  }

  /**
   * Reorder within a queue (drag-and-drop). Moves the item at fromIndex to toIndex.
   */
  reorder(entryId: string, fromIndex: number, toIndex: number): void {
    const queue = this.queues.get(entryId);
    if (!queue) {
      this.logger?.warn(
        { action: 'draftQueue.reorder.missingQueue', data: { entryId, fromIndex, toIndex } },
        'Cannot reorder a missing draft queue',
      );
      return;
    }

    if (fromIndex < 0 || fromIndex >= queue.length) {
      this.logger?.warn(
        { action: 'draftQueue.reorder.invalidFromIndex', data: { entryId, fromIndex, queueLength: queue.length } },
        'Rejected draft queue reorder because source index was invalid',
      );
      return;
    }
    if (toIndex < 0 || toIndex >= queue.length) {
      this.logger?.warn(
        { action: 'draftQueue.reorder.invalidToIndex', data: { entryId, toIndex, queueLength: queue.length } },
        'Rejected draft queue reorder because destination index was invalid',
      );
      return;
    }
    if (fromIndex === toIndex) {
      this.logger?.debug(
        { action: 'draftQueue.reorder.noop', data: { entryId, fromIndex, toIndex } },
        'Draft queue reorder was a no-op',
      );
      return;
    }

    const [item] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, item);
    this.queues.set(entryId, queue);
    this.logger?.info(
      { action: 'draftQueue.reorder.success', data: { entryId, fromIndex, toIndex } },
      'Reordered draft queue',
    );
  }

  /**
   * Add a participant to the end of a queue if not already present.
   */
  addToQueue(entryId: string, participantId: string): void {
    const queue = this.queues.get(entryId) ?? [];
    if (!queue.includes(participantId)) {
      queue.push(participantId);
      this.queues.set(entryId, queue);
      this.logger?.info(
        { action: 'draftQueue.add.success', data: { entryId, participantId, queueLength: queue.length } },
        'Added participant to draft queue',
      );
      return;
    }
    this.logger?.debug(
      { action: 'draftQueue.add.duplicate', data: { entryId, participantId } },
      'Skipped adding duplicate participant to draft queue',
    );
  }

  /**
   * Remove a specific participant from a specific entry's queue.
   */
  removeFromQueue(entryId: string, participantId: string): void {
    const queue = this.queues.get(entryId);
    if (!queue) {
      this.logger?.warn(
        { action: 'draftQueue.remove.missingQueue', data: { entryId, participantId } },
        'Cannot remove participant from a missing draft queue',
      );
      return;
    }

    this.queues.set(
      entryId,
      queue.filter((id) => id !== participantId),
    );
    this.logger?.info(
      { action: 'draftQueue.remove.success', data: { entryId, participantId } },
      'Removed participant from draft queue',
    );
  }

  /**
   * Clear all queues (e.g., when a draft completes).
   */
  clearAll(): void {
    this.queues.clear();
    this.logger?.warn({ action: 'draftQueue.clearAll' }, 'Cleared all draft queues');
  }

  /**
   * Check if an entry has a queue set.
   */
  hasQueue(entryId: string): boolean {
    const queue = this.queues.get(entryId);
    const hasQueue = queue !== undefined && queue.length > 0;
    this.logger?.debug(
      { action: 'draftQueue.hasQueue', data: { entryId, hasQueue } },
      'Checked whether an entry has a draft queue',
    );
    return hasQueue;
  }
}

export const draftQueue = new DraftQueue();
