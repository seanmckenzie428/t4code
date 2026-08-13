import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ProjectCustomAction,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type ContextMenuItem,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ChangeRequestStateLike } from "@t3tools/client-runtime/state/thread-settled";
import { ChevronDownIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import ProjectCustomActionsControl, {
  type ProjectCustomActionResult,
} from "../ProjectCustomActionsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { cn } from "~/lib/utils";
import {
  manageAppViewPlacement,
  type ResolvedAppViewPlacement,
} from "../app-views/AppViewPlacements.logic";
import { AppViewPlacementIcon } from "../app-views/AppViewPlacementIcon";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { readLocalApi } from "~/localApi";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  /** Drafts have no server thread yet, so the title carries no action menu. */
  isServerThread: boolean;
  /** PR state feeding the settled classification, resolved by ChatView. */
  changeRequestState: ChangeRequestStateLike | null;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  activeProjectFaviconPath: string | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  activeProjectCustomActions: ReadonlyArray<ProjectCustomAction> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  appViewPlacements: ReadonlyArray<ResolvedAppViewPlacement>;
  gitCwd: string | null;
  readonly onOpenPullRequest?: ((number: number) => void) | undefined;
  onNewThreadInProject: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  onRunProjectCustomAction: (action: ProjectCustomAction) => void;
  onSetProjectCustomActionPlacement: (
    actionId: string,
    placement: "menu" | "toolbar",
  ) => Promise<ProjectCustomActionResult>;
  onDeleteProjectCustomAction: (actionId: string) => Promise<ProjectCustomActionResult>;
  onActivateAppViewPlacement: (placement: ResolvedAppViewPlacement) => void;
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  isServerThread,
  changeRequestState,
  activeProjectName,
  activeProjectCwd,
  activeProjectFaviconPath,
  openInCwd,
  activeProjectScripts,
  activeProjectCustomActions,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  appViewPlacements,
  gitCwd,
  onOpenPullRequest,
  onNewThreadInProject,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onRunProjectCustomAction,
  onSetProjectCustomActionPlacement,
  onDeleteProjectCustomAction,
  onActivateAppViewPlacement,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  const activeThreadRef = useMemo(
    () => scopeThreadRef(activeThreadEnvironmentId, activeThreadId),
    [activeThreadEnvironmentId, activeThreadId],
  );
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  // Inline rename, keyed by thread: navigating away drops an in-progress
  // rename instead of committing stale text. Cleared on thread change (not
  // just hidden) so returning to the thread doesn't revive the old draft.
  const [renaming, setRenaming] = useState<{ threadId: ThreadId; title: string } | null>(null);
  if (renaming !== null && renaming.threadId !== activeThreadId) {
    setRenaming(null);
  }
  const renamingTitle = renaming?.threadId === activeThreadId ? renaming.title : null;
  const renameCommittedRef = useRef(false);
  const startRename = useCallback(() => {
    renameCommittedRef.current = false;
    setRenaming({ threadId: activeThreadId, title: activeThreadTitle });
  }, [activeThreadId, activeThreadTitle]);
  const commitRename = useCallback(
    (title: string) => {
      setRenaming(null);
      const resolution = resolveRenameCommit({ title, originalTitle: activeThreadTitle });
      if (resolution.action === "reject-empty") {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (resolution.action === "noop") return;
      void updateThreadMetadata({
        environmentId: activeThreadEnvironmentId,
        input: { threadId: activeThreadId, title: resolution.title },
      }).then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      });
    },
    [activeThreadEnvironmentId, activeThreadId, activeThreadTitle, updateThreadMetadata],
  );
  const { openMenu } = useThreadActionMenu({
    threadRef: isServerThread ? activeThreadRef : null,
    projectCwd: activeProjectCwd,
    changeRequestState,
    onStartRename: startRename,
  });
  const titleButtonRef = useRef<HTMLButtonElement | null>(null);
  const openMenuFromTitle = useCallback(() => {
    const rect = titleButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ x: rect.left, y: rect.bottom + 4 });
  }, [openMenu]);
  const handleHeaderContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!isServerThread || renamingTitle !== null) return;
      // The right-side controls (git, scripts, open-in) keep their own
      // behavior; only the breadcrumb area opens the thread menu.
      if ((event.target as HTMLElement).closest("[data-chat-header-actions]")) return;
      event.preventDefault();
      openMenu({ x: event.clientX, y: event.clientY });
    },
    [isServerThread, openMenu, renamingTitle],
  );
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        renameCommittedRef.current = true;
        commitRename(event.currentTarget.value);
      } else if (event.key === "Escape") {
        renameCommittedRef.current = true;
        setRenaming(null);
      }
    },
    [commitRename],
  );
  const handleAppViewPlacementContextMenu = async (
    event: ReactMouseEvent,
    item: ResolvedAppViewPlacement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    const action = await api.contextMenu.show(
      [{ id: "manage", label: "Manage generated view…" }] satisfies ContextMenuItem<"manage">[],
      { x: event.clientX, y: event.clientY },
    );
    if (action === "manage") {
      onActivateAppViewPlacement(manageAppViewPlacement(item));
    }
  };
  return (
    <div
      className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
      onContextMenu={handleHeaderContextMenu}
    >
      <WorkspaceBreadcrumb ariaLabel="Thread breadcrumb" className="flex-1">
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProjectName ? (
          <>
            <WorkspaceBreadcrumbItem>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`New thread in ${activeProjectName}`}
                      onClick={onNewThreadInProject}
                      className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  <ProjectFavicon
                    environmentId={activeThreadEnvironmentId}
                    cwd={activeProjectCwd ?? ""}
                    faviconPath={activeProjectFaviconPath}
                    className="size-3.5"
                  />
                  <span className="max-w-40 truncate">{activeProjectName}</span>
                </TooltipTrigger>
                <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
              </Tooltip>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
          </>
        ) : null}
        <WorkspaceBreadcrumbItem current className="flex-1">
          {renamingTitle !== null ? (
            <input
              autoFocus
              aria-label="Thread title"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium text-foreground outline-none ring-1 ring-ring/50 focus:ring-ring"
              defaultValue={renamingTitle}
              onBlur={(event) => {
                if (renameCommittedRef.current) return;
                commitRename(event.currentTarget.value);
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={handleRenameKeyDown}
            />
          ) : isServerThread ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    ref={titleButtonRef}
                    type="button"
                    aria-label={`Thread actions for ${activeThreadTitle}`}
                    aria-haspopup="menu"
                    onClick={openMenuFromTitle}
                    className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <h2 className="min-w-0 truncate">{activeThreadTitle}</h2>
                <ChevronDownIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
                />
              </TooltipTrigger>
              <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <h2 aria-label={activeThreadTitle} className="min-w-0 flex-1 truncate">
                    {activeThreadTitle}
                  </h2>
                }
              />
              <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
            </Tooltip>
          )}
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen ? "pr-0" : "pr-16",
        )}
      >
        {appViewPlacements.map((item) => {
          const action = item.placement.action;
          if (action && "menu" in action) {
            const primaryAction = action.primary;
            if (primaryAction) {
              return (
                <Group key={item.id} aria-label={item.label} className="shrink-0">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="max-w-36"
                    title={item.description}
                    onClick={() =>
                      onActivateAppViewPlacement({
                        ...item,
                        placement: { ...item.placement, action: primaryAction },
                      })
                    }
                    onContextMenu={(event) => void handleAppViewPlacementContextMenu(event, item)}
                  >
                    <AppViewPlacementIcon
                      icon={item.placement.icon}
                      className="size-3.5 shrink-0"
                    />
                    <span className="hidden truncate @5xl/header-actions:inline">{item.label}</span>
                  </Button>
                  <GroupSeparator className="hidden @3xl/header-actions:block" />
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="outline"
                          aria-label={`${item.label} options`}
                          onContextMenu={(event) =>
                            void handleAppViewPlacementContextMenu(event, item)
                          }
                        />
                      }
                    >
                      <ChevronDownIcon aria-hidden className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end" side="bottom">
                      {action.menu.map((menuItem, index) => (
                        <MenuItem
                          key={`${item.id}:${index}`}
                          onClick={() =>
                            onActivateAppViewPlacement({
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
                </Group>
              );
            }
            return (
              <Menu key={item.id}>
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      aria-label={item.label}
                      className="max-w-36"
                      onContextMenu={(event) => void handleAppViewPlacementContextMenu(event, item)}
                    />
                  }
                  title={item.description}
                >
                  <AppViewPlacementIcon icon={item.placement.icon} className="size-3.5 shrink-0" />
                  <span className="hidden truncate @5xl/header-actions:inline">{item.label}</span>
                  <ChevronDownIcon className="size-3 shrink-0" />
                </MenuTrigger>
                <MenuPopup align="end" side="bottom">
                  {action.menu.map((menuItem, index) => (
                    <MenuItem
                      key={`${item.id}:${index}`}
                      onClick={() =>
                        onActivateAppViewPlacement({
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
            );
          }
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    aria-label={item.label}
                    onClick={() => onActivateAppViewPlacement(item)}
                    onContextMenu={(event) => void handleAppViewPlacementContextMenu(event, item)}
                    className="max-w-36"
                  />
                }
              >
                <AppViewPlacementIcon icon={item.placement.icon} className="size-3.5 shrink-0" />
                <span className="hidden truncate @5xl/header-actions:inline">{item.label}</span>
              </TooltipTrigger>
              <TooltipPopup side="top">{item.description}</TooltipPopup>
            </Tooltip>
          );
        })}
        {activeProjectCustomActions ? (
          <ProjectCustomActionsControl
            actions={activeProjectCustomActions}
            onRun={onRunProjectCustomAction}
            onSetPlacement={onSetProjectCustomActionPlacement}
            onDelete={onDeleteProjectCustomAction}
          />
        ) : null}
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            fileScripts={fileScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            onOpenPullRequest={onOpenPullRequest}
            {...(draftId ? { draftId } : {})}
          />
        )}
      </div>
    </div>
  );
});
