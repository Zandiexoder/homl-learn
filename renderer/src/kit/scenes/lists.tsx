import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Card, Citizen, fitSize, Ghost, Heading, Pop } from "../parts";
import { asArray, asText, lineStart, revealLine, springAt, useSceneFade } from "../timing";
import type { SceneProps } from "../types";
import { shade } from "../theme";

const PAD = 120;

type Item = Record<string, unknown>;

export const Steps: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const steps = asArray<Item>(props.steps).slice(0, 6);
  const vertical = steps.length > 4;
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, gap: 56 }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={70}>{title}</Heading>
          </Pop>
        )}
        <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: vertical ? 20 : 36, flex: 1 }}>
          {steps.map((step, i) => {
            const start = lineStart(lines, revealLine(i, steps.length, lines.length, step.at));
            const p = springAt(frame, fps, start);
            const label = asText(step.title ?? step.label);
            const detail = asText(step.detail);
            if (frame < start) {
              return <Ghost key={i} label={i + 1} palette={palette} style={vertical ? { height: 110 } : { flex: 1, height: 420 }} />;
            }
            return (
              <Pop key={i} p={p} style={vertical ? {} : { flex: 1 }}>
                <Card
                  palette={palette}
                  accent={accent}
                  style={{
                    height: vertical ? 110 : 420,
                    display: "flex",
                    flexDirection: vertical ? "row" : "column",
                    alignItems: vertical ? "center" : "flex-start",
                    gap: vertical ? 30 : 24,
                    padding: vertical ? "0 36px" : "40px 36px",
                  }}
                >
                  <div
                    style={{
                      width: 76,
                      height: 76,
                      flex: "none",
                      borderRadius: 38,
                      background: accent,
                      color: shade(accent, -0.7),
                      fontSize: 42,
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: fitSize(label, vertical ? 44 : 46, vertical ? 50 : 26), fontWeight: 800 }}>{label}</div>
                    {detail && !vertical && (
                      <div style={{ fontSize: fitSize(detail, 32, 70), color: palette.muted, marginTop: 14, lineHeight: 1.3 }}>{detail}</div>
                    )}
                  </div>
                </Card>
              </Pop>
            );
          })}
        </div>
      </AbsoluteFill>
    </Background>
  );
};

export const Panels: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  let panels = asArray<Item>(props.panels).slice(0, 4);
  if (panels.length === 0) {
    // Fallback use: show the narration itself as cards.
    panels = lines.slice(0, 4).map((l) => ({ text: l.text }));
  }
  const cols = panels.length <= 2 ? panels.length : 2;
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, gap: 48 }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={70}>{title}</Heading>
          </Pop>
        )}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 36, flex: 1 }}>
          {panels.map((panel, i) => {
            const start = lineStart(lines, revealLine(i, panels.length, lines.length, panel.at));
            const p = springAt(frame, fps, start);
            const heading = asText(panel.title);
            const text = asText(panel.text);
            if (frame < start) return <Ghost key={i} label={i + 1} palette={palette} />;
            return (
              <Pop key={i} p={p} from="scale">
                <Card palette={palette} accent={accent} style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 22 }}>
                  <div style={{ width: 54, height: 54, borderRadius: i % 2 ? 14 : 27, background: i % 2 ? shade(accent, 0.3) : accent }} />
                  {heading && <div style={{ fontSize: fitSize(heading, panels.length <= 2 ? 64 : 50, 28), fontWeight: 900 }}>{heading}</div>}
                  {text && (
                    <div style={{ fontSize: fitSize(text, (heading ? 34 : 44) * (panels.length <= 2 ? 1.25 : 1), 90), color: heading ? palette.muted : palette.text, lineHeight: 1.3, fontWeight: heading ? 600 : 700 }}>
                      {text}
                    </div>
                  )}
                </Card>
              </Pop>
            );
          })}
        </div>
      </AbsoluteFill>
    </Background>
  );
};

export const Comparison: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const left = (props.left ?? {}) as Item;
  const right = (props.right ?? {}) as Item;
  const sides = [left, right];
  const total = sides.reduce((n, s) => n + asArray(s.points).length, 0);
  let counter = 0;
  const other = shade(accent, 0.45);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, flexDirection: "row", gap: 60 }}>
        {sides.map((side, s) => {
          const color = s === 0 ? accent : other;
          const p = springAt(frame, fps, s === 0 ? 0 : 8);
          return (
            <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 26 }}>
              <Pop p={p}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ width: 22, height: 70, borderRadius: 11, background: color }} />
                  <Heading size={fitSize(asText(side.title), 66, 18)}>{asText(side.title)}</Heading>
                </div>
              </Pop>
              {asArray<unknown>(side.points).map((point, i) => {
                const idx = counter++;
                const start = lineStart(lines, revealLine(idx, total, lines.length));
                const text = asText(point);
                if (frame < start) return <Ghost key={i} label="" palette={palette} style={{ height: 100 }} />;
                return (
                  <Pop key={i} p={springAt(frame, fps, start)}>
                    <Card palette={palette} accent={color} style={{ padding: "26px 32px" }}>
                      <div style={{ fontSize: fitSize(text, 40, 60), fontWeight: 700 }}>{text}</div>
                    </Card>
                  </Pop>
                );
              })}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 960 - 3,
            top: 160,
            bottom: 160,
            width: 6,
            borderRadius: 3,
            background: palette.line,
            transform: `scaleY(${interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" })})`,
          }}
        />
      </AbsoluteFill>
    </Background>
  );
};

export const Cast: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const people = asArray<Item>(props.people).slice(0, 4);
  const colors = [accent, ...palette.accents.filter((a) => a !== accent)];
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, gap: 30 }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={70}>{title}</Heading>
          </Pop>
        )}
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", flex: 1 }}>
          {people.map((person, i) => {
            const start = lineStart(lines, revealLine(i, people.length, lines.length, person.at));
            const p = springAt(frame, fps, start);
            if (frame < start) return <Ghost key={i} label={i + 1} palette={palette} style={{ width: 300, height: 420 }} />;
            const name = asText(person.name);
            const role = asText(person.role);
            return (
              <Pop key={i} p={p} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: 380 }}>
                <Citizen color={colors[i % colors.length]} size={people.length > 3 ? 230 : 280} palette={palette} mood={i % 2 ? "curious" : "happy"} />
                <div style={{ fontSize: fitSize(name, 46, 18), fontWeight: 900, textAlign: "center" }}>{name}</div>
                {role && <div style={{ fontSize: fitSize(role, 30, 40), color: palette.muted, textAlign: "center", lineHeight: 1.25 }}>{role}</div>}
              </Pop>
            );
          })}
        </div>
      </AbsoluteFill>
    </Background>
  );
};
