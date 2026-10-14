import type { Palette } from "./theme";

/** One narrated line, in frames relative to the start of its scene. */
export type LineTiming = { text: string; start: number; end: number };

export type SceneSpec = {
  type: string;
  props: Record<string, unknown>;
  lines: LineTiming[];
  durationInFrames: number;
  /** For type "Custom": the component name registered in src/custom. */
  custom?: string;
};

export type VideoSpec = {
  title: string;
  palette: string;
  accent: string;
  fps: number;
  width: number;
  height: number;
  scenes: SceneSpec[];
};

/** Props every scene component receives. */
export type SceneProps = {
  lines: LineTiming[];
  accent: string;
  palette: Palette;
  props: Record<string, unknown>;
  durationInFrames: number;
};
