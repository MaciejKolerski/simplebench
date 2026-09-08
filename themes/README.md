# SimpleBench themes

Open **Settings → Themes**. **Create theme** makes a complete starter folder
and opens its editor. Change the controls or use **Edit JSON**, save, then select
the theme. **Open theme folder** opens its files in the file manager.
**Open folder** opens the theme library. Copy theme folders into it and press
**Refresh**, or use **Import folder** / drop a folder onto the Themes page.
Imports copy the complete folder, keep the original, and add a numeric suffix
when a folder name is already taken. Importing does not change your selection.

**Refresh** reloads edited JSON, stylesheets, images, and fonts in both windows.
Returning focus to a window also reloads the selected theme. Selection and
color mode persist across launches in `theme-settings.json`, beside
`session.json`. Running terminals retain their processes, output,
and command metadata when their appearance changes.

The default Linux library is
`~/.local/share/dev.simplebench.desktop/themes/`. The settings page displays the
actual location on every OS, including custom application data directories.

## Light, dark, and system appearance

**Color mode → System** is the default, including existing preferences that do
not have an `appearance` field. It reads the operating system's appearance before
rendering the interface and updates open windows, editors, and running terminals
when that appearance changes. **Light** and **Dark** keep a fixed mode across
launches. System changes do not write preferences or restart terminals.

DeepMono includes both Mono and Mono Light with the Graphite accent. Partial
themes inherit the palette for the current mode. Leave `appearance` out of
`theme.json` to follow the color mode setting; use semantic tokens such as
`var(--color-background)` and `var(--color-surface-text)` for adaptive colors.
CSS can use `:root[data-appearance="light"]` and
`:root[data-appearance="dark"]` for mode-specific overrides.

A theme with an explicit `"appearance": "light"` or `"appearance": "dark"`
pins its own mode, so a fixed custom palette keeps matching native controls and
fallback colors. The Color mode controls explain this and become available
again when an adaptive theme or DeepMono is selected. The previous color mode
preference is preserved.

## Folder layout

```text
my-theme/
  theme.json          Required manifest
  theme.css           First declared stylesheet
  styles/
    components.css    Additional declared stylesheet
  theme.schema.json   Editor completion and validation
  tokens.json         Complete default token reference (not loaded at runtime)
  README.md           This guide
  images/
    graphite.svg
  fonts/              Optional bundled fonts
    MyMono.woff2
```

Only `theme.json` is required. Paths in JSON are relative to the theme folder;
paths in CSS are relative to the CSS file. Names may contain spaces and Unicode.
Use forward slashes on all platforms. Files must stay inside the theme folder;
absolute paths, parent traversal, URLs, and symbolic links are not supported.

The repository includes `deepmono-custom/`, `theme.schema.json`, and
`default-tokens.json`. When importing the example directly from the repository,
copy `theme.schema.json` into that folder for editor completion; the app itself
does not need the schema to load a theme. Create theme includes it automatically.

The ready-to-import [Dracula theme](dracula/README.md) includes Dracula dark and
Alucard light palettes with matching terminal colors. It follows the Color mode
setting, including System appearance.

## Manifest

```json
{
  "$schema": "./theme.schema.json",
  "version": 1,
  "name": "My theme",
  "description": "My personal workspace",
  "appearance": "dark",
  "tokens": {
    "--color-background": "#101010",
    "--color-surface": "#161616",
    "--color-primary": "#9a9a9a",
    "--radius-control": "10px",
    "--radius-pane": "8px",
    "--terminal-padding": "14px",
    "--font-size": "14px",
    "--density": "1.1"
  },
  "backgrounds": {
    "terminal": {
      "image": "images/graphite.svg",
      "opacity": 0.3,
      "overlay": "#10101080",
      "size": "cover",
      "position": "center",
      "blur": 0
    }
  },
  "terminal": {
    "fontFamily": "MyMono, monospace",
    "fontSize": 14,
    "lineHeight": 1.3,
    "cursorStyle": "bar",
    "cursorBlink": true,
    "colors": {
      "background": "#101010cc",
      "foreground": "#dcdcdc",
      "blue": "#7a8fa6"
    }
  },
  "styles": {
    ".tab.active-tab": {
      "border-radius": "12px",
      "box-shadow": "inset 0 -2px var(--color-primary)"
    },
    ".settings-page-heading h1": {
      "font-weight": "600"
    }
  },
  "stylesheets": ["theme.css", "styles/components.css"]
}
```

`version` and `name` are required. `author`, `description`, and `appearance`
(`dark` or `light`) are optional. Appearance selects matching DeepMono defaults,
native controls, and scrollbars; omit it to use the Color mode setting.
Unspecified values inherit the built-in DeepMono defaults for that mode.
A theme never inherits stale values
from the previously selected theme.

Unknown manifest fields, invalid terminal options, invalid JSON styles, missing
resources, undecodable background images, and unreadable stylesheets produce an
error. Files are left intact and the last working appearance remains active.
At startup, DeepMono is the fallback until a theme loads successfully.

## Tokens and JSON styles

`tokens` maps CSS custom property names to **strings**. Use CSS units where
needed (`"12px"`, `"0.8rem"`), and strings for unitless tokens (`"0.8"`).
`tokens.json` / `default-tokens.json` contains all built-in defaults. You only
need to override the values you want to change. Additional custom variables
are supported and can be referenced from `styles` and your stylesheet.

| Area                  | Tokens                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Palette               | All `--color-*` properties: background and text, surfaces, outlines, primary/secondary, error, warning, info                                           |
| Typography            | `--font-family`, `--font-family-mono`, `--font-size`, `--font-size-9` through the sizes listed in the defaults                                         |
| Spacing               | `--density` scales spacing; `--space-N` overrides a specific step                                                                                      |
| Corners               | `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-control`, `--radius-tab`, `--radius-menu`, `--radius-modal`, `--radius-pane`, `--radius-window` |
| Borders and icons     | `--border-width`, `--focus-width`, `--icon-stroke-width`, `--icon-button-size`                                                                         |
| Shadows and overlays  | `--shadow-menu`, `--shadow-modal`, `--color-backdrop`, `--color-drop-overlay`                                                                          |
| Opacity               | Alpha channels in color values, `--opacity-disabled`, `--opacity-window`                                                                               |
| Title and status bars | `--titlebar-height`, `--titlebar-background`, `--statusbar-height`, `--statusbar-background`                                                           |
| Tabs                  | `--tab-height`, `--tab-min-width`, `--tab-max-width`, `--tab-background-active`                                                                        |
| Sidebar and files     | `--sidebar-background`, `--sidebar-min-width`, `--tree-row-height`, `--tree-indent`                                                                    |
| Settings              | `--settings-background`, `--settings-nav-width`, `--settings-page-padding`                                                                             |
| Controls and popups   | `--input-background`, `--button-background`, `--menu-background`, `--modal-background`                                                                 |
| Scrollbars            | `--scrollbar-width`, `--scrollbar-height`, palette outline/secondary colors                                                                            |
| Terminal              | `--terminal-padding`, plus `--terminal-*` values corresponding to the terminal options below                                                           |

For further control, `styles` maps **CSS selectors** to declaration objects.
Properties use CSS spelling (`border-radius`, not `borderRadius`); values are
strings. Pseudo-classes, pseudo-elements, descendant selectors, custom variables,
gradients, transitions, layout properties, and `!important` are supported.
Theme JSON can therefore style elements beyond the named tokens. A stylesheet
also supports media/container queries, keyframes, `@font-face`, and local CSS
imports. Invalid CSS declarations in JSON are rejected; the browser handles
stylesheet syntax using normal CSS error recovery.

Useful selectors include `.app-shell`, `.titlebar`, `.project-switcher`,
`.workspace-switcher`, `.tab`, `.tab.active-tab`, `.sidebar`, `.tree-row`,
`.source-heading`, `.git-file`, `.commit-form`, `.terminal-pane`,
`.terminal-pane.is-active`, `.terminal-search`, `.command-blocks`,
`.command-composer`, `.statusbar`, `.menu`, `.modal-surface`,
`.settings-navigation`, `.settings-nav-item`, `.keybinding-row`, `.theme-card`,
`.button`, `.button-primary`, `.icon-button`, `input`, and `textarea`.
Use `:root[data-appearance="light"]` or `.settings-window` to scope CSS.

The cascade is: built-in CSS → JSON tokens and terminal/background options →
JSON `layout` → JSON `styles` → CSS files in `stylesheets` order, subject to normal CSS specificity and
`!important`. Terminal/background sections override tokens for those same
options. Application state still owns project selection, pane geometry/minimum
sizes, tab order, and other behavior. Themes configure their appearance.

## Editing a theme in Settings

Use **Edit theme** on a custom theme card. The editor exposes all default tokens,
plus any custom tokens already defined by that theme. Search by name (for example,
`radius`, `border`, `padding`, `sidebar`, or `font`), or enable **Overrides only**.
Inputs accept CSS values, including units, `calc()`, variables, gradients, and
multi-value shorthands where the corresponding property permits them. Clear an
input to inherit its default again. Use **Edit JSON** for palette, terminal,
background, asset, selector, and stylesheet configuration in the same manifest.
JSON opens in the same CodeMirror editor as project files, with syntax coloring,
line numbers, folding, search, and undo/redo. **Format JSON** uses the Editor
indentation preferences; invalid JSON stays untouched and reports an error.
The configured save, find, go-to-line, and word-wrap shortcuts work in this editor.
JSON and the controls edit the same draft; switching views retains editor history
and preserves other fields.

**Save theme** validates the manifest, CSS declarations, and declared resources,
then atomically replaces that theme's `theme.json`. An active theme updates both
windows immediately. Saving an inactive theme keeps the current selection.
Failed saves retain the draft. If the file changed outside the app, saving stops
without replacing it; copy your draft from **Edit JSON**, reopen the editor, and
reconcile it with the external changes. Closing an edited draft offers discard
or continued editing. DeepMono is built in; create a theme to customize it.

The editor changes JSON only. Stylesheets remain editable in the theme folder
and retain their precedence. Invalid CSS custom-property values follow the
browser's normal fallback behavior; the editor cannot validate arbitrary custom
variables against the properties where your CSS will eventually use them.

## Layout and section dimensions

`layout` supplies convenient arrangements without changing project/workspace
state, tab order, pane identities, or running shells:

```json
{
  "version": 1,
  "name": "Spacious workspace",
  "layout": {
    "tabs": "below",
    "statusbar": "top",
    "settingsNavigation": "right"
  },
  "tokens": {
    "--work-area-padding": "12px",
    "--stage-padding": "0px 8px",
    "--pane-spacing": "6px",
    "--pane-border": "2px solid var(--color-outline)",
    "--pane-shadow": "var(--shadow-menu)",
    "--radius-pane": "18px 4px 18px 4px",
    "--radius-sidebar": "12px",
    "--sidebar-padding": "8px",
    "--sidebar-section-gap": "10px",
    "--sidebar-heading-padding": "12px 16px",
    "--tab-gap": "10px",
    "--tab-border-width": "2px",
    "--tab-height": "36px",
    "--editor-content-padding": "20px 0",
    "--editor-line-padding": "0 24px",
    "--settings-row-padding": "22px 0",
    "--git-section-margin": "12px 0"
  },
  "styles": {
    ".explorer-panel": { "gap": "16px" },
    ".menu-item": { "border-radius": "12px", "padding": "12px 16px" },
    ".theme-card": { "border-width": "2px", "margin-block": "8px" }
  }
}
```

| Layout field         | Values                                              | Default  |
| -------------------- | --------------------------------------------------- | -------- |
| `tabs`               | `inline`, `above`, `below` the title bar's controls | `inline` |
| `statusbar`          | `top`, `bottom` of the work area                    | `bottom` |
| `settingsNavigation` | `left`, `right`, `top`, `bottom`                    | `left`   |

These are optional presets. JSON `styles` and stylesheets can further change
CSS layout, alignment, wrapping, margins, padding, borders, corner shapes,
shadows, and typography. Standard media queries support different arrangements
at different window sizes. The existing sidebar placement context menus control
which side owns Explorer and Source Control, independently of theme selection.

Section tokens inherit the common spacing scale and borders by default:

| Section                 | Selected tokens                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window and work area    | `--app-padding`, `--app-gap`, `--work-area-padding`, `--work-area-gap`, `--stage-padding`                                                                                                                                                                                                                         |
| Title bar and tabs      | `--titlebar-padding-left`, `--titlebar-gap`, `--titlebar-border-width`, `--tab-bar-gap`, `--tab-gap`, `--tab-padding`, `--tab-border-width`                                                                                                                                                                       |
| Panels                  | `--pane-spacing`, `--pane-border`, `--pane-shadow`, `--radius-pane`                                                                                                                                                                                                                                               |
| Sidebars                | `--sidebar-padding`, `--sidebar-section-gap`, `--radius-sidebar`, `--sidebar-min-width`, `--sidebar-max-width`, `--sidebar-heading-height`, `--sidebar-heading-padding`                                                                                                                                           |
| File tree               | `--tree-padding`, `--tree-heading-padding`, `--tree-entry-gap`, `--tree-row-height`, `--tree-indent`                                                                                                                                                                                                              |
| Editor and preview      | `--editor-border`, `--editor-shadow`, `--radius-editor`, `--editor-heading-height`, `--editor-heading-padding`, `--editor-font-family`, `--editor-font-size`, `--editor-line-height`, `--editor-content-padding`, `--editor-line-padding`, `--markdown-padding`, `--markdown-max-width`, `--markdown-line-height` |
| Git                     | `--git-toolbar-padding`, `--git-repository-padding`, `--git-commit-flex`, `--git-commit-padding`, `--git-file-padding`, `--git-file-gap`, `--git-section-margin`, `--commit-file-list-flex`                                                                                                                       |
| Status bar              | `--statusbar-padding`, `--statusbar-gap`, `--statusbar-border-width`                                                                                                                                                                                                                                              |
| Settings                | `--settings-layout-padding`, `--settings-gap`, `--settings-nav-padding`, `--settings-nav-item-padding`, `--settings-heading-margin`, `--settings-row-padding`, `--editor-setting-padding`                                                                                                                         |
| Controls and menus      | `--button-padding`, `--button-gap`, `--input-padding`, `--control-border-width`, `--menu-padding`, `--menu-item-padding`, `--menu-item-gap`, `--menu-border-width`                                                                                                                                                |
| Dialogs and theme cards | `--modal-heading-padding`, `--modal-content-padding`, `--modal-border-width`, `--theme-library-padding`, `--theme-card-padding`, `--theme-list-gap`                                                                                                                                                               |

`--pane-spacing` adds padding inside each pane's allocated rectangle; adjacent
panes contribute spacing on both sides of the resize handle. It leaves the
handle and split geometry aligned, including nested splits. `--pane-border`
and `--pane-shadow` apply to terminal panels; file panels inherit these through
`--editor-border` and `--editor-shadow`. More spacing leaves less space for
content. Test ambitious themes at the minimum window size as well as full size.
Sidebar resizing reads the theme's computed width limits and available space;
saved widths survive switching back to a theme with wider limits.

CSS operates on the existing interface. It cannot introduce new application
commands, change the saved split tree, reorder actual tabs, or style text cells
inside xterm's canvas individually. Use the terminal options for canvas fonts
and colors. Window decorations provided by the OS remain outside the DOM.

## CSS files declared by JSON

`theme.json` is the entry point for every theme. Declare any number of local CSS
files in `stylesheets`; the application loads all of them automatically in both
windows. The array determines their cascade order, regardless of download order.
Files that are not declared or imported are not applied. A JSON-only theme may
omit `stylesheets` or use an empty array.

```json
{
  "version": 1,
  "name": "My theme",
  "stylesheets": [
    "styles/base.css",
    "styles/components.css",
    "styles/overrides.css"
  ]
}
```

These are full browser stylesheets, including pseudo-elements, responsive rules,
animations, `@font-face`, and `@import`. Use `:root[data-appearance="light"]` and
`:root[data-appearance="dark"]` for adaptive rules. Relative `url()` and `@import`
paths resolve from each CSS file, so `styles/base.css` can use
`url("../images/graphite.svg")` or `@import "parts/buttons.css"`. The resolved
resource must remain inside the same theme package. Browser CSS support and
normal cascade rules apply; CSS cannot execute application commands.

All declared files load before the theme replaces the current appearance. A
missing or unreadable declared stylesheet keeps the last working theme and
reports the failing path. Refresh also reloads local imports, images, and fonts;
changing themes removes all sheets belonging to the previous theme.

Existing manifests using `"stylesheet": "theme.css"` continue to work. Use only
one of `stylesheet` and `stylesheets`; duplicate paths in the array are rejected.
The old `customCss` preference is accepted when reading saved settings but no
longer disables files declared by the manifest. Loading preferences leaves the
file intact; the next explicit save omits this retired field.

## Images, transparency, and fonts

Background areas are `app`, `terminal`, `sidebar`, `titlebar`, `statusbar`,
`settings`, and `modal`. Each accepts:

| Property    | Value / default                                        |
| ----------- | ------------------------------------------------------ |
| `image`     | Optional relative image path                           |
| `size`      | CSS background size, default `cover`                   |
| `position`  | CSS background position, default `center`              |
| `repeat`    | CSS background repeat, default `no-repeat`             |
| `opacity`   | Image/overlay layer opacity, 0–1, default 1            |
| `blur`      | Image/overlay blur in pixels, 0–100, default 0         |
| `overlay`   | CSS color painted above the image, default transparent |
| `blendMode` | CSS blend mode, default `normal`                       |

Each image has its own layer, so opacity and blur do not affect terminal text
or controls. An app background can be covered by opaque child panels; adjust
surface colors or target those panels individually. Terminal ANSI applications
may intentionally paint colored cells over the image.

Use an alpha color such as `"#101010cc"` for translucent surfaces. To see through
the entire terminal area to the desktop, make the app background translucent
or transparent as well as `terminal.colors.background`. The `--opacity-window`
token fades the complete interface, including text; background alpha leaves
text opaque. `--radius-window` rounds the application surface.

Both native windows support transparent surfaces. Actual desktop compositing
and transparency depend on the OS/window manager. This does not implement a
native desktop blur effect: `backgrounds.*.blur` blurs the theme image inside
the application. macOS transparency uses Tauri's `macos-private-api` feature;
review that platform's distribution constraints when packaging for macOS.
See [Tauri's transparent window API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#method.transparent).

For arbitrary elements, `assets` makes local resources available as CSS URL
variables. This avoids document-relative URLs in JSON:

```json
{
  "version": 1,
  "name": "Local assets",
  "assets": { "wall": "images/graphite.svg" },
  "styles": { ".sidebar": { "background-image": "var(--asset-wall)" } }
}
```

A CSS file can reference local resources directly:

```css
@font-face {
  font-family: MyMono;
  src: url("fonts/MyMono.woff2") format("woff2");
  font-display: swap;
}

.sidebar {
  background-image: url("images/graphite.svg");
}
```

Set `terminal.fontFamily` to `"MyMono, monospace"`. When fonts finish loading,
existing terminals refit to the new metrics without restarting their shells.
PNG, JPEG, WebP, GIF, SVG, AVIF, ICO, WOFF, WOFF2, TTF, and OTF are supported as
local resources. A particular image/font format also needs webview support.
The asset protocol serves only CSS, images, and fonts inside installed themes;
it does not expose project files or scripts. Network resources are blocked by
the application's CSP. Local CSS imports work relative to their CSS file.

## Terminal options

All 16 ANSI palette entries are configurable under `terminal.colors`:
`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and their
`brightBlack` through `brightWhite` equivalents. Additional entries are
`background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground`,
`selectionForeground`, `selectionInactiveBackground`, `searchMatchBackground`,
`searchActiveMatchBackground`, `searchMatchBorder`, and `searchActiveMatchBorder`.
Colors accept CSS color values. Omit `selectionForeground` to retain the text's
original colors when selected.

| Option                         | Values / bounds                                |
| ------------------------------ | ---------------------------------------------- |
| `fontFamily`                   | CSS font family list                           |
| `fontSize`                     | 6–72 pixels                                    |
| `lineHeight`                   | 1–3                                            |
| `letterSpacing`                | −2–20 pixels                                   |
| `fontWeight`, `fontWeightBold` | `normal`, `bold`, or 1–1000                    |
| `cursorStyle`                  | `bar`, `block`, `underline`                    |
| `cursorInactiveStyle`          | `outline`, `bar`, `block`, `underline`, `none` |
| `cursorBlink`                  | Boolean                                        |
| `cursorWidth`                  | 1–10 pixels                                    |
| `minimumContrastRatio`         | 1–21                                           |
| `drawBoldTextInBrightColors`   | Boolean                                        |

Terminal CSS tokens use kebab-case (`--terminal-font-size`,
`--terminal-selection-background`); font size and letter spacing tokens use
pixel units. Boolean tokens use `"0"`/`"1"`. A CSS theme can override these tokens
too. The terminal canvas is transparent so the pane can paint images and alpha
colors. Use the terminal section/tokens to style glyphs; CSS selectors cannot
style individual WebGL glyphs. Scrollback, transport, shell execution, and
shortcut handling are not theme settings.

## Recovery and limits

**Restore DeepMono** explicitly replaces the saved theme selection. It does not
modify theme packages. To remove CSS from a theme, omit `stylesheets` or set it to
`[]` in its manifest and refresh. If a theme hides settings or makes the UI unusable,
close the application and launch it with `SIMPLEBENCH_SAFE_THEME=1`. This loads
DeepMono without modifying the saved selection. Then use Restore DeepMono and
launch normally without that environment variable. Alternatively, move the
selected theme folder out of the library while the application is closed.

The manifest and each CSS file are limited to 256 KiB. Resources and imported
files are limited to 20 MiB each. Imports allow at most 64 MiB, 1024 entries,
and 16 nested directory levels. Failed imports leave the source intact and
remove their partial copy. Duplicate folder names never overwrite an installed
theme. Only the settings window may change theme preferences, import/create
packages, or open theme folders; both windows may read and apply themes.
