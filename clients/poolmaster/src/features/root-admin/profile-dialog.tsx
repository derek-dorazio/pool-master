import type { ReactNode } from 'react';
import type { SportLeagueDto } from '@/lib/api';
import { ReadOnlyDetailModal, type Fact } from '@/features/shared/ui';
import { ProfileLeagues } from './profile-leagues';

/** Which profile's dialog is open, and whether it shows the profile or its form. */
export type ProfileDialogState<TProfile> =
  | { mode: 'view' | 'edit'; profile: TProfile }
  | { mode: 'new' }
  | null;

/** What a profile's form needs: the profile (null for a new one), and where Save and Cancel go. */
export type ProfileEditorProps<TProfile> = {
  onCancel: () => void;
  onSaved: (saved: TProfile) => void;
  profile: TProfile | null;
};

/**
 * A tier or pricing profile's dialog (#1849): see it, then Edit. The view lists its values and
 * the sport leagues naming it, with Close and Edit; Edit turns it into the profile's form, whose
 * Cancel and Save come back to the view. New opens straight on an empty form, and its Save shows
 * the new profile.
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
    return renderEditor({ onCancel: close, onSaved: showSaved, profile: null });
  }
  const profile = liveProfile(state.profile.id) ?? state.profile;
  if (state.mode === 'edit') {
    return renderEditor({ onCancel: () => onStateChange({ mode: 'view', profile }), onSaved: showSaved, profile });
  }
  return (
    <ReadOnlyDetailModal
      detailContent={<ProfileLeagues names={(league) => names(league, profile)} testId={`${testId}-leagues`} />}
      details={facts(profile)}
      editTestId={`${testId}-edit`}
      onCancel={close}
      onEdit={() => onStateChange({ mode: 'edit', profile })}
      onOpenChange={(isOpen) => {
        if (!isOpen) close();
      }}
      open
      testId={testId}
      title={profile.name}
    />
  );
}
