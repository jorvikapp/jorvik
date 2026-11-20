/**
 * Links on a profile (Twitch, YouTube, a website...), kept as a list of web addresses in one extended
 * profile field (MSC4133), like the bio. Servers without extended profiles simply don't have them.
 */
export const LINKS_FIELD = "app.jorvik.links";
export const MAX_PROFILE_LINKS = 5;
export const MAX_PROFILE_LINK_LENGTH = 300;

/** Bare web addresses such as twitch.tv/name or www.example.com/page. */
const BARE_ADDRESS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/**
 * Where some text points when the whole of it is one web address ("twitch.tv/name", "https://..."); null for
 * anything else. Only http and https: nothing here can open another kind of link.
 */
export function webLinkHref(input: string | null | undefined): string | null {
    const text = (input ?? "").trim();
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
        if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes(".") || url.username || url.password) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

/** The links in a stored value: web addresses only, no repeats, at most MAX_PROFILE_LINKS. */
export function profileLinksFrom(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const links: string[] = [];
    for (const item of value) {
        const href = typeof item === "string" && item.length <= MAX_PROFILE_LINK_LENGTH ? webLinkHref(item) : null;
        if (href && !links.includes(href)) {
            links.push(href);
        }
        if (links.length === MAX_PROFILE_LINKS) {
            break;
        }
    }
    return links;
}

export interface ProfileLinkView {
    href: string;
    /** "Twitch", "YouTube"; "Website" for any other site. */
    site: string;
    /** A short id for styling: "twitch", "youtube", "web". */
    kind: string;
    /** The account on that site ("xuruh", "@xuruh"), or the site and page for a website ("jorvik.app/blog"). */
    label: string;
}

interface KnownSite {
    kind: string;
    site: string;
    hosts: string[];
    /** The account from the path's parts; null when the address isn't an account page (it then shows as a website). */
    account: (parts: string[]) => string | null;
}

const first = (parts: string[]): string | null => parts[0] ?? null;
const atHandle = (parts: string[]): string | null => (parts[0]?.startsWith("@") ? parts[0] : null);
const afterPrefix =
    (...prefixes: string[]) =>
    (parts: string[]): string | null =>
        parts.length >= 2 && prefixes.includes(parts[0].toLowerCase()) ? parts[1] : null;

const KNOWN_SITES: KnownSite[] = [
    { kind: "twitch", site: "Twitch", hosts: ["twitch.tv"], account: first },
    {
        kind: "youtube",
        site: "YouTube",
        hosts: ["youtube.com"],
        account: (parts) => atHandle(parts) ?? afterPrefix("c", "user")(parts) ?? (parts[0] === "channel" && parts[1] ? "Channel" : null),
    },
    { kind: "kick", site: "Kick", hosts: ["kick.com"], account: first },
    { kind: "x", site: "X", hosts: ["x.com", "twitter.com"], account: (parts) => (parts[0] ? `@${parts[0]}` : null) },
    { kind: "bluesky", site: "Bluesky", hosts: ["bsky.app"], account: (parts) => (afterPrefix("profile")(parts) ? `@${parts[1]}` : null) },
    { kind: "instagram", site: "Instagram", hosts: ["instagram.com"], account: (parts) => (parts[0] ? `@${parts[0]}` : null) },
    { kind: "tiktok", site: "TikTok", hosts: ["tiktok.com"], account: atHandle },
    { kind: "github", site: "GitHub", hosts: ["github.com"], account: first },
    { kind: "reddit", site: "Reddit", hosts: ["reddit.com"], account: (parts) => (afterPrefix("u", "user")(parts) ? `u/${parts[1]}` : null) },
    { kind: "steam", site: "Steam", hosts: ["steamcommunity.com"], account: afterPrefix("id", "profiles") },
    { kind: "soundcloud", site: "SoundCloud", hosts: ["soundcloud.com"], account: first },
    { kind: "spotify", site: "Spotify", hosts: ["open.spotify.com"], account: (parts) => (afterPrefix("artist", "user")(parts) ? "Profile" : null) },
];

/** What a link shows as on the profile. The site comes from the real address, so a link can't pose as another site. */
export function describeProfileLink(href: string): ProfileLinkView {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
    const parts = url.pathname
        .split("/")
        .filter(Boolean)
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch {
                return part;
            }
        });
    const known = KNOWN_SITES.find((site) => site.hosts.includes(host));
    const account = known?.account(parts);
    if (known && account) {
        return { href, site: known.site, kind: known.kind, label: account };
    }
    const path = url.pathname.replace(/\/+$/, "");
    return { href, site: known?.site ?? "Website", kind: known?.kind ?? "web", label: `${host}${path}` };
}
