import type { EnvironmentId } from "@t3tools/contracts";
import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { FolderIcon } from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import type { ComponentType } from "react";
import { useState } from "react";
import { useAssetUrlState } from "../assets/assetUrls";
import { cn } from "~/lib/utils";
import { derivePhysicalProjectKeyFromPath } from "../logicalProject";
import { useProjectAppearanceStore } from "../projectAppearanceStore";

const loadedProjectFaviconSrcs = new Map<string, string>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  faviconPath?: string | null | undefined;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const appearance = useProjectAppearanceStore(
    (state) => state.byKey[derivePhysicalProjectKeyFromPath(input.environmentId, input.cwd)],
  );
  const state = useProjectFaviconAsset(input);
  const src = state._tag === "Success" ? state.url : null;
  const FallbackIcon = input.fallbackIcon ?? FolderIcon;

  if (appearance?.icon?.type === "image") {
    return (
      <img
        src={appearance.icon.dataUrl}
        alt=""
        className={cn("size-3.5 shrink-0 rounded-sm object-cover", input.className)}
      />
    );
  }

  if (appearance?.icon?.type === "lucide" && iconNames.includes(appearance.icon.name as IconName)) {
    return (
      <DynamicIcon
        name={appearance.icon.name as IconName}
        className={cn("size-3.5 shrink-0 text-muted-foreground", input.className)}
      />
    );
  }

  if (!src || isProjectFaviconFallbackUrl(src)) {
    return <ProjectFaviconFallback className={input.className} icon={FallbackIcon} />;
  }

  const cacheKey = getProjectFaviconCacheKey(input.environmentId, input.cwd, src);

  return (
    <ProjectFaviconImage
      key={cacheKey}
      cacheKey={cacheKey}
      src={src}
      className={input.className}
      fallbackIcon={FallbackIcon}
    />
  );
}

export function useProjectFaviconAsset(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}) {
  return useAssetUrlState(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
    ...(input.faviconPath ? { path: input.faviconPath } : {}),
  });
}

function ProjectFaviconFallback({
  className,
  icon: Icon,
}: {
  readonly className?: string | undefined;
  readonly icon: ComponentType<{ className?: string }>;
}) {
  return <Icon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
}

function ProjectFaviconImage({
  cacheKey,
  src,
  className,
  fallbackIcon: FallbackIcon,
}: {
  readonly cacheKey: string;
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon: ComponentType<{ className?: string }>;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => loadedProjectFaviconSrcs.get(cacheKey) ?? null,
  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    if (loadedProjectFaviconSrcs.get(cacheKey) === failedSrc) {
      loadedProjectFaviconSrcs.delete(cacheKey);
    }
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? (
        <ProjectFaviconFallback className={className} icon={FallbackIcon} />
      ) : null}
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
            loadedProjectFaviconSrcs.set(cacheKey, src);
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
