const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

async function afterPack(context) {
    if (process.platform === "linux") {
        const appOutDir = context?.appOutDir;
        const desktopFile = typeof appOutDir === "string" ? path.join(appOutDir, "jorvik.desktop") : "";
        if (desktopFile && fs.existsSync(desktopFile)) {
            const contents = fs.readFileSync(desktopFile, "utf8")
                .replace(/^Icon=.*$/m, "Icon=jorvik")
                .replace(/^StartupWMClass=.*$/m, "StartupWMClass=jorvik");
            const withIdentity = contents.includes("X-GNOME-WMClass=")
                ? contents.replace(/^X-GNOME-WMClass=.*$/m, "X-GNOME-WMClass=jorvik")
                : `${contents.trimEnd()}\nX-GNOME-WMClass=jorvik\n`;
            fs.writeFileSync(desktopFile, withIdentity);
        } else if (desktopFile) {
            fs.writeFileSync(desktopFile, "[Desktop Entry]\nName=Jorvik\nExec=AppRun --no-sandbox %U\nTerminal=false\nType=Application\nIcon=jorvik\nStartupWMClass=jorvik\nX-GNOME-WMClass=jorvik\nCategories=Network;\n");
        }
        return;
    }
    if (process.platform !== "darwin") {
        return;
    }

    const appOutDir = context?.appOutDir;
    if (typeof appOutDir !== "string" || appOutDir.length === 0 || !fs.existsSync(appOutDir)) {
        return;
    }

    // macOS metadata xattrs can break codesign with "resource fork ... not allowed".
    console.log(`[heorot-builder] Clearing xattrs in ${appOutDir}`);
    execFileSync("xattr", ["-cr", appOutDir], { stdio: "inherit" });
}

module.exports = afterPack;
module.exports.default = afterPack;
