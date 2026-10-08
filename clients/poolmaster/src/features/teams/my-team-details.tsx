import type { TeamIconKey } from '@poolmaster/shared/domain';
import type { SquadDto } from '@/lib/api';
import {
  Alert,
  Button,
  DefinitionList,
  FormField,
  IconAvatar,
  IconPickerModal,
  Input,
  Modal,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getTeamIconOption, TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { TeamIcon } from './team-icon';
import { TEAM_PAGE_FALLBACK_ERROR } from './my-team-shared';
import type { MyTeamDetails } from './use-my-team-details';

/** The selected team's name, icon, status and owners, or the create form when there is none. */
export function MyTeamDetailsTile({
  details,
  selectedTeam,
  currentIconKey,
  activeOwnerNames,
  isInactiveLeague,
  isInactiveTeam,
  isBusy,
  canCreateOwnTeam,
}: {
  details: MyTeamDetails;
  selectedTeam: SquadDto | null;
  currentIconKey: TeamIconKey;
  activeOwnerNames: string[];
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  isBusy: boolean;
  canCreateOwnTeam: boolean;
}) {
  const { teamName, setTeamName, createTeamMutation, handleOpenIconModal, handleSaveTeam } = details;
  const selectedIcon = getTeamIconOption(currentIconKey);
  const teamLifecycleLabel = selectedTeam?.isActive === false ? 'Inactive' : 'Active';
  const teamStatusClass = isInactiveTeam ? 'text-destructive' : 'text-foreground';

  return (
    <Tile data-testid="my-team-details-tile">
      <h3 className="text-xl font-semibold">{selectedTeam ? 'Team details' : 'Create your team'}</h3>

      {selectedTeam ? (
        <div className="mt-5 space-y-4">
          <Tile className="flex items-center gap-4" radius="lg">
            <IconAvatar className={selectedIcon.themeClass} size="md">
              <TeamIcon iconKey={currentIconKey} size="lg" />
            </IconAvatar>
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                Team name
              </div>
              <div className="mt-1 text-base font-medium">{selectedTeam.name}</div>
            </div>
          </Tile>

          <DefinitionList
            items={[
              {
                id: 'status',
                label: 'Status',
                value: (
                  <span className={teamStatusClass} data-testid="my-team-lifecycle-status">
                    {teamLifecycleLabel}
                  </span>
                ),
              },
              {
                id: 'current-icon',
                label: 'Current icon',
                value: <span data-testid="my-team-current-icon-label">{selectedIcon.label}</span>,
              },
            ]}
          />

          <Tile radius="lg">
            <div className="text-xs uppercase text-muted-foreground">
              Team owners
            </div>
            <div className="mt-3 space-y-2">
              {activeOwnerNames.length ? (
                activeOwnerNames.map((ownerName, index) => (
                  <div className="text-base font-medium text-foreground" key={`${ownerName}-${index}`}>
                    {ownerName}
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No active owners</div>
              )}
            </div>
          </Tile>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            A team is required for league participation. Start with a name and icon that feel right for your group.
          </p>
          <FormField label="Team name">
            <Input
              data-testid="my-team-name"
              disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
              maxLength={100}
              onChange={(event) => setTeamName(event.target.value)}
              value={teamName}
            />
          </FormField>
          <Tile className="flex items-center gap-4" radius="lg">
            <IconAvatar className={selectedIcon.themeClass} size="md">
              <TeamIcon iconKey={currentIconKey} size="lg" />
            </IconAvatar>
            <Button
              data-testid="my-team-change-icon"
              disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
              onClick={handleOpenIconModal}
              variant="secondary"
            >
              Change icon
            </Button>
          </Tile>
          <Button
            data-testid="my-team-save"
            disabled={!teamName.trim() || isInactiveLeague || isBusy || !canCreateOwnTeam}
            onClick={() => void handleSaveTeam().catch(() => undefined)}
          >
            {isBusy ? 'Saving...' : canCreateOwnTeam ? 'Create team' : 'Choose a team first'}
          </Button>
          {createTeamMutation.isSuccess ? (
            <Alert tone="success">Your team was created.</Alert>
          ) : null}
          {createTeamMutation.isError ? (
            <Alert tone="danger">{extractErrorMessage(createTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
          ) : null}
        </div>
      )}
    </Tile>
  );
}

export function MyTeamNameModal({
  details,
  open,
  selectedTeam,
  isInactiveLeague,
  isInactiveTeam,
  isBusy,
  canManageSelectedTeam,
}: {
  details: MyTeamDetails;
  open: boolean;
  selectedTeam: SquadDto | null;
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  isBusy: boolean;
  canManageSelectedTeam: boolean;
}) {
  const {
    teamName,
    setTeamName,
    teamNameDraftTeamId,
    updateTeamMutation,
    handleSaveTeam,
    handleOpenTeamNameModal,
    handleCloseTeamNameModal,
  } = details;

  return (
    <Modal
      description="Update the team name shown across league and contest pages."
      descriptionId="my-team-name-modal-description"
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          handleOpenTeamNameModal();
          return;
        }

        if (!isBusy) {
          handleCloseTeamNameModal();
        }
      }}
      open={open}
      testId="my-team-name-modal"
      title="Change team name"
    >
      <FormField label="Team name">
        <Input
          data-testid="my-team-name"
          disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
          maxLength={100}
          onChange={(event) => setTeamName(event.target.value)}
          value={teamName}
        />
      </FormField>
      {updateTeamMutation.isError ? (
        <Alert className="mt-4" tone="danger">
          {extractErrorMessage(updateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}
        </Alert>
      ) : null}
      <div className="mt-6 flex justify-end gap-3">
        <Button
          disabled={isBusy}
          onClick={handleCloseTeamNameModal}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          data-testid="my-team-save"
          disabled={
            !teamName.trim()
            || isInactiveLeague
            || isInactiveTeam
            || isBusy
            || !canManageSelectedTeam
            || teamNameDraftTeamId !== selectedTeam?.id
          }
          onClick={() =>
            void handleSaveTeam()
              .then(handleCloseTeamNameModal)
              .catch(() => undefined)}
        >
          {updateTeamMutation.isPending ? 'Saving...' : 'Save team'}
        </Button>
      </div>
    </Modal>
  );
}

export function MyTeamIconModal({
  details,
  hasSelectedTeam,
  isInactiveLeague,
  isBusy,
  canCreateOwnTeam,
  canManageSelectedTeam,
}: {
  details: MyTeamDetails;
  hasSelectedTeam: boolean;
  isInactiveLeague: boolean;
  isBusy: boolean;
  canCreateOwnTeam: boolean;
  canManageSelectedTeam: boolean;
}) {
  const {
    iconModalOpen,
    iconDraftKey,
    setIconDraftKey,
    updateTeamIconMutation,
    handleOpenIconModal,
    handleCloseIconModal,
    handleSaveTeamIcon,
  } = details;
  const draftIcon = getTeamIconOption(iconDraftKey);

  return (
    <IconPickerModal
      canSave={!isInactiveLeague && !isBusy && (hasSelectedTeam ? canManageSelectedTeam : canCreateOwnTeam)}
      canSelect={!isInactiveLeague && !isBusy}
      closeLabel="Close team icon modal"
      description="Choose an icon for your team."
      descriptionId="my-team-icon-modal-description"
      errorMessage={
        updateTeamIconMutation.isError
          ? extractErrorMessage(updateTeamIconMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })
          : null
      }
      isPending={updateTeamIconMutation.isPending}
      modalTestId="my-team-icon-modal"
      onCancel={handleCloseIconModal}
      onOpenChange={(open) => {
        if (open) {
          handleOpenIconModal();
          return;
        }

        handleCloseIconModal();
      }}
      onSave={() => void handleSaveTeamIcon().catch(() => undefined)}
      onSelect={setIconDraftKey}
      open={iconModalOpen}
      optionTestIdPrefix="my-team-icon"
      options={TEAM_ICON_OPTIONS}
      paletteTestId="my-team-icon-palette"
      renderOptionIcon={(icon) => (
        <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${icon.themeClass}`}>
          <TeamIcon iconKey={icon.key} size="md" />
        </div>
      )}
      renderSelectedIcon={() => (
        <IconAvatar className={draftIcon.themeClass} size="lg">
          <TeamIcon iconKey={iconDraftKey} size="lg" />
        </IconAvatar>
      )}
      saveTestId="my-team-save-icon"
      selectedLabel={draftIcon.label}
      title="Change team icon"
      value={iconDraftKey}
    />
  );
}
