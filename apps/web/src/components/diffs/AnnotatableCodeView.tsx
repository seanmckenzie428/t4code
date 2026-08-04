import type {
  AnnotationSide,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  FileContents,
  SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle, type CodeViewProps } from "@pierre/diffs/react";
import { EditProvider } from "@pierre/diffs/react";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, LoaderCircleIcon, PencilIcon, XIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { fnv1a32 } from "~/lib/diffRendering";
import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

import { LocalCommentAnnotation } from "../files/LocalCommentAnnotation";
import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;
export type AnnotatableCodeViewHandle = CodeViewHandle<DiffCommentAnnotationGroup>;
const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

interface AnnotatableCodeViewProps {
  files: ReadonlyArray<{
    fileDiff: FileDiffMetadata;
    filePath: string;
    fileKey: string;
    collapsed: boolean;
    editable?: boolean;
  }>;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  options: NonNullable<CodeViewProps<DiffCommentAnnotationGroup>["options"]>;
  viewerRef?: Ref<AnnotatableCodeViewHandle>;
  className?: string;
  renderHeaderPrefix: (
    fileDiff: FileDiffMetadata,
    fileKey: string,
    collapsed: boolean,
  ) => ReactNode;
  renderHeaderMetadata?: (fileDiff: FileDiffMetadata, fileKey: string) => ReactNode;
  editable?: boolean;
  onSaveFile?: (filePath: string, contents: string) => Promise<void>;
}

interface DiffSelectionContext {
  item: CodeViewItem<DiffCommentAnnotationGroup>;
}

export function AnnotatableCodeView({
  files,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  options,
  viewerRef,
  className,
  renderHeaderPrefix,
  renderHeaderMetadata,
  editable = false,
  onSaveFile,
}: AnnotatableCodeViewProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<{
    fileKey: string;
    annotation: DiffCommentLineAnnotation;
  } | null>(null);
  const [activeEdit, setActiveEdit] = useState<{
    fileKey: string;
    fileDiff: FileDiffMetadata;
    dirty: boolean;
    saving: boolean;
    version: number;
  } | null>(null);
  const latestEditFileRef = useRef<FileContents | null>(null);

  const filesByKey = useMemo(() => new Map(files.map((file) => [file.fileKey, file])), [files]);
  const items = useMemo<CodeViewDiffItem<DiffCommentAnnotationGroup>[]>(
    () =>
      files.map(({ fileDiff, filePath, fileKey, collapsed }) => {
        const persisted = reviewComments
          .filter(
            (comment) =>
              comment.sectionId === sectionId &&
              comment.filePath === filePath &&
              (comment.fenceLanguage ?? "diff") === "diff",
          )
          .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
            const range = restoreDiffReviewCommentRange(fileDiff, comment);
            if (!range) return annotations;
            return appendAnnotationEntry(annotations, range, {
              id: comment.id,
              kind: "comment",
              range,
              rangeLabel: comment.rangeLabel,
              text: comment.text,
            });
          }, []);
        const annotations =
          draft?.fileKey === fileKey ? [...persisted, draft.annotation] : persisted;
        return {
          id: fileKey,
          type: "diff",
          fileDiff: activeEdit?.fileKey === fileKey ? activeEdit.fileDiff : fileDiff,
          annotations,
          collapsed,
          edit: activeEdit?.fileKey === fileKey,
          version: fnv1a32(
            `${collapsed ? "1" : "0"}:${activeEdit?.fileKey === fileKey ? activeEdit.version : 0}:${annotations
              .flatMap((annotation) =>
                annotation.metadata.entries.map(
                  (entry) => `${entry.id}:${entry.rangeLabel}:${entry.text}`,
                ),
              )
              .join(":")}`,
          ),
        };
      }),
    [activeEdit, draft, files, reviewComments, sectionId],
  );

  const beginEdit = useCallback((fileKey: string, fileDiff: FileDiffMetadata) => {
    setDraft(null);
    setSelectedLines(null);
    latestEditFileRef.current = null;
    setActiveEdit({
      fileKey,
      fileDiff: structuredClone(fileDiff),
      dirty: false,
      saving: false,
      version: Date.now(),
    });
  }, []);

  const cancelEdit = useCallback(() => {
    latestEditFileRef.current = null;
    setActiveEdit(null);
  }, []);

  const saveEdit = useCallback(async () => {
    const latestFile = latestEditFileRef.current;
    if (!activeEdit || !latestFile || !onSaveFile) return;
    setActiveEdit((current) => (current ? { ...current, saving: true } : current));
    try {
      const file = filesByKey.get(activeEdit.fileKey);
      if (!file) return;
      await onSaveFile(file.filePath, latestFile.contents);
      latestEditFileRef.current = null;
      setActiveEdit(null);
      toastManager.add({ title: `Saved ${file.filePath}`, type: "success" });
    } catch (error) {
      setActiveEdit((current) => (current ? { ...current, saving: false } : current));
      toastManager.add({
        title: "Could not save diff edit",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    }
  }, [activeEdit, filesByKey, onSaveFile]);

  const removeEntry = useCallback(
    (entryId: string) => {
      setSelectedLines(null);
      if (draft?.annotation.metadata.entries.some((entry) => entry.id === entryId)) {
        setDraft(null);
      } else {
        removeReviewComment(composerDraftTarget, entryId);
      }
    },
    [composerDraftTarget, draft, removeReviewComment],
  );

  const submitEntry = useCallback(
    (entryId: string, text: string) => {
      const entry = draft?.annotation.metadata.entries.find(
        (candidate) => candidate.id === entryId,
      );
      const file = draft ? filesByKey.get(draft.fileKey) : undefined;
      if (!entry || !file) return;
      const comment = buildDiffReviewComment({
        id: entry.id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range: entry.range,
        text,
      });
      if (comment) addReviewComment(composerDraftTarget, comment);
      setSelectedLines(null);
      setDraft(null);
    },
    [addReviewComment, composerDraftTarget, draft, filesByKey, sectionId, sectionTitle],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null, context: DiffSelectionContext) => {
      if (!range) return;
      const item = context.item;
      if (item.type !== "diff") return;
      const file = filesByKey.get(item.id);
      if (!file) return;
      const id = nextFileCommentId();
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range,
        text: "",
      });
      if (!comment) return;
      setDraft({
        fileKey: item.id,
        annotation: {
          side: annotationSide(range),
          lineNumber: range.end,
          metadata: {
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        },
      });
    },
    [filesByKey, sectionId, sectionTitle],
  );

  const selectCommentRange = useCallback(
    (range: SelectedLineRange, context: DiffSelectionContext) => {
      setSelectedLines({ id: context.item.id, range });
    },
    [],
  );

  const hasOpenComment = draft !== null;
  const hasActiveEdit = activeEdit !== null;
  const createEditor = useCallback(
    (editorOptions: EditorOptions<DiffCommentAnnotationGroup>) =>
      new Editor<DiffCommentAnnotationGroup>(editorOptions),
    [],
  );
  const codeView = (
    <CodeView<DiffCommentAnnotationGroup>
      {...(viewerRef ? { ref: viewerRef } : {})}
      {...(className ? { className } : {})}
      items={items}
      selectedLines={selectedLines}
      onSelectedLinesChange={setSelectedLines}
      editorOptions={{ persistState: false }}
      onItemEditChange={(item, file) => {
        latestEditFileRef.current = file;
        setActiveEdit((current) =>
          current?.fileKey === item.id && !current.dirty ? { ...current, dirty: true } : current,
        );
      }}
      options={{
        ...options,
        enableGutterUtility: !hasOpenComment && !hasActiveEdit,
        enableLineSelection: !hasOpenComment && !hasActiveEdit,
        onGutterUtilityClick: selectCommentRange,
        onLineSelectionEnd: beginComment,
      }}
      renderHeaderPrefix={(item) =>
        item.type === "diff"
          ? renderHeaderPrefix(item.fileDiff, item.id, item.collapsed === true)
          : null
      }
      renderHeaderMetadata={(item) => {
        if (item.type !== "diff") return null;
        const isEditing = activeEdit?.fileKey === item.id;
        const anotherFileIsEditing = activeEdit !== null && !isEditing;
        return (
          <div className="flex items-center">
            {renderHeaderMetadata?.(item.fileDiff, item.id)}
            {editable && onSaveFile && filesByKey.get(item.id)?.editable === true && (
              <div className="ml-1 flex items-center gap-0.5 font-sans">
                {isEditing ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Cancel diff edit"
                      disabled={activeEdit.saving}
                      onClick={(event) => {
                        event.stopPropagation();
                        cancelEdit();
                      }}
                    >
                      <XIcon className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label="Save diff edit"
                      disabled={!activeEdit.dirty || activeEdit.saving}
                      onClick={(event) => {
                        event.stopPropagation();
                        void saveEdit();
                      }}
                    >
                      {activeEdit.saving ? (
                        <LoaderCircleIcon className="size-3 animate-spin" />
                      ) : (
                        <CheckIcon className="size-3" />
                      )}
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`Edit ${item.fileDiff.name}`}
                    disabled={anotherFileIsEditing || item.collapsed === true}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginEdit(item.id, item.fileDiff);
                    }}
                  >
                    <PencilIcon className="size-3" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      }}
      renderAnnotation={(annotation) => (
        <div className="py-1">
          {annotation.metadata.entries.map((entry) => (
            <LocalCommentAnnotation
              key={entry.id}
              kind={entry.kind}
              rangeLabel={entry.rangeLabel}
              text={entry.text}
              onCancel={() => removeEntry(entry.id)}
              onComment={(text) => submitEntry(entry.id, text)}
              onDelete={() => removeEntry(entry.id)}
            />
          ))}
        </div>
      )}
    />
  );
  return editable ? <EditProvider createEditor={createEditor}>{codeView}</EditProvider> : codeView;
}
