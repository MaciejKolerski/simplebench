import { previewSize } from "./frame.ts";

export type ScreenZoom = "fit" | number;
export const ZOOM_STEPS = [25, 50, 75, 100, 150, 200, 300] as const;

export function boundedZoom(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(25, Math.min(300, Math.round(value)));
}

/** Percentages refer to preview pixels, independent of guest hardware resolution. */
export function screenSize(
  display: readonly [number, number],
  rotation: number,
  viewport: { width: number; height: number },
  dpr: number,
  zoom: ScreenZoom,
) {
  const width = display[rotation % 2 ? 1 : 0];
  const height = display[rotation % 2 ? 0 : 1];
  const preview = previewSize(width, height);
  const scale =
    zoom === "fit"
      ? Math.min(viewport.width / width, viewport.height / height)
      : ((preview.width / width) * zoom) / 100 / dpr;
  return { width, height, scale: Math.max(0, scale), preview };
}

export function zoomStep(current: number, direction: 1 | -1) {
  return direction === 1
    ? (ZOOM_STEPS.find((value) => value > current + 0.5) ?? 300)
    : ([...ZOOM_STEPS].reverse().find((value) => value < current - 0.5) ?? 25);
}

/** Fit can lie outside the explicit zoom range; never reverse the requested direction. */
export function relativeZoom(current: number, requested: number) {
  const bounded = boundedZoom(requested);
  return (requested - current) * (bounded - current) > 0 ? bounded : undefined;
}
