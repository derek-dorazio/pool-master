import { TeamIconKey } from '@poolmaster/shared/domain';
import { z } from 'zod';

/** A team's name and icon, as Create team and Edit team both submit them. */
export const teamFormSchema = z.object({
  name: z.string().trim().min(1, 'Team name is required'),
  iconKey: z.nativeEnum(TeamIconKey),
});

export type TeamFormValues = z.infer<typeof teamFormSchema>;
