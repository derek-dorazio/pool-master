import { profileWords, type ProfileDisplaySection, type ProfileIdentity } from '@poolmaster/shared/display-strings';

/** One fact in a profile's view, as `ProfileDialog` lists them. */
type ProfileFact = { id: string; label: string; value: string };

/**
 * What a profile's view says about its words (#2194): its description for agents and root admins,
 * and what commissioners and members read, the name and line seeded for its code. A profile with
 * none seeded yet (one added here) shows its own name, and says its line is not written yet.
 */
export function profileWordsFacts(section: ProfileDisplaySection, profile: ProfileIdentity & { description: string }): ProfileFact[] {
  const words = profileWords(section, profile);
  return [
    { id: 'description', label: 'Description', value: profile.description },
    { id: 'shown-as', label: 'Shown as', value: words.name },
    { id: 'shown-line', label: 'Shown line', value: words.description ?? 'Not written yet: a change seeds it with the profile\'s display strings.' },
  ];
}
