import type { CSSProperties } from "react";
import generated from "../shared/icons.generated.json";
import type { Asset } from "../shared/schema";

const GEN = generated as Record<string, { body: string; w: number; h: number }>;

/** Glifos de 24×24 (traço) — usados em assets genéricos e na interface */
const GLYPHS: Record<string, string[]> = {
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  browser: ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 9h18", "M6.5 6.5h.01M9.5 6.5h.01"],
  mobile: ["M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M11 18h2"],
  service: ["M12 2l9 5v10l-9 5-9-5V7z", "M12 12l9-5", "M12 12v10", "M12 12L3 7"],
  database: ["M12 2c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  queue: ["M3 6h12", "M3 12h18", "M3 18h12", "M18 3l3 3-3 3"],
  cache: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  gateway: ["M4 12h13", "M13 6l6 6-6 6", "M4 4v16"],
  cloud: ["M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 1.5A4 4 0 0 0 6.5 19z"],
  // interface
  select: ["M5 3l14 7-6 2-2 6z"],
  hand: ["M8 13V6a1.5 1.5 0 0 1 3 0v5", "M11 11V4.5a1.5 1.5 0 0 1 3 0V11", "M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2 7-6 7-3 0-5-2-6-4l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 14"],
  group: ["M4 8V5a1 1 0 0 1 1-1h3", "M16 4h3a1 1 0 0 1 1 1v3", "M20 16v3a1 1 0 0 1-1 1h-3", "M8 20H5a1 1 0 0 1-1-1v-3"],
  note: ["M5 3h14v12l-6 6H5z", "M13 21v-6h6"],
  connect: ["M5 19L19 5", "M10 5h9v9"],
  library: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  undo: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  redo: ["M15 14l5-5-5-5", "M20 9H9a5 5 0 0 0 0 10h3"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  fit: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
  download: ["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"],
  upload: ["M12 15V3", "M7 8l5-5 5 5", "M4 21h16"],
  sparkle: ["M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"],
  plug: ["M9 2v6", "M15 2v6", "M6 8h12v4a6 6 0 0 1-12 0z", "M12 18v4"],
  help: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7", "M12 17h.01"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  copy: ["M9 9h11v11H9z", "M5 15V4h11"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-5-5"],
  edit: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  code: ["M8 8l-5 4 5 4", "M16 8l5 4-5 4"],
  play: ["M7 4l12 8-12 8z"],
  pause: ["M7 4v16", "M17 4v16"],
  grid: ["M3 3h18v18H3z", "M9 3v18", "M15 3v18", "M3 9h18", "M3 15h18"],
  layout: ["M4 4h6v6H4z", "M14 14h6v6h-6z", "M10 7h4a3 3 0 0 1 3 3v4"],
  check: ["M5 12l5 5 9-10"],
  chevron: ["M6 9l6 6 6-6"],
  dots: ["M5 12h.01M12 12h.01M19 12h.01"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  "folder-plus": ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M12 10.5v5", "M9.5 13h5"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4"],
  "arrow-up": ["M12 19V5", "M6 11l6-6 6 6"],
  home: ["M4 11l8-7 8 7", "M6 10v10h12V10"],
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  monitor: ["M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M8 21h8", "M12 17v4"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 12.5l9 5 9-5", "M3 17l9 5 9-5"],
  vault: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"], // cofre = pasta
  "file-plus": ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M12 11v6", "M9 14h6"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
};

export function Glyph({ name, size = 18, className, style, stroke = 1.8 }: { name: string; size?: number; className?: string; style?: CSSProperties; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      {(GLYPHS[name] ?? GLYPHS.service).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const initials = (s: string) =>
  s
    .split(/[\s\-_./]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

interface IconProps {
  icon: string;
  color: string;
  name: string;
  size?: number;
  x?: number;
  y?: number;
}

/** Renderiza o ícone de um asset como <svg>. Pode ser aninhado em outro <svg> via x/y. */
export function IconSvg({ icon, color, name, size = 28, x, y }: IconProps) {
  const pos = x != null ? { x, y } : {};
  const m = /^([ls]):(.+)$/.exec(icon);
  if (m) {
    const g = GEN[icon];
    if (g) return <svg {...pos} width={size} height={size} viewBox={`0 0 ${g.w} ${g.h}`} dangerouslySetInnerHTML={{ __html: g.body }} />;
    return <TextIcon text={initials(name)} color={color} size={size} pos={pos} />;
  }
  if (icon.startsWith("g:")) {
    return (
      <svg {...pos} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {(GLYPHS[icon.slice(2)] ?? GLYPHS.service).map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  }
  if (icon.startsWith("t:")) return <TextIcon text={icon.slice(2)} color={color} size={size} pos={pos} />;
  if (/^(https?:|data:|\/)/.test(icon)) {
    return (
      <svg {...pos} width={size} height={size} viewBox="0 0 24 24">
        <image href={icon} width="24" height="24" preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  }
  return <TextIcon text={initials(name)} color={color} size={size} pos={pos} />;
}

function TextIcon({ text, color, size, pos }: { text: string; color: string; size: number; pos: object }) {
  const fs = text.length <= 2 ? 11 : text.length === 3 ? 9 : 7.5;
  return (
    <svg {...pos} width={size} height={size} viewBox="0 0 24 24">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={color} />
      <text x="12" y="12.2" textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight="700" fill="#fff" fontFamily="Inter Tight, sans-serif">
        {text}
      </text>
    </svg>
  );
}

/** Ícone de asset em HTML (listas, inspector) */
export function AssetBadge({ asset, size = 36, tile = true }: { asset: Pick<Asset, "icon" | "color" | "name">; size?: number; tile?: boolean }) {
  const inner = Math.round(size * 0.62);
  return (
    <span className={tile ? "badge" : "badge bare"} style={{ width: size, height: size, ["--c" as string]: asset.color }}>
      <IconSvg icon={asset.icon} color={asset.color} name={asset.name} size={tile ? inner : size} />
    </span>
  );
}
