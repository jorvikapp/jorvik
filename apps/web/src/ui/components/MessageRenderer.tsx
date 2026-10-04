import React, { useMemo, useState } from "react";
import { mxidLocalpart, tokenizeMatrixMentions } from "../mentions/mentionTokens";

interface MessageRendererProps {
    body: string;
    format?: string;
    formattedBody?: string;
    resolveImageSource?: (src: string, width: number, height: number) => string | null;
    resolveImageFallbackSource?: (src: string, width: number, height: number) => string | null;
    resolveMentionDisplayName?: (userId: string) => string | null;
    ownUserId?: string | null;
}

const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_TEXT_ATTR_LENGTH = 256;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;

function normalizeAllowedImageSource(src: string): string | null {
    const candidate = src.trim();
    if (!candidate || candidate.length > MAX_IMAGE_URL_LENGTH) {
        return null;
    }

    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
        return null;
    }

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return null;
        }

        if (!parsed.hostname || parsed.username || parsed.password) {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

function sanitizeDimension(value: string | null, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.max(8, Math.min(parsed, 256));
}

function sanitizeText(value: string | null, fallback = ""): string {
    if (!value) {
        return fallback;
    }

    const sanitized = value.replace(CONTROL_CHAR_PATTERN, "").trim();
    if (!sanitized) {
        return fallback;
    }

    return sanitized.slice(0, MAX_TEXT_ATTR_LENGTH);
}

function sanitizeTextNode(value: string): string {
    return value.replace(CONTROL_CHAR_PATTERN, "");
}

function normalizeMentionDisplayName(value: string): string {
    const trimmed = sanitizeText(value, "");
    if (!trimmed) {
        return "";
    }

    return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

// Formatting shown as the same kind of element. Anything not listed here is
// shown as its text, so a message can't bring its own markup or styles.
const FORMATTING_TAGS: Record<string, string> = {
    strong: "strong",
    b: "strong",
    em: "em",
    i: "em",
    u: "u",
    s: "s",
    del: "s",
    strike: "s",
    sup: "sup",
    sub: "sub",
    p: "p",
    blockquote: "blockquote",
    ul: "ul",
    ol: "ol",
    li: "li",
    h1: "h1",
    h2: "h2",
    h3: "h3",
    h4: "h4",
    h5: "h5",
    h6: "h6",
};

// Links open outside the app, and only to the web or an email address.
function safeLinkHref(href: string | null): string | null {
    if (!href) {
        return null;
    }
    try {
        const url = new URL(href);
        return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.toString() : null;
    } catch {
        return null;
    }
}

function Spoiler({ children }: { children: React.ReactNode }): React.ReactElement {
    const [revealed, setRevealed] = useState(false);
    if (revealed) {
        return <span className="message-renderer-spoiler is-revealed">{children}</span>;
    }

    return (
        <span
            className="message-renderer-spoiler"
            role="button"
            tabIndex={0}
            aria-label="Spoiler, select to show"
            onClick={() => setRevealed(true)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setRevealed(true);
                }
            }}
        >
            {children}
        </span>
    );
}

// A mention as clients send it: a matrix.to link to a user.
const USER_PERMALINK_PATTERN = /^https:\/\/matrix\.to\/#\/([^/?#]+)/;

function userIdFromPermalink(href: string | null): string | null {
    const match = href ? USER_PERMALINK_PATTERN.exec(href) : null;
    if (!match) {
        return null;
    }
    try {
        const userId = decodeURIComponent(match[1]);
        return /^@[^:\s]+:\S+$/.test(userId) ? userId : null;
    } catch {
        return null;
    }
}

function renderMentionPill(
    userId: string,
    key: string,
    resolveMentionDisplayName?: (userId: string) => string | null,
    ownUserId?: string | null,
): React.ReactNode {
    const fallbackName = mxidLocalpart(userId);
    const resolvedName = resolveMentionDisplayName?.(userId);
    const displayName = normalizeMentionDisplayName(resolvedName ?? fallbackName) || fallbackName;
    const isDirectMention = Boolean(ownUserId && userId === ownUserId);

    return (
        <span
            key={key}
            className={`message-renderer-mention${isDirectMention ? " is-direct" : ""}`}
            data-mention-user-id={userId}
        >
            @{displayName}
        </span>
    );
}

function renderTextNodeWithMentions(
    value: string,
    keyPrefix: string,
    resolveMentionDisplayName?: (userId: string) => string | null,
    ownUserId?: string | null,
): React.ReactNode[] {
    const sanitized = sanitizeTextNode(value);
    const segments = tokenizeMatrixMentions(sanitized);
    const rendered: React.ReactNode[] = [];

    segments.forEach((segment, index) => {
        const key = `${keyPrefix}_text_${index}`;
        if (segment.type === "text") {
            rendered.push(<React.Fragment key={key}>{segment.value}</React.Fragment>);
            return;
        }

        rendered.push(
            renderMentionPill(
                segment.userId,
                `${keyPrefix}_mention_${index}`,
                resolveMentionDisplayName,
                ownUserId,
            ),
        );
    });

    return rendered;
}

function hasMatrixEmoticonMarker(element: HTMLElement): boolean {
    const marker = element.getAttribute("data-mx-emoticon");
    if (marker === null) {
        return false;
    }

    const normalized = marker.trim().toLowerCase();
    return normalized === "" || normalized === "true" || normalized === "1";
}

function handleSanitizedImageError(event: React.SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;
    if (image.dataset.heorotRetryAttempted === "1") {
        return;
    }

    const currentSource = image.currentSrc || image.src;
    if (!currentSource) {
        return;
    }

    const withCacheBuster = (url: string): string => {
        const hashIndex = url.indexOf("#");
        const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
        const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
        const separator = baseUrl.includes("?") ? "&" : "?";
        return `${baseUrl}${separator}__heorot_retry=${Date.now()}${hash}`;
    };

    const fallbackSource = image.dataset.heorotFallbackSrc;
    image.dataset.heorotRetryAttempted = "1";

    if (fallbackSource && fallbackSource !== currentSource) {
        image.dataset.heorotFallbackApplied = "1";
        image.src = withCacheBuster(fallbackSource);
        return;
    }

    image.src = withCacheBuster(currentSource);
}

function sanitizeNodes(
    nodes: NodeListOf<ChildNode>,
    keyPrefix: string,
    resolveImageSource?: (src: string, width: number, height: number) => string | null,
    resolveImageFallbackSource?: (src: string, width: number, height: number) => string | null,
    resolveMentionDisplayName?: (userId: string) => string | null,
    ownUserId?: string | null,
): React.ReactNode[] {
    const rendered: React.ReactNode[] = [];

    nodes.forEach((node, index) => {
        const key = `${keyPrefix}_${index}`;
        if (node.nodeType === Node.TEXT_NODE) {
            // The line breaks between list items are layout, and text isn't allowed there.
            const parentTag = node.parentElement?.tagName;
            if ((parentTag === "UL" || parentTag === "OL") && !(node.textContent ?? "").trim()) {
                return;
            }
            rendered.push(
                ...renderTextNodeWithMentions(
                    node.textContent ?? "",
                    key,
                    resolveMentionDisplayName,
                    ownUserId,
                ),
            );
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const element = node as HTMLElement;
        const tagName = element.tagName.toLowerCase();

        if (tagName === "br") {
            rendered.push(<br key={key} />);
            return;
        }

        if (tagName === "img") {
            if (!hasMatrixEmoticonMarker(element)) {
                return;
            }

            const src = element.getAttribute("src");
            if (!src) {
                return;
            }

            const width = sanitizeDimension(element.getAttribute("width"), 24);
            const height = sanitizeDimension(element.getAttribute("height"), 24);
            const resolvedSrc = resolveImageSource?.(src, width, height);
            const normalizedSrc = normalizeAllowedImageSource(resolvedSrc ?? src);
            const resolvedFallbackSrc = resolveImageFallbackSource?.(src, width, height);
            const normalizedFallbackSrc = normalizeAllowedImageSource(resolvedFallbackSrc ?? "");
            if (!normalizedSrc) {
                return;
            }

            const alt = sanitizeText(element.getAttribute("alt"), "");
            const title = sanitizeText(element.getAttribute("title"), alt);

            rendered.push(
                <img
                    key={key}
                    src={normalizedSrc}
                    alt={alt}
                    title={title}
                    width={width}
                    height={height}
                    loading="lazy"
                    decoding="async"
                    className="message-renderer-emoticon"
                    data-mx-emoticon="true"
                    data-heorot-fallback-src={normalizedFallbackSrc ?? undefined}
                    onError={handleSanitizedImageError}
                />,
            );
            return;
        }

        const mentionedUserId = tagName === "a" ? userIdFromPermalink(element.getAttribute("href")) : null;
        if (mentionedUserId) {
            rendered.push(renderMentionPill(mentionedUserId, key, resolveMentionDisplayName, ownUserId));
            return;
        }

        const renderChildren = (): React.ReactNode[] =>
            sanitizeNodes(
                element.childNodes as NodeListOf<ChildNode>,
                `${key}_child`,
                resolveImageSource,
                resolveImageFallbackSource,
                resolveMentionDisplayName,
                ownUserId,
            );

        if (tagName === "hr") {
            rendered.push(<hr key={key} className="message-renderer-rule" />);
            return;
        }

        // Code shows exactly as sent: no mentions, emoji or markup inside it.
        if (tagName === "pre") {
            rendered.push(
                <pre key={key} className="message-renderer-codeblock">
                    <code>{element.textContent ?? ""}</code>
                </pre>,
            );
            return;
        }
        if (tagName === "code") {
            rendered.push(
                <code key={key} className="message-renderer-code">
                    {element.textContent ?? ""}
                </code>,
            );
            return;
        }

        if (tagName === "span" && element.hasAttribute("data-mx-spoiler")) {
            rendered.push(<Spoiler key={key}>{renderChildren()}</Spoiler>);
            return;
        }

        const href = tagName === "a" ? safeLinkHref(element.getAttribute("href")) : null;
        if (href) {
            rendered.push(
                <a key={key} className="timeline-link" href={href} target="_blank" rel="noopener noreferrer">
                    {renderChildren()}
                </a>,
            );
            return;
        }

        // Never shown, not even as text: the old reply quote some clients
        // still put in front of the message, scripts and styles.
        if (tagName === "mx-reply" || tagName === "script" || tagName === "style") {
            return;
        }

        const formattingTag = FORMATTING_TAGS[tagName];
        if (formattingTag) {
            const start = tagName === "ol" ? Number.parseInt(element.getAttribute("start") ?? "", 10) : Number.NaN;
            rendered.push(
                React.createElement(
                    formattingTag,
                    { key, className: `message-renderer-${formattingTag}`, start: Number.isFinite(start) ? start : undefined },
                    ...renderChildren(),
                ),
            );
            return;
        }

        rendered.push(
            ...sanitizeNodes(
                element.childNodes as NodeListOf<ChildNode>,
                `${key}_child`,
                resolveImageSource,
                resolveImageFallbackSource,
                resolveMentionDisplayName,
                ownUserId,
            ),
        );
    });

    return rendered;
}

function renderSanitizedFormattedBody(
    formattedBody: string,
    resolveImageSource?: (src: string, width: number, height: number) => string | null,
    resolveImageFallbackSource?: (src: string, width: number, height: number) => string | null,
    resolveMentionDisplayName?: (userId: string) => string | null,
    ownUserId?: string | null,
): React.ReactNode[] | null {
    if (typeof DOMParser === "undefined") {
        return null;
    }

    try {
        const parser = new DOMParser();
        const document = parser.parseFromString(formattedBody, "text/html");
        return sanitizeNodes(
            document.body.childNodes,
            "message_html",
            resolveImageSource,
            resolveImageFallbackSource,
            resolveMentionDisplayName,
            ownUserId,
        );
    } catch {
        return null;
    }
}

export function MessageRenderer({
    body,
    format,
    formattedBody,
    resolveImageSource,
    resolveImageFallbackSource,
    resolveMentionDisplayName,
    ownUserId,
}: MessageRendererProps): React.ReactElement {
    const sanitizedNodes = useMemo(() => {
        if (format !== "org.matrix.custom.html" || typeof formattedBody !== "string") {
            return null;
        }

        const nodes = renderSanitizedFormattedBody(
            formattedBody,
            resolveImageSource,
            resolveImageFallbackSource,
            resolveMentionDisplayName,
            ownUserId,
        );
        if (!nodes || nodes.length === 0) {
            return null;
        }

        return nodes;
    }, [format, formattedBody, ownUserId, resolveImageSource, resolveImageFallbackSource, resolveMentionDisplayName]);

    if (sanitizedNodes) {
        return <div className="message-renderer-html">{sanitizedNodes}</div>;
    }

    return <>{renderTextNodeWithMentions(body, "message_plain", resolveMentionDisplayName, ownUserId)}</>;
}
