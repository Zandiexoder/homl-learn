import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Card, Citizen, fitSize, Ghost, Heading, Pop } from "../parts";
import { asArray, asText, lineStart, revealLine, springAt, useSceneFade } from "../timing";
import type { SceneProps } from "../types";
import { shade } from "../theme";

const PAD = 120;

export const Title: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title, lines[0]?.text ?? "");
  const subtitle = asText(props.subtitle);
  const kicker = asText(props.kicker);
  const p = springAt(frame, fps, 0);
  const p2 = springAt(frame, fps, lineStart(lines, 1) || 12);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, justifyContent: "center", gap: 36 }}>
        {kicker && (
          <Pop p={p}>
            <div style={{ color: accent, fontSize: 36, fontWeight: 800, letterSpacing: 6, textTransform: "uppercase" }}>
              {kicker}
            </div>
          </Pop>
        )}
        <Pop p={p}>
          <Heading size={fitSize(title, 120, 28)} style={{ maxWidth: 1500 }}>
            {title}
          </Heading>
        </Pop>
        <div style={{ width: interpolate(p, [0, 1], [0, 260]), height: 12, borderRadius: 6, background: accent }} />
        {subtitle && (
          <Pop p={p2}>
            <div style={{ fontSize: 48, color: palette.muted, maxWidth: 1400, fontWeight: 600 }}>{subtitle}</div>
          </Pop>
        )}
      </AbsoluteFill>
    </Background>
  );
};

export const Hook: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const question = asText(props.question, lines[0]?.text ?? "");
  const p = springAt(frame, fps, 0);
  const pBubble = springAt(frame, fps, 10);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, flexDirection: "row", alignItems: "center", gap: 80 }}>
        <Pop p={p} from="scale">
          <Citizen color={accent} size={420} mood="curious" palette={palette} />
        </Pop>
        <Pop p={pBubble} style={{ flex: 1 }}>
          <Card palette={palette} accent={accent} style={{ borderRadius: 48, padding: "56px 64px", position: "relative" }}>
            <Heading size={fitSize(question, 84, 60)}>{question}</Heading>
          </Card>
        </Pop>
      </AbsoluteFill>
    </Background>
  );
};

export const Definition: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const term = asText(props.term);
  const definition = asText(props.definition);
  const source = asText(props.source);
  const pTerm = springAt(frame, fps, 0);
  const pDef = springAt(frame, fps, lineStart(lines, lines.length > 1 ? 1 : 0) + 6);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, justifyContent: "center", gap: 48 }}>
        <Pop p={pTerm}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 28 }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: accent }} />
            <Heading size={fitSize(term, 110, 22)} style={{ color: accent }}>
              {term}
            </Heading>
          </div>
        </Pop>
        <Pop p={pDef}>
          <Card palette={palette} style={{ maxWidth: 1500 }}>
            <div style={{ fontSize: fitSize(definition, 58, 120), lineHeight: 1.3, fontWeight: 700 }}>{definition}</div>
            {source && <div style={{ marginTop: 24, fontSize: 30, color: palette.muted }}>— {source}</div>}
          </Card>
        </Pop>
      </AbsoluteFill>
    </Background>
  );
};

export const Quote: React.FC<SceneProps> = ({ accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const quote = asText(props.quote);
  const attribution = asText(props.attribution);
  const p = springAt(frame, fps, 0);
  const pAttr = springAt(frame, fps, 20);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD + 60, justifyContent: "center", gap: 40 }}>
        <Pop p={p}>
          <div style={{ fontSize: 220, lineHeight: 0.6, color: accent, fontWeight: 900, height: 110 }}>“</div>
          <div style={{ fontSize: fitSize(quote, 70, 110), lineHeight: 1.25, fontWeight: 800, maxWidth: 1500 }}>{quote}</div>
        </Pop>
        {attribution && (
          <Pop p={pAttr}>
            <div style={{ fontSize: 40, color: palette.muted, fontWeight: 700 }}>— {attribution}</div>
          </Pop>
        )}
      </AbsoluteFill>
    </Background>
  );
};

export const Recap: React.FC<SceneProps> = ({ lines, accent, palette, props, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = useSceneFade(durationInFrames);
  const title = asText(props.title, "Recap");
  const points = asArray<unknown>(props.points).map((p) => asText(p));
  const pTitle = springAt(frame, fps, 0);
  return (
    <Background palette={palette} accent={accent} opacity={fade}>
      <AbsoluteFill style={{ padding: PAD, gap: 40 }}>
        <Pop p={pTitle}>
          <Heading>{title}</Heading>
        </Pop>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {points.map((point, i) => {
            const start = lineStart(lines, revealLine(i, points.length, lines.length));
            const p = springAt(frame, fps, start);
            const shown = frame >= start;
            return shown ? (
              <Pop key={i} p={p}>
                <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
                  <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
                    <circle cx="32" cy="32" r="30" fill={accent} />
                    <path
                      d="M18 33 l9 9 l19 -20"
                      stroke={shade(accent, -0.6)}
                      strokeWidth="7"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="50"
                      strokeDashoffset={interpolate(p, [0, 1], [50, 0])}
                    />
                  </svg>
                  <div style={{ fontSize: fitSize(point, 50, 60), fontWeight: 700 }}>{point}</div>
                </div>
              </Pop>
            ) : (
              <Ghost key={i} label={i + 1} palette={palette} style={{ height: 76, width: 900, justifyContent: "flex-start", paddingLeft: 30 }} />
            );
          })}
        </div>
      </AbsoluteFill>
    </Background>
  );
};
