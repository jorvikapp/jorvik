import * as encrypt from "matrix-encrypt-attachment";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { cleanIcon, type ActivityIconFile } from "./activityWire";

/**
 * Game icons for activity (see activityWire.ts). The sender's desktop app hands over the icon Steam
 * keeps of the running game; it is encrypted, uploaded to the user's homeserver and remembered on this
 * device for that account, so each game uploads once. Receivers download and decrypt an icon once per
 * session and show it from memory.
 */

const STORAGE_PREFIX = "jorvik.activityIcons.";
/** Games remembered per account; the oldest are forgotten first. */
const MAX_REMEMBERED_ICONS = 100;
/** Icons are PNGs of at most 64x64, a few kilobytes; anything far bigger isn't worth downloading. */
const MAX_ICON_BYTES = 256 * 1024;
/** An icon that failed to download or decrypt is tried again after this long. */
const FAILED_ICON_RETRY_MS = 10 * 60_000;
const MAX_SHOWN_ICONS = 300;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface RememberedIcon {
    game: string;
    icon: ActivityIconFile;
}

function storageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
}

function readRemembered(userId: string): RememberedIcon[] {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.flatMap((entry: unknown) => {
            const { game, icon } = (entry ?? {}) as { game?: unknown; icon?: unknown };
            const cleaned = cleanIcon(icon);
            return typeof game === "string" && cleaned ? [{ game, icon: cleaned }] : [];
        });
    } catch {
        return [];
    }
}

/** The icon this device uploaded for the game before, if any. */
export function rememberedGameIcon(userId: string, gameId: string): ActivityIconFile | null {
    return readRemembered(userId).find((entry) => entry.game === gameId)?.icon ?? null;
}

function rememberGameIcon(userId: string, gameId: string, icon: ActivityIconFile): void {
    const kept = [...readRemembered(userId).filter((entry) => entry.game !== gameId), { game: gameId, icon }];
    try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(kept.slice(-MAX_REMEMBERED_ICONS)));
    } catch {
        // Storage full or blocked: the icon is uploaded again next time.
    }
}

const uploads = new Map<string, Promise<ActivityIconFile | null>>();

/**
 * The game's icon on the user's homeserver: `png` encrypted, uploaded and remembered. One upload at a
 * time per game; it rejects when the upload fails, to try again the next time the game runs.
 */
export function uploadGameIcon(
    client: MatrixClient,
    userId: string,
    gameId: string,
    png: Uint8Array,
): Promise<ActivityIconFile | null> {
    const key = `${userId}\u0000${gameId}`;
    const pending = uploads.get(key);
    if (pending) {
        return pending;
    }
    const upload = (async (): Promise<ActivityIconFile | null> => {
        const encrypted = await encrypt.encryptAttachment(png.slice().buffer);
        const { content_uri: url } = await client.uploadContent(
            new Blob([encrypted.data], { type: "application/octet-stream" }),
            { includeFilename: false, type: "application/octet-stream" },
        );
        const icon = cleanIcon({ ...encrypted.info, url });
        if (icon) {
            rememberGameIcon(userId, gameId, icon);
            showLocally(icon, png);
        }
        return icon;
    })().finally(() => uploads.delete(key));
    uploads.set(key, upload);
    return upload;
}

/** Decrypted icons as object URLs, by what identifies them; the oldest go first past the limit. */
const shown = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();

function iconKey(icon: ActivityIconFile): string {
    return [icon.url, icon.key.k, icon.iv, icon.hashes.sha256].join("\u0000");
}

function isPng(data: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

function keepShown(key: string, url: string): void {
    shown.set(key, url);
    while (shown.size > MAX_SHOWN_ICONS) {
        const [oldestKey, oldestUrl] = shown.entries().next().value as [string, string];
        shown.delete(oldestKey);
        URL.revokeObjectURL(oldestUrl);
    }
}

/** The user's own upload shows from the PNG they already have. */
function showLocally(icon: ActivityIconFile, png: Uint8Array): void {
    const key = iconKey(icon);
    if (!shown.has(key) && isPng(png)) {
        keepShown(key, URL.createObjectURL(new Blob([png.slice()], { type: "image/png" })));
    }
}

/** Reads a response, giving up once it's bigger than `max` bytes. */
async function readCapped(response: Response, max: number): Promise<ArrayBuffer> {
    if (Number(response.headers.get("content-length")) > max) {
        throw new Error("Game icon is too big");
    }
    const reader = response.body?.getReader();
    if (!reader) {
        const whole = await response.arrayBuffer();
        if (whole.byteLength > max) {
            throw new Error("Game icon is too big");
        }
        return whole;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        total += value.byteLength;
        if (total > max) {
            void reader.cancel().catch(() => undefined);
            throw new Error("Game icon is too big");
        }
        chunks.push(value);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return data.buffer;
}

/** From the user's own homeserver, which fetches it over federation if it's elsewhere. */
async function downloadIcon(client: MatrixClient, mxc: string): Promise<ArrayBuffer> {
    const urls = new Set(
        [
            client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, true),
            client.mxcUrlToHttp(mxc, undefined, undefined, undefined, false, true, false),
        ].filter((url): url is string => typeof url === "string" && url.length > 0),
    );
    const token = client.getAccessToken();
    let lastError: unknown = new Error("No download URL for the game icon");
    for (const url of urls) {
        try {
            const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
            if (!response.ok) {
                throw new Error(`Game icon download failed (${response.status})`);
            }
            return await readCapped(response, MAX_ICON_BYTES);
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

/** The icon's object URL if it's ready, null if it failed lately, undefined if it hasn't been loaded. */
export function peekGameIconUrl(icon: ActivityIconFile, now = Date.now()): string | null | undefined {
    const key = iconKey(icon);
    const url = shown.get(key);
    if (url) {
        return url;
    }
    const failed = failedAt.get(key);
    return failed !== undefined && now - failed < FAILED_ICON_RETRY_MS ? null : undefined;
}

/** The icon downloaded, decrypted and checked to be a PNG, as an object URL; null when that fails. */
export function loadGameIconUrl(client: MatrixClient, icon: ActivityIconFile): Promise<string | null> {
    const ready = peekGameIconUrl(icon);
    if (ready !== undefined) {
        return Promise.resolve(ready);
    }
    const key = iconKey(icon);
    const pending = loading.get(key);
    if (pending) {
        return pending;
    }
    const load = (async (): Promise<string | null> => {
        try {
            const plain = new Uint8Array(await encrypt.decryptAttachment(await downloadIcon(client, icon.url), icon));
            if (!isPng(plain)) {
                throw new Error("Game icon isn't a PNG");
            }
            const url = URL.createObjectURL(new Blob([plain], { type: "image/png" }));
            keepShown(key, url);
            failedAt.delete(key);
            return url;
        } catch {
            failedAt.set(key, Date.now());
            return null;
        } finally {
            loading.delete(key);
        }
    })();
    loading.set(key, load);
    return load;
}

/** Forgets every icon shown, for signing out. */
export function clearGameIconUrls(): void {
    for (const url of shown.values()) {
        URL.revokeObjectURL(url);
    }
    shown.clear();
    loading.clear();
    failedAt.clear();
}
