import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LineTiming } from "./types";

/** Frame where line i starts (clamped to the lines that exist). */
export function lineStart(lines: LineTiming[], i: number): number {
  if (lines.length === 0) return 0;
  return lines[Math.max(0, Math.min(i, lines.length - 1))].start;
}

/**
 * Which line reveals item i of n. With more lines than items, the first line introduces the
 * scene and the items follow one per line; with fewer, items share lines evenly.
 */
export function revealLine(i: number, n: number, lineCount: number, at?: unknown): number {
  if (typeof at === "number" && Number.isFinite(at)) return Math.max(0, Math.min(at, lineCount - 1));
  if (lineCount <= 1) return 0;
  if (lineCount > n) return Math.min(i + 1, lineCount - 1);
  return Math.min(Math.floor((i * lineCount) / n), lineCount - 1);
}

/** 0..1 spring starting at startFrame; plain function so it can be used inside loops. */
export function springAt(frame: number, fps: number, startFrame: number): number {
  return spring({ frame: frame - startFrame, fps, config: { damping: 14, mass: 0.7 } });
}

/** 0..1 spring that starts when line i starts. */
export function useBeat(lines: LineTiming[], i: number, delay = 0): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - lineStart(lines, i) - delay, fps, config: { damping: 14, mass: 0.7 } });
}

/** 0..1 spring that starts at an absolute frame. */
export function useSpringAt(startFrame: number): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - startFrame, fps, config: { damping: 14, mass: 0.7 } });
}

/** Fade the whole scene out over its last frames. */
export function useSceneFade(durationInFrames: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, 8, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Index of the line being spoken now, or -1 before the first. */
export function useActiveLine(lines: LineTiming[]): number {
  const frame = useCurrentFrame();
  let active = -1;
  lines.forEach((l, i) => {
    if (frame >= l.start) active = i;
  });
  return active;
}

export function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}
