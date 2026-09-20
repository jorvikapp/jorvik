#!/usr/bin/env node
'use strict';
/**
 * BUILD-TIME ONLY. Pre-renders the tray icon with the unread badge burned in.
 * `sharp` is a devDependency and never ships in the packaged app.
 *
 *   node scripts/gen-tray-badges.js <base-tray-icon.png> <out-dir>
 *
 * Emits <out-dir>/tray-0.png .. tray-99.png plus tray-99plus.png, all 64x64.
 * tray-0.png is the unbadged icon, so the runtime lookup has no special case.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SIZE = 64;          // hosts render at 22/24px; 64 downscales cleanly and covers HiDPI
const BADGE_BG = '#da4453';
const BADGE_FG = '#ffffff';
const OUTLINE = '#ffffff';   // keeps the badge legible on light and dark panels

function badgeSvg(label) {
    // ~47% of the icon: large enough to read a digit at a 22px panel size,
    // small enough to leave the mark recognisable. Inset 1px so the outline
    // is not clipped by the icon edge.
    const h = 30;
    const r = h / 2;
    const perChar = label.length > 2 ? 13 : 15;
    const w = Math.max(h, label.length * perChar + 8);
    const x = SIZE - w - 1;
    const y = 1;
    const fontSize = label.length > 2 ? 16 : label.length > 1 ? 19 : 22;
    return Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" ` +
        `fill="${BADGE_BG}" stroke="${OUTLINE}" stroke-width="2.5"/>` +
        // librsvg does not honour dominant-baseline reliably, which clipped the
        // glyph tops. Position by explicit baseline: centre + half the cap height
        // (~0.72 em for DejaVu Sans Bold).
        `<text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.36}" ` +
        `font-family="DejaVu Sans, Noto Sans, sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold" fill="${BADGE_FG}" ` +
        `text-anchor="middle">${label}</text>` +
        `</svg>`
    );
}

// Windows draws a taskbar overlay at the small-icon metric: 16px at 100% DPI,
// 32px at 200%. The tray art above is the whole mark plus a badge, which is
// wrong here -- the overlay sits on the corner of the app icon, so it has to be
// the badge alone.
const OVERLAY_SIZE = 32;

function overlaySvg(label) {
    const d = OVERLAY_SIZE - 2;
    const r = d / 2;
    const fontSize = label.length > 2 ? 12 : label.length > 1 ? 18 : 22;
    return Buffer.from(
        `<svg width="${OVERLAY_SIZE}" height="${OVERLAY_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="1" y="1" width="${d}" height="${d}" rx="${r}" ry="${r}" ` +
        `fill="${BADGE_BG}" stroke="${OUTLINE}" stroke-width="1.5"/>` +
        `<text x="${OVERLAY_SIZE / 2}" y="${OVERLAY_SIZE / 2 + fontSize * 0.36}" ` +
        `font-family="DejaVu Sans, Noto Sans, sans-serif" ` +
        `font-size="${fontSize}" font-weight="bold" fill="${BADGE_FG}" ` +
        `text-anchor="middle">${label}</text>` +
        `</svg>`
    );
}

async function main() {
    const [base, outDir] = process.argv.slice(2);
    if (!base || !outDir) {
        console.error('usage: gen-tray-badges.js <base-tray-icon.png> <out-dir>');
        process.exit(2);
    }
    fs.mkdirSync(outDir, { recursive: true });

    const baseBuf = await sharp(base)
        .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    fs.writeFileSync(path.join(outDir, 'tray-0.png'), baseBuf);

    const labels = [];
    for (let n = 1; n <= 99; n++) labels.push([String(n), `tray-${n}.png`]);
    labels.push(['99+', 'tray-99plus.png']);

    for (const [label, file] of labels) {
        const out = await sharp(baseBuf)
            .composite([{ input: badgeSvg(label), top: 0, left: 0 }])
            .png()
            .toBuffer();
        fs.writeFileSync(path.join(outDir, file), out);
    }

    for (const [label, file] of labels) {
        const out = await sharp(overlaySvg(label)).png().toBuffer();
        fs.writeFileSync(path.join(outDir, file.replace(/^tray-/, 'overlay-')), out);
    }

    // A blank badge almost always means the build machine has no usable font.
    const probe = await sharp(path.join(outDir, 'tray-8.png')).stats();
    const flat = probe.channels.every(c => c.min === c.max);
    console.log(`generated ${labels.length * 2 + 1} icons in ${outDir}`);
    if (flat) {
        console.error('WARNING: rendered badge looks blank - install a font ' +
                      '(fonts-dejavu-core) on the build machine and re-run.');
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
