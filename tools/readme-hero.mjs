// The README hero: .github/assets/readme-hero.png, 1200x400. The wordmark and
// the one-line tagline from docs/site.config.mjs, so it cannot drift from the
// site's own hero. Same recipe as docs/generate-social-card.mjs: rendered at 2x
// in system Chrome, downscaled, corners rounded into the alpha channel because
// GitHub strips `style` from README HTML.
// Run: node tools/readme-hero.mjs
import { execFile } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import config from "../docs/site.config.mjs";

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(repoRoot, "docs", "assets");
const WIDTH = 1200;
const HEIGHT = 400;

const [interFont, groteskFont, logoSvg] = await Promise.all([
  readFile(path.join(assetsDir, "fonts", "inter-latin.woff2")),
  readFile(path.join(assetsDir, "fonts", "space-grotesk-latin.woff2")),
  readFile(path.join(assetsDir, "logo.svg"), "utf8"),
]);

const escapeHtml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fontFace = (family, data) => `
  @font-face {
    font-family: '${family}';
    src: url(data:font/woff2;base64,${data.toString("base64")}) format('woff2');
    font-weight: 100 900;
    font-display: block;
  }`;

const wordmark = "Yuku for TSRX";
const tagline = escapeHtml(config.hero.text).replaceAll(".tsrx", "<b>.tsrx</b>");

// [text, x, y, size, opacity, rotation]: real TSRX syntax at the edges.
const tokens = [
  ["@if", 70, 54, 30, 0.45, -8],
  ["@for", 1040, 60, 34, 0.5, 6],
  ["@empty", 96, 322, 26, 0.38, 5],
  ["@switch", 1000, 300, 28, 0.44, -5],
  ["@try", 40, 196, 24, 0.34, 0],
  ["@catch", 1096, 190, 24, 0.36, 0],
  ["<{tag}>", 890, 30, 22, 0.3, -6],
  ["@{", 24, 262, 38, 0.28, 0],
  ["}", 1140, 120, 38, 0.26, 0],
  [".tsrx", 1070, 346, 26, 0.46, 0],
];

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  ${fontFace("Inter", interFont)}
  ${fontFace("Space Grotesk", groteskFont)}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  .card {
    position: relative;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: #140A05;
    font-family: 'Inter', sans-serif;
    overflow: hidden;
  }
  .glow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(720px 360px at 50% 46%, rgba(234, 88, 12, 0.28), transparent 70%),
      radial-gradient(480px 300px at 6% 6%, rgba(154, 52, 18, 0.20), transparent 70%),
      radial-gradient(480px 300px at 96% 94%, rgba(154, 52, 18, 0.20), transparent 70%);
  }
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(251, 146, 60, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(251, 146, 60, 0.05) 1px, transparent 1px);
    background-size: 52px 52px;
    mask-image: radial-gradient(720px 380px at 50% 50%, transparent 30%, #000 78%);
    -webkit-mask-image: radial-gradient(720px 380px at 50% 50%, transparent 30%, #000 78%);
  }
  .tokens span {
    position: absolute;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #FB923C;
  }
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    z-index: 2;
  }
  .row { display: flex; align-items: center; gap: 30px; }
  .row svg {
    width: 104px;
    height: 104px;
    filter: drop-shadow(0 14px 40px rgba(234, 88, 12, 0.55));
  }
  .name {
    font-family: 'Space Grotesk', 'Inter', sans-serif;
    font-weight: 700;
    font-size: 96px;
    line-height: 1;
    letter-spacing: -0.03em;
    background: linear-gradient(115deg, #FDBA74 15%, #FFEDD5 50%, #FB923C 90%);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
  }
  .tagline { font-size: 28px; font-weight: 500; color: #b5aba8; }
  .tagline b { color: #FFEDD5; font-weight: 600; }
</style>
<div class="card">
  <div class="glow"></div>
  <div class="grid"></div>
  <div class="tokens">${tokens
    .map(
      ([t, x, y, size, op, rot]) =>
        `<span style="left:${x}px;top:${y}px;font-size:${size}px;opacity:${op};transform:rotate(${rot}deg)">${escapeHtml(t)}</span>`,
    )
    .join("")}</div>
  <div class="center">
    <div class="row">${logoSvg}<div class="name">${escapeHtml(wordmark)}</div></div>
    <div class="tagline">${tagline}</div>
  </div>
</div>`;

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const heroDir = path.join(repoRoot, ".github", "assets");
await mkdir(heroDir, { recursive: true });
const raw = path.join(heroDir, "readme-hero.raw.png");
await page.screenshot({ path: raw });
await browser.close();

const hero = path.join(heroDir, "readme-hero.png");
// 12.5% of each side is what `border-radius: 12.5%` would mean in CSS.
const rx = WIDTH * 0.125;
const ry = HEIGHT * 0.125;
await run("magick", [
  raw,
  "-resize",
  `${WIDTH}x${HEIGHT}`,
  "-unsharp",
  "0x0.6+0.6+0.01",
  "-alpha",
  "set",
  "(",
  "+clone",
  "-alpha",
  "transparent",
  "-background",
  "none",
  "-fill",
  "white",
  "-draw",
  `roundrectangle 0,0,${WIDTH - 1},${HEIGHT - 1},${rx},${ry}`,
  ")",
  "-compose",
  "DstIn",
  "-composite",
  "-strip",
  hero,
]);
await unlink(raw);
console.log(`wrote ${hero}`);
