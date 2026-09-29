const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * AppImageUpdate, Gear Lever and AppImageLauncher find new versions through the
 * update information in the AppImage's .upd_info section and a .zsync file
 * published next to it. Electron Builder writes neither: its only update
 * mechanism is the blockmap electron-updater reads, and there is no option for
 * the update string. So this does what appimagetool's -u flag does, after the
 * fact.
 *
 * `latest` resolves to the newest GitHub release, and the glob matches the
 * AppImage's artifactName, so the string never needs changing between versions.
 */
const UPDATE_INFORMATION = "gh-releases-zsync|jorvikapp|jorvik|latest|Jorvik-*-x86_64.AppImage.zsync";

function readAt(fd, position, length) {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, position);
    return buffer;
}

// The AppImage runtime is an ELF64 executable with the squashfs appended, so
// the section table sits in the runtime at the front of the file.
function findSection(fd, wanted) {
    const header = readAt(fd, 0, 64);
    if (header.toString("latin1", 0, 4) !== "\x7fELF" || header[4] !== 2 || header[5] !== 1) {
        throw new Error("AppImage runtime is not a little-endian ELF64 file");
    }
    const tableOffset = Number(header.readBigUInt64LE(0x28));
    const entrySize = header.readUInt16LE(0x3a);
    const count = header.readUInt16LE(0x3c);
    const namesIndex = header.readUInt16LE(0x3e);

    const entry = (index) => {
        const raw = readAt(fd, tableOffset + index * entrySize, entrySize);
        return {
            name: raw.readUInt32LE(0),
            offset: Number(raw.readBigUInt64LE(0x18)),
            size: Number(raw.readBigUInt64LE(0x20)),
        };
    };

    const names = entry(namesIndex);
    const nameTable = readAt(fd, names.offset, names.size);
    for (let index = 0; index < count; index++) {
        const section = entry(index);
        const end = nameTable.indexOf(0, section.name);
        if (nameTable.toString("latin1", section.name, end) === wanted) {
            return section;
        }
    }
    throw new Error(`AppImage runtime has no ${wanted} section`);
}

function embedUpdateInformation(appImagePath) {
    const fd = fs.openSync(appImagePath, "r+");
    try {
        const section = findSection(fd, ".upd_info");
        const value = Buffer.from(UPDATE_INFORMATION, "utf8");
        if (value.length >= section.size) {
            throw new Error(`Update information is ${value.length} bytes; .upd_info holds ${section.size}`);
        }
        // Zero-fill the whole section so no stale bytes follow the string.
        const padded = Buffer.alloc(section.size);
        value.copy(padded);
        fs.writeSync(fd, padded, 0, padded.length, section.offset);
    } finally {
        fs.closeSync(fd);
    }
    console.log(`[jorvik-builder] Embedded AppImage update information: ${UPDATE_INFORMATION}`);
}

// The .zsync describes the finished file, so it must come after the embed.
// -u names the AppImage relative to the .zsync, which AppImageUpdate resolves
// against the release the .zsync was downloaded from.
function writeZsync(appImagePath) {
    const directory = path.dirname(appImagePath);
    const name = path.basename(appImagePath);
    try {
        execFileSync("zsyncmake", ["-u", name, "-o", `${name}.zsync`, name], { cwd: directory, stdio: "inherit" });
    } catch (error) {
        // A local build without zsync installed is still a usable AppImage. On
        // CI a missing .zsync would silently break updates, so it fails there.
        if (error.code === "ENOENT" && process.env.CI !== "true") {
            console.warn("[jorvik-builder] zsyncmake not found; skipping the .zsync (install the zsync package)");
            return;
        }
        throw error;
    }
    console.log(`[jorvik-builder] Wrote ${name}.zsync`);
}

async function artifactBuildCompleted(event) {
    const file = event?.file;
    if (typeof file !== "string" || !file.endsWith(".AppImage")) {
        return;
    }
    embedUpdateInformation(file);
    writeZsync(file);
}

module.exports = artifactBuildCompleted;
module.exports.default = artifactBuildCompleted;
