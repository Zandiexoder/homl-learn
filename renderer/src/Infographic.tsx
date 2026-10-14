import React, { useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { Background, Card, Citizen, fitSize } from "./kit/parts";
import { FONT, palette as getPalette, shade } from "./kit/theme";

export type InfographicSpec = {
  kind: "infographic";
  palette: string;
  accent: string;
  data: {
    title: string;
    subtitle?: string;
    stats?: { value: string; label?: string }[];
    sections?: { heading: string; text?: string }[];
    steps?: string[];
    takeaway?: string;
    source?: string;
  };
};

/** A tall, single-image summary of the sources in the video kit's flat style. */
export const Infographic: React.FC<{ spec: InfographicSpec }> = ({ spec }) => {
  const palette = getPalette(spec.palette);
  const accent = spec.accent;
  const d = spec.data;
  const stats = (d.stats ?? []).slice(0, 4);
  const sections = (d.sections ?? []).slice(0, 4);
  const steps = (d.steps ?? []).slice(0, 5);
  const second = shade(accent, palette.id === "paper" ? 0.55 : 0.4);
  const onAccent = palette.id === "paper" ? "#ffffff" : shade(accent, -0.75);
  // Measure the laid-out content and shrink it to fit the frame, so long text never runs off the bottom.
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [fitted, setFitted] = useState(false);
  const tries = useRef(0);
  const [handle] = useState(() => delayRender("fit infographic"));
  useLayoutEffect(() => {
    if (fitted) return;
    document.fonts.ready.then(() => {
      const el = content.current;
      if (!el) return;
      // Scaling down widens the layout, which changes wrapping, so measure again until it settles.
      const natural = el.scrollHeight;
      const next = Math.min(1, 1890 / natural);
      const fits = natural * scale <= 1920;
      tries.current += 1;
      if ((fits && Math.abs(next - scale) < 0.02) || tries.current > 8) {
        setFitted(true);
        continueRender(handle);
      } else {
        setScale(next);
      }
    });
  }, [scale, fitted, handle]);
  const s = scale;
  return (
    <Background palette={palette} accent={accent}>
      <div ref={content} style={{ position: "absolute", left: 0, top: 0, width: 1080 / s, minHeight: fitted ? 1920 / s : undefined, transform: `scale(${s})`, transformOrigin: "top left", boxSizing: "border-box",
        padding: "96px 80px 72px", display: "flex", flexDirection: "column", gap: 48, fontFamily: FONT }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, textTransform: "uppercase", color: accent }}>At a glance</div>
          <div style={{ fontSize: fitSize(d.title, 96, 22), fontWeight: 900, lineHeight: 1.05, letterSpacing: -1 }}>{d.title}</div>
          {d.subtitle && <div style={{ fontSize: fitSize(d.subtitle, 40, 90), color: palette.muted, fontWeight: 600, lineHeight: 1.3 }}>{d.subtitle}</div>}
          <div style={{ width: 200, height: 12, borderRadius: 6, background: accent }} />
        </header>

        {stats.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(stats.length, 2)}, 1fr)`, gap: 24 }}>
            {stats.map((s, i) => (
              <Card key={i} palette={palette} accent={accent} style={{ padding: "30px 34px" }}>
                <div style={{ fontSize: fitSize(s.value, 84, 8), fontWeight: 900, color: accent, lineHeight: 1 }}>{s.value}</div>
                {s.label && <div style={{ fontSize: fitSize(s.label, 32, 40), fontWeight: 700, marginTop: 12, lineHeight: 1.25 }}>{s.label}</div>}
              </Card>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: sections.length > 1 ? "1fr 1fr" : "1fr", gap: 24 }}>
          {sections.map((s, i) => (
            <Card key={i} palette={palette} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: i % 2 ? 14 : 24, background: i % 2 ? second : accent }} />
              <div style={{ fontSize: fitSize(s.heading, 42, 22), fontWeight: 900, lineHeight: 1.15 }}>{s.heading}</div>
              {s.text && <div style={{ fontSize: fitSize(s.text, 30, 130), color: palette.muted, lineHeight: 1.35, fontWeight: 600 }}>{s.text}</div>}
            </Card>
          ))}
        </div>

        {steps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {steps.map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ width: 64, height: 64, flex: "none", borderRadius: 32, background: accent, color: onAccent, fontSize: 34, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: fitSize(step, 36, 50), fontWeight: 700 }}>{step}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {d.takeaway && (
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <Citizen color={accent} size={190} palette={palette} />
            <Card palette={palette} accent={accent} style={{ flex: 1, borderRadius: 40 }}>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase", color: accent }}>Key takeaway</div>
              <div style={{ fontSize: fitSize(d.takeaway, 38, 110), fontWeight: 800, lineHeight: 1.3, marginTop: 10 }}>{d.takeaway}</div>
            </Card>
          </div>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 24, fontSize: 22, color: palette.muted, fontWeight: 600 }}>
          <span>{d.source ? `Sources: ${d.source}` : ""}</span>
          <span>Made with Homl Learn</span>
        </footer>
      </div>
    </Background>
  );
};
