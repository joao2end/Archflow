// Captura frame a frame logic-video.html (setTime) e gera os MP4 com áudio.
// Requer: playwright-core, ffmpeg-static e o Microsoft Edge/Chrome instalado.
// Uso: node render.mjs <h|v|all> [audio.wav] [frames]
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = process.env.PROMO_DIR || dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] || 'all';
const wav = process.argv[3] || join(here, 'logic-audio.wav');
const limit = +process.argv[4] || 900;
const FPS = 30;
const FORMATS = {
  h: { w: 1920, h: 1080, out: 'logic-16x9.mp4' },
  v: { w: 1080, h: 1920, out: 'logic-9x16.mp4' },
};

async function render(key) {
  const { w, h, out } = FORMATS[key];
  const browser = await chromium.launch({ channel: 'msedge', args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await page.addInitScript(() => { window.__noAutoplay = true; });
  await page.goto(pathToFileURL(join(here, 'logic-video.html')).href + `?format=${key}&capture=1`);
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(500);
  const outFile = join(here, out);
  const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-i', wav, '-t', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise(res => ff.on('close', res));
  const stage = page.locator('#stage');
  const t0 = Date.now();
  for (let i = 0; i < limit; i++) {
    await page.evaluate(t => window.setTime(t), i / FPS);
    const buf = await stage.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 60 === 0) console.log(key, i, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  ff.stdin.end(); await done; await browser.close();
  console.log('pronto', outFile);
}
for (const k of which === 'all' ? ['h', 'v'] : [which]) await render(k);
