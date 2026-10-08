/**
 * Where a user lands after logging in or registering.
 *
 * Split out of `auth-home-page.tsx` for `react-refresh/only-export-components`
 * (#345 Phase 0, from #167): that module exports the page component, so a plain
 * function exported alongside it broke Fast Refresh for the whole page.
 */
import type { UserDto } from "@/lib/api";

type PostAuthUser = Pick<UserDto, "isRootAdmin" | "isActive">;

export function resolvePostAuthDestination(
  user: PostAuthUser,
  routeState: { from?: string },
): string {
  // An inactive account signs in only to reactivate or delete itself (DOMAIN-OPERATIONS A9),
  // and is hidden from every league, so any other destination would show it nothing.
  if (user.isActive === false) {
    return "/my-account";
  }
  if (routeState.from) {
    return routeState.from;
  }
  if (user.isRootAdmin) {
    return "/manage";
  }
  return "/welcome";
}
