import React from "react";
import { Composition, continueRender, delayRender } from "remotion";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import { Explainer } from "./Explainer";
import { Infographic, type InfographicSpec } from "./Infographic";
import type { VideoSpec } from "./kit/types";

// Wait for the bundled fonts before the first frame is captured.
const fontHandle = delayRender("fonts");
document.fonts.ready.then(() => continueRender(fontHandle));

const SAMPLE: VideoSpec = {
  title: "Sample",
  palette: "deep-space",
  accent: "#F2B33D",
  fps: 30,
  width: 1920,
  height: 1080,
  scenes: [{ type: "Title", props: { title: "Homl Learn" }, lines: [{ text: "Hello", start: 0, end: 60 }], durationInFrames: 90 }],
};

const SAMPLE_INFOGRAPHIC: InfographicSpec = {
  kind: "infographic",
  palette: "paper",
  accent: "#2F6F9F",
  data: { title: "Homl Learn", sections: [{ heading: "Sample", text: "Replace me" }] },
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="Infographic"
    component={Infographic}
    defaultProps={{ spec: SAMPLE_INFOGRAPHIC }}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
  />
  <Composition
    id="Explainer"
    component={Explainer}
    defaultProps={{ spec: SAMPLE }}
    durationInFrames={90}
    fps={30}
    width={1920}
    height={1080}
    calculateMetadata={({ props }) => {
      const spec = props.spec as VideoSpec;
      return {
        durationInFrames: Math.max(1, spec.scenes.reduce((n, s) => n + s.durationInFrames, 0)),
        fps: spec.fps,
        width: spec.width,
        height: spec.height,
      };
    }}
  />
  </>
);
