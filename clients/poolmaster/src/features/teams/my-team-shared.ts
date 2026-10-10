import type { SquadDto } from '@/lib/api';

export type TeamMember = NonNullable<SquadDto['members']>[number];
export type ActiveTeamDialog = 'inactivate' | 'delete' | null;

export const TEAM_PAGE_FALLBACK_ERROR = 'We could not complete that team action. Please try again.';
