import { teamConference } from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/team-conference';

describe('a team\'s conference as the feed codes it', () => {
  it('keeps the conference and division codes exactly as sent', () => {
    expect(teamConference('AFC', 'EAST')).toEqual({ conference: { providerCode: 'AFC', divisionProviderCode: 'EAST' } });
  });

  it('gives a vendor\'s numbered conference as its id in text, with no division when none is sent', () => {
    expect(teamConference(7)).toEqual({ conference: { providerCode: '7' } });
    expect(teamConference('Western', null)).toEqual({ conference: { providerCode: 'Western' } });
  });

  it('gives no conference for a team the feed puts in none, blank or missing', () => {
    expect(teamConference('')).toEqual({});
    expect(teamConference(null, null)).toEqual({});
    expect(teamConference(undefined)).toEqual({});
  });
});
