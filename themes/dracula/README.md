# Dracula for SimpleBench

An adaptive theme based on Graplo's Dracula 1.0.2 palette for DankMaterialShell,
including its Alucard light variant. The palette is bundled here; the original
DankMaterialShell installation is not needed.

Import this folder through **Settings → Themes → Import folder**, then choose
**Dracula**. Alternatively, copy it into the theme library shown in Settings
and press **Refresh**. On Linux, the default location is
`~/.local/share/dev.simplebench.desktop/themes/dracula/`.

**Color mode → Dark** uses Dracula, **Light** uses Alucard, and **System** follows
the operating system. Both application windows, file editors, and terminal
panes use the selected palette.

`theme.json` contains the dark palette and terminal colors. `theme.css` contains
the light palette, the active tab underline, and subdued editor comments.
The terminal adds Dracula's green (`#50fa7b`) to the source palette. Light-mode
pink, error, warning, info, and terminal green are darkened for readable text;
muted dark-mode text is lightened from the source outline color. Fonts, sizing,
and layout inherit the application's defaults.
