/**
 * A message as plain text, for the places that show it outside the timeline:
 * notifications, reply previews, pins and search. Formatting marks are left
 * out, and spoilers stay hidden, since the plain body still has them as typed.
 */

export const SPOILER_PLACEHOLDER = "(spoiler)";

export interface PreviewableContent {
    body?: unknown;
    format?: unknown;
    formatted_body?: unknown;
}

const BLOCK_TAGS = new Set([
    "P",
    "DIV",
    "BLOCKQUOTE",
    "PRE",
    "UL",
    "OL",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "TABLE",
    "TR",
]);
// Never part of the message's own text: the old reply quote some clients
// still put in front, and anything that isn't text at all.
const SKIPPED_TAGS = new Set(["MX-REPLY", "SCRIPT", "STYLE"]);

export function messagePreviewText(content: PreviewableContent): string {
    if (
        content.format === "org.matrix.custom.html" &&
        typeof content.formatted_body === "string" &&
        typeof DOMParser !== "undefined"
    ) {
        const document = new DOMParser().parseFromString(content.formatted_body, "text/html");
        return htmlToText(document.body, false)
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join("\n");
    }

    return typeof content.body === "string" ? stripPlainReplyFallback(content.body).trim() : "";
}

function htmlToText(node: Node, preformatted: boolean): string {
    let text = "";
    node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
            // Outside code, whitespace in HTML is one space, newlines included.
            const value = child.textContent ?? "";
            text += preformatted ? value : value.replace(/\s+/g, " ");
            return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const element = child as Element;
        const tag = element.tagName;
        if (SKIPPED_TAGS.has(tag)) {
            return;
        }
        if (tag === "BR") {
            text += "\n";
            return;
        }
        if (element.hasAttribute("data-mx-spoiler")) {
            text += SPOILER_PLACEHOLDER;
            return;
        }
        if (tag === "IMG") {
            text += element.getAttribute("alt") ?? "";
            return;
        }

        const inner = htmlToText(element, preformatted || tag === "PRE");
        text += BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
    });
    return text;
}

// Plain bodies of replies from older clients start with the message they
// answer, as "> <@sender:server> ..." lines and a blank line. A quote at the
// start without the sender's tag was typed, and stays.
function stripPlainReplyFallback(body: string): string {
    if (!/^> (?:\* )?<@/.test(body)) {
        return body;
    }
    const lines = body.split("\n");
    while (lines.length > 0 && lines[0].startsWith("> ")) {
        lines.shift();
    }
    if (lines[0] === "") {
        lines.shift();
    }
    return lines.join("\n");
}
