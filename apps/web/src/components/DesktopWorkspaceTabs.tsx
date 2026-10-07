import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  Columns2Icon,
  GlobeIcon,
  FolderIcon,
  MessageSquareIcon,
  FileDiffIcon,
  UsersIcon,
  XIcon,
  PlusIcon,
  FileIcon,
  LayoutPanelTopIcon,
} from "lucide-react";
import {
  DESKTOP_CORE_TABS,
  desktopSurfaceId,
  type DesktopTabId,
  type DesktopWorkspace,
} from "../desktopWorkspaceStore";
import type { RightPanelSurface } from "../rightPanelStore";
import { cn } from "../lib/utils";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const labels = {
  chat: "Chat",
  review: "Review",
  "pull-request": "PR",
  browser: "Browser",
  files: "Files",
  agents: "Subagents",
};
const icons = {
  chat: MessageSquareIcon,
  review: FileDiffIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  browser: GlobeIcon,
  files: FolderIcon,
  agents: UsersIcon,
};

export function desktopTabIds(
  workspace: DesktopWorkspace,
  reviewAvailable: boolean,
  prAvailable: boolean,
): DesktopTabId[] {
  return [
    ...DESKTOP_CORE_TABS.filter(
      (id) => (id !== "review" || reviewAvailable) && (id !== "pull-request" || prAvailable),
    ),
    ...workspace.surfaceOrder
      .filter((id) => id !== workspace.browserId && id !== workspace.fileId)
      .map((id): DesktopTabId => `surface:${id}`),
  ];
}

export function DesktopWorkspaceTabs(props: {
  workspace: DesktopWorkspace;
  surfaces: readonly RightPanelSurface[];
  reviewAvailable: boolean;
  prAvailable: boolean;
  surfaceTitle: (surface: RightPanelSurface) => string;
  split: boolean;
  splitShortcut: string | null;
  onSelect: (tab: DesktopTabId) => void;
  onClose: (surface: RightPanelSurface) => void;
  onReorder: (from: string, to: string) => void;
  onSplit: () => void;
  onNewBrowser: () => void;
  onFiles: () => void;
  onViews: () => void;
  onDevice: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const dragged = useRef<string | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () => setHasOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [props.surfaces, props.workspace]);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.workspace.selected]);
  const tabs = [
    ...DESKTOP_CORE_TABS.map((id) => ({
      id: id as DesktopTabId,
      label: labels[id],
      Icon: icons[id],
      fixed: true,
      available:
        (id !== "review" || props.reviewAvailable) && (id !== "pull-request" || props.prAvailable),
      surface: props.surfaces.find((s) => s.id === desktopSurfaceId(props.workspace, id)),
    })),
    ...props.workspace.surfaceOrder
      .filter((id) => id !== props.workspace.browserId && id !== props.workspace.fileId)
      .flatMap((id) => {
        const surface = props.surfaces.find((s) => s.id === id);
        return surface
          ? [
              {
                id: `surface:${id}` as DesktopTabId,
                label: props.surfaceTitle(surface),
                Icon:
                  surface.kind === "preview"
                    ? GlobeIcon
                    : surface.kind === "file"
                      ? FileIcon
                      : LayoutPanelTopIcon,
                fixed: false,
                available: true,
                surface,
              },
            ]
          : [];
      }),
  ];
  return (
    <div
      className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-3"
      data-main-view-tabs
    >
      <div
        ref={strip}
        role="tablist"
        aria-label="Main panel"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="group/main-tab relative flex shrink-0 items-center rounded-md hover:bg-accent/60"
            draggable={!tab.fixed}
            onDragStart={(event) => {
              dragged.current = tab.surface?.id ?? null;
              event.dataTransfer.setData("text/plain", tab.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              dragged.current = null;
            }}
            onDragOver={(event) => {
              if (!tab.fixed) event.preventDefault();
            }}
            onDrop={(event) => {
              if (tab.fixed || !dragged.current || !tab.surface) return;
              event.preventDefault();
              props.onReorder(dragged.current, tab.surface.id);
              dragged.current = null;
            }}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="tab"
                    aria-selected={props.workspace.selected === tab.id}
                    disabled={!tab.available}
                    onClick={() => props.onSelect(tab.id)}
                    className={cn(
                      "flex h-7 max-w-44 items-center gap-1.5 rounded-md px-2 text-sm outline-offset-2 disabled:opacity-40",
                      props.workspace.selected === tab.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
                  />
                }
              >
                <tab.Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    tab.surface &&
                      tab.surface.kind !== "files" &&
                      "group-hover/main-tab:opacity-0 group-has-focus-visible/main-tab:opacity-0",
                  )}
                />
                <span className="truncate">{tab.label}</span>
              </TooltipTrigger>
              <TooltipPopup>{tab.label}</TooltipPopup>
            </Tooltip>
            {tab.surface && tab.surface.kind !== "files" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Close ${tab.label}`}
                      className="pointer-events-none absolute top-1/2 left-1.5 flex size-4.5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/main-tab:pointer-events-auto group-hover/main-tab:opacity-100 group-has-focus-visible/main-tab:pointer-events-auto group-has-focus-visible/main-tab:opacity-100 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => {
                        if (tab.surface) props.onClose(tab.surface);
                      }}
                    />
                  }
                >
                  <XIcon className="size-3" />
                </TooltipTrigger>
                <TooltipPopup>Close {tab.label}</TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        ))}
      </div>
      {hasOverflow ? (
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Open tab picker" />}
          >
            <ChevronDownIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup>
            {tabs.map((tab) => (
              <MenuItem
                key={tab.id}
                disabled={!tab.available}
                onClick={() => props.onSelect(tab.id)}
              >
                {tab.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : null}
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open content" />}>
          <PlusIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem onClick={props.onNewBrowser}>New browser tab</MenuItem>
          <MenuItem onClick={props.onFiles}>Open file</MenuItem>
          <MenuItem onClick={props.onViews}>Generated views</MenuItem>
          <MenuItem onClick={props.onDevice}>Device</MenuItem>
        </MenuPopup>
      </Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={props.split ? "Collapse Chat" : "Show Chat alongside"}
              disabled={props.workspace.selected === "chat" && !props.workspace.lastContent}
              onClick={props.onSplit}
            />
          }
        >
          <Columns2Icon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup>
          {props.split ? "Collapse Chat" : "Show Chat alongside"}
          {props.splitShortcut ? ` (${props.splitShortcut})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
