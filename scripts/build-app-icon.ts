/** Gera build/icon.png (512px) e build/icon.ico a partir de um SVG: fachada clássica sobre planta azul. */
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdirSync, writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8584e0"/><stop offset="1" stop-color="#4a49a8"/></linearGradient>
    <pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/></pattern>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
    <path d="M96 188 256 84l160 104z"/>
    <path d="M120 220h272"/>
    <path d="M148 252v140M236 252v140M276 252v140M364 252v140"/>
    <path d="M96 424h320"/>
  </g>
  <g fill="#ffb84d"><circle cx="256" cy="150" r="20"/></g>
  <path d="M236 392V330a20 20 0 0 1 40 0v62z" fill="#ffb84d"/>
</svg>`;

mkdirSync("build", { recursive: true });
const png = (s: number) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer();
writeFileSync("build/icon.png", await png(512));
writeFileSync("build/icon.ico", await pngToIco(await Promise.all([16, 32, 48, 64, 128, 256].map(png))));
console.log("ícones gerados em build/");
