// Draws the Unreel logo and splash screens, then renders the source PNGs that
// `npx capacitor-assets generate --android` turns into every Android size.
//
//   node assets/make-assets.mjs && npx capacitor-assets generate --android
//
// The mark is the app's counter ring (a limit filling up) around a play button.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const dir = new URL('./', import.meta.url);
const VIOLET_LIGHT = '#8B6BFF';
const VIOLET_DARK = '#5A35E6';
const NIGHT = '#0E0E12';

/** Ring + play mark centred at (cx, cy) with ring radius r. */
function mark(cx, cy, r, color = '#FFFFFF') {
  const stroke = r * 0.22;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * 0.72;
  // Play triangle, nudged right so it looks optically centred
  const h = r * 0.98;
  const w = h * 0.88;
  const x0 = cx - w * 0.38;
  const tri = `${x0},${cy - h / 2} ${x0},${cy + h / 2} ${x0 + w},${cy}`;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.28" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${filled} ${circumference}"
      transform="rotate(-90 ${cx} ${cy})"/>
    <polygon points="${tri}" fill="${color}" stroke="${color}" stroke-width="${r * 0.16}" stroke-linejoin="round"/>`;
}

const gradient = `
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${VIOLET_LIGHT}"/>
    <stop offset="1" stop-color="${VIOLET_DARK}"/>
  </linearGradient>`;

const svg = (size, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs}</defs>${body}</svg>`;

const wordmark = (cx, y, size, color) =>
  `<text x="${cx}" y="${y}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
     font-weight="700" font-size="${size}" letter-spacing="${-size * 0.02}" fill="${color}">Unreel</text>`;

const files = {
  // Legacy/full icon (Android crops it to the launcher's shape)
  'icon-only.png': [1024, svg(1024, `<rect width="1024" height="1024" fill="url(#bg)"/>${mark(512, 512, 250)}`, gradient)],
  // Adaptive icon: mark kept inside the central safe zone, background as its own layer
  'icon-foreground.png': [1024, svg(1024, mark(512, 512, 190))],
  'icon-background.png': [1024, svg(1024, `<rect width="1024" height="1024" fill="url(#bg)"/>`, gradient)],
  'splash.png': [2732, svg(2732,
    `<rect width="2732" height="2732" fill="url(#bg)"/>${mark(1366, 1250, 250)}${wordmark(1366, 1720, 170, '#FFFFFF')}`,
    gradient)],
  'splash-dark.png': [2732, svg(2732,
    `<rect width="2732" height="2732" fill="${NIGHT}"/>${mark(1366, 1250, 250, VIOLET_LIGHT)}${wordmark(1366, 1720, 170, '#F2F2F5')}`)],
};

for (const [name, [, source]] of Object.entries(files)) {
  await sharp(Buffer.from(source)).png().toFile(new URL(name, dir).pathname);
  console.log('wrote', name);
}

// Web favicon and the in-app header logo use the same artwork as an SVG
const webIcon = svg(512, `<rect width="512" height="512" rx="112" fill="url(#bg)"/>${mark(256, 256, 125)}`, gradient);
await writeFile(new URL('../public/icon.svg', dir), webIcon);
await sharp(Buffer.from(webIcon)).resize(192).png().toFile(new URL('../public/icon-192.png', dir).pathname);
console.log('wrote public/icon.svg, public/icon-192.png');
