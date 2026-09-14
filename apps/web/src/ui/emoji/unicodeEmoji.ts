export interface UnicodeEmoji {
    value: string;
    name: string;
}

export interface UnicodeEmojiGroup {
    name: string;
    emojis: UnicodeEmoji[];
}

interface RawGroup {
    n: string;
    e: [string, string][];
}

/**
 * The full Unicode emoji set, fetched on first use.
 *
 * Deliberately not bundled: it is ~51KB of data nobody needs until they open
 * the picker, and the app already carries a heavy startup payload. The promise
 * is cached so repeated opens reuse one fetch, and cleared on failure so a
 * transient error can be retried.
 */
let cached: Promise<UnicodeEmojiGroup[]> | null = null;

export function loadUnicodeEmoji(): Promise<UnicodeEmojiGroup[]> {
    if (cached) {
        return cached;
    }

    const url = new URL("emoji-data.json", document.baseURI).toString();
    cached = fetch(url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Emoji data unavailable (${response.status})`);
            }
            return response.json() as Promise<RawGroup[]>;
        })
        .then((raw) =>
            raw.map((group) => ({
                name: group.n,
                emojis: group.e.map(([value, name]) => ({ value, name })),
            })),
        )
        .catch((error: unknown) => {
            cached = null;
            throw error;
        });

    return cached;
}
