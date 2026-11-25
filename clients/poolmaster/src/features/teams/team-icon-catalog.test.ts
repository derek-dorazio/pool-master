import { TeamIconKey } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { getTeamIconOption, TEAM_ICON_OPTIONS } from './team-icon-catalog';

describe('getTeamIconOption', () => {
  it('finds each team icon by its key', () => {
    for (const option of TEAM_ICON_OPTIONS) expect(getTeamIconOption(option.key)).toBe(option);
  });

  it('falls back to the field captain for a team with no icon', () => {
    expect(getTeamIconOption(undefined).key).toBe(TeamIconKey.CAPTAIN_SMILE_FIELD);
  });

  it('offers every icon key once', () => {
    expect(TEAM_ICON_OPTIONS.map((option) => option.key).sort()).toEqual(Object.values(TeamIconKey).sort());
  });
});
