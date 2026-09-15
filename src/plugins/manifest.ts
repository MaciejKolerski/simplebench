import type { Json, PluginManifest } from "../../packages/plugin-sdk/index";
import { validShortcut } from "../keybindings.ts";
export type {
  PluginManifest,
  PanelDescriptor,
} from "../../packages/plugin-sdk/index";
export const pluginId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
export function packagePath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    /[\\:%?#\x00-\x1f<>"|*]/.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(
      "Use a relative package path without traversal, reserved names or encoded separators.",
    );
}
export function jsonState(value: unknown): asserts value is Json {
  let count = 0;
  const visit = (item: unknown, depth: number) => {
    if (++count > 4096 || depth > 16)
      throw new Error("Panel state exceeds its size or depth limit.");
    if (item === null || typeof item === "boolean" || typeof item === "string")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (
      !item ||
      typeof item !== "object" ||
      ![Object.prototype, Array.prototype, null].includes(
        Object.getPrototypeOf(item),
      )
    )
      throw new Error("Panel state must be JSON data.");
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("Reserved state property.");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw new Error("Panel state exceeds 64 KiB.");
}
function object(
  value: unknown,
  allowed: string[],
  path: string,
): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unsupported ${path}.${key}.`);
  return value as Record<string, any>;
}
function label(
  value: unknown,
  path: string,
  limit = 160,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error(`Invalid ${path}.`);
}
export function parsePlugin(value: unknown): PluginManifest {
  const data = object(
    value,
    [
      "schemaVersion",
      "id",
      "name",
      "version",
      "description",
      "hostApi",
      "entry",
      "activation",
      "stylesheets",
      "contributes",
    ],
    "plugin",
  );
  if (data.schemaVersion !== 1)
    throw new Error("Unsupported plugin schema version.");
  if (data.hostApi !== 1)
    throw new Error("This plugin requires a different host API.");
  label(data.id, "id", 100);
  if (!pluginId.test(data.id))
    throw new Error("Plugin ID must be namespaced, for example author.name.");
  label(data.name, "name");
  label(data.description, "description", 2000);
  if (
    typeof data.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(data.version) ||
    data.version.length > 80
  )
    throw new Error("Invalid plugin version.");
  if (data.entry !== undefined) {
    packagePath(data.entry);
    if (!/\.m?js$/.test(data.entry))
      throw new Error("The entry must be prebuilt JavaScript ESM.");
  }
  if (
    data.activation !== undefined &&
    !["startup", "lazy"].includes(data.activation)
  )
    throw new Error("Unsupported activation trigger.");
  if (data.stylesheets !== undefined) {
    if (
      !Array.isArray(data.stylesheets) ||
      data.stylesheets.length > 16 ||
      new Set(data.stylesheets).size !== data.stylesheets.length
    )
      throw new Error("Invalid stylesheets.");
    for (const path of data.stylesheets) {
      packagePath(path);
      if (!path.endsWith(".css")) throw new Error("Expected a CSS file.");
    }
  }
  const contribution = object(
    data.contributes ?? {},
    ["views", "commands", "keybindings", "fills", "themes"],
    "contributes",
  );
  const seen = new Set<string>();
  for (const [kind, entries] of Object.entries(contribution)) {
    if (!Array.isArray(entries) || entries.length > 128)
      throw new Error(`Invalid contributes.${kind}.`);
    for (const entry of entries) {
      const fields = {
        views: ["id", "title", "placement", "multiple", "stateVersion"],
        commands: ["id", "label", "description", "context"],
        keybindings: ["command", "shortcut"],
        fills: ["id", "slot", "label"],
        themes: ["id", "path"],
      }[kind]!;
      const item = object(entry, fields, kind);
      const id = kind === "keybindings" ? item.command : item.id;
      if (
        typeof id !== "string" ||
        id.length > 160 ||
        !pluginId.test(id) ||
        !id.startsWith(data.id + ".")
      )
        throw new Error(`Contribution ID must belong to ${data.id}.`);
      const identity = kind === "keybindings" ? `keybinding:${id}` : id;
      if (seen.has(identity)) throw new Error(`Duplicate contribution: ${id}`);
      seen.add(identity);
      if (kind === "views") {
        label(item.title, "view title");
        if (item.placement === "sidebar" && item.multiple)
          throw new Error("Sidebar views are single-instance per workspace.");
        if (
          !["central", "sidebar"].includes(item.placement) ||
          typeof item.multiple !== "boolean" ||
          !Number.isInteger(item.stateVersion) ||
          item.stateVersion < 1 ||
          item.stateVersion > 1000
        )
          throw new Error("Invalid view contract.");
      } else if (kind === "commands") {
        label(item.label, "command label");
        label(item.description, "command description", 2000);
        const context = object(
          item.context ?? {},
          ["workspace", "viewTypes", "textInput"],
          "context",
        );
        for (const key of ["workspace", "textInput"])
          if (context[key] !== undefined && typeof context[key] !== "boolean")
            throw new Error(`Invalid context.${key}.`);
        if (
          context.viewTypes !== undefined &&
          (!Array.isArray(context.viewTypes) ||
            context.viewTypes.length > 128 ||
            context.viewTypes.some(
              (v: unknown) => typeof v !== "string" || v.length > 160,
            ))
        )
          throw new Error("Invalid context.viewTypes.");
      } else if (kind === "keybindings") {
        if (
          item.shortcut !== null &&
          (typeof item.shortcut !== "string" || !validShortcut(item.shortcut))
        )
          throw new Error("Invalid default shortcut.");
        if (
          !contribution.commands?.some(
            (command: { id: string }) => command.id === id,
          )
        )
          throw new Error("Keybinding references an undeclared command.");
      } else if (kind === "fills") {
        label(item.label, "fill label");
        if (
          !["statusbar", "sidebar-actions", "view-actions"].includes(item.slot)
        )
          throw new Error("Unsupported slot.");
      } else {
        packagePath(item.path);
      }
    }
  }
  if (
    !data.entry &&
    ["views", "commands", "keybindings", "fills"].some(
      (k) => contribution[k]?.length,
    )
  )
    throw new Error("Executable contributions require an entry.");
  return data as PluginManifest;
}
