/**
 * The picture behind someone's avatar on their profile: an mxc:// address kept in an extended profile field
 * (MSC4133), like the bio. Servers without extended profiles simply don't have one.
 */
export const BANNER_FIELD = "app.jorvik.banner";

/** The kinds of picture a banner can be: still or animated (GIF, WebP). */
export const BANNER_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** Big enough for a short GIF, small enough that a profile opens quickly. The server's own limit wins if lower. */
export const BANNER_MAX_BYTES = 10 * 1024 * 1024;

const MXC = /^mxc:\/\/[A-Za-z0-9.:\-[\]]+\/[A-Za-z0-9_-]+$/;

/** The banner's mxc:// address from a stored value; anything else (wrong type, another scheme) is no banner. */
export function bannerMxcFrom(value: unknown): string | null {
    return typeof value === "string" && MXC.test(value.trim()) ? value.trim() : null;
}

// What this session last saved for a user, so profiles already open show a new banner without a refetch.
const saved = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function rememberBanner(userId: string, mxc: string | null): void {
    saved.set(userId, mxc);
    for (const listener of listeners) {
        listener();
    }
}

/** undefined when this session hasn't saved one for them. */
export function savedBanner(userId: string): string | null | undefined {
    return saved.has(userId) ? saved.get(userId) : undefined;
}

export function subscribeBanners(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** For tests. */
export function clearSavedBanners(): void {
    saved.clear();
}
