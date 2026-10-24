/**
 * The message that tells someone what a person is playing. It is a to-device message, only ever sent
 * encrypted and only to the people the sender's activity privacy settings pick (activityPrivacy.ts),
 * so it never reaches presence, room state or a room's timeline:
 *
 *     "com.heorot.activity": {
 *         "device_id": "ABCDEFG",
 *         "game": { "id": "wow", "name": "World of Warcraft" },
 *         "started_at": 1792850000000,
 *         "expires_at": 1792850600000
 *     }
 *
 * "game": null means the game stopped. While a game runs the sender repeats the message every few
 * minutes with a later expires_at, and a receiver forgets it once expires_at passes, so an app that
 * crashed or lost its connection doesn't leave anyone "playing" for good.
 */

export const ACTIVITY_EVENT = "com.heorot.activity";
export const ACTIVITY_HEARTBEAT_MS = 5 * 60_000;
export const ACTIVITY_LIFETIME_MS = 10 * 60_000;
export const MAX_ACTIVITY_TEXT_LENGTH = 128;

/** A receiver keeps a message no longer than this, whatever its expires_at says. */
const MAX_ACCEPTED_LIFETIME_MS = 2 * ACTIVITY_LIFETIME_MS;
/** A start time further back than this is taken as "just now": nobody plays for a week straight. */
const MAX_PLAYING_MS = 7 * 24 * 60 * 60_000;
const GAME_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_+/=.-]{1,64}$/;

export interface ActivityGame {
    /** Lower-case letters, digits, "-" and "_": "steam-570", "minecraft". */
    id: string;
    name: string;
}

export interface ActivityContent {
    device_id: string;
    game: ActivityGame | null;
    started_at?: number;
    expires_at?: number;
}

export type IncomingActivity =
    | { game: ActivityGame; startedAt: number; expiresAt: number }
    | { game: null };

export function isGameId(value: unknown): value is string {
    return typeof value === "string" && GAME_ID_PATTERN.test(value);
}

/** Plain text on one line: control characters dropped, runs of whitespace made single spaces, capped. */
export function cleanActivityText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    // eslint-disable-next-line no-control-regex
    const text = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ");
    const cleaned = text.replace(/\s+/g, " ").trim().slice(0, MAX_ACTIVITY_TEXT_LENGTH).trim();
    return cleaned || null;
}

export function cleanGame(value: unknown): ActivityGame | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const { id, name } = value as { id?: unknown; name?: unknown };
    const cleanName = cleanActivityText(name);
    return isGameId(id) && cleanName ? { id, name: cleanName } : null;
}

/** A game id from a name, for a desktop app too old to send one: "World of Warcraft" -> "world-of-warcraft". */
export function gameIdFromName(name: string): string | null {
    const id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64)
        .replace(/-+$/, "");
    return isGameId(id) ? id : null;
}

export function playingContent(deviceId: string, game: ActivityGame, startedAt: number, now: number): ActivityContent {
    return {
        device_id: deviceId,
        game: { id: game.id, name: game.name },
        started_at: startedAt,
        expires_at: now + ACTIVITY_LIFETIME_MS,
    };
}

export function stoppedContent(deviceId: string): ActivityContent {
    return { device_id: deviceId, game: null };
}

/** The sending device as the message names it, for when the encryption doesn't say. */
export function contentDeviceId(content: unknown): string | null {
    const deviceId = (content as { device_id?: unknown } | null)?.device_id;
    return typeof deviceId === "string" && DEVICE_ID_PATTERN.test(deviceId) ? deviceId : null;
}

/** What a received message says, or null when it's malformed or already expired. */
export function parseIncomingActivity(content: unknown, now: number): IncomingActivity | null {
    if (!content || typeof content !== "object") {
        return null;
    }
    const { game, started_at: startedAt, expires_at: expiresAt } = content as {
        game?: unknown;
        started_at?: unknown;
        expires_at?: unknown;
    };
    if (game === null) {
        return { game: null };
    }
    const parsedGame = cleanGame(game);
    if (!parsedGame || typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) {
        return null;
    }
    const started =
        typeof startedAt === "number" && Number.isFinite(startedAt) && startedAt <= now && now - startedAt <= MAX_PLAYING_MS
            ? startedAt
            : now;
    return { game: parsedGame, startedAt: started, expiresAt: Math.min(expiresAt, now + MAX_ACCEPTED_LIFETIME_MS) };
}
