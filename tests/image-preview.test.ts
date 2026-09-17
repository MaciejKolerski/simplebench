import assert from "node:assert/strict";
import { test } from "node:test";
import { imagePreviewType } from "../src/image-preview.ts";

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
