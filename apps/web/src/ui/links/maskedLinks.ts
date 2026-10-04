/**
 * Links whose text doesn't show where they go, like [the site](address) in a
 * message. A link that shows its own address, or another address on the same
 * site, hides nothing. Jorvik asks before opening the others, until someone
 * trusts that site on this device.
 */

const TRUSTED_HOSTS_STORAGE_KEY = "jorvik.trusted_link_hosts";
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isMaskedLink(text: string, href: string): boolean {
    const target = parseUrl(href);
    if (!target) {
        return true;
    }

    const shown = text.trim();
    if (target.protocol === "mailto:") {
        return shown.toLowerCase() !== safeDecode(target.pathname).toLowerCase();
    }

    const shownHost = hostShownBy(shown);
    return shownHost === null || shownHost !== target.hostname.toLowerCase();
}

export function linkHost(href: string): string | null {
    return parseUrl(href)?.hostname.toLowerCase() || null;
}

export function isTrustedLinkHost(host: string): boolean {
    return readTrustedHosts().includes(host.toLowerCase());
}

export function trustLinkHost(host: string): void {
    const hosts = readTrustedHosts();
    const normalized = host.toLowerCase();
    if (hosts.includes(normalized)) {
        return;
    }
    try {
        window.localStorage.setItem(TRUSTED_HOSTS_STORAGE_KEY, JSON.stringify([...hosts, normalized]));
    } catch {
        // Without storage it asks again next time, which is the safe side.
    }
}

// The site a link's text names, when the text is an address: "www.jorvik.app",
// "https://www.jorvik.app/download". Ordinary words name no site.
function hostShownBy(text: string): string | null {
    if (!text || /\s/.test(text)) {
        return null;
    }
    const url = parseUrl(SCHEME_PATTERN.test(text) ? text : `https://${text}`);
    return url && url.hostname.includes(".") ? url.hostname.toLowerCase() : null;
}

function readTrustedHosts(): string[] {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(TRUSTED_HOSTS_STORAGE_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
        return [];
    }
}

function parseUrl(value: string): URL | null {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
