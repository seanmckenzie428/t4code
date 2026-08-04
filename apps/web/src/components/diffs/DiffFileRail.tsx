import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeRowDecoration, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { CheckCircle2Icon, ListIcon, ListTreeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";

import type { DiffFileReviewState } from "../../lib/diffCollapse";
import { getDiffCollapseIconClassName } from "../../lib/diffRendering";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

export interface DiffFileRailEntry {
  readonly fileDiff: FileDiffMetadata;
  readonly fileKey: string;
  readonly filePath: string;
  readonly reviewState: DiffFileReviewState;
}

interface DiffFileRailProps {
  readonly files: ReadonlyArray<DiffFileRailEntry>;
  readonly onReveal: (fileKey: string) => void;
  readonly onToggleViewed: (filePath: string, viewed: boolean) => void;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 11px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

export function reviewFileGitStatus(fileDiff: FileDiffMetadata): GitStatusEntry["status"] {
  switch (fileDiff.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
    default:
      return "modified";
  }
}

export function reviewFileDecoration(
  reviewState: DiffFileReviewState | undefined,
): FileTreeRowDecoration | null {
  if (reviewState === "changed") {
    return { text: "Changed", title: "Changed since you last viewed this file" };
  }
  if (reviewState === "viewed") {
    return { text: "Viewed", title: "Viewed" };
  }
  return null;
}

function DiffFileTree(props: DiffFileRailProps) {
  const { resolvedTheme } = useTheme();
  const filesByPath = useMemo(
    () => new Map(props.files.map((file) => [file.filePath, file])),
    [props.files],
  );
  const filesByPathRef = useRef(filesByPath);
  filesByPathRef.current = filesByPath;
  const pathSignature = props.files.map((file) => file.filePath).join("\0");
  const paths = useMemo(
    () => (pathSignature.length === 0 ? [] : pathSignature.split("\0")),
    [pathSignature],
  );
  const gitStatus = useMemo<GitStatusEntry[]>(
    () =>
      props.files.map((file) => ({
        path: file.filePath,
        status: reviewFileGitStatus(file.fileDiff),
      })),
    [props.files],
  );
  const onRevealRef = useRef(props.onReveal);
  onRevealRef.current = props.onReveal;
  const { model } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: true,
    gitStatus,
    icons: T3_PIERRE_ICONS,
    initialExpansion: "open",
    onSelectionChange: (selectedPaths) => {
      const file = filesByPathRef.current.get(selectedPaths.at(-1) ?? "");
      if (file) onRevealRef.current(file.fileKey);
    },
    paths: [],
    renderRowDecoration: ({ item }) =>
      reviewFileDecoration(filesByPathRef.current.get(item.path)?.reviewState),
    search: false,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);

  return (
    <FileTree
      model={model}
      aria-label="Changed files tree"
      className="min-h-0 flex-1 overflow-hidden"
      style={{
        colorScheme: resolvedTheme,
        ["--trees-fg-override" as string]: "var(--foreground)",
      }}
    />
  );
}

export function DiffFileRail(props: DiffFileRailProps) {
  const [mode, setMode] = useState<"tree" | "flat">("tree");
  const viewedCount = props.files.filter((file) => file.reviewState === "viewed").length;

  return (
    <aside
      className="hidden w-56 shrink-0 flex-col border-l border-border/70 bg-card/25 @min-[480px]:flex"
      aria-label="Changed files"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/70 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="min-w-0 flex-1 truncate">Changed files</span>
        <span className="tabular-nums">
          {viewedCount}/{props.files.length}
        </span>
        <ToggleGroup
          variant="ghost"
          size="xs"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "tree" || next === "flat") setMode(next);
          }}
        >
          <Toggle aria-label="Tree file list" value="tree">
            <ListTreeIcon className="size-3" />
          </Toggle>
          <Toggle aria-label="Flat file list" value="flat">
            <ListIcon className="size-3" />
          </Toggle>
        </ToggleGroup>
      </div>
      {mode === "tree" ? (
        <DiffFileTree {...props} />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {props.files.map(({ fileDiff, filePath, fileKey, reviewState }) => {
            const viewed = reviewState === "viewed";
            return (
              <div
                key={fileKey}
                className={cn(
                  "group flex min-w-0 items-center rounded-md text-xs hover:bg-muted/70",
                  viewed && "text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={filePath}
                  onClick={() => props.onReveal(fileKey)}
                >
                  {filePath}
                </button>
                {reviewState === "changed" && (
                  <span className="shrink-0 text-[9px] font-medium text-amber-500">Changed</span>
                )}
                <button
                  type="button"
                  className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-70 outline-none transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={viewed ? `Mark ${filePath} unviewed` : `Mark ${filePath} viewed`}
                  aria-pressed={viewed}
                  onClick={() => props.onToggleViewed(filePath, !viewed)}
                >
                  <CheckCircle2Icon
                    className={cn(
                      "size-3.5",
                      viewed && "fill-primary/20 text-primary",
                      !viewed && getDiffCollapseIconClassName(fileDiff),
                    )}
                  />
                </button>
              </div>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
