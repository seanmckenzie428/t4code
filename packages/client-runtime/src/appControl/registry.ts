import type {
  AppCommandDescriptor,
  AppCommandInvocation,
  AppControlRisk,
} from "@t3tools/contracts";

export interface AppCommandContext {
  readonly environmentId: string;
  readonly projectId?: string;
  readonly threadId?: string;
  readonly source: "button" | "keybinding" | "palette" | "mcp" | "view";
}

export type AppCommandAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export interface AppCommandRegistration<Context extends AppCommandContext = AppCommandContext> {
  readonly descriptor: AppCommandDescriptor;
  readonly domain: AppCommandDomain;
  readonly availability?: (context: Context) => AppCommandAvailability;
  readonly execute: (
    invocation: AppCommandInvocation,
    context: Context,
  ) => unknown | Promise<unknown>;
}

export interface AvailableAppCommand {
  readonly descriptor: AppCommandDescriptor;
  readonly domain: AppCommandDomain;
  readonly availability: AppCommandAvailability;
}

export interface AppCommandFilter {
  readonly domain?: AppCommandDomain;
  readonly owner?: AppCommandDescriptor["owner"];
  readonly risk?: AppControlRisk | ReadonlySet<AppControlRisk>;
  readonly includeUnavailable?: boolean;
}

export type AppCommandDomain =
  | "ui"
  | "project"
  | "thread"
  | "delegation"
  | "script"
  | "terminal"
  | "source-control"
  | "settings"
  | "view";

export type AppCommandRegistryErrorCode =
  | "duplicate-command"
  | "invalid-descriptor"
  | "unknown-command"
  | "invalid-arguments"
  | "unavailable";

export class AppCommandRegistryError extends Error {
  readonly code: AppCommandRegistryErrorCode;
  readonly commandId: string;

  constructor(code: AppCommandRegistryErrorCode, commandId: string, message: string) {
    super(message);
    this.name = "AppCommandRegistryError";
    this.code = code;
    this.commandId = commandId;
  }
}

const available = { available: true } as const;

export class AppCommandRegistry<Context extends AppCommandContext = AppCommandContext> {
  readonly #commands = new Map<string, AppCommandRegistration<Context>>();

  constructor(registrations: ReadonlyArray<AppCommandRegistration<Context>> = []) {
    for (const registration of registrations) this.register(registration);
  }

  register(registration: AppCommandRegistration<Context>): () => void {
    validateDescriptor(registration.descriptor);
    const commandId = registration.descriptor.id;
    if (this.#commands.has(commandId)) {
      throw new AppCommandRegistryError(
        "duplicate-command",
        commandId,
        `Command ${commandId} is already registered.`,
      );
    }
    this.#commands.set(commandId, registration);
    return () => {
      if (this.#commands.get(commandId) === registration) this.#commands.delete(commandId);
    };
  }

  get(commandId: string): AppCommandRegistration<Context> | undefined {
    return this.#commands.get(commandId);
  }

  list(context: Context, filter: AppCommandFilter = {}): ReadonlyArray<AvailableAppCommand> {
    const risks =
      filter.risk === undefined
        ? undefined
        : typeof filter.risk === "string"
          ? new Set([filter.risk])
          : filter.risk;

    return [...this.#commands.values()]
      .filter(({ descriptor, domain }) => {
        if (filter.domain !== undefined && domain !== filter.domain) return false;
        if (filter.owner !== undefined && descriptor.owner !== filter.owner) return false;
        return risks?.has(descriptor.risk) ?? true;
      })
      .map((registration) => ({
        descriptor: registration.descriptor,
        domain: registration.domain,
        availability: registration.availability?.(context) ?? available,
      }))
      .filter((command) => filter.includeUnavailable !== false || command.availability.available)
      .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id));
  }

  availability(commandId: string, context: Context): AppCommandAvailability {
    const registration = this.#require(commandId);
    return registration.availability?.(context) ?? available;
  }

  async invoke(invocation: AppCommandInvocation, context: Context): Promise<unknown> {
    const registration = this.#require(invocation.commandId);
    const commandAvailability = registration.availability?.(context) ?? available;
    if (!commandAvailability.available) {
      throw new AppCommandRegistryError(
        "unavailable",
        invocation.commandId,
        commandAvailability.reason,
      );
    }
    const validationError = validateAppCommandArguments(
      registration.descriptor.inputSchema,
      invocation.args,
    );
    if (validationError !== undefined) {
      throw new AppCommandRegistryError(
        "invalid-arguments",
        invocation.commandId,
        `Invalid arguments for ${invocation.commandId}: ${validationError}`,
      );
    }
    return registration.execute(invocation, context);
  }

  #require(commandId: string): AppCommandRegistration<Context> {
    const registration = this.#commands.get(commandId);
    if (registration === undefined) {
      throw new AppCommandRegistryError(
        "unknown-command",
        commandId,
        `Command ${commandId} is not registered.`,
      );
    }
    return registration;
  }
}

function validateDescriptor(descriptor: AppCommandDescriptor): void {
  if (
    descriptor.id.trim().length === 0 ||
    descriptor.version !== 1 ||
    descriptor.title.trim().length === 0 ||
    descriptor.description.trim().length === 0 ||
    !isObject(descriptor.inputSchema) ||
    !isObject(descriptor.outputSchema)
  ) {
    throw new AppCommandRegistryError(
      "invalid-descriptor",
      descriptor.id,
      `Command ${descriptor.id || "<empty>"} has an invalid descriptor.`,
    );
  }
}

export function validateAppCommandArguments(
  schemaValue: unknown,
  value: unknown,
  path = "$",
): string | undefined {
  if (!isObject(schemaValue)) return "schema is not an object";
  const schema = schemaValue;

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} is not one of the allowed values`;
  }
  if ("const" in schema && !Object.is(schema.const, value)) return `${path} does not match const`;
  if (Array.isArray(schema.anyOf)) {
    if (
      !schema.anyOf.some(
        (candidate) => validateAppCommandArguments(candidate, value, path) === undefined,
      )
    ) {
      return `${path} does not match any allowed schema`;
    }
    return undefined;
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validateAppCommandArguments(candidate, value, path) === undefined,
    ).length;
    return matches === 1 ? undefined : `${path} must match exactly one allowed schema`;
  }

  switch (schema.type) {
    case undefined:
      return undefined;
    case "null":
      return value === null ? undefined : `${path} must be null`;
    case "string":
      return typeof value === "string" ? undefined : `${path} must be a string`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${path} must be a finite number`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? undefined
        : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? undefined : `${path} must be a boolean`;
    case "array": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        return `${path} exceeds maxItems`;
      }
      if (schema.items !== undefined) {
        for (let index = 0; index < value.length; index += 1) {
          const error = validateAppCommandArguments(
            schema.items,
            value[index],
            `${path}[${index}]`,
          );
          if (error !== undefined) return error;
        }
      }
      return undefined;
    }
    case "object": {
      if (!isObject(value)) return `${path} must be an object`;
      const properties = isObject(schema.properties) ? schema.properties : {};
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (typeof key === "string" && !(key in value)) return `${path}.${key} is required`;
        }
      }
      for (const [key, propertyValue] of Object.entries(value)) {
        const propertySchema = properties[key];
        if (propertySchema !== undefined) {
          const error = validateAppCommandArguments(
            propertySchema,
            propertyValue,
            `${path}.${key}`,
          );
          if (error !== undefined) return error;
        } else if (schema.additionalProperties === false) {
          return `${path}.${key} is not allowed`;
        }
      }
      return undefined;
    }
    default:
      return `${path} uses unsupported schema type`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
