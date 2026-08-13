import type { PreviewAutomationHighlightCallout } from "@t3tools/contracts";

export const PREVIEW_HIGHLIGHT_GLOBAL = "__t4CodePreviewHighlightOverlayV1";

const HIGHLIGHT_COLORS = {
  blue: { solid: "#3b82f6", fill: "rgb(59 130 246 / 16%)" },
  cyan: { solid: "#06b6d4", fill: "rgb(6 182 212 / 16%)" },
  green: { solid: "#22c55e", fill: "rgb(34 197 94 / 16%)" },
  amber: { solid: "#f59e0b", fill: "rgb(245 158 11 / 16%)" },
  red: { solid: "#ef4444", fill: "rgb(239 68 68 / 16%)" },
  purple: { solid: "#a855f7", fill: "rgb(168 85 247 / 16%)" },
  pink: { solid: "#ec4899", fill: "rgb(236 72 153 / 16%)" },
} as const;

const DEFAULT_HIGHLIGHT_COLORS = Object.keys(HIGHLIGHT_COLORS) as ReadonlyArray<
  keyof typeof HIGHLIGHT_COLORS
>;

export interface PreviewHighlightExpressionInput {
  readonly mode: "apply" | "update";
  readonly highlightId: string;
  readonly callouts: ReadonlyArray<PreviewAutomationHighlightCallout>;
  readonly scrollTo?: number;
}

export const buildPreviewHighlightExpression = (input: PreviewHighlightExpressionInput): string => {
  const payload = JSON.stringify({
    ...input,
    callouts: input.callouts.map((callout, index) => ({
      ...callout,
      color: callout.color ?? DEFAULT_HIGHLIGHT_COLORS[index % DEFAULT_HIGHLIGHT_COLORS.length],
    })),
    colors: HIGHLIGHT_COLORS,
    globalName: PREVIEW_HIGHLIGHT_GLOBAL,
  });
  return `(async () => {
    const payload = ${payload};
    const current = globalThis[payload.globalName];
    if (payload.mode === "update" && current?.id !== payload.highlightId) {
      return { staleHighlight: true };
    }
    const injected = globalThis.__t3PlaywrightInjected;
    const targets = [];
    for (let index = 0; index < payload.callouts.length; index += 1) {
      try {
        const parsed = injected.parseSelector(payload.callouts[index].locator);
        const element = injected.querySelector(parsed, document, true);
        if (!element) return { notFound: index };
        targets.push(element);
      } catch (error) {
        return { invalidSelector: index, message: String(error) };
      }
    }
    if (payload.scrollTo !== undefined) {
      targets[payload.scrollTo - 1].scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }
    if (typeof current?.cleanup === "function") current.cleanup();

    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("popover", "manual");
    host.inert = true;
    host.style.cssText = "all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important";
    const shadow = host.attachShadow({ mode: "closed" });
    const layer = document.createElement("div");
    Object.assign(layer.style, {
      all: "initial",
      position: "fixed",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "2147483647",
      contain: "strict",
      fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    });
    shadow.append(layer);

    const visuals = payload.callouts.map((callout, index) => {
      const color = payload.colors[callout.color];
      const outline = document.createElement("div");
      const badge = document.createElement("div");
      const panel = document.createElement("div");
      Object.assign(outline.style, {
        position: "fixed",
        boxSizing: "border-box",
        border: "2px solid " + color.solid,
        borderRadius: "8px",
        background: color.fill,
        boxShadow: "0 0 0 2px rgb(255 255 255 / 85%), 0 8px 30px rgb(0 0 0 / 18%)",
        pointerEvents: "none",
      });
      badge.textContent = String(index + 1);
      Object.assign(badge.style, {
        position: "fixed",
        boxSizing: "border-box",
        display: "grid",
        placeItems: "center",
        width: "24px",
        height: "24px",
        borderRadius: "999px",
        background: color.solid,
        color: "white",
        border: "2px solid white",
        boxShadow: "0 2px 8px rgb(0 0 0 / 30%)",
        font: "700 12px/1 ui-sans-serif, system-ui, sans-serif",
        pointerEvents: "none",
      });
      Object.assign(panel.style, {
        position: "fixed",
        boxSizing: "border-box",
        display: callout.title || callout.explanation ? "block" : "none",
        width: "min(300px, calc(100vw - 24px))",
        padding: "10px 12px",
        border: "1px solid rgb(255 255 255 / 20%)",
        borderLeft: "4px solid " + color.solid,
        borderRadius: "9px",
        background: "rgb(17 24 39 / 94%)",
        color: "white",
        boxShadow: "0 10px 30px rgb(0 0 0 / 28%)",
        pointerEvents: "none",
        font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
      });
      if (callout.title) {
        const title = document.createElement("div");
        title.textContent = callout.title;
        Object.assign(title.style, { fontWeight: "700", marginBottom: callout.explanation ? "4px" : "0" });
        panel.append(title);
      }
      if (callout.explanation) {
        const explanation = document.createElement("div");
        explanation.textContent = callout.explanation;
        Object.assign(explanation.style, { color: "rgb(229 231 235)", whiteSpace: "pre-wrap" });
        panel.append(explanation);
      }
      layer.append(outline, badge, panel);
      return { outline, badge, panel };
    });

    let frame = 0;
    const render = () => {
      frame = 0;
      targets.forEach((target, index) => {
        const rect = target.getBoundingClientRect();
        const visual = visuals[index];
        const visible = target.isConnected && rect.width > 0 && rect.height > 0;
        visual.outline.style.display = visible ? "block" : "none";
        visual.badge.style.display = visible ? "grid" : "none";
        if (!visible) {
          visual.panel.style.display = "none";
          return;
        }
        Object.assign(visual.outline.style, {
          left: rect.left + "px",
          top: rect.top + "px",
          width: rect.width + "px",
          height: rect.height + "px",
        });
        Object.assign(visual.badge.style, {
          left: Math.max(4, rect.left - 12) + "px",
          top: Math.max(4, rect.top - 12) + "px",
        });
        if (payload.callouts[index].title || payload.callouts[index].explanation) {
          visual.panel.style.display = "block";
          const panelWidth = Math.min(300, window.innerWidth - 24);
          const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - panelWidth - 12));
          const top = rect.bottom + 10 + 120 <= window.innerHeight
            ? rect.bottom + 10
            : Math.max(12, rect.top - visual.panel.offsetHeight - 10);
          Object.assign(visual.panel.style, { left: left + "px", top: top + "px" });
        }
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const resizeObserver = new ResizeObserver(schedule);
    targets.forEach((target) => resizeObserver.observe(target));
    resizeObserver.observe(document.documentElement);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      host.remove();
      if (globalThis[payload.globalName]?.id === payload.highlightId) {
        delete globalThis[payload.globalName];
      }
    };
    globalThis[payload.globalName] = { id: payload.highlightId, cleanup };
    document.documentElement.append(host);
    try { host.showPopover(); } catch {}
    render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    render();
    return { ok: true, count: targets.length };
  })()`;
};

export const buildPreviewHighlightClearExpression = (highlightId: string): string =>
  `(() => {
    const current = globalThis[${JSON.stringify(PREVIEW_HIGHLIGHT_GLOBAL)}];
    if (!current || current.id !== ${JSON.stringify(highlightId)}) return { cleared: false };
    if (typeof current.cleanup !== "function") return { cleared: false };
    current.cleanup();
    return { cleared: true };
  })()`;
