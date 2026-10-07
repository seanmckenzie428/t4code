import type { ScopedThreadRef } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";

export function DesktopReplyCard({
  text,
  cwd,
  threadRef,
  onOpen,
  onDismiss,
}: {
  text: string;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="Latest reply"
      className="mb-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg"
    >
      <div className="max-h-36 overflow-hidden text-sm">
        <ChatMarkdown text={text} cwd={cwd} threadRef={threadRef} />
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={onOpen}>
          Open Chat
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss reply" onClick={onDismiss}>
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}
