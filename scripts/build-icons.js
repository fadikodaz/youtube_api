#!/usr/bin/env node
// Builds public/icons.svg: one SVG sprite with only the icons the site uses.
//   npm run icons
//
// - Phosphor Icons (MIT, https://phosphoricons.com): "bold" for interface
//   icons (#i-name), "duotone" for feature/step icons (#d-name). The duotone
//   layer is coloured with CSS: --duo (colour) and --duo-opacity.
// - Simple Icons (CC0, https://simpleicons.org): platform logos (#b-name),
//   coloured with currentColor; brand colours are in BRAND_COLORS below.
//
// Usage in HTML:  <svg class="ic"><use href="/icons.svg#i-download-simple"/></svg>
const fs = require('fs');
const path = require('path');
const si = require('simple-icons');

const ROOT = path.join(__dirname, '..');
const PH = path.join(ROOT, 'node_modules', '@phosphor-icons', 'core', 'assets');

// Interface icons (bold)
const BOLD = [
  'download-simple',
  'caret-down',
  'caret-right',
  'caret-left',
  'list',
  'x',
  'moon',
  'sun',
  'globe-simple',
  'plus',
  'minus',
  'arrow-right',
  'arrow-up-right',
  'check',
  'check-circle',
  'clipboard-text',
  'link-simple',
  'image',
  'video-camera',
  'music-notes',
  'warning-circle',
  'arrow-clockwise',
  'share-network',
  'hand-pointing',
  'dots-three',
];

// Feature and illustration icons (duotone)
const DUOTONE = [
  'music-notes',
  'sliders-horizontal',
  'devices',
  'user-circle-minus',
  'timer',
  'film-strip',
  'image',
  'lightning',
  'shield-check',
  'device-mobile',
  'share-network',
  'link-simple',
  'download-simple',
  'translate',
  'infinity',
  'monitor-play',
];

const BRANDS = ['youtube', 'tiktok', 'facebook', 'pinterest', 'dailymotion', 'twitch'];

function phosphor(weight, name) {
  const file = path.join(PH, weight, `${name}-${weight}.svg`);
  const svg = fs.readFileSync(file, 'utf8');
  let inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // Duotone background layer: colour/opacity controlled from CSS.
  inner = inner.replace(/opacity="0\.2"/g, 'style="fill:var(--duo,currentColor);opacity:var(--duo-opacity,0.2)"');
  return inner;
}

const symbols = [];
for (const n of BOLD) {
  symbols.push(`<symbol id="i-${n}" viewBox="0 0 256 256" fill="currentColor">${phosphor('bold', n)}</symbol>`);
}
for (const n of DUOTONE) {
  symbols.push(`<symbol id="d-${n}" viewBox="0 0 256 256" fill="currentColor">${phosphor('duotone', n)}</symbol>`);
}
const BRAND_COLORS = {};
for (const slug of BRANDS) {
  const key = `si${slug[0].toUpperCase()}${slug.slice(1)}`;
  const icon = si[key];
  if (!icon) throw new Error(`Simple Icons has no ${slug}`);
  BRAND_COLORS[slug] = `#${icon.hex}`;
  symbols.push(`<symbol id="b-${slug}" viewBox="0 0 24 24" fill="currentColor"><path d="${icon.path}"/></symbol>`);
}

const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n' +
  '<!-- Phosphor Icons (MIT) https://phosphoricons.com | Simple Icons (CC0) https://simpleicons.org -->\n' +
  symbols.join('\n') +
  '\n</svg>\n';

fs.writeFileSync(path.join(ROOT, 'public', 'icons.svg'), sprite);
// The design mockups are opened as local files, where browsers block
// external <use> references, so they get the same sprite as a script.
fs.writeFileSync(path.join(ROOT, 'mockups', 'icons-sprite.js'), `window.ICON_SPRITE = ${JSON.stringify(sprite)};\n`);
console.log(`icons.svg: ${symbols.length} icons, ${(sprite.length / 1024).toFixed(1)} KB`);
console.log('brand colours:', BRAND_COLORS);
