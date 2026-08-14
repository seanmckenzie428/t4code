const VISUALIZE_DIRECTIVE_PATTERN = /\uE200visualize\uE202(\{[^\n\uE201]*\})\uE201/g;

/**
 * T4 does not host Codex's private visualization transport. Omit its complete,
 * valid directives instead of presenting their transport syntax as chat text.
 */
export function stripUnsupportedAssistantDirectives(text: string): string {
  return text.replace(VISUALIZE_DIRECTIVE_PATTERN, (directive, serialized) => {
    try {
      const payload: unknown = JSON.parse(serialized);
      if (
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { path?: unknown }).path === "string"
      ) {
        return "";
      }
    } catch {
      // Keep malformed directives visible: they may be intentional user content.
    }
    return directive;
  });
}
