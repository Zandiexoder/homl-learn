import type React from "react";
import type { SceneProps } from "./types";
import { Definition, Hook, Quote, Recap, Title } from "./scenes/basic";
import { Cast, Comparison, Panels, Steps } from "./scenes/lists";
import { Chart, Flow, Orbit, Spectrum, Timeline } from "./scenes/diagrams";

export const KIT: Record<string, React.FC<SceneProps>> = {
  Title,
  Hook,
  Definition,
  Quote,
  Steps,
  Comparison,
  Flow,
  Timeline,
  Chart,
  Panels,
  Cast,
  Orbit,
  Spectrum,
  Recap,
};
