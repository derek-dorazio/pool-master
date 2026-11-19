import type { ReactNode } from 'react';
import type { SportLeagueDto } from '@/lib/api';
import type { Fact } from '@/features/shared/ui';
import { ProfileLeagues } from './profile-leagues';

/** Which profile's dialog is open, and whether it shows the profile or its form. */
export type ProfileDialogState<TProfile> =
  | { mode: 'view' | 'edit'; profile: TProfile }
  | { mode: 'new' }
  | null;

/**
 * What a profile's dialog needs (`ProfileFormModal`): the mode, the profile (null for a new one),
 * what its view shows, and where Close, Edit, Cancel and Save go.
 */
export type ProfileEditorProps<TProfile> = {
  mode: 'view' | 'edit';
  profile: TProfile | null;
  /** The profile's values, as the view lists them; none for a new profile. */
  facts: Fact[];
  /** The sport leagues naming the profile, under its values in the view. */
  viewContent: ReactNode;
  onClose: () => void;
  onEdit: () => void;
  /** Cancel in the form: back to the view, or closed for a new profile. */
  onCancelEdit: () => void;
  onSaved: (saved: TProfile) => void;
};

/**
 * A tier or pricing profile's dialog (#1849), one `DetailEditModal` (rules/ux-rules.md §12 item
 * 14): the view lists its values and the sport leagues naming it, with Close and Edit; Edit turns
 * it into the profile's form, whose Cancel and Save come back to the view. New opens straight on
 * an empty form, and its Save shows the new profile.
 */
export function ProfileDialog<TProfile extends { id: string; name: string }>({
  facts,
  liveProfile,
  names,
  onStateChange,
  renderEditor,
  state,
  testId,
}: {
  /** The profile's values, as the view lists them. */
  facts: (profile: TProfile) => Fact[];
  /** The profile as the list now holds it, so the view follows a save. */
  liveProfile: (id: string) => TProfile | undefined;
  /** Whether a sport league names the profile. */
  names: (league: SportLeagueDto, profile: TProfile) => boolean;
  onStateChange: (state: ProfileDialogState<TProfile>) => void;
  renderEditor: (props: ProfileEditorProps<TProfile>) => ReactNode;
  state: ProfileDialogState<TProfile>;
  testId: string;
}) {
  if (state === null) return null;
  const close = () => onStateChange(null);
  const showSaved = (saved: TProfile) => onStateChange({ mode: 'view', profile: saved });

  if (state.mode === 'new') {
    return renderEditor({
      facts: [],
      mode: 'edit',
      onCancelEdit: close,
      onClose: close,
      onEdit: close,
      onSaved: showSaved,
      profile: null,
      viewContent: null,
    });
  }
  const profile = liveProfile(state.profile.id) ?? state.profile;
  return renderEditor({
    facts: facts(profile),
    mode: state.mode,
    onCancelEdit: () => onStateChange({ mode: 'view', profile }),
    onClose: close,
    onEdit: () => onStateChange({ mode: 'edit', profile }),
    onSaved: showSaved,
    profile,
    viewContent: <ProfileLeagues names={(league) => names(league, profile)} testId={`${testId}-leagues`} />,
  });
}
