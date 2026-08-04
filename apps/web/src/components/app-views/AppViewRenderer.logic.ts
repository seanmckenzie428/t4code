import type { AppViewBinding, NativeAppViewNode } from "@t3tools/contracts";

export type AppViewDataSources = Partial<
  Record<AppViewBinding["source"], Readonly<Record<string, unknown>>>
>;

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function readAppViewPath(root: unknown, path: string): unknown {
  if (path === "$") return root;
  const segments = path
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function resolveAppViewNodeValue(
  node: NativeAppViewNode,
  dataSources: AppViewDataSources,
): unknown {
  const binding = node.bindings?.find(
    (entry) => entry.path === "value" || entry.path === "$.value",
  );
  if (!binding) return node.value;
  return readAppViewPath(dataSources[binding.source], binding.sourcePath);
}

export function appViewTable(value: unknown): {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
} {
  if (!Array.isArray(value)) return { columns: [], rows: [] };
  const rows = value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 20);
  return { columns, rows: rows.slice(0, 200) };
}

export function appViewChartValues(
  value: unknown,
): readonly { readonly label: string; readonly value: number; readonly percent: number }[] {
  if (!Array.isArray(value)) return [];
  const values = value.flatMap((entry, index) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      return [{ label: String(index + 1), value: entry }];
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)) return [];
    return [
      {
        label: typeof candidate.label === "string" ? candidate.label : String(index + 1),
        value: candidate.value,
      },
    ];
  });
  const maximum = Math.max(0, ...values.map((entry) => Math.abs(entry.value)));
  return values.slice(0, 100).map((entry) => ({
    ...entry,
    percent: maximum === 0 ? 0 : Math.min(100, (Math.abs(entry.value) / maximum) * 100),
  }));
}
