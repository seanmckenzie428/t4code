import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { useMemo, type MouseEvent as ReactMouseEvent } from "react";

import { selectPersonalAppViews, selectThreadAppViews, useAppViewStore } from "~/appViewStore";
import { useT3ProjectFileAppViews } from "~/hooks/useT3ProjectFileAppViews";
import { useProject, useThreadShell } from "~/state/entities";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { AppViewPlacementIcon } from "./AppViewPlacementIcon";
import {
  activateAppViewPlacement,
  mergeContextAppViews,
  resolveAppViewPlacements,
} from "./AppViewPlacements.logic";
import { invokeWebAppCommand } from "~/appCommandRegistry";
import { toastManager } from "../ui/toast";
import { readLocalApi } from "~/localApi";

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
    thread?.worktreePath ?? null,
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
  const handleContextMenu = async (event: ReactMouseEvent, item: (typeof placements)[number]) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    const action = await api.contextMenu.show(
      [{ id: "manage", label: "Manage generated view…" }] satisfies ContextMenuItem<"manage">[],
      { x: event.clientX, y: event.clientY },
    );
    if (action === "manage") {
      useAppViewStore.getState().openManifest(props.threadRef, item.manifest);
    }
  };
  return (
    <SidebarMenu aria-label="Project app views">
      {placements.map((item) => {
        const activate = (selected = item) =>
          activateAppViewPlacement(selected, {
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
          });
        const content = (
          <>
            <AppViewPlacementIcon icon={item.placement.icon} />
            <span className="truncate">{item.label}</span>
          </>
        );
        const action = item.placement.action;
        return (
          <SidebarMenuItem key={item.id}>
            {action && "menu" in action ? (
              <Menu>
                <MenuTrigger
                  render={
                    <SidebarMenuButton
                      type="button"
                      title={item.description}
                      onContextMenu={(event) => void handleContextMenu(event, item)}
                    />
                  }
                >
                  {content}
                </MenuTrigger>
                <MenuPopup align="start" side="right">
                  {action.menu.map((menuItem, index) => (
                    <MenuItem
                      key={`${item.id}:${index}`}
                      onClick={() =>
                        activate({
                          ...item,
                          placement: { ...item.placement, action: menuItem.action },
                        })
                      }
                    >
                      {menuItem.label}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            ) : (
              <SidebarMenuButton
                type="button"
                title={item.description}
                onClick={() => activate()}
                onContextMenu={(event) => void handleContextMenu(event, item)}
              >
                {content}
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
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
