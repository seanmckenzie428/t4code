import type { AppViewManifest, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ExternalLink, FolderGit2, Pin, PinOff, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { selectPersonalAppViews, selectThreadAppViews, useAppViewStore } from "~/appViewStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { useMainViewStore } from "~/mainViewStore";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { toastManager } from "~/components/ui/toast";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  generatedViewDeleteConfirmation,
  generatedViewLibraryEntries,
  projectAppViewSaveInput,
} from "./GeneratedViewLibrary.logic";

function useSaveProjectAppView(ref: ScopedThreadRef, projectId: ProjectId | null) {
  const runSave = useAtomCommand(projectEnvironment.saveAppView, { reportFailure: false });
  const [savingViewId, setSavingViewId] = useState<string | null>(null);

  const save = async (manifest: AppViewManifest) => {
    if (!projectId || savingViewId !== null) return;
    setSavingViewId(manifest.id);
    const result = await runSave({
      environmentId: ref.environmentId,
      input: projectAppViewSaveInput(projectId, manifest),
    });
    setSavingViewId(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not save generated view",
        description: error instanceof Error ? error.message : "t3.json could not be updated.",
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: result.value.change === "created" ? "Saved to project" : "Project view updated",
      description: "t3.json changed. Review the tracked change in Changes.",
    });
    useMainViewStore.getState().select(ref, "review");
  };

  return { save, savingViewId };
}

export function GeneratedViewToolbar(props: {
  ref: ScopedThreadRef;
  manifest: AppViewManifest;
  projectId: ProjectId | null;
  onManage: () => void;
}) {
  const isPersonal = useAppViewStore(
    (state) =>
      props.manifest.id in (state.personalByEnvironment[String(props.ref.environmentId)] ?? {}),
  );
  const pinPersonal = useAppViewStore((state) => state.pinPersonal);
  const unpinPersonal = useAppViewStore((state) => state.unpinPersonal);
  const projectSave = useSaveProjectAppView(props.ref, props.projectId);

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span className="text-xs text-muted-foreground">Generated view</span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (isPersonal) unpinPersonal(props.ref, props.manifest.id);
            else pinPersonal(props.ref, props.manifest.id);
          }}
          title={
            isPersonal
              ? "Remove the copy saved for you in this T3 environment"
              : "Keep a personal copy available across project threads"
          }
        >
          {isPersonal ? <PinOff /> : <Pin />}
          {isPersonal ? "Remove personal save" : "Save personally"}
        </Button>
        {props.projectId ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={projectSave.savingViewId !== null}
            onClick={() => void projectSave.save(props.manifest)}
            title="Write or update this generated view in the project's tracked t3.json"
          >
            <FolderGit2 />
            {projectSave.savingViewId === props.manifest.id ? "Saving…" : "Save to project"}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={props.onManage}>
          Manage
        </Button>
      </div>
    </div>
  );
}

export function GeneratedViewLibrary(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ref: ScopedThreadRef;
  projectId: ProjectId | null;
}) {
  const threadViews = useAppViewStore(
    (state) => selectThreadAppViews(state.byThreadKey, props.ref).manifests,
  );
  const personalViews = useAppViewStore((state) =>
    selectPersonalAppViews(state.personalByEnvironment, props.ref.environmentId),
  );
  const pinPersonal = useAppViewStore((state) => state.pinPersonal);
  const unpinPersonal = useAppViewStore((state) => state.unpinPersonal);
  const openPersonal = useAppViewStore((state) => state.openPersonal);
  const projectSave = useSaveProjectAppView(props.ref, props.projectId);
  const removeView = useAppViewStore((state) => state.remove);
  const rightPanel = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, props.ref),
  );
  const openViewIds = useMemo(
    () =>
      new Set(
        rightPanel.surfaces.flatMap((surface) =>
          surface.kind === "app-view" ? [surface.viewId] : [],
        ),
      ),
    [rightPanel.surfaces],
  );
  const entries = useMemo(
    () => generatedViewLibraryEntries({ threadViews, personalViews, openViewIds }),
    [openViewIds, personalViews, threadViews],
  );
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generated views</DialogTitle>
          <DialogDescription>
            Reopen closed views, save a personal copy across threads, or save a shared view to the
            project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">Available views</h3>
              <p className="text-xs text-muted-foreground">
                Closing a view keeps it here until the thread is deleted.
              </p>
            </div>
            {entries.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No generated views yet. Ask the agent to present one, then manage it here.
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-lg border border-border">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{entry.manifest.title}</div>
                      <div className="mt-1 flex gap-1">
                        <Badge variant={entry.isOpen ? "success" : "secondary"}>
                          {entry.isOpen ? "Open" : "Closed"}
                        </Badge>
                        {entry.isPersonal ? <Badge variant="info">Saved personally</Badge> : null}
                      </div>
                    </div>
                    {entry.isOpen ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          useRightPanelStore
                            .getState()
                            .closeSurface(props.ref, `app-view:${entry.id}`)
                        }
                      >
                        Close
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (entry.isThreadView)
                            useRightPanelStore.getState().openAppView(props.ref, entry.id);
                          else openPersonal(props.ref, entry.id);
                          props.onOpenChange(false);
                        }}
                      >
                        <ExternalLink /> Open
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        entry.isPersonal
                          ? unpinPersonal(props.ref, entry.id)
                          : pinPersonal(props.ref, entry.id)
                      }
                      disabled={!entry.isThreadView && !entry.isPersonal}
                      title={
                        entry.isPersonal
                          ? "Remove the copy saved for you in this T3 environment"
                          : "Keep a personal copy available across project threads"
                      }
                    >
                      {entry.isPersonal ? <PinOff /> : <Pin />}
                      {entry.isPersonal ? "Remove personal save" : "Save personally"}
                    </Button>
                    {props.projectId && entry.isThreadView ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={projectSave.savingViewId !== null}
                        onClick={() => void projectSave.save(entry.manifest)}
                        title="Write or update this generated view in the project's tracked t3.json"
                      >
                        <FolderGit2 />
                        {projectSave.savingViewId === entry.id ? "Saving…" : "Save to project"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        const confirmed = window.confirm(
                          generatedViewDeleteConfirmation({
                            title: entry.manifest.title,
                            isThreadView: entry.isThreadView,
                            isPersonal: entry.isPersonal,
                            hasProjectProposal: false,
                          }),
                        );
                        if (!confirmed) return;
                        removeView(props.ref, entry.id);
                        toastManager.add({
                          type: "success",
                          title: `Deleted ${entry.manifest.title}`,
                        });
                      }}
                    >
                      <Trash2 /> Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
