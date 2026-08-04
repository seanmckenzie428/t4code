import type { ProjectCustomAction } from "@t3tools/contracts";
import type { ProjectCustomActionIcon } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  ChevronDownIcon,
  BugIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GlobeIcon,
  HammerIcon,
  LayoutDashboardIcon,
  LinkIcon,
  ListChecksIcon,
  MailIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  ServerIcon,
  SettingsIcon,
  SquareTerminalIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { projectCustomActionPresentation } from "./ProjectCustomActionsControl.logic";

export type ProjectCustomActionResult = AtomCommandResult<void, unknown>;

interface Props {
  readonly actions: ReadonlyArray<ProjectCustomAction>;
  readonly onRun: (action: ProjectCustomAction) => void;
  readonly onSetPlacement: (
    actionId: string,
    placement: "menu" | "toolbar",
  ) => Promise<ProjectCustomActionResult>;
  readonly onDelete: (actionId: string) => Promise<ProjectCustomActionResult>;
}

function ActionIcon({ icon }: { readonly icon: ProjectCustomActionIcon }) {
  const className = "size-3.5 shrink-0";
  if (icon === "link") return <LinkIcon className={className} />;
  if (icon === "external-link") return <ExternalLinkIcon className={className} />;
  if (icon === "terminal") return <SquareTerminalIcon className={className} />;
  if (icon === "database") return <DatabaseIcon className={className} />;
  if (icon === "server") return <ServerIcon className={className} />;
  if (icon === "globe") return <GlobeIcon className={className} />;
  if (icon === "dashboard") return <LayoutDashboardIcon className={className} />;
  if (icon === "mail") return <MailIcon className={className} />;
  if (icon === "settings") return <SettingsIcon className={className} />;
  if (icon === "git-branch") return <GitBranchIcon className={className} />;
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export default function ProjectCustomActionsControl({
  actions,
  onRun,
  onSetPlacement,
  onDelete,
}: Props) {
  const presentation = projectCustomActionPresentation(actions);
  const [deleteAction, setDeleteAction] = useState<ProjectCustomAction | null>(null);
  const confirmDelete = useCallback(() => {
    if (!deleteAction) return;
    setDeleteAction(null);
    void onDelete(deleteAction.id);
  }, [deleteAction, onDelete]);
  if (actions.length === 0) return null;

  return (
    <>
      {presentation.toolbar.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="outline"
                aria-label={`${action.commandId === "ui.external-url.open" ? "Open" : "Run"} ${action.name}`}
                onClick={() => onRun(action)}
              />
            }
          >
            <ActionIcon icon={action.icon} />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {action.name}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">{action.name}</TooltipPopup>
        </Tooltip>
      ))}
      <Menu highlightItemOnHover={false}>
        <MenuTrigger render={<Button size="xs" variant="outline" aria-label="Project actions" />}>
          <span>Actions</span>
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          {presentation.menu.map((action) => (
            <MenuItem
              key={action.id}
              className="group data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
              onClick={() => onRun(action)}
            >
              <ActionIcon icon={action.icon} />
              <span className="truncate">{action.name}</span>
              <span className="ms-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    action.placement === "toolbar"
                      ? `Unpin ${action.name} from top bar`
                      : `Pin ${action.name} to top bar`
                  }
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onSetPlacement(
                      action.id,
                      action.placement === "toolbar" ? "menu" : "toolbar",
                    );
                  }}
                >
                  {action.placement === "toolbar" ? (
                    <PinOffIcon className="size-3.5" />
                  ) : (
                    <PinIcon className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${action.name}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDeleteAction(action);
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>

      <AlertDialog
        open={deleteAction !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteAction(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{deleteAction?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the action from this project. It does not run or delete its target.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
