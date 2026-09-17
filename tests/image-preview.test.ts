import assert from "node:assert/strict";
import { test } from "node:test";
import { imagePreviewType, isSvgFile } from "../src/image-preview.ts";
import {
  fileTabs,
  newProject,
  newSession,
  openFileTab,
  restoreSession,
  updateFilePreviewView,
} from "../src/model.ts";

test("image files use case-insensitive extensions and converted formats use PNG", () => {
  for (const [file, type] of [
    ["assets/photo.PNG", "image/png"],
    ["assets/photo.JPEG", "image/jpeg"],
    ["photo.webp", "image/webp"],
    ["favicon.ICO", "image/x-icon"],
    ["animation.apng", "image/png"],
    ["animation.gif", "image/gif"],
    ["vector.svg", "image/svg+xml"],
    ["image.avif", "image/avif"],
    ["image.bmp", "image/bmp"],
    ...[
      "tif",
      "tiff",
      "tga",
      "dds",
      "pbm",
      "pgm",
      "ppm",
      "pam",
      "pnm",
      "qoi",
      "hdr",
      "exr",
      "ff",
    ].map((extension) => [`image.${extension}`, "image/png"]),
  ])
    assert.equal(imagePreviewType(file), type, file);
});

test("text files and image directory names are not image previews", () => {
  for (const path of [
    "main.ts",
    "image.png.txt",
    "dir.png/file",
    "dir.png\\file",
    "README",
    "constructor",
    "image.toString",
  ])
    assert.equal(imagePreviewType(path), undefined, path);
});

test("SVG view modes restore with the same editor default as Markdown", () => {
  const project = newProject("/project", "bash");
  const initial = openFileTab(
    { ...newSession(), projects: [project], activeProjectId: project.id },
    project.workspaces[0].id,
    project.path,
    "vector.SVG",
  );
  const file = fileTabs(initial)[0];
  assert.equal(isSvgFile(file.relative), true);
  assert.equal(isSvgFile("vector.svg.txt"), false);
  assert.equal(isSvgFile("picture.png"), false);
  for (const mode of ["editor", "split", "preview"] as const) {
    const state = updateFilePreviewView(initial, file.id, mode);
    const restored = restoreSession(JSON.parse(JSON.stringify(state)), {
      directory: project.path,
      home: "/home/test",
      platform: "linux",
      profiles: [],
    });
    assert.equal(fileTabs(restored)[0].previewView ?? "editor", mode);
    assert.equal(fileTabs(restored)[0].id, file.id);
  }
});
