const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * AppImage assembles its AppDir by copying the packed app directory wholesale,
 * so a file placed under usr/share here arrives at the AppDir root. There is no
 * AppImage-specific option for extra files, and this is the supported hook that
 * runs early enough.
 *
 * The deb and rpm take the same directory as /opt/Jorvik, so they get a copy
 * there too. Harmless, but it means those two do not register the metainfo with
 * the system; doing that properly needs fpm arguments and is a separate job.
 */
function installLinuxMetainfo(appOutDir) {
    const source = path.resolve(__dirname, "..", "metainfo", "app.jorvik.Jorvik.metainfo.xml");
    if (!fs.existsSync(source)) {
        throw new Error(`Missing AppStream metainfo at ${source}`);
    }

    const targetDir = path.join(appOutDir, "usr", "share", "metainfo");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(source, path.join(targetDir, path.basename(source)));
    console.log(`[jorvik-builder] Installed AppStream metainfo into ${targetDir}`);
}

async function afterPack(context) {
    const appOutDir = context?.appOutDir;
    if (typeof appOutDir !== "string" || appOutDir.length === 0 || !fs.existsSync(appOutDir)) {
        return;
    }

    if (context?.electronPlatformName === "linux" || process.platform === "linux") {
        installLinuxMetainfo(appOutDir);
    }

    if (process.platform !== "darwin") {
        return;
    }

    // macOS metadata xattrs can break codesign with "resource fork ... not allowed".
    console.log(`[heorot-builder] Clearing xattrs in ${appOutDir}`);
    execFileSync("xattr", ["-cr", appOutDir], { stdio: "inherit" });
}

module.exports = afterPack;
module.exports.default = afterPack;
