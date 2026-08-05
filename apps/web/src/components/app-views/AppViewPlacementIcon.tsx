import type { AppViewPlacementIcon as AppViewPlacementIconId } from "@t3tools/contracts";
import {
  DatabaseIcon,
  FileDiffIcon,
  FilesIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LinkIcon,
  ServerIcon,
  SparklesIcon,
  SquareTerminalIcon,
} from "lucide-react";

export function AppViewPlacementIcon(props: {
  readonly icon: AppViewPlacementIconId | undefined;
  readonly className?: string;
}) {
  const className = props.className ?? "size-4";
  if (props.icon === "dashboard") return <LayoutDashboardIcon className={className} />;
  if (props.icon === "globe") return <GlobeIcon className={className} />;
  if (props.icon === "terminal") return <SquareTerminalIcon className={className} />;
  if (props.icon === "files") return <FilesIcon className={className} />;
  if (props.icon === "diff") return <FileDiffIcon className={className} />;
  if (props.icon === "database") return <DatabaseIcon className={className} />;
  if (props.icon === "server") return <ServerIcon className={className} />;
  if (props.icon === "link") return <LinkIcon className={className} />;
  return <SparklesIcon className={className} />;
}
