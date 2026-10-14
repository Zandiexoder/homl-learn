export type Palette = {
  id: string;
  bgTop: string;
  bgBottom: string;
  text: string;
  muted: string;
  panel: string;
  line: string;
  accents: string[];
};

// One accent colour per video, picked from the palette's accents.
export const PALETTES: Record<string, Palette> = {
  "deep-space": {
    id: "deep-space",
    bgTop: "#22355C",
    bgBottom: "#0D1630",
    text: "#F6F4EE",
    muted: "#A9B6D3",
    panel: "rgba(255,255,255,0.07)",
    line: "rgba(255,255,255,0.22)",
    accents: ["#F2B33D", "#FF7A59", "#5EE3C1", "#8FB8FF", "#F48FB1"],
  },
  reef: {
    id: "reef",
    bgTop: "#14646A",
    bgBottom: "#08343A",
    text: "#F4F7F2",
    muted: "#A7D3CF",
    panel: "rgba(255,255,255,0.08)",
    line: "rgba(255,255,255,0.25)",
    accents: ["#FF8C6B", "#FFD166", "#B8F2E6", "#F7A1C4", "#9AD0FF"],
  },
  paper: {
    id: "paper",
    bgTop: "#F6F0E2",
    bgBottom: "#E7DDC8",
    text: "#1F2A33",
    muted: "#5B6670",
    panel: "rgba(31,42,51,0.06)",
    line: "rgba(31,42,51,0.25)",
    accents: ["#2F6F9F", "#C4472F", "#2E8B6A", "#8A4FB5", "#C77D10"],
  },
};

export const FONT = "'Nunito', 'Helvetica Neue', sans-serif";

export function palette(id?: string): Palette {
  return PALETTES[id ?? ""] ?? PALETTES["deep-space"];
}

/** A lighter or darker shade of a hex colour. amount in -1..1 */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)),
  );
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}
