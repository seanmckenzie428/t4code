import type { ReactNode } from "react";

import { useActiveEnvironmentId } from "../state/entities";
import { QuickChatPopup } from "./QuickChatPopup";

export function QuickChatLayout({ children }: { children: ReactNode }) {
  const environmentId = useActiveEnvironmentId();
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1">{children}</div>
      {environmentId !== null ? <QuickChatPopup environmentId={environmentId} /> : null}
    </div>
  );
}
