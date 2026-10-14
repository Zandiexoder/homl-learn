import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { CUSTOM } from "./custom";
import { KIT } from "./kit/registry";
import { palette as getPalette } from "./kit/theme";
import type { VideoSpec } from "./kit/types";
import { Panels } from "./kit/scenes/lists";

/** Catches a crashing custom scene and shows the narration as cards instead of failing the render. */
class SceneBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const Explainer: React.FC<{ spec: VideoSpec }> = ({ spec }) => {
  const palette = getPalette(spec.palette);
  return (
    <AbsoluteFill style={{ background: palette.bgBottom }}>
      <Series>
        {spec.scenes.map((scene, i) => {
          const Component = (scene.type === "Custom" && scene.custom && CUSTOM[scene.custom]) || KIT[scene.type] || Panels;
          const props = { lines: scene.lines, accent: spec.accent, palette, props: scene.props ?? {}, durationInFrames: scene.durationInFrames };
          return (
            <Series.Sequence key={i} durationInFrames={scene.durationInFrames} name={`${i + 1}. ${scene.custom ?? scene.type}`}>
              <SceneBoundary fallback={<Panels {...props} props={{}} />}>
                <Component {...props} />
              </SceneBoundary>
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};
