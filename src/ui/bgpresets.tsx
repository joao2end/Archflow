/** Texturas de fundo ladrilhadas — Subtle Patterns (toptal.com/designers/subtlepatterns), em /public/bg. */
export interface BgPreset {
  id: string;
  label: string;
  file: string;
  tile: [number, number];
}

export const BG_PRESETS: BgPreset[] = [
  { id: "so-white", label: "So White", file: "so-white.png", tile: [400, 392] },
  { id: "natural-white", label: "Natural White", file: "natural-white.png", tile: [400, 400] },
  { id: "papyrus", label: "Papyrus", file: "papyrus.png", tile: [400, 400] },
  { id: "papyrus-dark", label: "Papyrus Dark", file: "papyrus-dark.png", tile: [400, 400] },
  { id: "textured-paper", label: "Textured Paper", file: "textured-paper.png", tile: [500, 500] },
  { id: "paper", label: "Paper", file: "paper.png", tile: [500, 593] },
  { id: "white-paperboard", label: "Paperboard", file: "white-paperboard.png", tile: [256, 252] },
  { id: "lined-paper", label: "Lined Paper", file: "lined-paper.png", tile: [300, 224] },
  { id: "graph-paper", label: "Graph Paper", file: "graph-paper.png", tile: [400, 400] },
  { id: "stardust", label: "Stardust", file: "stardust.png", tile: [798, 798] },
];

export const presetById = (id?: string) => BG_PRESETS.find((p) => id === `preset:${p.id}`);

/** `<pattern>` da textura em tamanho natural (não escala com o zoom), deslocado por (x, y) para acompanhar o pan. */
export function PresetPattern({ id, preset, scale = 1, x = 0, y = 0 }: { id: string; preset: BgPreset; scale?: number; x?: number; y?: number }) {
  const [w, h] = preset.tile;
  return (
    <pattern id={id} width={w * scale} height={h * scale} patternUnits="userSpaceOnUse" x={x} y={y}>
      <image href={`/bg/${preset.file}`} width={w * scale} height={h * scale} />
    </pattern>
  );
}
