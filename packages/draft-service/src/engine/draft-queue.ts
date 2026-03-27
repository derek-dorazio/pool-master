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

export class DraftQueue {
  private queues: Map<string, string[]> = new Map();

  /**
   * Set a manager's ranked preference list.
   * Replaces any existing queue for this entry.
   */
  setQueue(entryId: string, participantIds: string[]): void {
    this.queues.set(entryId, [...participantIds]);
  }

  /**
   * Get the queue for an entry. Returns empty array if none set.
   */
  getQueue(entryId: string): string[] {
    return [...(this.queues.get(entryId) ?? [])];
  }

  /**
   * Get the next available pick from the queue, skipping already-drafted participants.
   * Returns null if the queue is empty or all queued participants are taken.
   */
  getNextAvailable(entryId: string, draftedParticipantIds: Set<string>): string | null {
    const queue = this.queues.get(entryId);
    if (!queue) return null;

    for (const participantId of queue) {
      if (!draftedParticipantIds.has(participantId)) {
        return participantId;
      }
    }

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
  }

  /**
   * Reorder within a queue (drag-and-drop). Moves the item at fromIndex to toIndex.
   */
  reorder(entryId: string, fromIndex: number, toIndex: number): void {
    const queue = this.queues.get(entryId);
    if (!queue) return;

    if (fromIndex < 0 || fromIndex >= queue.length) return;
    if (toIndex < 0 || toIndex >= queue.length) return;
    if (fromIndex === toIndex) return;

    const [item] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, item);
    this.queues.set(entryId, queue);
  }

  /**
   * Add a participant to the end of a queue if not already present.
   */
  addToQueue(entryId: string, participantId: string): void {
    const queue = this.queues.get(entryId) ?? [];
    if (!queue.includes(participantId)) {
      queue.push(participantId);
      this.queues.set(entryId, queue);
    }
  }

  /**
   * Remove a specific participant from a specific entry's queue.
   */
  removeFromQueue(entryId: string, participantId: string): void {
    const queue = this.queues.get(entryId);
    if (!queue) return;

    this.queues.set(
      entryId,
      queue.filter((id) => id !== participantId),
    );
  }

  /**
   * Clear all queues (e.g., when a draft completes).
   */
  clearAll(): void {
    this.queues.clear();
  }

  /**
   * Check if an entry has a queue set.
   */
  hasQueue(entryId: string): boolean {
    const queue = this.queues.get(entryId);
    return queue !== undefined && queue.length > 0;
  }
}

export const draftQueue = new DraftQueue();
