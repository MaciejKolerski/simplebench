export const backgroundAreas = [
  "app",
  "terminal",
  "sidebar",
  "titlebar",
  "statusbar",
  "settings",
  "modal",
] as const;
export type BackgroundArea = (typeof backgroundAreas)[number];
export interface ThemeBackground {
  image?: string;
  opacity?: number;
  size?: string;
  position?: string;
  repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y" | "space" | "round";
  blur?: number;
  overlay?: string;
  blendMode?: string;
}
export const terminalColors = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
  "searchMatchBackground",
  "searchActiveMatchBackground",
  "searchMatchBorder",
  "searchActiveMatchBorder",
] as const;
export const terminalNumbers = {
  fontSize: [6, 72],
  lineHeight: [1, 3],
  letterSpacing: [-2, 20],
  cursorWidth: [1, 10],
  minimumContrastRatio: [1, 21],
} as const;
export const terminalEnums = {
  cursorStyle: ["bar", "block", "underline"],
  cursorInactiveStyle: ["outline", "bar", "block", "underline", "none"],
} as const;
export const terminalBooleans = [
  "cursorBlink",
  "drawBoldTextInBrightColors",
] as const;
export interface ThemeTerminal {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: string | number;
  fontWeightBold?: string | number;
  cursorWidth?: number;
  minimumContrastRatio?: number;
  cursorStyle?: "bar" | "block" | "underline";
  cursorInactiveStyle?: "outline" | "bar" | "block" | "underline" | "none";
  cursorBlink?: boolean;
  drawBoldTextInBrightColors?: boolean;
  colors?: Partial<Record<(typeof terminalColors)[number], string>>;
}
export interface ThemeManifest {
  $schema?: string;
  version: 1;
  name: string;
  author?: string;
  description?: string;
  appearance?: "dark" | "light";
  layout?: {
    tabs?: "inline" | "above" | "below";
    statusbar?: "top" | "bottom";
    settingsNavigation?: "left" | "right" | "top" | "bottom";
  };
  tokens?: Record<string, string>;
  styles?: Record<string, Record<string, string>>;
  assets?: Record<string, string>;
  backgrounds?: Partial<Record<BackgroundArea, ThemeBackground>>;
  terminal?: ThemeTerminal;
  stylesheets?: string[];
  stylesheet?: string;
}
export type Appearance = "light" | "dark";
export type AppearancePreference = "system" | Appearance;

export function resolveAppearance(
  preference: AppearancePreference,
  system: Appearance,
): Appearance {
  return preference === "system" ? system : preference;
}

export interface ThemePreferences {
  version: 1;
  active: string | null;
  appearance: AppearancePreference;
}
export interface ThemeBundle {
  id: string;
  manifest: unknown;
}
export interface ThemeCurrent {
  preferences: ThemePreferences;
  theme: ThemeBundle | null;
  safeMode: boolean;
}
export interface ThemeEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  error: string | null;
}
export interface ThemeCatalog {
  directory: string;
  themes: ThemeEntry[];
}
export const builtinPreferences: ThemePreferences = {
  version: 1,
  active: null,
  appearance: "system",
};
export const builtinTheme: ThemeManifest = {
  version: 1,
  name: "DeepMono",
  description: "Mono and Mono Light palettes with the Graphite accent.",
};
export const kebab = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`Unknown ${path} field: ${key}`);
}
function string(
  value: unknown,
  path: string,
  limit = 2000,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > limit ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new Error(
      `${path} must be a nonempty string of at most ${limit} characters.`,
    );
}
function number(value: unknown, path: string, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${path} must be between ${min} and ${max}.`);
}
export function relativeAsset(value: unknown): asserts value is string {
  string(value, "Asset path", 1024);
  if (
    /[\\:?#\x00-\x1f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Use a relative path inside the theme folder: ${value}`);
}
export function parseTheme(value: unknown): ThemeManifest {
  const data = object(value, "theme.json");
  keys(
    data,
    [
      "$schema",
      "version",
      "name",
      "author",
      "description",
      "appearance",
      "layout",
      "tokens",
      "styles",
      "assets",
      "backgrounds",
      "terminal",
      "stylesheet",
      "stylesheets",
    ],
    "theme",
  );
  if (data.version !== 1)
    throw new Error("Unsupported theme version. Expected version 1.");
  string(data.name, "name", 160);
  for (const field of ["$schema", "author", "description"])
    if (data[field] !== undefined) string(data[field], field);
  if (
    data.appearance !== undefined &&
    !["dark", "light"].includes(data.appearance as string)
  )
    throw new Error("appearance must be dark or light.");
  if (data.layout !== undefined) {
    const layout = object(data.layout, "layout");
    const options = {
      tabs: ["inline", "above", "below"],
      statusbar: ["top", "bottom"],
      settingsNavigation: ["left", "right", "top", "bottom"],
    };
    keys(layout, Object.keys(options), "layout");
    for (const [key, values] of Object.entries(options))
      if (layout[key] !== undefined && !values.includes(layout[key] as string))
        throw new Error(`Invalid layout.${key}.`);
  }
  if (data.stylesheet !== undefined && data.stylesheets !== undefined)
    throw new Error(
      "Use stylesheets or the legacy stylesheet field, not both.",
    );
  if (data.stylesheets !== undefined && !Array.isArray(data.stylesheets))
    throw new Error("stylesheets must be an array of relative CSS paths.");
  const stylesheets =
    (data.stylesheets as unknown[] | undefined) ??
    (data.stylesheet !== undefined ? [data.stylesheet] : []);
  for (const path of stylesheets) {
    relativeAsset(path);
    if (!path.endsWith(".css"))
      throw new Error("Stylesheet paths must name CSS files.");
  }
  if (new Set(stylesheets).size !== stylesheets.length)
    throw new Error("stylesheets must not contain duplicate paths.");
  for (const [name, token] of Object.entries(
    object(data.tokens ?? {}, "tokens"),
  )) {
    if (!/^--[a-z][a-z0-9-]*$/.test(name))
      throw new Error(`Invalid CSS token: ${name}`);
    string(token, `tokens.${name}`, 4000);
  }
  for (const [name, path] of Object.entries(
    object(data.assets ?? {}, "assets"),
  )) {
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      throw new Error(`Invalid asset name: ${name}`);
    relativeAsset(path);
  }
  for (const [selector, declarations] of Object.entries(
    object(data.styles ?? {}, "styles"),
  )) {
    string(selector, "CSS selector", 1000);
    for (const [property, value] of Object.entries(
      object(declarations, `styles.${selector}`),
    )) {
      if (!/^(--)?[a-z][a-z0-9-]*$/.test(property))
        throw new Error(`Use kebab-case CSS property names: ${property}`);
      string(value, `styles.${selector}.${property}`, 4000);
    }
  }
  const backgrounds = object(data.backgrounds ?? {}, "backgrounds");
  keys(backgrounds, backgroundAreas, "backgrounds");
  for (const [area, value] of Object.entries(backgrounds)) {
    const background = object(value, `backgrounds.${area}`);
    keys(
      background,
      [
        "image",
        "opacity",
        "size",
        "position",
        "repeat",
        "blur",
        "overlay",
        "blendMode",
      ],
      `backgrounds.${area}`,
    );
    if (background.image !== undefined) relativeAsset(background.image);
    if (background.opacity !== undefined)
      number(background.opacity, `${area}.opacity`, 0, 1);
    if (background.blur !== undefined)
      number(background.blur, `${area}.blur`, 0, 100);
    for (const key of ["size", "position", "repeat", "overlay", "blendMode"])
      if (background[key] !== undefined)
        string(background[key], `${area}.${key}`);
  }
  const terminal = object(data.terminal ?? {}, "terminal");
  keys(
    terminal,
    [
      "colors",
      "fontFamily",
      "fontWeight",
      "fontWeightBold",
      ...Object.keys(terminalNumbers),
      ...Object.keys(terminalEnums),
      ...terminalBooleans,
    ],
    "terminal",
  );
  for (const [key, [min, max]] of Object.entries(terminalNumbers))
    if (terminal[key] !== undefined)
      number(terminal[key], `terminal.${key}`, min, max);
  for (const [key, values] of Object.entries(terminalEnums))
    if (
      terminal[key] !== undefined &&
      !(values as readonly unknown[]).includes(terminal[key])
    )
      throw new Error(`Invalid terminal.${key}.`);
  for (const key of terminalBooleans)
    if (terminal[key] !== undefined && typeof terminal[key] !== "boolean")
      throw new Error(`terminal.${key} must be a boolean.`);
  if (terminal.fontFamily !== undefined)
    string(terminal.fontFamily, "terminal.fontFamily");
  for (const key of ["fontWeight", "fontWeightBold"])
    if (
      terminal[key] !== undefined &&
      !["normal", "bold"].includes(terminal[key] as string)
    )
      number(terminal[key], `terminal.${key}`, 1, 1000);
  const colors = object(terminal.colors ?? {}, "terminal.colors");
  keys(colors, terminalColors, "terminal.colors");
  for (const [key, value] of Object.entries(colors))
    string(value, `terminal.colors.${key}`);
  return data as unknown as ThemeManifest;
}
