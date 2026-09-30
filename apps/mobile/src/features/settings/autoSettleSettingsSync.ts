import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ProjectId,
  ServerSettings,
} from "@t3tools/contracts";

export type AutoSettleSettings = Pick<
  ServerSettings,
  "sidebarAutoSettleAfterDays" | "sidebarAutoSettleOnMerge" | "sidebarAutoArchiveSettled"
>;

interface AutoSettleSyncTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | null;
  readonly label: string;
  readonly settings: AutoSettleSettings | null;
  readonly capabilities?: Pick<ExecutionEnvironmentCapabilities, "threadAutoArchive">;
}

/** Legacy settlement servers drop the archive key, so never send or compare it there. */
export function filterAutoSettleSettingsPatch(
  patch: Partial<AutoSettleSettings>,
  capabilities?: Pick<ExecutionEnvironmentCapabilities, "threadAutoArchive">,
): Partial<AutoSettleSettings> {
  if (capabilities?.threadAutoArchive === true) return patch;
  const { sidebarAutoArchiveSettled: _archive, ...supported } = patch;
  return supported;
}

/** Receives connected, capable targets. Applying these defaults must preserve other settings. */
export function planAutoSettleSettingsSync(
  reference: {
    readonly environmentId: EnvironmentId;
    readonly projectId?: ProjectId | null;
    readonly settings: AutoSettleSettings;
    readonly capabilities?: Pick<ExecutionEnvironmentCapabilities, "threadAutoArchive">;
  },
  targets: readonly AutoSettleSyncTarget[],
) {
  const patch = filterAutoSettleSettingsPatch(
    {
      sidebarAutoSettleAfterDays: reference.settings.sidebarAutoSettleAfterDays,
      sidebarAutoSettleOnMerge: reference.settings.sidebarAutoSettleOnMerge,
      sidebarAutoArchiveSettled: reference.settings.sidebarAutoArchiveSettled,
    },
    reference.capabilities,
  );
  const mismatches = targets.filter(
    (target) =>
      (target.environmentId !== reference.environmentId ||
        target.projectId !== reference.projectId) &&
      target.settings !== null &&
      (target.settings.sidebarAutoSettleAfterDays !== patch.sidebarAutoSettleAfterDays ||
        target.settings.sidebarAutoSettleOnMerge !== patch.sidebarAutoSettleOnMerge ||
        (target.capabilities?.threadAutoArchive === true &&
          patch.sidebarAutoArchiveSettled !== undefined &&
          target.settings.sidebarAutoArchiveSettled !== patch.sidebarAutoArchiveSettled)),
  );
  return { patch, mismatches };
}
