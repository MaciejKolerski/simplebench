export const MAX_ANDROID_PIXELS = 720 * 1280;
export const MAX_ANDROID_DISPLAY_EDGE = 4096;
export const MAX_ANDROID_DISPLAY_PIXELS = 3840 * 2160;

/** Bound the source before IPC without changing the guest's screen or density. */
export function previewSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    return { width: 1, height: 1 };
  const scale = Math.min(
    1,
    1280 / width,
    1280 / height,
    Math.sqrt(MAX_ANDROID_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
export const ANDROID_FRAME_HEADER = 68;

export interface AndroidFrame {
  epoch: number;
  sequence: number;
  timestampUs: bigint;
  width: number;
  height: number;
  rotation: 0 | 1 | 2 | 3;
  pixels: Uint8Array<ArrayBuffer>;
}

export function generationBytes(generation: string): Uint8Array {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      generation,
    )
  )
    throw new Error("Invalid Android process generation.");
  return Uint8Array.from(generation.replaceAll("-", "").match(/../g)!, (pair) =>
    parseInt(pair, 16),
  );
}

/** Borrows the binary IPC allocation; no pixel copying or JSON conversion. */
export function decodeFrame(
  bytes: ArrayBuffer,
  generation: Uint8Array,
): AndroidFrame {
  if (
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength < 1024 ||
    bytes.byteLength > ANDROID_FRAME_HEADER + MAX_ANDROID_PIXELS * 4
  )
    throw new Error("Invalid Android binary frame size. Reconnect the panel.");
  const header = new DataView(bytes);
  if (
    header.getUint32(0, true) !== 0x50414253 ||
    header.getUint32(4, true) !== 4 ||
    generation.length !== 16
  )
    throw new Error("Unsupported Android frame protocol. Reconnect the panel.");
  for (let i = 0; i < 16; i++) {
    if (header.getUint8(8 + i) !== generation[i])
      throw new Error("Android frame belongs to an old process.");
  }
  const epoch = Number(header.getBigUint64(24, true));
  const sequence = Number(header.getBigUint64(32, true));
  const width = header.getUint32(48, true);
  const height = header.getUint32(52, true);
  const rotation = header.getUint32(56, true);
  const encoding = header.getUint32(60, true);
  const length = header.getUint32(64, true);
  if (
    !Number.isSafeInteger(epoch) ||
    !Number.isSafeInteger(sequence) ||
    epoch < 1 ||
    sequence < 1 ||
    rotation > 3 ||
    encoding !== 0 ||
    width > 1280 ||
    height > 1280 ||
    width * height > MAX_ANDROID_PIXELS ||
    (width === 0) !== (height === 0) ||
    length !== width * height * 4 ||
    Math.max(ANDROID_FRAME_HEADER + length, 1024) !== bytes.byteLength
  )
    throw new Error(
      "Invalid Android frame dimensions or metadata. Reconnect the panel.",
    );
  return {
    epoch,
    sequence,
    timestampUs: header.getBigUint64(40, true),
    width,
    height,
    rotation: rotation as AndroidFrame["rotation"],
    pixels: new Uint8Array(bytes, ANDROID_FRAME_HEADER, length),
  };
}

/** Coordinates are physical guest pixels in its natural orientation. */
export function touchPoint(
  bounds: { left: number; top: number; width: number; height: number },
  frame: Pick<AndroidFrame, "width" | "height" | "rotation">,
  display: readonly [number, number],
  clientX: number,
  clientY: number,
  clamp: boolean,
): { x: number; y: number } | undefined {
  if (
    !frame.width ||
    !frame.height ||
    display.some(
      (value) =>
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_ANDROID_DISPLAY_EDGE,
    ) ||
    display[0] * display[1] > MAX_ANDROID_DISPLAY_PIXELS
  )
    return;
  const scale = Math.min(
    bounds.width / frame.width,
    bounds.height / frame.height,
  );
  if (!Number.isFinite(scale) || scale <= 0) return;
  const left = bounds.left + (bounds.width - frame.width * scale) / 2;
  const top = bounds.top + (bounds.height - frame.height * scale) / 2;
  let u = (clientX - left) / (frame.width * scale);
  let v = (clientY - top) / (frame.height * scale);
  if (
    !Number.isFinite(u) ||
    !Number.isFinite(v) ||
    (!clamp && (u < 0 || v < 0 || u >= 1 || v >= 1))
  )
    return;
  u = Math.max(0, Math.min(1, u));
  v = Math.max(0, Math.min(1, v));
  const point = [
    [u, v],
    [1 - v, u],
    [1 - u, 1 - v],
    [v, 1 - u],
  ][frame.rotation];
  if (!point) return;
  return {
    x: Math.min(display[0] - 1, Math.floor(point[0] * display[0])),
    y: Math.min(display[1] - 1, Math.floor(point[1] * display[1])),
  };
}

/** Release native IPC storage promptly on engines with transferable buffers. */
export function releaseFrame(bytes: ArrayBuffer) {
  const transferable = bytes as ArrayBuffer & {
    transfer?: (size: number) => ArrayBuffer;
  };
  transferable.transfer?.(0);
}
