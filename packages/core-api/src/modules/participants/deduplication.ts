/**
 * Participant deduplication — name normalisation, fuzzy matching,
 * and cross-provider participant resolution.
 */

import type { Participant } from '@poolmaster/shared/domain';

export interface MatchCandidate {
  participant: Participant;
  confidence: 'EXACT' | 'HIGH' | 'LOW' | 'AMBIGUOUS';
  score: number; // 0-1
  matchMethod: string;
}

export interface DeduplicationResult {
  canonicalParticipantId?: string;
  candidates: MatchCandidate[];
  needsManualReview: boolean;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.90;
const LOW_CONFIDENCE_THRESHOLD = 0.70;

/**
 * Normalises a participant name for comparison.
 * Handles "Last, First" format, diacritics, whitespace, and casing.
 */
export function normaliseName(raw: string): string {
  let name = raw.toLowerCase();

  // Handle "Last, First" format
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0) {
    name = `${parts[1]} ${parts[0]}`.toLowerCase();
  }

  // Strip diacritics (é → e, ñ → n, etc.)
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Remove comma formatting and normalise whitespace
  name = name.replace(/,/g, '');
  name = name.replace(/[.\-']/g, ''); // strip dots, hyphens, apostrophes
  name = name.replace(/\s+/g, ' ').trim();

  return name;
}

/**
 * Computes similarity between two strings using Levenshtein-based metric.
 * Returns a score from 0 (no match) to 1 (exact match).
 */
export function nameSimilarity(a: string, b: string): number {
  const normA = normaliseName(a);
  const normB = normaliseName(b);

  if (normA === normB) return 1.0;

  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(normA, normB);
  return 1 - distance / maxLen;
}

/**
 * Finds matching candidates for a new participant record from an existing participant list.
 *
 * Matching pipeline (run in order):
 * 1. Exact name + sport match → EXACT confidence
 * 2. Fuzzy name match (≥90% similarity) → HIGH confidence
 * 3. Name + nationality + sport → HIGH confidence (for common names)
 * 4. No match → return empty candidates, needsManualReview = false (new participant)
 */
export function findMatches(
  newName: string,
  sport: string,
  nationality: string | undefined,
  existingParticipants: Participant[],
): DeduplicationResult {
  const candidates: MatchCandidate[] = [];

  // Only compare within the same sport
  const sameSport = existingParticipants.filter((p) => p.sportId === sport);

  for (const existing of sameSport) {
    const similarity = nameSimilarity(newName, existing.name);

    if (similarity === 1.0) {
      candidates.push({
        participant: existing,
        confidence: 'EXACT',
        score: 1.0,
        matchMethod: 'NAME_SPORT_EXACT',
      });
    } else if (similarity >= HIGH_CONFIDENCE_THRESHOLD) {
      candidates.push({
        participant: existing,
        confidence: 'HIGH',
        score: similarity,
        matchMethod: 'NAME_FUZZY',
      });
    } else if (
      similarity >= LOW_CONFIDENCE_THRESHOLD &&
      nationality &&
      existing.nationality === nationality
    ) {
      candidates.push({
        participant: existing,
        confidence: 'HIGH',
        score: similarity,
        matchMethod: 'NAME_NATIONALITY_SPORT',
      });
    } else if (similarity >= LOW_CONFIDENCE_THRESHOLD) {
      candidates.push({
        participant: existing,
        confidence: 'LOW',
        score: similarity,
        matchMethod: 'NAME_FUZZY_LOW',
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Determine result
  if (candidates.length > 0 && candidates[0].confidence === 'EXACT') {
    return {
      canonicalParticipantId: candidates[0].participant.id,
      candidates,
      needsManualReview: false,
    };
  }

  if (candidates.length > 0 && candidates[0].confidence === 'HIGH') {
    return {
      canonicalParticipantId: candidates[0].participant.id,
      candidates,
      needsManualReview: false,
    };
  }

  if (candidates.length > 0) {
    return {
      candidates,
      needsManualReview: true,
    };
  }

  return { candidates: [], needsManualReview: false };
}

/**
 * Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a single-row DP approach for space efficiency
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}
