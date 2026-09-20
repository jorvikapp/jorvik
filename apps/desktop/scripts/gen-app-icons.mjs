#!/usr/bin/env node
/**
 * BUILD-TIME ONLY. Materialises the packaging icons from the one tracked source.
 *
 * `apps/desktop/build/` is gitignored, so nothing in it survives a fresh clone.
 * Electron Builder does not fail on a missing icon -- it quietly falls back to
 * the stock Electron icon (platformPackager.getOrConvertIcon), which is how CI
 * shipped Linux packages with the wrong launcher icon while every check passed.
 *
 * Writes:
 *   build/icon.png        - single source for the macOS/Windows icon conversion
 *   build/icons/NxN.png   - hicolor sizes for deb/rpm/AppImage desktop entries
 *
 * The odd sizes matter: handed a lone 1254x1254 PNG, Electron Builder installs
 * it to hicolor/1254x1254/apps/, a directory hicolor's index.theme never
 * declares, so desktop environments skip it and fall back to a generic icon.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(projectRoot, "../web/public/jorvik-icon.png");
const buildDir = path.resolve(projectRoot, "build");
const iconsDir = path.resolve(buildDir, "icons");

// Sizes declared by the freedesktop hicolor theme; anything else is ignored by
// the icon loaders in GTK and Qt.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

if (!fs.existsSync(source)) {
    throw new Error(`Missing icon source: ${source}`);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.copyFileSync(source, path.resolve(buildDir, "icon.png"));
console.log(`[jorvik-desktop] build/icon.png <- ${path.relative(projectRoot, source)}`);

// macOS and Windows convert build/icon.png themselves, so the copy above is all
// they need. Only Linux consumes the hicolor set, and only Linux is already
// proven to have sharp -- build:tray-badges runs it on the same machine. Do not
// fail a mac or Windows release build over a devDependency it never needed.
let sharp;
try {
    ({ default: sharp } = await import("sharp"));
} catch (error) {
    if (process.platform === "linux") {
        throw error;
    }
    console.warn(`[jorvik-desktop] sharp unavailable (${error.code ?? "load failed"}); skipping the hicolor set`);
    process.exit(0);
}

const { width, height } = await sharp(source).metadata();
if (!width || !height || width !== height) {
    throw new Error(`Icon source must be square, got ${width}x${height}`);
}
if (width < SIZES[SIZES.length - 1]) {
    throw new Error(`Icon source must be at least ${SIZES[SIZES.length - 1]}px, got ${width}px`);
}

fs.mkdirSync(iconsDir, { recursive: true });

for (const size of SIZES) {
    const out = path.resolve(iconsDir, `${size}x${size}.png`);
    await sharp(source)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(out);
    console.log(`[jorvik-desktop] build/icons/${size}x${size}.png`);
}
