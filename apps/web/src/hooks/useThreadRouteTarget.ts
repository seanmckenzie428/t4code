import { useRouterState } from "@tanstack/react-router";

import type { AppRouter } from "../router";
import { resolveThreadRouteTargetFromMatches, type ThreadRouteTarget } from "../threadRoutes";

export function useThreadRouteTarget(router?: AppRouter): ThreadRouteTarget | null {
  return useRouterState({
    ...(router === undefined ? {} : { router }),
    select: (state) => resolveThreadRouteTargetFromMatches(state.matches),
  }) as ThreadRouteTarget | null;
}
