import markdownit, { type Env, type StateInline, type Token } from "markdown-it";
import type { MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import type { ResolvedEmoji } from "../emoji/EmojiPackTypes";
import { findMentions } from "../mentions/composerMentions";
import { mxcThumbnailToHttp, mxcToHttp } from "../utils/mxc";

/**
 * Turns what someone typed into a Matrix message. The body is the text as
 * typed. When the text has formatting, mentions or custom emoji, it also gets
 * an HTML body: Discord-style markdown (**bold**, *italic*, __underline__,
 * ~~strike~~, ||spoiler||, `code`, ``` blocks, > quotes, >>> quotes to the
 * end, lists, # headings and [masked](links)), mentions as matrix.to links
 * and custom emoji as images. Nothing inside code is changed, and no HTML
 * typed by hand gets through.
 */

const TOKEN_PATTERN = /:[a-zA-Z0-9_+-]{2,}:/g;
const URL_PATTERN = /(?:https?:\/\/|ftp:\/\/|mailto:|matrix:|www\.)[^\s<>()]+/gi;
const TRAILING_URL_PUNCTUATION = ".,!?;:";
const SPOILER_MARKER = 0x7c; // |

export interface MessageFormattingContext {
    roomId: string;
    activeSpaceId?: string | null;
    // Our own homeserver, for short @name mentions.
    localDomain: string | null;
}

export type EmojiShortcodeResolver = (
    client: MatrixClient,
    room: Room,
    shortcodeInput: string,
    activeSpaceId: string | null,
) => Promise<ResolvedEmoji | null>;

export type FormattedTextMessageContent =
    | {
          body: string;
      }
    | {
          body: string;
          format: "org.matrix.custom.html";
          formatted_body: string;
      };

export interface FormattedMessage {
    content: FormattedTextMessageContent;
    // Everyone mentioned outside code, for m.mentions.
    mentionedUserIds: string[];
}

interface ResolvedToken {
    shortcode: string;
    src: string;
}

interface RenderEnv extends Env {
    emoji: Map<string, ResolvedToken>;
    findMentions: (text: string) => ReturnType<typeof findMentions>;
    mentioned: Set<string>;
    linkDepth: number;
    replaced: boolean;
}

// Token types that mean the text has formatting worth an HTML body.
const FORMATTING_TOKENS = new Set([
    "strong_open",
    "em_open",
    "s_open",
    "spoiler_open",
    "code_inline",
    "fence",
    "blockquote_open",
    "bullet_list_open",
    "ordered_list_open",
    "heading_open",
]);

const md = markdownit("default", { html: false, breaks: true, linkify: true, typographer: false });
// Not chat formatting: tables, rules, images from URLs, underlined headings,
// indented code (people indent text with spaces), link references and
// &entities, which should stay as typed.
md.disable(["table", "hr", "image", "lheading", "code", "reference", "entity"], true);
// Links as in plain messages: addresses with a scheme, not bare emails.
md.linkify.set({ fuzzyEmail: false });
md.inline.ruler.at("text", plainText);
md.inline.ruler.before("emphasis", "spoiler", spoilerTokenize);
md.inline.ruler2.before("emphasis", "spoiler", spoilerPostProcess);

md.renderer.rules.text = (tokens, index, _options, env) => renderText(tokens[index].content, env as RenderEnv);
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    (env as RenderEnv).linkDepth += 1;
    return self.renderToken(tokens, index, options);
};
md.renderer.rules.link_close = (tokens, index, options, env, self) => {
    (env as RenderEnv).linkDepth -= 1;
    return self.renderToken(tokens, index, options);
};
// Discord's __underline__, which commonmark would make bold.
md.renderer.rules.strong_open = (tokens, index) => (tokens[index].markup === "__" ? "<u>" : "<strong>");
md.renderer.rules.strong_close = (tokens, index) => (tokens[index].markup === "__" ? "</u>" : "</strong>");

export async function formatMessage(
    rawText: string,
    context: MessageFormattingContext,
    resolver: EmojiShortcodeResolver,
    client: MatrixClient,
): Promise<FormattedMessage> {
    const room = client.getRoom(context.roomId);
    if (!room) {
        return { content: { body: rawText }, mentionedUserIds: [] };
    }

    const shortcodes = [...new Set(collectShortcodes(rawText))];
    const emoji =
        shortcodes.length > 0
            ? await resolveTokens(client, room, context.activeSpaceId ?? null, resolver, shortcodes)
            : new Map<string, ResolvedToken>();

    const env: RenderEnv = {
        emoji,
        findMentions: (text) => findMentions(text, room, context.localDomain),
        mentioned: new Set(),
        linkDepth: 0,
        replaced: false,
    };
    const tokens = md.parse(endQuotesAtLineEnd(expandMultilineQuote(rawText)), env);
    // A message that is one paragraph doesn't need wrapping in <p>.
    const singleParagraph =
        tokens.length === 3 && tokens[0].type === "paragraph_open" && tokens[1].type === "inline";
    const html = (
        singleParagraph ? md.renderer.renderInline(tokens[1].children ?? [], md.options, env) : md.renderer.render(tokens, md.options, env)
    ).trim();

    if (!env.replaced && !hasFormatting(tokens)) {
        return { content: { body: rawText }, mentionedUserIds: [] };
    }

    return {
        content: { body: rawText, format: "org.matrix.custom.html", formatted_body: html },
        mentionedUserIds: [...env.mentioned],
    };
}

function hasFormatting(tokens: Token[]): boolean {
    return tokens.some(
        (token) =>
            FORMATTING_TOKENS.has(token.type) ||
            (token.type === "link_open" && token.markup !== "linkify") ||
            (token.children ? hasFormatting(token.children) : false),
    );
}

// Discord's ">>> ": everything from that line to the end is quoted.
function expandMultilineQuote(text: string): string {
    const lines = text.split("\n");
    const start = lines.findIndex((line) => line === ">>>" || line.startsWith(">>> "));
    if (start < 0) {
        return text;
    }

    const quoted = lines.slice(start).map((line, index) => `> ${index === 0 ? line.replace(/^>>> ?/, "") : line}`);
    return [...lines.slice(0, start), ...quoted].join("\n");
}

// In Discord a quote is just its "> " lines; markdown would carry it on into
// the next line, quoting the reply under it too. A blank line between ends it,
// except inside code blocks, which stay exactly as typed.
function endQuotesAtLineEnd(text: string): string {
    const lines = text.split("\n");
    const out: string[] = [];
    let inFence = false;
    lines.forEach((line, index) => {
        out.push(line);
        if (/^\s{0,3}(```|~~~)/.test(line)) {
            inFence = !inFence;
        }
        const next = lines[index + 1];
        if (!inFence && next !== undefined && next.trim() !== "" && /^\s{0,3}>/.test(line) && !/^\s{0,3}>/.test(next)) {
            out.push("");
        }
    });
    return out.join("\n");
}

// Plain text between formatting: escaped, with mentions linked and custom
// emoji drawn, except inside links, where the text is the link's own.
function renderText(text: string, env: RenderEnv): string {
    if (env.linkDepth > 0) {
        return escapeHtml(text);
    }

    const pieces: Array<{ start: number; end: number; html: string }> = [];
    for (const mention of env.findMentions(text)) {
        env.mentioned.add(mention.userId);
        pieces.push({ start: mention.start, end: mention.end, html: toMentionLink(mention.userId, text.slice(mention.start, mention.end)) });
    }
    TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_PATTERN.exec(text)) !== null) {
        const resolved = env.emoji.get(match[0]);
        if (resolved) {
            pieces.push({ start: match.index, end: match.index + match[0].length, html: toEmojiImageTag(resolved.src, resolved.shortcode) });
        }
    }
    if (pieces.length === 0) {
        return escapeHtml(text);
    }

    env.replaced = true;
    pieces.sort((left, right) => left.start - right.start);
    let cursor = 0;
    let html = "";
    for (const piece of pieces) {
        if (piece.start < cursor) {
            continue;
        }
        html += escapeHtml(text.slice(cursor, piece.start)) + piece.html;
        cursor = piece.end;
    }
    return html + escapeHtml(text.slice(cursor));
}

// markdown-it's own text rule, which runs over plain characters up to the next
// one that may start markup, with | added so spoiler markers are seen at all.
const MARKUP_STARTS = new Set([10, 33, 35, 36, 37, 38, 42, 43, 45, 58, 60, 61, 62, 64, 91, 92, 93, 94, 95, 96, 123, SPOILER_MARKER, 125, 126]);

function plainText(state: StateInline, silent: boolean): boolean {
    let pos = state.pos;
    while (pos < state.posMax && !MARKUP_STARTS.has(state.src.charCodeAt(pos))) {
        pos += 1;
    }
    if (pos === state.pos) {
        return false;
    }
    if (!silent) {
        state.pending += state.src.slice(state.pos, pos);
    }
    state.pos = pos;
    return true;
}

// ||spoiler||, on the same delimiter machinery as markdown-it's ~~strikethrough~~,
// so it can hold other formatting.
function spoilerTokenize(state: StateInline, silent: boolean): boolean {
    if (silent || state.src.charCodeAt(state.pos) !== SPOILER_MARKER) {
        return false;
    }

    const scanned = state.scanDelims(state.pos, true);
    let length = scanned.length;
    if (length < 2) {
        return false;
    }

    if (length % 2) {
        state.push("text", "", 0).content = "|";
        length -= 1;
    }
    for (let index = 0; index < length; index += 2) {
        state.push("text", "", 0).content = "||";
        state.delimiters.push({
            marker: SPOILER_MARKER,
            length: 0,
            token: state.tokens.length - 1,
            end: -1,
            open: scanned.can_open,
            close: scanned.can_close,
        });
    }
    state.pos += scanned.length;
    return true;
}

function spoilerPostProcess(state: StateInline): boolean {
    const convert = (delimiters: StateInline["delimiters"]): void => {
        for (const start of delimiters) {
            if (start.marker !== SPOILER_MARKER || start.end === -1) {
                continue;
            }
            const open = state.tokens[start.token];
            open.type = "spoiler_open";
            open.tag = "span";
            open.nesting = 1;
            open.markup = "||";
            open.content = "";
            open.attrs = [["data-mx-spoiler", ""]];
            const close = state.tokens[delimiters[start.end].token];
            close.type = "spoiler_close";
            close.tag = "span";
            close.nesting = -1;
            close.markup = "||";
            close.content = "";
        }
    };

    convert(state.delimiters);
    for (const meta of state.tokens_meta) {
        if (meta?.delimiters) {
            convert(meta.delimiters);
        }
    }
    return false;
}

function collectShortcodes(text: string): string[] {
    const urlSpans: Array<{ start: number; end: number }> = [];
    URL_PATTERN.lastIndex = 0;
    let url: RegExpExecArray | null;
    while ((url = URL_PATTERN.exec(text)) !== null) {
        urlSpans.push({ start: url.index, end: url.index + trimUrl(url[0]).length });
    }

    const shortcodes: string[] = [];
    TOKEN_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_PATTERN.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (!urlSpans.some((span) => start >= span.start && end <= span.end)) {
            shortcodes.push(match[0]);
        }
    }
    return shortcodes;
}

function trimUrl(candidate: string): string {
    let cut = candidate.length;
    while (cut > 0) {
        const char = candidate.charAt(cut - 1);
        if (TRAILING_URL_PUNCTUATION.includes(char)) {
            cut -= 1;
            continue;
        }
        if (char === ")") {
            const prefix = candidate.slice(0, cut);
            if ((prefix.match(/\)/g) ?? []).length > (prefix.match(/\(/g) ?? []).length) {
                cut -= 1;
                continue;
            }
        }
        break;
    }
    return candidate.slice(0, cut);
}

async function resolveTokens(
    client: MatrixClient,
    room: Room,
    activeSpaceId: string | null,
    resolver: EmojiShortcodeResolver,
    tokens: string[],
): Promise<Map<string, ResolvedToken>> {
    const resolved = new Map<string, ResolvedToken>();
    const results = await Promise.all(
        tokens.map(async (token) => {
            const emoji = await resolver(client, room, token, activeSpaceId);
            const src = emoji ? (mxcThumbnailToHttp(client, emoji.url, 24, 24) ?? mxcToHttp(client, emoji.url)) : null;
            return emoji && src ? { token, shortcode: emoji.shortcode, src } : null;
        }),
    );
    for (const result of results) {
        if (result) {
            resolved.set(result.token, { shortcode: result.shortcode, src: result.src });
        }
    }
    return resolved;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The standard Matrix mention: a matrix.to link to the user, as Element sends it.
function toMentionLink(userId: string, text: string): string {
    return `<a href="https://matrix.to/#/${escapeHtml(userId)}">${escapeHtml(text)}</a>`;
}

function toEmojiImageTag(src: string, shortcode: string): string {
    const escapedShortcode = escapeHtml(shortcode);
    return `<img data-mx-emoticon="true" alt="${escapedShortcode}" title="${escapedShortcode}" height="24" width="24" src="${escapeHtml(src)}" />`;
}
