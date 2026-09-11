import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error(
    "Compiling the macOS icon requires macOS and Xcode 26 or later.",
  );
}

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const iconSource = path.join(projectRoot, "public", "Simplebench.icon");
const outputDirectory = path.join(
  projectRoot,
  "src-tauri",
  "target",
  "macos-icon",
);
const fallbackIcon = path.join(projectRoot, "src-tauri", "icons", "icon.icns");

mkdirSync(outputDirectory, { recursive: true });
execFileSync(
  "xcrun",
  [
    "actool",
    iconSource,
    "--compile",
    outputDirectory,
    "--app-icon",
    "Simplebench",
    "--output-partial-info-plist",
    path.join(outputDirectory, "icon-info.plist"),
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "10.13",
    "--target-device",
    "mac",
    "--output-format",
    "human-readable-text",
    "--errors",
    "--warnings",
  ],
  { stdio: "inherit" },
);

const compiledIcon = readFileSync(
  path.join(outputDirectory, "Simplebench.icns"),
);
if (
  !existsSync(fallbackIcon) ||
  !readFileSync(fallbackIcon).equals(compiledIcon)
) {
  writeFileSync(fallbackIcon, compiledIcon);
}
