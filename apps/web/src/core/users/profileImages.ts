/**
 * Pictures on a profile, each an mxc:// address kept in an extended profile field (MSC4133), like the bio.
 * Servers without extended profiles simply don't have them.
 *   - the banner: behind the avatar on the profile card;
 *   - the nameplate: behind your name in your panel at the bottom left.
 */
export const BANNER_FIELD = "app.jorvik.banner";
export const NAMEPLATE_FIELD = "app.jorvik.nameplate";
export type ProfileImageField = typeof BANNER_FIELD | typeof NAMEPLATE_FIELD;

/** The kinds of picture they can be: still or animated (GIF, WebP). */
export const PROFILE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** Big enough for a short GIF, small enough that it shows quickly. The server's own limit wins if lower. */
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const MXC = /^mxc:\/\/[A-Za-z0-9.:\-[\]]+\/[A-Za-z0-9_-]+$/;

/** The picture's mxc:// address from a stored value; anything else (wrong type, another scheme) is none. */
export function profileImageMxcFrom(value: unknown): string | null {
    return typeof value === "string" && MXC.test(value.trim()) ? value.trim() : null;
}

// What this session last saved, so views already open show a new picture without a refetch.
const saved = new Map<string, string | null>();
const listeners = new Set<() => void>();
const key = (userId: string, field: ProfileImageField): string => `${field}\u0000${userId}`;

export function rememberProfileImage(userId: string, field: ProfileImageField, mxc: string | null): void {
    saved.set(key(userId, field), mxc);
    for (const listener of listeners) {
        listener();
    }
}

/** undefined when this session hasn't saved one. */
export function savedProfileImage(userId: string, field: ProfileImageField): string | null | undefined {
    const k = key(userId, field);
    return saved.has(k) ? saved.get(k) : undefined;
}

export function subscribeProfileImages(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** For tests. */
export function clearSavedProfileImages(): void {
    saved.clear();
}
