import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANDROID_FRAME_HEADER,
  decodeFrame,
  generationBytes,
  touchPoint,
  previewSize,
} from "../src/android/frame.ts";
import { relativeZoom, screenSize, zoomStep } from "../src/android/zoom.ts";

const generation = generationBytes("01234567-89ab-4def-8abc-0123456789ab");
function frame(width: number, height: number) {
  const bytes = new ArrayBuffer(
    Math.max(1024, ANDROID_FRAME_HEADER + width * height * 4),
  );
  const header = new DataView(bytes);
  header.setUint32(0, 0x50414253, true);
  header.setUint32(4, 4, true);
  new Uint8Array(bytes, 8, 16).set(generation);
  header.setBigUint64(24, 7n, true);
  header.setBigUint64(32, 123n, true);
  header.setBigUint64(40, 987654n, true);
  header.setUint32(48, width, true);
  header.setUint32(52, height, true);
  header.setUint32(64, width * height * 4, true);
  return { bytes, header };
}

test("Android binary frames borrow their pixels and keep process, epoch and sequence separate", () => {
  const { bytes } = frame(360, 640);
  const result = decodeFrame(bytes, generation);
  assert.equal(result.epoch, 7);
  assert.equal(result.sequence, 123);
  assert.equal(result.timestampUs, 987654n);
  assert.equal(result.pixels.buffer, bytes);
  assert.equal(result.pixels.byteOffset, ANDROID_FRAME_HEADER);
  assert.throws(
    () =>
      decodeFrame(
        bytes,
        generationBytes("01234567-89ab-4def-8abc-0123456789ac"),
      ),
    /old process/,
  );
  assert.equal(decodeFrame(frame(0, 0).bytes, generation).pixels.length, 0);
});

test("Android rejects oversized pixels, incomplete payloads, unsafe counters and invalid orientation", () => {
  for (const [offset, value] of [
    [48, 0xffffffff],
    [52, 0],
    [56, 4],
    [60, 1],
    [64, 7],
  ]) {
    const { bytes, header } = frame(2, 2);
    header.setUint32(offset, value, true);
    assert.throws(() => decodeFrame(bytes, generation));
  }
  const { bytes, header } = frame(2, 2);
  header.setBigUint64(24, 2n ** 53n, true);
  assert.throws(() => decodeFrame(bytes, generation));
  assert.throws(() => decodeFrame(frame(1280, 1280).bytes, generation));
  assert.throws(() => decodeFrame(new ArrayBuffer(68), generation));
});

test("Android maps all orientations through letterboxing and clamps only existing gestures", () => {
  const bounds = { left: 10, top: 20, width: 500, height: 640 };
  const pixels = { width: 360, height: 640, rotation: 0 as 0 | 1 | 2 | 3 };
  const display = [720, 1280] as const;
  assert.equal(touchPoint(bounds, pixels, display, 30, 100, false), undefined);
  assert.deepEqual(touchPoint(bounds, pixels, display, -100, -100, true), {
    x: 0,
    y: 0,
  });
  for (const [rotation, expected] of [
    [0, { x: 180, y: 384 }],
    [1, { x: 503, y: 320 }],
    [2, { x: 540, y: 896 }],
    [3, { x: 216, y: 960 }],
  ] as const) {
    pixels.rotation = rotation;
    assert.deepEqual(
      touchPoint(bounds, pixels, display, 170, 212, false),
      expected,
    );
  }
  assert.equal(touchPoint(bounds, pixels, display, NaN, 40, false), undefined);
  assert.equal(
    touchPoint({ ...bounds, width: 0 }, pixels, display, 20, 40, false),
    undefined,
  );
});

test("modern phone previews stay bounded while touch uses the full hardware display", () => {
  for (const display of [
    [1080, 2424],
    [1344, 2992],
    [1440, 3120],
  ] as const) {
    for (const rotation of [0, 1, 2, 3] as const) {
      const size = screenSize(
        display,
        rotation,
        { width: 550, height: 640 },
        2,
        300,
      );
      const pixels = previewSize(size.width, size.height);
      assert.ok(pixels.width <= 1280 && pixels.height <= 1280);
      assert.ok(pixels.width * pixels.height <= 720 * 1280);
      const bounds = {
        left: -240,
        top: -510,
        width: pixels.width * 1.5,
        height: pixels.height * 1.5,
      };
      const point = touchPoint(
        bounds,
        { ...pixels, rotation },
        display,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        false,
      )!;
      assert.ok(Math.abs(point.x - display[0] / 2) <= 1);
      assert.ok(Math.abs(point.y - display[1] / 2) <= 1);
    }
  }
  assert.deepEqual(previewSize(720, 1280), { width: 720, height: 1280 });
  assert.equal(zoomStep(99, 1), 100);
  assert.equal(zoomStep(151, -1), 150);
  assert.equal(zoomStep(300, 1), 300);
  assert.equal(relativeZoom(15, 10), undefined);
  assert.equal(relativeZoom(15, 20), 25);
  assert.equal(relativeZoom(400, 500), undefined);
  assert.equal(relativeZoom(400, 350), 300);
});
