import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { selectPersonalAppViews, selectThreadAppViews, useAppViewStore } from "~/appViewStore";
import { useT3ProjectFileAppViews } from "~/hooks/useT3ProjectFileAppViews";
import { useProject, useThreadShell } from "~/state/entities";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { AppViewPlacementIcon } from "./AppViewPlacementIcon";
import {
  activateAppViewPlacement,
  mergeContextAppViews,
  resolveAppViewPlacements,
} from "./AppViewPlacements.logic";
import { invokeWebAppCommand } from "~/appCommandRegistry";
import { toastManager } from "../ui/toast";

function ActiveProjectSidebarAppViewLaunchers(props: { readonly threadRef: ScopedThreadRef }) {
  const thread = useThreadShell(props.threadRef);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const threadViews = useAppViewStore((state) =>
    selectThreadAppViews(state.byThreadKey, props.threadRef),
  );
  const personalViews = useAppViewStore((state) =>
    selectPersonalAppViews(state.personalByEnvironment, props.threadRef.environmentId),
  );
  const projectViews = useT3ProjectFileAppViews(
    props.threadRef.environmentId,
    project?.workspaceRoot ?? null,
    project?.id ?? null,
  );
  const placements = useMemo(
    () =>
      resolveAppViewPlacements(
        mergeContextAppViews({
          personal: personalViews,
          project: projectViews,
          thread: threadViews.manifests,
        }),
        "project-sidebar",
      ),
    [personalViews, projectViews, threadViews.manifests],
  );
  if (placements.length === 0) return null;
  return (
    <SidebarMenu aria-label="Project app views">
      {placements.map((item) => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            type="button"
            title={item.description}
            onClick={() =>
              activateAppViewPlacement(item, {
                openView: (manifest) =>
                  useAppViewStore.getState().openManifest(props.threadRef, manifest),
                runAction: (action) => {
                  void invokeWebAppCommand(
                    action.commandId,
                    {
                      environmentId: props.threadRef.environmentId,
                      ...(thread ? { projectId: thread.projectId } : {}),
                      threadId: props.threadRef.threadId,
                      source: "view",
                    },
                    action.args ?? {},
                  ).catch((error: unknown) => {
                    toastManager.add({
                      type: "error",
                      title: "Generated view action failed",
                      description:
                        error instanceof Error ? error.message : "The command could not be run.",
                    });
                  });
                },
              })
            }
          >
            <AppViewPlacementIcon icon={item.placement.icon} />
            <span className="truncate">{item.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export function ProjectSidebarAppViewLaunchers(props: {
  readonly threadRef: ScopedThreadRef | null;
}) {
  return props.threadRef ? (
    <ActiveProjectSidebarAppViewLaunchers threadRef={props.threadRef} />
  ) : null;
}
