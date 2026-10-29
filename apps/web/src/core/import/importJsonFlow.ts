import { EventType, Preset, type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    HEOROT_VOICE_CHANNEL_EVENT,
    HEOROT_SPACE_CHILD_CHANNEL_TYPE_KEY,
    HEOROT_SPACE_CHILD_VOICE_KEY,
    MATRIX_CALL_COMPAT_EVENT,
} from "../voice/voiceChannel";
import { getSpacePack, saveSpacePack } from "../emoji/EmojiPackStore";
import { createCategory, writeCategories, writeChannelOrder, type HeorotCategory } from "../stores/CategoryStore";

const CHANNEL_ACCESS_EVENT = "com.heorot.channel_access";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonExportGuild {
    id: string;
    name: string;
    description?: string | null;
}

export interface JsonExportCategory {
    id: string;
    name: string;
    position: number;
}

export interface JsonExportChannel {
    id: string;
    name: string;
    type: string; // "text" | "voice" | ...
    position: number;
    category_id: string | null;
    topic?: string | null;
    nsfw?: boolean;
    slowmode_delay?: number;
    bitrate?: number;
    user_limit?: number;
}

export interface JsonExportEmoji {
    id: string;
    name: string;
    shortcode: string;
    animated: boolean;
    path: string;
    status: string;
}

export interface JsonExport {
    exported_at: string;
    guild: JsonExportGuild;
    categories: JsonExportCategory[];
    channels: JsonExportChannel[];
    emojis: JsonExportEmoji[];
}

export interface ImportProgress {
    stage: "space" | "channels" | "emojis" | "done";
    current: number;
    total: number;
    message: string;
}

export type ProgressCallback = (progress: ImportProgress) => void;

export interface ImportResult {
    spaceId: string;
    channelsCreated: number;
    emojisUploaded: number;
    errors: string[];
}

// ---------------------------------------------------------------------------
// Rate limiting helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RateLimitState {
    pauseUntil: number;
    /** Called about once a second while waiting for the server, with how long is left. */
    onWait?: (waitMs: number) => void;
}

async function waitOut(state: RateLimitState): Promise<void> {
    for (let waitMs = state.pauseUntil - Date.now(); waitMs > 0; waitMs = state.pauseUntil - Date.now()) {
        state.onWait?.(waitMs);
        await delay(Math.min(waitMs, 1000));
    }
}

async function withRateLimit<T>(
    fn: () => Promise<T>,
    sharedState?: RateLimitState,
    maxRetries = 6,
): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (sharedState) {
            await waitOut(sharedState);
        }

        try {
            return await fn();
        } catch (err) {
            const httpStatus = (err as { httpStatus?: number }).httpStatus;
            if (httpStatus === 429 && attempt < maxRetries) {
                const retryAfterMs =
                    (err as { data?: { retry_after_ms?: number } }).data?.retry_after_ms ?? 5000;
                const retryAt = Date.now() + retryAfterMs + 100;
                if (sharedState) {
                    sharedState.pauseUntil = Math.max(sharedState.pauseUntil, retryAt);
                } else {
                    await delay(retryAfterMs + 100);
                }
                continue;
            }
            throw err;
        }
    }
    throw new Error("Max retries exceeded");
}

async function inParallel<T>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
    let next = 0;
    async function worker(): Promise<void> {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export interface ImportSignal {
    cancelled: boolean;
}

export interface ChannelImportConfig {
    minPL: 0 | 50 | 100;
    isPublic: boolean;
    isEncrypted: boolean;
}

/** What a channel gets unless the import says otherwise: encrypted, like channels made in Jorvik. */
export function defaultChannelImportConfig(): ChannelImportConfig {
    return { minPL: 0, isPublic: false, isEncrypted: true };
}

// ---------------------------------------------------------------------------
// Other helpers
// ---------------------------------------------------------------------------

function getViaServer(client: MatrixClient): string | null {
    const userId = client.getUserId();
    if (!userId) return null;
    const sep = userId.indexOf(":");
    if (sep < 0 || sep === userId.length - 1) return null;
    return userId.slice(sep + 1).trim() || null;
}

function getEmojiFilename(path: string): string {
    return path.split("/").pop() ?? path;
}

function guessMimeType(filename: string): string {
    if (filename.endsWith(".gif")) return "image/gif";
    if (filename.endsWith(".png")) return "image/png";
    if (filename.endsWith(".webp")) return "image/webp";
    if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
    return "image/png";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseJsonExport(raw: unknown): JsonExport | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const guild = obj.guild as Record<string, unknown> | undefined;
    if (!guild || typeof guild.name !== "string") return null;
    if (!Array.isArray(obj.categories) || !Array.isArray(obj.channels) || !Array.isArray(obj.emojis)) return null;
    return raw as JsonExport;
}

export function getSupportedChannels(exportData: JsonExport): JsonExportChannel[] {
    return exportData.channels.filter((ch) => ch.type === "text" || ch.type === "voice");
}

export async function runJsonImport(
    client: MatrixClient,
    exportData: JsonExport,
    emojiFiles: Map<string, File>,
    onProgress: ProgressCallback,
    signal: ImportSignal,
    channelConfig: Record<string, ChannelImportConfig> = {},
): Promise<ImportResult> {
    const errors: string[] = [];
    const viaServer = getViaServer(client);
    const via = viaServer ? [viaServer] : undefined;
    const supportedChannels = getSupportedChannels(exportData);
    const sourceToMatrix = new Map<string, string>();
    const rateLimitState: RateLimitState = { pauseUntil: 0 };
    let lastProgressTs = 0;

    const emitProgress = (progress: ImportProgress, force = false): void => {
        const now = Date.now();
        if (!force && now - lastProgressTs < 150) {
            return;
        }
        lastProgressTs = now;
        onProgress(progress);
    };

    // What the progress says while the server makes the import wait.
    const waitMessage = (waitMs: number): string =>
        `Your server asked Jorvik to slow down. Carrying on in ${Math.ceil(waitMs / 1000)} s.`;

    // 1. Create main space
    onProgress({ stage: "space", current: 0, total: 1, message: `Creating Space "${exportData.guild.name}"...` });
    rateLimitState.onWait = (waitMs) =>
        emitProgress({ stage: "space", current: 0, total: 1, message: waitMessage(waitMs) }, true);
    const spaceResponse = await withRateLimit(() =>
        client.createRoom({
            name: exportData.guild.name,
            topic: exportData.guild.description || undefined,
            preset: Preset.PrivateChat,
            creation_content: { type: "m.space" },
            initial_state: [
                {
                    type: EventType.RoomJoinRules,
                    state_key: "",
                    content: { join_rule: "invite" },
                },
                // Spaces are encrypted by default, like channels.
                {
                    type: EventType.RoomEncryption,
                    state_key: "",
                    content: { algorithm: "m.megolm.v1.aes-sha2" },
                },
            ],
        }),
        rateLimitState,
    );
    const spaceId = spaceResponse.room_id;
    emitProgress({ stage: "space", current: 1, total: 1, message: "Space created." }, true);

    // 2. Create channels, one at a time. Servers limit how fast an account can make rooms (Synapse: 10 at once, then
    // about one a minute), and channels made side by side would only take turns being refused until they gave up.
    const CHANNEL_CONCURRENCY = 1;
    let channelsCreated = 0;
    rateLimitState.onWait = (waitMs) =>
        emitProgress({
            stage: "channels",
            current: channelsCreated,
            total: supportedChannels.length,
            message: signal.cancelled
                ? waitMessage(waitMs)
                : `Your server limits how fast channels can be made. Next one in ${Math.ceil(waitMs / 1000)} s, ` +
                  `${supportedChannels.length - channelsCreated} to go.`,
        }, true);
    await inParallel(supportedChannels, CHANNEL_CONCURRENCY, async (channel) => {
        if (signal.cancelled) return;
        const isVoice = channel.type === "voice";

        try {
            const cfg: ChannelImportConfig = channelConfig[channel.id] ?? defaultChannelImportConfig();
            const initialState: Array<{ type: string; state_key: string; content: Record<string, unknown> }> = [];

            if (cfg.isPublic) {
                initialState.push({
                    type: EventType.RoomJoinRules,
                    state_key: "",
                    content: { join_rule: "public" },
                });
            }

            // Voice channels too: a call is end-to-end encrypted when its room is.
            if (cfg.isEncrypted) {
                initialState.push({
                    type: EventType.RoomEncryption,
                    state_key: "",
                    content: { algorithm: "m.megolm.v1.aes-sha2" },
                });
            }
            if (isVoice) {
                initialState.push({
                    type: HEOROT_VOICE_CHANNEL_EVENT,
                    state_key: "",
                    content: { enabled: true, version: 1, chat_suppressed: true },
                });
                initialState.push({
                    type: MATRIX_CALL_COMPAT_EVENT,
                    state_key: "",
                    content: { type: "voice", intent: "voice", chat_suppressed: true },
                });
            }

            if (cfg.minPL > 0) {
                initialState.push({
                    type: CHANNEL_ACCESS_EVENT,
                    state_key: "",
                    content: { min_power_level: cfg.minPL },
                });
            }

            // SpaceParent included in initial_state to save a separate API call
            initialState.push({
                type: EventType.SpaceParent,
                state_key: spaceId,
                content: { canonical: true, ...(via ? { via } : {}) },
            });

            const roomResponse = await withRateLimit(() =>
                client.createRoom({
                    name: channel.name,
                    topic: channel.topic ?? undefined,
                    preset: Preset.PrivateChat,
                    // Merged into the server's usual power levels. A power levels event in initial_state would replace
                    // them, leaving the creator without the rights to finish making the room.
                    power_level_content_override: cfg.minPL > 0 ? { events_default: cfg.minPL } : undefined,
                    initial_state: initialState,
                }),
            rateLimitState,
            );

            const childContent: Record<string, unknown> = { suggested: true };
            if (via) childContent.via = via;
            if (isVoice) {
                childContent[HEOROT_SPACE_CHILD_CHANNEL_TYPE_KEY] = "voice";
                childContent[HEOROT_SPACE_CHILD_VOICE_KEY] = true;
            }

            await withRateLimit(() =>
                client.sendStateEvent(spaceId, EventType.SpaceChild, childContent, roomResponse.room_id),
            rateLimitState,
            );

            sourceToMatrix.set(channel.id, roomResponse.room_id);
            channelsCreated += 1;
            emitProgress({
                stage: "channels",
                current: channelsCreated,
                total: supportedChannels.length,
                message: `Created ${isVoice ? "voice" : "text"} channel "${channel.name}"`,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Channel "${channel.name}": ${msg}`);
        }
    });
    emitProgress({
        stage: "channels",
        current: supportedChannels.length,
        total: supportedChannels.length,
        message: "Channels done.",
    }, true);

    // 3. Write categories and channel order
    rateLimitState.onWait = (waitMs) =>
        emitProgress({
            stage: "channels",
            current: channelsCreated,
            total: supportedChannels.length,
            message: waitMessage(waitMs),
        }, true);
    if (!signal.cancelled) {
        const categoryIds = new Set(exportData.categories.map((c) => c.id));
        const sortedCategories = [...exportData.categories].sort((a, b) => a.position - b.position);

        const uncategorized = supportedChannels
            .filter((ch) => !ch.category_id || !categoryIds.has(ch.category_id))
            .sort((a, b) => a.position - b.position);

        const globalOrder: string[] = [];
        const heorotCategories: HeorotCategory[] = [];

        for (const ch of uncategorized) {
            const roomId = sourceToMatrix.get(ch.id);
            if (roomId) globalOrder.push(roomId);
        }

        for (const cat of sortedCategories) {
            const channelsInCat = supportedChannels
                .filter((ch) => ch.category_id === cat.id)
                .sort((a, b) => a.position - b.position);
            const roomIds = channelsInCat
                .map((ch) => sourceToMatrix.get(ch.id))
                .filter((id): id is string => Boolean(id));
            if (roomIds.length === 0) continue;

            const heorotCat = createCategory(cat.name);
            heorotCat.roomIds = roomIds;
            heorotCategories.push(heorotCat);
            globalOrder.push(...roomIds);
        }

        if (heorotCategories.length > 0) {
            await withRateLimit(() => writeCategories(client, spaceId, heorotCategories), rateLimitState);
        }
        if (globalOrder.length > 0) {
            await withRateLimit(() => writeChannelOrder(client, spaceId, globalOrder), rateLimitState);
        }
    }

    // 4. Upload emojis
    const emojisToUpload = exportData.emojis.filter((e) => {
        if (e.status !== "ok") return false;
        return emojiFiles.has(getEmojiFilename(e.path));
    });

    let emojisUploaded = 0;
    rateLimitState.onWait = (waitMs) =>
        emitProgress({
            stage: "emojis",
            current: emojisUploaded,
            total: emojisToUpload.length,
            message: waitMessage(waitMs),
        }, true);

    if (emojisToUpload.length > 0) {
        const EMOJI_CONCURRENCY = 5;
        const emojiPack = (await getSpacePack(client, spaceId)) ?? { version: 1 as const, emojis: {} };

        await inParallel(emojisToUpload, EMOJI_CONCURRENCY, async (emojiMeta) => {
            if (signal.cancelled) return;
            const filename = getEmojiFilename(emojiMeta.path);
            const file = emojiFiles.get(filename);
            if (!file) return;

            try {
                const mimeType = guessMimeType(filename);
                const uploadResponse = await withRateLimit(() =>
                    client.uploadContent(file, {
                        includeFilename: true,
                        type: mimeType,
                        name: filename,
                    }),
            rateLimitState,
            );
                const mxcUrl = uploadResponse.content_uri;
                const shortcode = emojiMeta.shortcode.startsWith(":") ? emojiMeta.shortcode : `:${emojiMeta.shortcode}:`;
                emojiPack.emojis[shortcode] = {
                    url: mxcUrl,
                    name: emojiMeta.name,
                    created_ts: Date.now(),
                };
                emojisUploaded += 1;
                emitProgress({
                    stage: "emojis",
                    current: emojisUploaded,
                    total: emojisToUpload.length,
                    message: `Uploaded emoji "${emojiMeta.name}"`,
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`Emoji "${emojiMeta.name}": ${msg}`);
            }
        });

        if (emojisUploaded > 0) {
            await withRateLimit(() => saveSpacePack(client, spaceId, emojiPack), rateLimitState);
        }
    }

    emitProgress({
        stage: "done",
        current: emojisToUpload.length,
        total: emojisToUpload.length,
        message: "Import complete!",
    }, true);

    return { spaceId, channelsCreated, emojisUploaded, errors };
}
