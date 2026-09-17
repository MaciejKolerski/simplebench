const imageTypes: Record<string, string> = {
  png: "image/png",
  apng: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  dib: "image/bmp",
  // Native decoders convert formats unavailable in webviews to PNG.
  tif: "image/png",
  tiff: "image/png",
  tga: "image/png",
  dds: "image/png",
  pbm: "image/png",
  pgm: "image/png",
  ppm: "image/png",
  pam: "image/png",
  pnm: "image/png",
  qoi: "image/png",
  hdr: "image/png",
  exr: "image/png",
  ff: "image/png",
};

export function imagePreviewType(relative: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(relative)?.[1].toLowerCase();
  return extension && Object.hasOwn(imageTypes, extension)
    ? imageTypes[extension]
    : undefined;
}

export function isSvgFile(relative: string): boolean {
  return imagePreviewType(relative) === "image/svg+xml";
}
