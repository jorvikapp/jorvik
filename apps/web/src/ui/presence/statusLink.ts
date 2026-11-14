/** Bare web addresses such as twitch.tv/name or www.example.com/page. */
const BARE_ADDRESS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/**
 * Where a status message points when the whole message is one web address; null for anything else.
 * Only http and https: a status can never open another kind of link.
 */
export function statusLinkHref(statusMessage: string | null | undefined): string | null {
    const text = (statusMessage ?? "").trim();
    if (!text || /\s/.test(text)) {
        return null;
    }
    let candidate: string;
    if (/^https?:\/\//i.test(text)) {
        candidate = text;
    } else if (!text.includes("@") && BARE_ADDRESS.test(text)) {
        candidate = `https://${text}`;
    } else {
        return null;
    }
    try {
        const url = new URL(candidate);
        if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".")) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}
