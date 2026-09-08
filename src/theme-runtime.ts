import { convertFileSrc } from "@tauri-apps/api/core";
import type { ITerminalOptions, ITheme } from "@xterm/xterm";
import { native } from "./api";
import {
  builtinTheme,
  kebab,
  parseTheme,
  resolveAppearance,
  terminalColors,
} from "./themes";
import type {
  AppearancePreference,
  ThemeBundle,
  ThemeManifest,
  ThemePreferences,
} from "./themes";

import { defaultTerminalPreferences } from "./terminal-preferences";
import type { TerminalPreferences } from "./terminal-preferences";

let terminalPreferences = defaultTerminalPreferences;
export function applyTerminalPreferences(next: TerminalPreferences) {
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(terminalPreferences.appearance)) {
    if (key === "colors") {
      for (const name of Object.keys(value))
        root.removeProperty(`--terminal-${kebab(name)}`);
    } else root.removeProperty(`--terminal-${kebab(key)}`);
  }
  terminalPreferences = next;
  for (const [key, value] of Object.entries(next.appearance)) {
    if (key === "colors") {
      for (const [name, color] of Object.entries(next.appearance.colors ?? {}))
        root.setProperty(`--terminal-${kebab(name)}`, color);
    } else
      root.setProperty(
        `--terminal-${kebab(key)}`,
        `${typeof value === "boolean" ? Number(value) : value}${key === "fontSize" || key === "letterSpacing" ? "px" : ""}`,
      );
  }
  refreshTerminalAppearance();
}

export function terminalPalette() {
  terminalAppearance();
  return { ...searchPalette };
}

export const themeAppliedEvent = "simplebench-theme-applied";
let revision = 0;
let appliedRevision = 0;
let terminalOptions: ITerminalOptions | undefined;
let searchPalette: Record<string, string> = {};

export function initializeAppearance(
  preference: AppearancePreference = "system",
) {
  document.documentElement.dataset.appearance = resolveAppearance(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
}

export function applyAppearance(preference: AppearancePreference) {
  terminalAppearance();
  initializeAppearance(preference);
  refreshTerminalAppearance();
}

function refreshTerminalAppearance() {
  const request = ++appliedRevision;
  // WebKit applies media changes after this task. Canvas fonts need an explicit load.
  requestAnimationFrame(() => {
    const next = readTerminalAppearance();
    void loadTerminalFonts(next).then(() => {
      if (request !== appliedRevision) return;
      terminalOptions = next;
      window.dispatchEvent(new Event(themeAppliedEvent));
    });
  });
}

export async function loadTerminalFonts(options: ITerminalOptions) {
  await Promise.allSettled(
    ["normal", "italic"].flatMap((style) =>
      [options.fontWeight, options.fontWeightBold].map((weight) =>
        document.fonts.load(
          `${style} ${weight} ${options.fontSize}px ${options.fontFamily}`,
        ),
      ),
    ),
  );
}

export function themeAssetUrl(id: string, path: string, revision: string) {
  const base = native ? convertFileSrc("", "theme") : "/theme-assets/";
  return `${base}${encodeURIComponent(id)}/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function setDeclaration(
  style: CSSStyleDeclaration,
  property: string,
  value: string,
) {
  const important = /\s*!important\s*$/.test(value);
  const plain = value.replace(/\s*!important\s*$/, "");
  if (!property.startsWith("--") && !CSS.supports(property, plain))
    throw new Error(`Invalid CSS value for ${property}: ${value}`);
  style.setProperty(property, plain, important ? "important" : "");
  if (!style.getPropertyValue(property))
    throw new Error(`Invalid CSS value for ${property}: ${value}`);
}

export function compileTheme(
  theme: ThemeManifest,
  asset: (path: string) => string,
) {
  const sheet = new CSSStyleSheet();
  const rule = (selector: string, declarations: Record<string, string>) => {
    // CSSOM validates selectors and serializes values without interpolating executable stylesheet syntax.
    let rule: CSSRule;
    try {
      const index = sheet.insertRule(`${selector} {}`, sheet.cssRules.length);
      rule = sheet.cssRules[index];
    } catch {
      throw new Error(`Invalid CSS selector: ${selector}`);
    }
    if (!(rule instanceof CSSStyleRule))
      throw new Error(`Invalid CSS selector: ${selector}`);
    const style = rule.style;
    for (const [property, value] of Object.entries(declarations))
      setDeclaration(style, property, value);
  };
  const tokens: Record<string, string> = { ...theme.tokens };
  for (const [name, path] of Object.entries(theme.assets ?? {}))
    tokens[`--asset-${name}`] = `url("${asset(path)}")`;
  for (const [key, value] of Object.entries(theme.terminal ?? {})) {
    if (key === "colors") continue;
    tokens[`--terminal-${kebab(key)}`] =
      `${typeof value === "boolean" ? Number(value) : value}${key === "fontSize" || key === "letterSpacing" ? "px" : ""}`;
  }
  for (const [name, color] of Object.entries(theme.terminal?.colors ?? {})) {
    if (!CSS.supports("color", color))
      throw new Error(`Invalid terminal color: ${name}`);
    tokens[`--terminal-${kebab(name)}`] = color;
  }
  for (const [area, background] of Object.entries(theme.backgrounds ?? {})) {
    const prefix = `--background-${area}-`;
    if (background.image)
      tokens[`${prefix}image`] = `url("${asset(background.image)}")`;
    if (background.opacity !== undefined)
      tokens[`${prefix}opacity`] = String(background.opacity);
    if (background.blur !== undefined)
      tokens[`${prefix}blur`] = `${background.blur}px`;
    for (const [key, property] of Object.entries({
      size: "background-size",
      position: "background-position",
      repeat: "background-repeat",
      overlay: "background-color",
      blendMode: "mix-blend-mode",
    })) {
      const value = background[key as keyof typeof background];
      if (typeof value === "string") {
        if (!CSS.supports(property, value))
          throw new Error(`Invalid backgrounds.${area}.${key}: ${value}`);
        tokens[`${prefix}${kebab(key)}`] = value;
      }
    }
  }
  rule(":root", tokens);
  for (const [selector, declarations] of Object.entries(theme.styles ?? {}))
    rule(selector, declarations);
  return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
}

export interface PreparedTheme {
  manifest: ThemeManifest;
  appearance: AppearancePreference;
  commit: () => void;
  dispose: () => void;
}
export async function prepareTheme(
  bundle: ThemeBundle | null,
  preferences: ThemePreferences,
): Promise<PreparedTheme> {
  const manifest = bundle ? parseTheme(bundle.manifest) : builtinTheme;
  const appearance = manifest.appearance ?? preferences.appearance;
  const currentRevision = `${Date.now()}-${++revision}`;
  const asset = (path: string) =>
    themeAssetUrl(bundle!.id, path, currentRevision);
  const style = document.createElement("style");
  style.dataset.themeLayer = "tokens";
  style.textContent = compileTheme(manifest, asset);
  const links: HTMLLinkElement[] = [];
  const cancelLoads = new Set<() => void>();
  const dispose = () => {
    for (const cancel of cancelLoads) cancel();
    style.remove();
    for (const link of links) link.remove();
  };
  try {
    const paths =
      manifest.stylesheets ??
      (manifest.stylesheet ? [manifest.stylesheet] : []);
    await Promise.all(
      paths.map(
        (path) =>
          new Promise<void>((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.media = "not all";
            link.href = asset(path);
            links.push(link);
            const finish = (error?: Error) => {
              clearTimeout(timeout);
              link.onload = link.onerror = null;
              cancelLoads.delete(cancel);
              if (error) reject(error);
              else resolve();
            };
            const cancel = () =>
              finish(new Error("Theme loading was cancelled."));
            const timeout = setTimeout(
              () => finish(new Error(`Loading ${path} timed out.`)),
              10000,
            );
            cancelLoads.add(cancel);
            link.onload = () => finish();
            link.onerror = () =>
              finish(
                new Error(
                  `Cannot load ${path}. The previous theme is still active.`,
                ),
              );
            // Append in manifest order; completion order must not change the cascade.
            document.head.append(link);
          }),
      ),
    );
    await Promise.all(
      Object.values(manifest.backgrounds ?? {})
        .filter((background) => background.image)
        .map(
          (background) =>
            new Promise<void>((resolve, reject) => {
              const image = new Image();
              const timeout = setTimeout(
                () =>
                  reject(
                    new Error(`Cannot load background: ${background.image}`),
                  ),
                10000,
              );
              image.onload = () => {
                clearTimeout(timeout);
                resolve();
              };
              image.onerror = () => {
                clearTimeout(timeout);
                reject(
                  new Error(`Cannot decode background: ${background.image}`),
                );
              };
              image.src = asset(background.image!);
            }),
        ),
    );
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    manifest,
    appearance,
    dispose,
    commit: () => {
      terminalAppearance();
      document
        .querySelectorAll("[data-theme-layer]")
        .forEach((node) => node.remove());
      if (links.length) {
        // Moving a loaded link restarts stylesheet loading in WebKitGTK.
        document.head.insertBefore(style, links[0]);
        for (const link of links) {
          link.dataset.themeLayer = "css";
          link.media = "all";
        }
      } else document.head.append(style);
      document.documentElement.dataset.theme = bundle?.id ?? "deepmono";
      applyAppearance(appearance);
    },
  };
}

export function terminalAppearance(): ITerminalOptions {
  return (terminalOptions ??= readTerminalAppearance());
}

function readTerminalAppearance(): ITerminalOptions {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) =>
    root.getPropertyValue(`--terminal-${kebab(name)}`).trim();
  const probe = document.createElement("span");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const colors: Record<string, string> = {};
  for (const name of terminalColors) {
    if (!token(name) || token(name) === "none") continue;
    probe.style.color = `var(--terminal-${kebab(name)})`;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    colors[name] =
      `#${Array.from(context.getImageData(0, 0, 1, 1).data, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  probe.remove();
  searchPalette = colors;
  const numeric = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = parseFloat(token(name));
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  };
  const weight = (name: string, fallback: "normal" | "bold") => {
    const value = token(name);
    return value === "normal" || value === "bold"
      ? value
      : numeric(name, fallback === "bold" ? 700 : 400, 1, 1000);
  };
  return {
    ...terminalPreferences.behavior,
    fontFamily: token("fontFamily"),
    fontSize: numeric("fontSize", 13, 6, 72),
    fontWeight: weight("fontWeight", "normal"),
    fontWeightBold: weight("fontWeightBold", "bold"),
    lineHeight: numeric("lineHeight", 1.25, 1, 3),
    letterSpacing: numeric("letterSpacing", 0, -2, 20),
    cursorBlink: token("cursorBlink") !== "0",
    cursorWidth: numeric("cursorWidth", 1, 1, 10),
    cursorStyle: (["bar", "block", "underline"].includes(token("cursorStyle"))
      ? token("cursorStyle")
      : "bar") as ITerminalOptions["cursorStyle"],
    cursorInactiveStyle: ([
      "outline",
      "bar",
      "block",
      "underline",
      "none",
    ].includes(token("cursorInactiveStyle"))
      ? token("cursorInactiveStyle")
      : "outline") as ITerminalOptions["cursorInactiveStyle"],
    minimumContrastRatio: numeric("minimumContrastRatio", 1, 1, 21),
    drawBoldTextInBrightColors: token("drawBoldTextInBrightColors") !== "0",
    // Preserve the pane's RGB for xterm's contrast calculations and background
    // queries; zero alpha lets CSS paint the background and images only once.
    theme: {
      ...Object.fromEntries(
        Object.entries(colors).filter(([key]) => !key.startsWith("search")),
      ),
      background: `${colors.background.slice(0, 7)}00`,
    } as ITheme,
  };
}

export function terminalSearchColors() {
  terminalAppearance();
  const color = (name: string) => searchPalette[name];
  return {
    matchBackground: color("searchMatchBackground"),
    activeMatchBackground: color("searchActiveMatchBackground"),
    matchBorder: color("searchMatchBorder"),
    activeMatchBorder: color("searchActiveMatchBorder"),
    matchOverviewRuler: color("searchMatchBorder"),
    activeMatchColorOverviewRuler: color("searchActiveMatchBorder"),
  };
}
