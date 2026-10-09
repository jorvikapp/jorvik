// Prints one version's release notes from the AppStream metainfo as Markdown, for its
// GitHub release (the publish job in .github/workflows/desktop-build.yml). The notes are
// written once, in the metainfo, and also show in software centres and on
// www.jorvik.app/changelog.
//
//   node apps/desktop/scripts/release-notes.mjs 1.0.19 [out.md]
//
// With a file name it writes the notes there, so CI's warning stays out of them.
// Without notes for that version it prints a pointer to the changelog and warns, so a
// release is never held up by its notes.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const METAINFO = fileURLToPath(new URL("../metainfo/app.jorvik.Jorvik.metainfo.xml", import.meta.url));
const FOOTER = "Downloads and install steps: https://www.jorvik.app/download\nEvery version: https://www.jorvik.app/changelog";

function plainText(markup) {
    const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    return markup
        .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
        .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
        .replace(/<[^>]*>/g, "")
        .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name) => {
            if (name[0] === "#") {
                const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
                return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
            }
            return entities[name.toLowerCase()];
        })
        .replace(/\s+/g, " ")
        .trim();
}

export function releaseNotesMarkdown(xml, version) {
    const escaped = version.replace(/\./g, "\\.");
    const release = xml.match(new RegExp(`<release\\b[^>]*\\bversion="${escaped}"[^>]*>([\\s\\S]*?)</release>`));
    const description = release && (release[1].match(/<description>([\s\S]*?)<\/description>/) || [])[1];
    if (!description) {
        return null;
    }
    const blocks = [];
    for (const [, tag, attrs, body] of description.matchAll(/<(p|ul|ol)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
        if (/xml:lang/.test(attrs || "")) {
            continue;
        }
        if (tag === "p") {
            blocks.push(plainText(body));
            continue;
        }
        const items = [...body.matchAll(/<li(\s[^>]*)?>([\s\S]*?)<\/li>/g)]
            .filter(([, liAttrs]) => !/xml:lang/.test(liAttrs || ""))
            .map(([, , item], index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${plainText(item)}`);
        blocks.push(items.join("\n"));
    }
    return blocks.filter(Boolean).join("\n\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const version = (process.argv[2] || "").replace(/^v/, "");
    if (!version) {
        console.error("usage: node release-notes.mjs <version>");
        process.exit(2);
    }
    const notes = releaseNotesMarkdown(readFileSync(METAINFO, "utf8"), version);
    if (!notes) {
        console.log(`::warning::No release notes for ${version} in the metainfo`);
        console.error(`No release notes for ${version} in ${METAINFO}`);
    }
    const text = `${notes ?? "See the changelog for what's new."}\n\n${FOOTER}\n`;
    if (process.argv[3]) {
        writeFileSync(process.argv[3], text);
    } else {
        process.stdout.write(text);
    }
}
