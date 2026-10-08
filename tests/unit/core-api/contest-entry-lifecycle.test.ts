/**
 * Contest entries end to end through ContestService, against the stateful in-memory world:
 * who may enter, rename, set a tiebreaker on and leave a contest, in which contest statuses,
 * and what the reads show to whom. Tests assert the stored rows, not the calls made.
 */
import {
  ContestService,
  ContestEntryAccessError,
  ContestEntryNotFoundError,
  ContestEntryOperationError,
  ContestNotFoundError,
  ContestOperationError,
} from '../../../packages/core-api/src/modules/contests/service';
import {
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

function setup(options: { mailDelivery?: MailDeliveryProvider } = {}) {
  const world = new InMemoryContestWorld();
  const league = world.addLeague({ name: 'Augusta Club', leagueCode: 'AUGUSTA' });
  const commissioner = world.addUser({ firstName: 'Carla', lastName: 'Commish' });
  world.addMember(league.id, commissioner.id, { role: LeagueRole.COMMISSIONER });
  const owner = world.addUser({ firstName: 'Olive', lastName: 'Owner', email: 'olive@example.com' });
  world.addMember(league.id, owner.id);
  const squad = world.addSquad(league.id, 'Birdie Brigade');
  world.addSquadMember(squad.id, owner.id);
  const rival = world.addUser({ firstName: 'Rex', lastName: 'Rival' });
  world.addMember(league.id, rival.id);
  const rivalSquad = world.addSquad(league.id, 'Bogey Bunch');
  world.addSquadMember(rivalSquad.id, rival.id);
  const contest = world.addContest(league.id, { status: ContestStatus.OPEN });
  world.addConfiguration(contest.id);
  const service = new ContestService(world.contestServiceDeps({ mailDelivery: options.mailDelivery }));
  return { world, league, commissioner, owner, squad, rival, rivalSquad, contest, service };
}

function capturingMail(): MailDeliveryProvider & { sent: Array<{ to: string; subject: string; text: string }> } {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return {
    sent,
    send: async (message) => {
      sent.push({ to: String(message.to), subject: message.subject, text: message.text });
      return { messageId: `message-${sent.length}` };
    },
  } as MailDeliveryProvider & { sent: typeof sent };
}

describe('ContestService entries — entering a contest', () => {
  it('stores entry number 1 named after the squad when a squad owner enters an open contest', async () => {
    const { world, owner, squad, contest, service } = setup();

    const dto = await service.createEntry(contest.id, owner.id);

    const stored = world.entriesOf(contest.id, squad.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ entryNumber: 1, name: 'Birdie Brigade Entry 1', status: 'ACTIVE' });
    expect(dto).toMatchObject({ id: stored[0].id, squadName: 'Birdie Brigade', picksCount: 0 });
  });

  it.each([
    ContestStatus.DRAFT,
    ContestStatus.DRAFTING,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ])('refuses a new entry with CONTEST_ENTRY_LOCKED and stores nothing while the contest is %s', async (status) => {
    const { world, owner, squad, contest, service } = setup();
    world.contests.set(contest.id, { ...contest, status });

    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
    });
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(0);
  });

  it('refuses a new entry with CONTEST_ENTRY_FIELD_NOT_LOADED while the contest event has no field yet', async () => {
    const { world, owner, squad, contest, service } = setup();
    world.contests.set(contest.id, { ...contest, sportEventId: 'event-1' });

    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_FIELD_NOT_LOADED',
    });
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(0);

    world.fieldSizes.set('event-1', 40);
    await service.createEntry(contest.id, owner.id);
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(1);
  });

  it('refuses entering an unknown contest with ContestNotFoundError', async () => {
    const { owner, service } = setup();

    await expect(service.createEntry('no-such-contest', owner.id)).rejects.toBeInstanceOf(ContestNotFoundError);
  });

  it('numbers a squad\'s entries 1, 2, 3 and refuses the fourth with CONTEST_ENTRY_LIMIT_REACHED when the cap is 3', async () => {
    const { world, owner, squad, contest, service } = setup();
    const configuration = [...world.configurations.values()][0];
    world.configurations.set(configuration.id, { ...configuration, maxEntriesPerSquad: 3 });

    await service.createEntry(contest.id, owner.id);
    await service.createEntry(contest.id, owner.id);
    await service.createEntry(contest.id, owner.id);
    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LIMIT_REACHED',
    });

    expect(world.entriesOf(contest.id, squad.id).map((entry) => entry.entryNumber)).toEqual([1, 2, 3]);
  });

  it('allows any number of entries when a managed configuration leaves the cap empty', async () => {
    const { world, owner, squad, contest, service } = setup();

    for (let i = 0; i < 5; i++) {
      await service.createEntry(contest.id, owner.id);
    }

    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(5);
  });

  it('caps a squad at one entry when the contest has no configuration', async () => {
    const { world, owner, contest, service } = setup();
    world.configurations.clear();

    await service.createEntry(contest.id, owner.id);
    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LIMIT_REACHED',
    });
  });

  it('caps a squad at one entry when a legacy configuration has no typed settings and no cap', async () => {
    const { world, owner, contest, service } = setup();
    const configuration = [...world.configurations.values()][0];
    world.configurations.set(configuration.id, { ...configuration, configJson: undefined, maxEntriesPerSquad: null });

    await service.createEntry(contest.id, owner.id);
    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LIMIT_REACHED',
    });
  });

  it('lets a squad enter again after leaving, without colliding with the entry number it still holds', async () => {
    const { world, owner, squad, contest, service } = setup();
    await service.createEntry(contest.id, owner.id);
    await service.createEntry(contest.id, owner.id);
    // Leaving removes the squad's first entry; entry 2 stays.
    await service.deleteMyEntry(contest.id, owner.id);
    expect(world.entriesOf(contest.id, squad.id).map((entry) => entry.entryNumber)).toEqual([2]);

    await service.createEntry(contest.id, owner.id);

    expect(world.entriesOf(contest.id, squad.id).map((entry) => entry.entryNumber)).toEqual([2, 3]);
  });
});

describe('ContestService entries — who may act', () => {
  it('refuses a user who is not in the league with LEAGUE_MEMBERSHIP_REQUIRED', async () => {
    const { world, contest, service } = setup();
    const outsider = world.addUser();

    await expect(service.createEntry(contest.id, outsider.id)).rejects.toMatchObject({
      name: 'ContestEntryAccessError',
      code: 'LEAGUE_MEMBERSHIP_REQUIRED',
    });
  });

  it('refuses a member who has left the league with LEAGUE_MEMBERSHIP_INACTIVE, even with a squad row left behind', async () => {
    const { world, owner, contest, service } = setup();
    for (const [id, row] of world.memberships) {
      if (row.userId === owner.id) world.memberships.set(id, { ...row, status: LeagueMembershipStatus.INACTIVE });
    }

    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'LEAGUE_MEMBERSHIP_INACTIVE',
    });
  });

  it('refuses a member whose team membership has ended with SQUAD_MEMBERSHIP_INACTIVE', async () => {
    const { world, owner, contest, service } = setup();
    for (const [id, row] of world.squadMemberships) {
      if (row.userId === owner.id) world.squadMemberships.set(id, { ...row, status: SquadMembershipStatus.INACTIVE });
    }

    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'SQUAD_MEMBERSHIP_INACTIVE',
    });
  });

  it('refuses an active member with no team with SQUAD_MEMBERSHIP_REQUIRED', async () => {
    const { commissioner, contest, service } = setup();

    await expect(service.createEntry(contest.id, commissioner.id)).rejects.toMatchObject({
      code: 'SQUAD_MEMBERSHIP_REQUIRED',
    });
  });

  it('refuses entering for a team whose squad row is gone with SQUAD_MEMBERSHIP_REQUIRED', async () => {
    const { world, owner, squad, contest, service } = setup();
    world.squads.delete(squad.id);

    await expect(service.createEntry(contest.id, owner.id)).rejects.toBeInstanceOf(ContestEntryAccessError);
  });
});

describe('ContestService entries — leaving a contest', () => {
  it('deletes the squad\'s entry when it has no picks', async () => {
    const { world, owner, squad, contest, service } = setup();
    await service.createEntry(contest.id, owner.id);

    await service.deleteMyEntry(contest.id, owner.id);

    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(0);
  });

  it('refuses leaving with CONTEST_ENTRY_SELECTIONS_EXIST and keeps the entry once it has a pick', async () => {
    const { world, owner, squad, contest, service } = setup();
    const dto = await service.createEntry(contest.id, owner.id);
    world.addPick(dto.id, 'sep-1');

    await expect(service.deleteMyEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_SELECTIONS_EXIST',
    });
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(1);
  });

  it('refuses leaving with CONTEST_ENTRY_LOCKED and keeps the entry once the contest is underway', async () => {
    const { world, owner, squad, contest, service } = setup();
    await service.createEntry(contest.id, owner.id);
    world.contests.set(contest.id, { ...contest, status: ContestStatus.ACTIVE });

    await expect(service.deleteMyEntry(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_LOCKED',
    });
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(1);
  });

  it('refuses leaving with SQUAD_MANAGER_REQUIRED for a member who has no team', async () => {
    const { commissioner, contest, service } = setup();

    await expect(service.deleteMyEntry(contest.id, commissioner.id)).rejects.toMatchObject({
      code: 'SQUAD_MANAGER_REQUIRED',
    });
  });

  it('answers ContestEntryNotFoundError when the squad never entered', async () => {
    const { owner, contest, service } = setup();

    await expect(service.deleteMyEntry(contest.id, owner.id)).rejects.toBeInstanceOf(ContestEntryNotFoundError);
  });
});

describe('ContestService entries — renaming and tiebreakers', () => {
  it('stores a trimmed new name and a tiebreaker on the owner\'s entry', async () => {
    const { world, owner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);

    const dto = await service.updateEntry(contest.id, created.id, owner.id, {
      name: '  Sunday Charge  ',
      tiebreakerValue: -12,
    });

    expect(world.entries.get(created.id)).toMatchObject({ name: 'Sunday Charge', tiebreakerValue: -12 });
    expect(dto).toMatchObject({ name: 'Sunday Charge', tiebreakerValue: -12 });
  });

  it('clears the tiebreaker when it is set to null and leaves the name alone', async () => {
    const { world, owner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);
    await service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: -8 });

    await service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: null });

    expect(world.entries.get(created.id)).toMatchObject({ name: 'Birdie Brigade Entry 1', tiebreakerValue: null });
  });

  it('refuses a blank name with CONTEST_ENTRY_NAME_REQUIRED and keeps the old one', async () => {
    const { world, owner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);

    await expect(service.updateEntry(contest.id, created.id, owner.id, { name: '   ' })).rejects.toMatchObject({
      code: 'CONTEST_ENTRY_NAME_REQUIRED',
    });
    expect(world.entries.get(created.id)?.name).toBe('Birdie Brigade Entry 1');
  });

  it('refuses a name another of the squad\'s entries already has, ignoring case and spaces, with CONTEST_ENTRY_NAME_DUPLICATE', async () => {
    const { owner, contest, service } = setup();
    await service.createEntry(contest.id, owner.id);
    const second = await service.createEntry(contest.id, owner.id);

    await expect(service.updateEntry(contest.id, second.id, owner.id, { name: ' birdie brigade entry 1 ' }))
      .rejects.toMatchObject({ code: 'CONTEST_ENTRY_NAME_DUPLICATE' });
  });

  it('accepts re-saving an entry under its own name in different case', async () => {
    const { world, owner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);

    await service.updateEntry(contest.id, created.id, owner.id, { name: 'BIRDIE BRIGADE ENTRY 1' });

    expect(world.entries.get(created.id)?.name).toBe('BIRDIE BRIGADE ENTRY 1');
  });

  it('allows two different squads to use the same entry name', async () => {
    const { world, owner, rival, contest, service } = setup();
    const mine = await service.createEntry(contest.id, owner.id);
    const theirs = await service.createEntry(contest.id, rival.id);
    await service.updateEntry(contest.id, mine.id, owner.id, { name: 'Green Jacket' });

    await service.updateEntry(contest.id, theirs.id, rival.id, { name: 'Green Jacket' });

    expect(world.entries.get(theirs.id)?.name).toBe('Green Jacket');
  });

  it('refuses changing another squad\'s entry with ContestEntryNotFoundError and leaves it untouched', async () => {
    const { world, owner, rival, contest, service } = setup();
    const theirs = await service.createEntry(contest.id, rival.id);

    await expect(service.updateEntry(contest.id, theirs.id, owner.id, { name: 'Hijacked' }))
      .rejects.toBeInstanceOf(ContestEntryNotFoundError);
    expect(world.entries.get(theirs.id)?.name).toBe('Bogey Bunch Entry 1');
  });

  it('refuses changes with CONTEST_ENTRY_LOCKED once the contest is underway', async () => {
    const { world, owner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);
    world.contests.set(contest.id, { ...contest, status: ContestStatus.LOCKED });

    await expect(service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: -3 }))
      .rejects.toBeInstanceOf(ContestEntryOperationError);
    expect(world.entries.get(created.id)?.tiebreakerValue).toBeUndefined();
  });

  it('refuses changes with SQUAD_MANAGER_REQUIRED for a member with no team', async () => {
    const { owner, commissioner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);

    await expect(service.updateEntry(contest.id, created.id, commissioner.id, { name: 'Mine now' }))
      .rejects.toMatchObject({ code: 'SQUAD_MANAGER_REQUIRED' });
  });
});

describe('ContestService entries — confirmation email', () => {
  function completeLineup(world: InMemoryContestWorld, entryId: string) {
    for (let i = 1; i <= 6; i++) world.addPick(entryId, `sep-${i}`);
  }

  /**
   * A contest on an event with six tiers. The world's configuration takes one pick per tier, so
   * a complete lineup is 6 picks (#479: the roster is derived, never stored).
   */
  function setupOnTieredEvent(options: { mailDelivery?: MailDeliveryProvider } = {}) {
    const context = setup(options);
    const event = context.world.addSportEvent({ startDate: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    context.world.addEventTiers(event.id, 6);
    const contest = { ...context.contest, sportEventId: event.id };
    context.world.contests.set(contest.id, contest);
    return { ...context, contest };
  }

  it('emails the owner a confirmation once the lineup is complete and a tiebreaker is saved', async () => {
    const mail = capturingMail();
    const { world, owner, contest, service } = setupOnTieredEvent({ mailDelivery: mail });
    const created = await service.createEntry(contest.id, owner.id);
    completeLineup(world, created.id);

    await service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: -10 });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('olive@example.com');
    expect(mail.sent[0].text).toContain('Birdie Brigade Entry 1');
    expect(mail.sent[0].text).toContain('-10');
  });

  it('sends no confirmation while the lineup is short of the roster size', async () => {
    const mail = capturingMail();
    const { world, owner, contest, service } = setupOnTieredEvent({ mailDelivery: mail });
    const created = await service.createEntry(contest.id, owner.id);
    world.addPick(created.id, 'sep-1');

    await service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: -10 });

    expect(mail.sent).toHaveLength(0);
  });

  it('sends no confirmation for a complete lineup with no tiebreaker', async () => {
    const mail = capturingMail();
    const { world, owner, contest, service } = setupOnTieredEvent({ mailDelivery: mail });
    const created = await service.createEntry(contest.id, owner.id);
    completeLineup(world, created.id);

    await service.updateEntry(contest.id, created.id, owner.id, { name: 'Renamed' });

    expect(mail.sent).toHaveLength(0);
  });

  it('still saves the entry when the confirmation email fails to send', async () => {
    const { world, owner, contest, service } = setupOnTieredEvent({
      mailDelivery: { send: async () => { throw new Error('SMTP down'); } } as unknown as MailDeliveryProvider,
    });
    const created = await service.createEntry(contest.id, owner.id);
    completeLineup(world, created.id);

    await service.updateEntry(contest.id, created.id, owner.id, { tiebreakerValue: -4 });

    expect(world.entries.get(created.id)?.tiebreakerValue).toBe(-4);
  });
});

describe('ContestService entries — reads', () => {
  it('lists the reader\'s own entries first, with picks shown only for their own while the contest is open', async () => {
    const { world, owner, rival, contest, service } = setup();
    const theirs = await service.createEntry(contest.id, rival.id);
    const mine = await service.createEntry(contest.id, owner.id);
    world.addPick(theirs.id, 'sep-1');
    world.addPick(mine.id, 'sep-2');

    const result = await service.listEntries(contest.id, owner.id);

    expect(result.picksRevealed).toBe(false);
    expect(result.isJoined).toBe(true);
    expect(result.myEntryIds).toEqual([mine.id]);
    expect(result.entries.map((entry) => entry.id)).toEqual([mine.id, theirs.id]);
    expect(result.entries[0].participants).toHaveLength(1);
    expect(result.entries[1].participants).toBeUndefined();
    expect(result.entries[1].picksCount).toBe(1);
  });

  it('reveals every entry\'s picks once the contest is underway', async () => {
    const { world, owner, rival, contest, service } = setup();
    const theirs = await service.createEntry(contest.id, rival.id);
    world.addPick(theirs.id, 'sep-1');
    world.contests.set(contest.id, { ...contest, status: ContestStatus.ACTIVE });

    const result = await service.listEntries(contest.id, owner.id);

    expect(result.picksRevealed).toBe(true);
    expect(result.isJoined).toBe(false);
    expect(result.entries[0].participants?.map((pick) => pick.sportEventParticipantId)).toEqual(['sep-1']);
  });

  it('shows a member with no team every entry as someone else\'s', async () => {
    const { owner, commissioner, contest, service } = setup();
    await service.createEntry(contest.id, owner.id);

    const result = await service.listEntries(contest.id, commissioner.id);

    expect(result).toMatchObject({ isJoined: false, myEntryId: null, myEntryIds: [] });
    expect(result.entries).toHaveLength(1);
  });

  it('hides another squad\'s picks in entry detail while open and shows the owner their own', async () => {
    const { world, owner, rival, contest, service } = setup();
    const theirs = await service.createEntry(contest.id, rival.id);
    world.addPick(theirs.id, 'sep-1');

    const asOwner = await service.getEntryDetail(contest.id, theirs.id, rival.id);
    const asOther = await service.getEntryDetail(contest.id, theirs.id, owner.id);

    expect(asOwner.entry.participants).toHaveLength(1);
    expect(asOther.entry.participants).toBeUndefined();
    expect(asOther.picksRevealed).toBe(false);
  });

  it('answers ContestEntryNotFoundError for an entry that belongs to another contest', async () => {
    const { world, league, owner, contest, service } = setup();
    const other = world.addContest(league.id);
    world.addConfiguration(other.id);
    const elsewhere = await service.createEntry(other.id, owner.id);

    await expect(service.getEntryDetail(contest.id, elsewhere.id, owner.id))
      .rejects.toBeInstanceOf(ContestEntryNotFoundError);
  });

  it('returns the squad\'s entry from getMyEntry, and null for a member with no team', async () => {
    const { owner, commissioner, contest, service } = setup();
    const created = await service.createEntry(contest.id, owner.id);

    await expect(service.getMyEntry(contest.id, owner.id)).resolves.toMatchObject({ id: created.id });
    await expect(service.getMyEntry(contest.id, commissioner.id)).resolves.toBeNull();
  });

  it('counts entries per contest, with zero for a contest nobody entered', async () => {
    const { world, league, owner, rival, contest, service } = setup();
    const empty = world.addContest(league.id);
    await service.createEntry(contest.id, owner.id);
    await service.createEntry(contest.id, rival.id);

    const counts = await service.countEntriesByContest([contest.id, empty.id]);

    expect(counts.get(contest.id)).toBe(2);
    expect(counts.get(empty.id)).toBe(0);
    await expect(service.countEntriesByContest([])).resolves.toEqual(new Map());
  });

  it('refuses the golf leaderboard with CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN while picks are still hidden', async () => {
    const { owner, contest, service } = setup();

    await expect(service.getGolfLeaderboard(contest.id, owner.id)).rejects.toMatchObject({
      code: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN',
    });
  });

  it('refuses the golf leaderboard with CONTEST_GOLF_LEADERBOARD_EVENT_REQUIRED for a contest with no event', async () => {
    const { world, owner, contest, service } = setup();
    world.contests.set(contest.id, { ...contest, status: ContestStatus.ACTIVE });

    await expect(service.getGolfLeaderboard(contest.id, owner.id)).rejects.toBeInstanceOf(ContestOperationError);
  });
});

describe('ContestService — draft visibility and contest edits', () => {
  it('hides a draft contest from a member and shows it to its commissioner and a root admin', async () => {
    const { world, league, owner, commissioner, service } = setup();
    const draft = world.addContest(league.id, { status: ContestStatus.DRAFT, name: 'Secret draft' });

    const memberList = await service.listByLeague(league.id, { userId: owner.id, isRootAdmin: false });
    const commissionerList = await service.listByLeague(league.id, { userId: commissioner.id, isRootAdmin: false });
    const adminList = await service.listByLeague(league.id, { userId: 'admin', isRootAdmin: true });

    expect(memberList.map((contest) => contest.id)).not.toContain(draft.id);
    expect(commissionerList.map((contest) => contest.id)).toContain(draft.id);
    expect(adminList.map((contest) => contest.id)).toContain(draft.id);
    await expect(service.getContest(draft.id, { userId: owner.id, isRootAdmin: false })).resolves.toBeNull();
    await expect(service.getContest(draft.id, { userId: commissioner.id, isRootAdmin: false }))
      .resolves.toMatchObject({ contest: { id: draft.id } });
  });

  it('hides a draft contest from a commissioner who has left the league', async () => {
    const { world, league, commissioner, service } = setup();
    const draft = world.addContest(league.id, { status: ContestStatus.DRAFT });
    for (const [id, row] of world.memberships) {
      if (row.userId === commissioner.id) world.memberships.set(id, { ...row, status: LeagueMembershipStatus.INACTIVE });
    }

    await expect(service.getContest(draft.id, { userId: commissioner.id, isRootAdmin: false })).resolves.toBeNull();
  });

  it('renames a draft contest, and refuses renaming or deleting one that is open', async () => {
    const { world, league, contest, service } = setup();
    const draft = world.addContest(league.id, { status: ContestStatus.DRAFT });

    await service.updateContest(draft.id, { name: 'Renamed draft' });
    expect(world.contests.get(draft.id)?.name).toBe('Renamed draft');

    await expect(service.updateContest(contest.id, { name: 'Too late' })).rejects.toMatchObject({
      code: 'CONTEST_EDIT_STATUS_INVALID',
    });
    await expect(service.deleteContest(contest.id)).rejects.toMatchObject({
      code: 'CONTEST_DELETE_STATUS_INVALID',
    });
    expect(world.contests.get(contest.id)?.name).toBe('Masters Pool');
  });

  it('deletes a draft contest, and answers ContestNotFoundError for an unknown one', async () => {
    const { world, league, service } = setup();
    const draft = world.addContest(league.id, { status: ContestStatus.DRAFT });

    await service.deleteContest(draft.id);

    expect(world.contests.has(draft.id)).toBe(false);
    await expect(service.deleteContest(draft.id)).rejects.toBeInstanceOf(ContestNotFoundError);
    await expect(service.updateContest(draft.id, { name: 'x' })).rejects.toBeInstanceOf(ContestNotFoundError);
  });
});

describe('ContestService entries — the event start closes entries', () => {
  const HOUR = 60 * 60 * 1000;

  function onEvent(startDate: Date) {
    const context = setup();
    const event = context.world.addSportEvent({ startDate });
    context.world.contests.set(context.contest.id, { ...context.contest, sportEventId: event.id });
    return context;
  }

  it('refuses a new entry with CONTEST_ENTRY_LOCKED once the event\'s start time has passed, though its status still says scheduled', async () => {
    const { world, owner, squad, contest, service } = onEvent(new Date(Date.now() - HOUR));

    await expect(service.createEntry(contest.id, owner.id)).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(0);
  });

  it('refuses renaming or leaving with CONTEST_ENTRY_LOCKED once the event\'s start time has passed', async () => {
    const { world, owner, squad, contest, service } = onEvent(new Date(Date.now() + HOUR));
    const created = await service.createEntry(contest.id, owner.id);
    const event = [...world.sportEvents.values()][0];
    world.sportEvents.set(event.id, { ...event, startDate: new Date(Date.now() - HOUR) });

    await expect(service.updateEntry(contest.id, created.id, owner.id, { name: 'Late change' }))
      .rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    await expect(service.deleteMyEntry(contest.id, owner.id)).rejects.toMatchObject({ code: 'CONTEST_ENTRY_LOCKED' });
    expect(world.entriesOf(contest.id, squad.id)).toMatchObject([{ name: 'Birdie Brigade Entry 1' }]);
  });

  it('accepts an entry on an event that starts later', async () => {
    const { world, owner, squad, contest, service } = onEvent(new Date(Date.now() + 7 * 24 * HOUR));

    await service.createEntry(contest.id, owner.id);

    expect(world.entriesOf(contest.id, squad.id)).toHaveLength(1);
  });
});

