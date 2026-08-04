import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffFontPreference, DiffThemePreference } from "@t3tools/contracts/settings";

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

const STATIC_DIFF_THEMES = {
  github: { light: "github-light", dark: "github-dark" },
  vitesse: { light: "vitesse-light", dark: "vitesse-dark" },
  solarized: { light: "solarized-light", dark: "solarized-dark" },
  "rose-pine": { light: "rose-pine-dawn", dark: "rose-pine" },
  catppuccin: { light: "catppuccin-latte", dark: "catppuccin-mocha" },
} as const;

export type DiffThemeName =
  | (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES]
  | (typeof STATIC_DIFF_THEMES)[keyof typeof STATIC_DIFF_THEMES]["light" | "dark"];

export interface ResolvedDiffTheme {
  readonly name: DiffThemeName;
  readonly type: "light" | "dark";
}

export const DIFF_THEME_OPTIONS: ReadonlyArray<{
  readonly value: DiffThemePreference;
  readonly label: string;
}> = [
  { value: "app", label: "Match app" },
  { value: "github", label: "GitHub" },
  { value: "vitesse", label: "Vitesse" },
  { value: "solarized", label: "Solarized" },
  { value: "rose-pine", label: "Rosé Pine" },
  { value: "catppuccin", label: "Catppuccin" },
];

export const DIFF_FONT_OPTIONS: ReadonlyArray<{
  readonly value: DiffFontPreference;
  readonly label: string;
}> = [
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "system-mono", label: "System monospace" },
  { value: "sf-mono", label: "SF Mono" },
  { value: "menlo", label: "Menlo" },
];

const DIFF_FONT_FAMILIES: Record<DiffFontPreference, string> = {
  "jetbrains-mono": '"JetBrains Mono Variable", "JetBrains Mono", monospace',
  "system-mono": "ui-monospace, SFMono-Regular, Consolas, monospace",
  "sf-mono": 'SFMono-Regular, "SF Mono", ui-monospace, monospace',
  menlo: 'Menlo, Monaco, "Courier New", monospace',
};

export function resolveDiffTheme(
  theme: "light" | "dark",
  preference: DiffThemePreference = "app",
): ResolvedDiffTheme {
  if (preference === "app") {
    return {
      name: theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light,
      type: theme,
    };
  }
  return {
    name: STATIC_DIFF_THEMES[preference][theme],
    type: theme,
  };
}

export function resolveDiffThemeName(
  theme: "light" | "dark",
  preference: DiffThemePreference = "app",
): DiffThemeName {
  return resolveDiffTheme(theme, preference).name;
}

export function resolveDiffFontFamily(preference: DiffFontPreference): string {
  return DIFF_FONT_FAMILIES[preference];
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}

export type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

export interface DiffLineStat {
  additions: number;
  deletions: number;
}

export function getDiffLineStat(files: ReadonlyArray<FileDiffMetadata>): DiffLineStat {
  return files.reduce<DiffLineStat>(
    (total, file) => {
      for (const hunk of file.hunks) {
        total.additions += hunk.additionLines;
        total.deletions += hunk.deletionLines;
      }

      return total;
    },
    { additions: 0, deletions: 0 },
  );
}

interface RenderablePatchOptions {
  /**
   * Pierre's partial-patch parser keeps hunk render starts in source-file
   * coordinates. Its virtualizer iterates partial patches as compact rows, so
   * review diffs need compact render starts while retaining collapsedBefore
   * for the "N unmodified lines" separator.
   */
  compactPartialHunkOffsets?: boolean;
}

export function compactPartialHunkOffsets(file: FileDiffMetadata): FileDiffMetadata {
  if (!file.isPartial) return file;

  let splitLineStart = 0;
  let unifiedLineStart = 0;
  const hunks = file.hunks.map((hunk) => {
    const compactHunk = {
      ...hunk,
      splitLineStart,
      unifiedLineStart,
    };
    splitLineStart += hunk.splitLineCount;
    unifiedLineStart += hunk.unifiedLineCount;
    return compactHunk;
  });

  return {
    ...file,
    hunks,
    splitLineCount: splitLineStart,
    unifiedLineCount: unifiedLineStart,
    ...(file.cacheKey ? { cacheKey: `${file.cacheKey}:compact-partial` } : {}),
  };
}

export function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
  options: RenderablePatchOptions = {},
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) =>
      options.compactPartialHunkOffsets
        ? parsedPatch.files.map(compactPartialHunkOffsets)
        : parsedPatch.files,
    );
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function buildFileReviewRevision(fileDiff: FileDiffMetadata): string {
  const serialized = JSON.stringify(fileDiff, (key, value) =>
    key === "cacheKey" ? undefined : value,
  );
  const primary = fnv1a32(serialized, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(serialized, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(
    36,
  );
  return `${serialized.length}:${primary}:${secondary}`;
}

export function getDiffCollapseIconClassName(fileDiff: FileDiffMetadata): string {
  switch (fileDiff.type) {
    case "new":
      return "text-[var(--diffs-addition-base)]";
    case "deleted":
      return "text-[var(--diffs-deletion-base)]";
    case "change":
    case "rename-pure":
    case "rename-changed":
      return "text-[var(--diffs-modified-base)]";
    default:
      return "text-muted-foreground/80";
  }
}
