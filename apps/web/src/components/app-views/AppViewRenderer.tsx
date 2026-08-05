import { isAppCommandId, type AppCommandId } from "@t3tools/client-runtime/app-control";
import type {
  AppViewAction,
  AppViewManifest,
  NativeAppViewManifest,
  NativeAppViewNode,
} from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

import {
  appViewChartValues,
  appViewTable,
  resolveAppViewNodeValue,
  type AppViewDataSources,
} from "./AppViewRenderer.logic";
import { SandboxedAppView } from "./SandboxedAppView";

export interface AppViewActionRequest {
  readonly commandId: AppCommandId;
  readonly args: unknown;
}

interface AppViewRendererProps {
  manifest: AppViewManifest;
  dataSources?: AppViewDataSources;
  onAction: (request: AppViewActionRequest) => void | Promise<void>;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

function NodeActions(props: {
  actions: readonly AppViewAction[] | undefined;
  inputs: Readonly<Record<string, unknown>>;
  onAction: AppViewRendererProps["onAction"];
}) {
  if (!props.actions?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {props.actions.map((action) => {
        const registered = isAppCommandId(action.commandId);
        return (
          <Button
            key={action.id}
            size="sm"
            variant="outline"
            disabled={!registered}
            title={registered ? undefined : "Command is not registered by this T3 client."}
            onClick={() => {
              if (!registered) return;
              const baseArgs =
                typeof action.args === "object" &&
                action.args !== null &&
                !Array.isArray(action.args)
                  ? action.args
                  : {};
              const args =
                Object.keys(props.inputs).length === 0
                  ? baseArgs
                  : { ...baseArgs, input: props.inputs };
              void props.onAction({
                commandId: action.commandId,
                args,
              });
            }}
          >
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}

function NodeInput(props: {
  node: NativeAppViewNode;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  const input = props.node.input;
  if (!input) return null;
  const stringValue = typeof props.value === "string" ? props.value : "";
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {input.kind !== "checkbox" ? input.label : null}
      {input.kind === "textarea" ? (
        <textarea
          className="min-h-24 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          value={stringValue}
          onChange={(event) => props.onChange(input.name, event.currentTarget.value)}
        />
      ) : input.kind === "select" ? (
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={stringValue}
          onChange={(event) => props.onChange(input.name, event.currentTarget.value)}
        >
          {input.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : input.kind === "checkbox" ? (
        <span className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={props.value === true}
            onChange={(event) => props.onChange(input.name, event.currentTarget.checked)}
          />
          {input.label}
        </span>
      ) : input.kind === "radio" ? (
        <span className="flex flex-wrap gap-3 text-sm text-foreground">
          {input.options?.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={input.name}
                value={option.value}
                checked={stringValue === option.value}
                onChange={(event) => props.onChange(input.name, event.currentTarget.value)}
              />
              {option.label}
            </label>
          ))}
        </span>
      ) : (
        <input
          type="text"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={stringValue}
          onChange={(event) => props.onChange(input.name, event.currentTarget.value)}
        />
      )}
    </label>
  );
}

function AppViewNodeRenderer(props: {
  node: NativeAppViewNode;
  dataSources: AppViewDataSources;
  inputs: Readonly<Record<string, unknown>>;
  onInputChange: (name: string, value: unknown) => void;
  onAction: AppViewRendererProps["onAction"];
}): ReactNode {
  const { node } = props;
  const value = resolveAppViewNodeValue(node, props.dataSources);
  const renderChildren = () =>
    node.children?.map((child) => <AppViewNodeRenderer key={child.id} {...props} node={child} />);
  let content: ReactNode;

  switch (node.type) {
    case "stack":
      content = <div className="flex flex-col gap-3">{renderChildren()}</div>;
      break;
    case "grid":
      content = (
        <div
          className={cn(
            "grid gap-3",
            node.columns === 1
              ? "grid-cols-1"
              : node.columns === 3
                ? "md:grid-cols-3"
                : "md:grid-cols-2",
          )}
        >
          {renderChildren()}
        </div>
      );
      break;
    case "tabs":
      content = <AppViewTabs nodes={node.children ?? []} {...props} />;
      break;
    case "section":
      content = (
        <section className="rounded-lg border border-border bg-card p-4">
          {renderChildren()}
        </section>
      );
      break;
    case "markdown":
      content = (
        <div className="prose prose-sm max-w-none text-foreground dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ children: linkChildren, href }) => (
                <span className="underline decoration-dotted" title={href}>
                  {linkChildren}
                </span>
              ),
            }}
          >
            {displayValue(value)}
          </ReactMarkdown>
        </div>
      );
      break;
    case "metric":
      content = <div className="text-2xl font-semibold tabular-nums">{displayValue(value)}</div>;
      break;
    case "badge":
      content = (
        <span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-medium">
          {displayValue(value)}
        </span>
      );
      break;
    case "key-value": {
      const entries =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? Object.entries(value).slice(0, 100)
          : [];
      content = (
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-sm">
          {entries.map(([key, entry]) => (
            <div key={key} className="contents">
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="break-words text-right">{displayValue(entry)}</dd>
            </div>
          ))}
        </dl>
      );
      break;
    }
    case "list":
      content = (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(Array.isArray(value) ? value : []).slice(0, 200).map((entry, index) => (
            <li key={index}>{displayValue(entry)}</li>
          ))}
        </ul>
      );
      break;
    case "table": {
      const table = appViewTable(value);
      content = (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60">
              <tr>
                {table.columns.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {table.columns.map((column) => (
                    <td key={column} className="max-w-64 truncate px-3 py-2">
                      {displayValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      break;
    }
    case "chart":
      content = (
        <div className="space-y-2">
          {appViewChartValues(value).map((entry, index) => (
            <div
              key={`${entry.label}:${index}`}
              className="grid grid-cols-[minmax(4rem,auto)_1fr_auto] items-center gap-2 text-xs"
            >
              <span className="truncate text-muted-foreground">{entry.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${entry.percent}%` }}
                />
              </span>
              <span className="tabular-nums">{entry.value}</span>
            </div>
          ))}
        </div>
      );
      break;
    case "input":
      content = (
        <NodeInput
          node={node}
          value={node.input ? props.inputs[node.input.name] : undefined}
          onChange={props.onInputChange}
        />
      );
      break;
    case "text":
      content = (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayValue(value)}</p>
      );
      break;
  }

  return (
    <div data-app-view-node={node.id} className="min-w-0">
      {node.title ? (
        <h3 className="mb-2 text-sm font-medium text-foreground">{node.title}</h3>
      ) : null}
      {content}
      <NodeActions actions={node.actions} inputs={props.inputs} onAction={props.onAction} />
    </div>
  );
}

function AppViewTabs(
  props: Omit<Parameters<typeof AppViewNodeRenderer>[0], "node"> & {
    nodes: readonly NativeAppViewNode[];
  },
) {
  const [activeId, setActiveId] = useState(props.nodes[0]?.id ?? "");
  const active = props.nodes.find((node) => node.id === activeId) ?? props.nodes[0];
  return (
    <div>
      <div className="mb-3 flex gap-1 border-b border-border">
        {props.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={cn(
              "border-b-2 px-3 py-2 text-xs",
              node.id === active?.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
            onClick={() => setActiveId(node.id)}
          >
            {node.title ?? node.id}
          </button>
        ))}
      </div>
      {active ? <AppViewNodeRenderer {...props} node={active} /> : null}
    </div>
  );
}

function NativeAppViewRenderer(
  props: Omit<AppViewRendererProps, "manifest"> & { manifest: NativeAppViewManifest },
) {
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6"
        data-app-view-id={props.manifest.id}
      >
        <div>
          <h2 className="text-base font-semibold">{props.manifest.title}</h2>
          <p className="text-xs text-muted-foreground">Revision {props.manifest.revision}</p>
        </div>
        <AppViewNodeRenderer
          node={props.manifest.root}
          dataSources={props.dataSources ?? {}}
          inputs={inputs}
          onInputChange={(name, value) => setInputs((current) => ({ ...current, [name]: value }))}
          onAction={props.onAction}
        />
      </div>
    </ScrollArea>
  );
}

export function AppViewRenderer(props: AppViewRendererProps) {
  return props.manifest.kind === "sandboxed" ? (
    <SandboxedAppView manifest={props.manifest} onAction={props.onAction} />
  ) : (
    <NativeAppViewRenderer {...props} manifest={props.manifest} />
  );
}
