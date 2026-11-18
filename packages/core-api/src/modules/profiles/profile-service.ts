/**
 * ProfileService (#1844): the root admin's list, read, create, update and delete of one profile
 * kind, tier or pricing. A profile is defined once for the platform and each sport league names
 * one of each kind; nothing is set per sport. A profile any league names can't be deleted, and
 * editing one changes what every league naming it uses from then on: an event records the values
 * it was tiered and priced with, so nothing already made moves.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProfileRepository } from '@poolmaster/shared/db';
import {
  findBudgetPricingProblem,
  findTierLayoutProblem,
  type BudgetPricingProfile,
  type PricingProfile,
  type TierLayoutValues,
  type TierProfile,
} from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

/** What differs between the two kinds: their words, their error codes and their values' check. */
export interface ProfileKind<TWrite> {
  /** As a sentence names it: "Tier profile". */
  label: string;
  codes: { notFound: ApiErrorCode; nameTaken: ApiErrorCode; inUse: ApiErrorCode; invalid: ApiErrorCode };
  /** Why the values can't be used, or null when they can. */
  findProblem: (values: TWrite) => string | null;
}

export const TIER_PROFILE_KIND: ProfileKind<Pick<TierProfile, 'name'> & TierLayoutValues> = {
  label: 'Tier profile',
  codes: { notFound: 'TIER_PROFILE_NOT_FOUND', nameTaken: 'TIER_PROFILE_NAME_TAKEN', inUse: 'TIER_PROFILE_IN_USE', invalid: 'TIER_PROFILE_INVALID' },
  findProblem: findTierLayoutProblem,
};

export const PRICING_PROFILE_KIND: ProfileKind<BudgetPricingProfile> = {
  label: 'Pricing profile',
  codes: { notFound: 'PRICING_PROFILE_NOT_FOUND', nameTaken: 'PRICING_PROFILE_NAME_TAKEN', inUse: 'PRICING_PROFILE_IN_USE', invalid: 'PRICING_PROFILE_INVALID' },
  findProblem: findBudgetPricingProblem,
};

/** A profile, with how many sport leagues name it. */
export interface ProfileUse<TProfile> {
  profile: TProfile;
  sportLeagueCount: number;
}

export interface ProfileServiceDeps<TProfile, TWrite> {
  profiles: ProfileRepository<TProfile, TWrite>;
  kind: ProfileKind<TWrite>;
  logger?: FastifyBaseLogger;
}

export class ProfileService<TProfile extends { id: string; name: string }, TWrite extends { name: string }> {
  constructor(private readonly deps: ProfileServiceDeps<TProfile, TWrite>) {}

  /** Every profile, by name, each with its sport league count: two reads, however many. */
  async list(): Promise<Array<ProfileUse<TProfile>>> {
    const [profiles, counts] = await Promise.all([this.deps.profiles.findAll(), this.deps.profiles.countSportLeagues()]);
    return profiles.map((profile) => ({ profile, sportLeagueCount: counts.get(profile.id) ?? 0 }));
  }

  /** 404 when no such profile exists. */
  async get(id: string): Promise<ProfileUse<TProfile>> {
    const [profile, counts] = await Promise.all([this.deps.profiles.findById(id), this.deps.profiles.countSportLeagues()]);
    if (!profile) throw this.notFound(id);
    return { profile, sportLeagueCount: counts.get(id) ?? 0 };
  }

  /** 422 when the values contradict each other; 409 when another profile of the kind has the name. */
  async create(input: TWrite): Promise<ProfileUse<TProfile>> {
    this.assertValid(input);
    await this.assertNameFree(input.name);
    const profile = await this.deps.profiles.create(input);
    this.deps.logger?.info({ profileId: profile.id, name: profile.name, kind: this.deps.kind.label }, 'Created profile');
    return { profile, sportLeagueCount: 0 };
  }

  /**
   * Replaces the profile's name and values. 404 when no such profile exists, 422 when the values
   * contradict each other, 409 when another profile of the kind has the name.
   */
  async update(id: string, input: TWrite): Promise<ProfileUse<TProfile>> {
    if (!(await this.deps.profiles.findById(id))) throw this.notFound(id);
    this.assertValid(input);
    await this.assertNameFree(input.name, id);
    const profile = await this.deps.profiles.update(id, input);
    this.deps.logger?.info({ profileId: id, name: profile.name, kind: this.deps.kind.label }, 'Updated profile');
    return this.get(id);
  }

  /** 404 when no such profile exists; 409 while any sport league names it. */
  async delete(id: string): Promise<void> {
    const used = await this.deps.profiles.deleteUnlessUsed(id);
    if (used === null) throw this.notFound(id);
    if (used > 0) {
      this.deps.logger?.warn({ profileId: id, sportLeagueCount: used, kind: this.deps.kind.label }, 'Refused to delete a profile a sport league names');
      throw new ProfileError(
        `${this.deps.kind.label} ${id} is named by ${used} sport league${used === 1 ? '' : 's'}, so it cannot be deleted.`,
        this.deps.kind.codes.inUse,
        409,
      );
    }
    this.deps.logger?.info({ profileId: id, kind: this.deps.kind.label }, 'Deleted profile');
  }

  private assertValid(input: TWrite): void {
    const problem = this.deps.kind.findProblem(input);
    if (problem) throw new ProfileError(problem, this.deps.kind.codes.invalid, 422);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const named = await this.deps.profiles.findByName(name);
    if (named && named.id !== exceptId) {
      throw new ProfileError(`Another ${this.deps.kind.label.toLowerCase()} is already named "${name}".`, this.deps.kind.codes.nameTaken, 409);
    }
  }

  private notFound(id: string): ProfileError {
    return new ProfileError(`${this.deps.kind.label} ${id} was not found.`, this.deps.kind.codes.notFound, 404);
  }
}

export type TierProfileService = ProfileService<TierProfile, Pick<TierProfile, 'name'> & TierLayoutValues>;
export type PricingProfileService = ProfileService<PricingProfile, BudgetPricingProfile>;
