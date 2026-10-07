import { ChevronLeftIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function DesktopChatDivider({
  width,
  onResize,
  onCollapse,
  collapseShortcut,
}: {
  width: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
  collapseShortcut: string | null;
}) {
  return (
    <div className="relative z-40 w-1 shrink-0">
      <div
        role="separator"
        aria-label="Chat width"
        aria-orientation="vertical"
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className="h-full cursor-col-resize bg-border/60 hover:bg-primary/40 focus:bg-primary/40"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          onResize(width + (event.key === "ArrowLeft" ? -24 : 24));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const container = event.currentTarget.parentElement?.parentElement;
          if (!container) return;
          const next = Math.max(
            280,
            Math.min(
              container.clientWidth - 360,
              event.clientX - container.getBoundingClientRect().left,
            ),
          );
          container.style.setProperty("--desktop-chat-width", `${next}px`);
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          const value = Number.parseFloat(
            event.currentTarget.parentElement?.parentElement?.style.getPropertyValue(
              "--desktop-chat-width",
            ) ?? "",
          );
          if (Number.isFinite(value)) onResize(value);
        }}
      />
      <div className="absolute top-1/2 right-0 -translate-y-1/2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-xs"
                aria-label="Collapse Chat"
                onClick={onCollapse}
              />
            }
          >
            <ChevronLeftIcon />
          </TooltipTrigger>
          <TooltipPopup>
            Collapse Chat{collapseShortcut ? ` (${collapseShortcut})` : ""}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}
