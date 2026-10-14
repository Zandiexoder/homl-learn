import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Card, fitSize, Ghost, Heading, Pop } from "../parts";
import { asArray, asText, lineStart, revealLine, springAt, useSceneFade } from "../timing";
import type { SceneProps } from "../types";
import { shade } from "../theme";

const PAD = 120;
type Item = Record<string, unknown>;

/** A process: boxes joined by arrows, with a packet travelling along each arrow once both ends exist. */
export const Flow: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const nodes = asArray<unknown>(props.nodes).slice(0, 5).map((n) => (typeof n === "string" ? { label: n } : (n as Item)));
  const n = nodes.length || 1;
  const width = 1920 - PAD * 2;
  const boxW = Math.min(300, (width - (n - 1) * 90) / n);
  const gap = n > 1 ? (width - boxW * n) / (n - 1) : 0;
  const starts = nodes.map((node, i) => lineStart(lines, revealLine(i, n, lines.length, node.at)));
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={70}>{title}</Heading>
          </Pop>
        )}
        <div style={{ position: "absolute", left: PAD, top: 420, width, height: 260 }}>
          {nodes.slice(0, -1).map((_, i) => {
            const x1 = i * (boxW + gap) + boxW;
            const x2 = x1 + gap;
            const shown = frame >= starts[i + 1];
            const grow = springAt(frame, fps, starts[i + 1]);
            const travel = ((frame - starts[i + 1]) % 45) / 45;
            return (
              <svg key={i} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={width} height={260} aria-hidden>
                <line x1={x1 + 12} y1={130} x2={x1 + 12 + (gap - 36) * (shown ? grow : 0)} y2={130} stroke={palette.line} strokeWidth={8} strokeLinecap="round" />
                {shown && grow > 0.95 && (
                  <>
                    <path d={`M${x2 - 30} 112 L${x2 - 8} 130 L${x2 - 30} 148`} stroke={palette.line} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={x1 + 20 + (gap - 50) * travel} cy={130} r={13} fill={accent} />
                  </>
                )}
              </svg>
            );
          })}
          {nodes.map((node, i) => {
            const label = asText(node.label ?? node.title);
            const left = i * (boxW + gap);
            if (frame < starts[i]) {
              return <Ghost key={i} label={i + 1} palette={palette} style={{ position: "absolute", left, top: 0, width: boxW, height: 260 }} />;
            }
            return (
              <Pop key={i} p={springAt(frame, fps, starts[i])} from="scale" style={{ position: "absolute", left, top: 0, width: boxW, height: 260 }}>
                <Card palette={palette} accent={accent} style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
                  <div style={{ fontSize: fitSize(label, 42, 16), fontWeight: 800, lineHeight: 1.2 }}>{label}</div>
                </Card>
              </Pop>
            );
          })}
        </div>
        {asText(props.caption) && (
          <Pop p={springAt(frame, fps, lineStart(lines, lines.length - 1))} style={{ position: "absolute", left: PAD, right: PAD, bottom: 140 }}>
            <div style={{ fontSize: 40, color: palette.muted, textAlign: "center", fontWeight: 700 }}>{asText(props.caption)}</div>
          </Pop>
        )}
      </AbsoluteFill>
    </Background>
  );
};

export const Timeline: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const events = asArray<Item>(props.events).slice(0, 6);
  const width = 1920 - PAD * 2;
  const step = events.length > 1 ? width / (events.length - 1) : 0;
  const axis = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={70}>{title}</Heading>
          </Pop>
        )}
        <div style={{ position: "absolute", left: PAD, top: 560, width: width * axis, height: 8, borderRadius: 4, background: palette.line }} />
        {events.map((ev, i) => {
          const start = lineStart(lines, revealLine(i, events.length, lines.length, ev.at));
          const p = springAt(frame, fps, start);
          const x = PAD + (events.length > 1 ? i * step : width / 2);
          const above = i % 2 === 0;
          const shown = frame >= start;
          const date = asText(ev.date);
          const label = asText(ev.label ?? ev.title);
          return (
            <React.Fragment key={i}>
              <div
                style={{
                  position: "absolute",
                  left: x - 22,
                  top: 542,
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: shown ? accent : "transparent",
                  border: `5px ${shown ? "solid" : "dashed"} ${shown ? shade(accent, -0.3) : palette.line}`,
                  boxSizing: "border-box",
                  transform: `scale(${shown ? interpolate(p, [0, 1], [0.3, 1]) : 1})`,
                }}
              />
              {shown && (
                <Pop
                  p={p}
                  style={{
                    position: "absolute",
                    left: Math.min(Math.max(x - 170, PAD - 40), 1920 - PAD - 300),
                    top: above ? 300 : 630,
                    width: 340,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 40, fontWeight: 900, color: accent }}>{date}</div>
                  <div style={{ fontSize: fitSize(label, 34, 40), fontWeight: 700, marginTop: 8, lineHeight: 1.25 }}>{label}</div>
                </Pop>
              )}
            </React.Fragment>
          );
        })}
      </AbsoluteFill>
    </Background>
  );
};

/** Bar chart. Values are drawn only when the source gives them; otherwise bars are schematic levels. */
export const Chart: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const bars = asArray<Item>(props.bars).slice(0, 7);
  const values = bars.map((b) => (typeof b.value === "number" ? b.value : typeof b.level === "number" ? b.level : 3));
  const max = Math.max(...values, 1);
  const showValues = props.showValues === true && bars.every((b) => typeof b.value === "number");
  const unit = asText(props.unit);
  const plotH = 560;
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={64}>{title}</Heading>
          </Pop>
        )}
        <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 170, height: plotH, display: "flex", alignItems: "flex-end", gap: 40, borderBottom: `6px solid ${palette.line}` }}>
          {bars.map((bar, i) => {
            const start = lineStart(lines, revealLine(i, bars.length, lines.length, bar.at));
            const p = springAt(frame, fps, start);
            const h = (values[i] / max) * (plotH - 80) * (frame >= start ? p : 0);
            const color = bar.highlight === true ? accent : i % 2 ? shade(accent, 0.35) : accent;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                {showValues && frame >= start && (
                  <div style={{ fontSize: 36, fontWeight: 900, opacity: p }}>
                    {String(bar.value)}
                    {unit}
                  </div>
                )}
                <div
                  style={{
                    width: "100%",
                    height: frame >= start ? h : plotH * 0.35,
                    borderRadius: "20px 20px 0 0",
                    background: frame >= start ? color : "transparent",
                    border: frame >= start ? "none" : `3px dashed ${palette.line}`,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: PAD, right: PAD, bottom: 90, display: "flex", gap: 40 }}>
          {bars.map((bar, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: fitSize(asText(bar.label), 32, 14), fontWeight: 700, color: palette.muted }}>
              {asText(bar.label)}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </Background>
  );
};

/** A central idea with related ideas orbiting it. */
export const Orbit: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const center = asText(props.center);
  const items = asArray<unknown>(props.items).slice(0, 6).map((x) => asText(typeof x === "object" && x ? (x as Item).label : x));
  const cx = 960;
  const cy = 560;
  const rx = 620;
  const ry = 330;
  const pCenter = springAt(frame, fps, 0);
  const spin = frame / 900;
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={palette.line} strokeWidth={4} strokeDasharray="14 18" />
      </svg>
      {items.map((label, i) => {
        const start = lineStart(lines, revealLine(i, items.length, lines.length));
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2 + spin;
        const x = cx + Math.cos(angle) * rx;
        const y = cy + Math.sin(angle) * ry;
        const p = springAt(frame, fps, start);
        const shown = frame >= start;
        return (
          <div key={i} style={{ position: "absolute", left: x - 170, top: y - 60, width: 340, height: 120 }}>
            {shown ? (
              <Pop p={p} from="scale" style={{ height: "100%" }}>
                <Card palette={palette} accent={accent} style={{ height: "100%", padding: 16, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", background: palette.bgBottom }}>
                  <div style={{ fontSize: fitSize(label, 36, 22), fontWeight: 800 }}>{label}</div>
                </Card>
              </Pop>
            ) : (
              <Ghost label={i + 1} palette={palette} style={{ height: "100%" }} />
            )}
          </div>
        );
      })}
      <Pop p={pCenter} from="scale" style={{ position: "absolute", left: cx - 200, top: cy - 200, width: 400, height: 400 }}>
        <div
          style={{
            width: 400,
            height: 400,
            borderRadius: 200,
            background: accent,
            color: shade(accent, -0.75),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 50,
            boxSizing: "border-box",
            fontSize: fitSize(center, 56, 16),
            fontWeight: 900,
            boxShadow: `0 0 0 24px ${accent}33`,
          }}
        >
          {center}
        </div>
      </Pop>
    </Background>
  );
};

/** Two extremes with markers placed between them (position 0..1). */
export const Spectrum: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title);
  const markers = asArray<Item>(props.markers).slice(0, 5);
  const left = PAD + 60;
  const width = 1920 - left * 2;
  const grow = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD }}>
        {title && (
          <Pop p={springAt(frame, fps, 0)}>
            <Heading size={66}>{title}</Heading>
          </Pop>
        )}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left,
          top: 560,
          width: width * grow,
          height: 28,
          borderRadius: 14,
          background: `linear-gradient(90deg, ${shade(accent, 0.55)}, ${accent})`,
        }}
      />
      <div style={{ position: "absolute", left, top: 610, fontSize: 40, fontWeight: 900 }}>{asText(props.left)}</div>
      <div style={{ position: "absolute", right: left, top: 610, fontSize: 40, fontWeight: 900, textAlign: "right" }}>{asText(props.right)}</div>
      {markers.map((m, i) => {
        const start = lineStart(lines, revealLine(i, markers.length, lines.length, m.at));
        if (frame < start) return null;
        const p = springAt(frame, fps, start);
        const pos = typeof m.position === "number" ? Math.max(0, Math.min(1, m.position)) : (i + 1) / (markers.length + 1);
        const x = left + pos * width;
        const label = asText(m.label);
        // Markers sit above the bar at alternating heights so neighbours don't collide.
        const stem = i % 2 ? 110 : 210;
        return (
          <Pop key={i} p={p} style={{ position: "absolute", left: x - 160, top: 560 - stem - 60, width: 320, textAlign: "center" }}>
            <div style={{ fontSize: fitSize(label, 36, 24), fontWeight: 800, marginBottom: 10, height: 50 }}>{label}</div>
            <div style={{ width: 8, height: stem, background: palette.text, margin: "0 auto", borderRadius: 4, opacity: 0.6 }} />
          </Pop>
        );
      })}
    </Background>
  );
};
