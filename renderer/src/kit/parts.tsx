import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { FONT, type Palette, shade } from "./theme";

/** Dark (or paper) gradient with slow drifting shapes. */
export const Background: React.FC<{ palette: Palette; accent: string; children?: React.ReactNode; opacity?: number }> = ({
  palette,
  accent,
  children,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const drift = (speed: number, range: number) => Math.sin(frame / speed) * range;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${palette.bgTop} 0%, ${palette.bgBottom} 100%)`,
        fontFamily: FONT,
        color: palette.text,
      }}
    >
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }} aria-hidden>
        <circle cx={220 + drift(90, 30)} cy={180 + drift(70, 20)} r={140} fill={accent} opacity={0.045} />
        <circle cx={1700 + drift(80, 25)} cy={880 + drift(100, 30)} r={220} fill={accent} opacity={0.04} />
        <circle cx={1560 + drift(60, 15)} cy={160} r={6} fill={palette.text} opacity={0.5} />
        <circle cx={380} cy={940 + drift(50, 10)} r={4} fill={palette.text} opacity={0.4} />
        <circle cx={980 + drift(120, 40)} cy={70} r={3} fill={palette.text} opacity={0.35} />
      </svg>
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Dashed numbered placeholder shown until its item is spoken, so no frame looks half empty. */
export const Ghost: React.FC<{ label?: string | number; palette: Palette; style?: React.CSSProperties }> = ({
  label,
  palette,
  style,
}) => (
  <div
    style={{
      border: `3px dashed ${palette.line}`,
      borderRadius: 28,
      color: palette.muted,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 40,
      fontWeight: 800,
      opacity: 0.7,
      ...style,
    }}
  >
    {label}
  </div>
);

/** Pops in with the given 0..1 progress. */
export const Pop: React.FC<{ p: number; children: React.ReactNode; style?: React.CSSProperties; from?: "up" | "scale" }> = ({
  p,
  children,
  style,
  from = "up",
}) => {
  const transform =
    from === "scale" ? `scale(${interpolate(p, [0, 1], [0.6, 1])})` : `translateY(${interpolate(p, [0, 1], [40, 0])}px)`;
  return <div style={{ opacity: Math.min(1, p * 1.4), transform, ...style }}>{children}</div>;
};

/** A rounded, friendly "citizen" character. Original design: a soft blob with eyes. */
export const Citizen: React.FC<{
  color: string;
  size?: number;
  mood?: "happy" | "curious" | "surprised";
  blink?: number;
  palette: Palette;
}> = ({ color, size = 220, mood = "happy", palette }) => {
  const frame = useCurrentFrame();
  const bob = Math.sin(frame / 9) * 6;
  const blinking = frame % 96 < 4;
  const eyeH = blinking ? 2 : 16;
  const mouth =
    mood === "surprised" ? (
      <ellipse cx="100" cy="128" rx="11" ry="14" fill={shade(color, -0.55)} />
    ) : mood === "curious" ? (
      <>
        <path d="M84 124 q16 12 32 -2" stroke={shade(color, -0.55)} strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M110 80 q12 -10 24 -4" stroke={shade(color, -0.55)} strokeWidth="5" fill="none" strokeLinecap="round" />
      </>
    ) : (
      <path d="M80 122 q20 22 40 0" stroke={shade(color, -0.55)} strokeWidth="6" fill="none" strokeLinecap="round" />
    );
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 200 220" style={{ transform: `translateY(${bob}px)` }} aria-hidden>
      <ellipse cx="100" cy="212" rx="60" ry="8" fill="#000" opacity={palette.id === "paper" ? 0.12 : 0.25} />
      <path d="M30 120 C30 50, 170 50, 170 120 L170 175 C170 200, 30 200, 30 175 Z" fill={color} />
      <path d="M44 112 C48 72, 100 62, 120 66" stroke={shade(color, 0.35)} strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.6" />
      <ellipse cx="78" cy="102" rx="9" ry={eyeH / 2 + 1} fill="#1A1A2E" />
      <ellipse cx="122" cy="102" rx="9" ry={eyeH / 2 + 1} fill="#1A1A2E" />
      {mouth}
      <circle cx="62" cy="122" r="9" fill="#FF8A8A" opacity="0.35" />
      <circle cx="138" cy="122" r="9" fill="#FF8A8A" opacity="0.35" />
    </svg>
  );
};

export const Heading: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({
  children,
  size = 76,
  style,
}) => (
  <div style={{ fontSize: size, fontWeight: 900, lineHeight: 1.08, letterSpacing: -1, ...style }}>{children}</div>
);

/** A soft rounded card. */
export const Card: React.FC<{ palette: Palette; accent?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  palette,
  accent,
  children,
  style,
}) => (
  <div
    style={{
      background: palette.panel,
      borderRadius: 32,
      padding: "36px 40px",
      border: `2px solid ${accent ? accent + "66" : palette.line}`,
      boxSizing: "border-box",
      ...style,
    }}
  >
    {children}
  </div>
);

/** Text sized down so long strings still fit their box. */
export function fitSize(text: string, base: number, maxChars: number, min = 0.55): number {
  if (text.length <= maxChars) return base;
  return Math.max(base * min, base * (maxChars / text.length) ** 0.6);
}
