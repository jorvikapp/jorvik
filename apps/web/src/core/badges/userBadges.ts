import {
    EventType,
    GuestAccess,
    HistoryVisibility,
    KnownMembership,
    Preset,
    Visibility,
    type MatrixClient,
    type Room,
} from "matrix-js-sdk/src/matrix";

/**
 * Badges a homeserver gives the people on it, shown next to their names in
 * Jorvik. The server's /.well-known/matrix/client says which room holds the
 * list and who may hand badges out:
 *
 *     "app.jorvik.badges": {
 *         "room_id": "!abc:matrix.jorvik.app",
 *         "managers": ["@admin:matrix.jorvik.app"]
 *     }
 *
 * Only whoever runs the server can change that file, so nobody can award
 * themselves a badge. The list is a state event in that room, which anyone
 * signed in can read without joining (it is world-readable, invite-only and
 * only its managers can change it):
 *
 *     { "users": { "@riff:matrix.jorvik.app": ["bug_finder", "tester"] } }
 *
 * Badges this version doesn't know and malformed entries are skipped, and a
 * server without the setting simply has no badges.
 */

// Also the order badges are shown in.
export const BADGE_IDS = ["staff", "bug_finder", "tester", "contributor", "early_supporter"] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export const BADGE_LABELS: Record<BadgeId, string> = {
    staff: "Staff",
    bug_finder: "Bug Finder",
    tester: "Tester",
    contributor: "Contributor",
    early_supporter: "Early Supporter",
};

export const BADGES_WELL_KNOWN_KEY = "app.jorvik.badges";
export const BADGES_EVENT_TYPE = "app.jorvik.badges";
export const BADGES_ROOM_TYPE = "app.jorvik.badges";

export interface BadgeSettings {
    roomId: string | null;
    managers: readonly string[];
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const NO_BADGES: readonly BadgeId[] = Object.freeze([]);
const NO_SETTINGS: BadgeSettings = Object.freeze({ roomId: null, managers: Object.freeze([]) });
const USER_ID_PATTERN = /^@[^:\s]+:\S+$/;
const ROOM_ID_PATTERN = /^![^:\s]+:\S+$/;

let badgesByUser = new Map<string, readonly BadgeId[]>();
let settings: BadgeSettings = NO_SETTINGS;
let generation = 0;
const listeners = new Set<() => void>();

export function parseBadgeList(raw: unknown): Map<string, readonly BadgeId[]> {
    const result = new Map<string, readonly BadgeId[]>();
    const users = isRecord(raw) ? raw.users : null;
    if (!isRecord(users)) {
        return result;
    }

    for (const [userId, ids] of Object.entries(users)) {
        if (!USER_ID_PATTERN.test(userId) || !Array.isArray(ids)) {
            continue;
        }
        const badges = BADGE_IDS.filter((id) => ids.includes(id));
        if (badges.length > 0) {
            result.set(userId, badges);
        }
    }
    return result;
}

export function parseBadgeSettings(wellKnown: unknown): BadgeSettings {
    const raw = isRecord(wellKnown) ? wellKnown[BADGES_WELL_KNOWN_KEY] : null;
    if (!isRecord(raw)) {
        return NO_SETTINGS;
    }

    const roomId = typeof raw.room_id === "string" && ROOM_ID_PATTERN.test(raw.room_id) ? raw.room_id : null;
    const managers = Array.isArray(raw.managers)
        ? raw.managers.filter((id): id is string => typeof id === "string" && USER_ID_PATTERN.test(id))
        : [];
    return { roomId, managers };
}

/** The server's badge setting, or null if it couldn't be read right now. */
export async function fetchBadgeSettings(homeserverUrl: string): Promise<BadgeSettings | null> {
    try {
        const base = homeserverUrl.replace(/\/$/, "");
        const response = await fetch(`${base}/.well-known/matrix/client`, { signal: AbortSignal.timeout(5000) });
        if (response.status === 404) {
            return NO_SETTINGS;
        }
        if (!response.ok) {
            return null;
        }
        return parseBadgeSettings(await response.json());
    } catch {
        return null;
    }
}

/**
 * The list in the badges room: empty if there is none yet, or null if it
 * couldn't be read right now, so a passing network problem doesn't take
 * everyone's badges away.
 */
export async function fetchBadgeList(client: MatrixClient, roomId: string): Promise<Map<string, readonly BadgeId[]> | null> {
    try {
        return parseBadgeList(await client.getStateEvent(roomId, BADGES_EVENT_TYPE, ""));
    } catch (error) {
        return errcodeOf(error) === "M_NOT_FOUND" ? new Map() : null;
    }
}

export function getUserBadges(userId: string | null | undefined): readonly BadgeId[] {
    return (userId ? badgesByUser.get(userId) : undefined) ?? NO_BADGES;
}

export function getBadgeSettings(): BadgeSettings {
    return settings;
}

export function subscribeUserBadges(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function isBadgesRoom(room: Room): boolean {
    return room.getType() === BADGES_ROOM_TYPE;
}

/**
 * Reads the server's setting and badges now and every ten minutes after. The
 * returned function stops that and forgets them, for signing out or
 * switching servers.
 */
export function startUserBadges(client: MatrixClient, homeserverUrl: string): () => void {
    const run = ++generation;
    const refresh = async (): Promise<void> => {
        const nextSettings = await fetchBadgeSettings(homeserverUrl);
        if (run !== generation) {
            return;
        }
        if (nextSettings) {
            setSettings(nextSettings);
        }

        const roomId = settings.roomId;
        if (!roomId) {
            if (nextSettings) {
                setBadges(new Map());
            }
            return;
        }
        const list = await fetchBadgeList(client, roomId);
        if (list && run === generation) {
            setBadges(list);
        }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
        clearInterval(timer);
        if (run === generation) {
            generation += 1;
            setSettings(NO_SETTINGS);
            setBadges(new Map());
        }
    };
}

/**
 * Gives someone exactly these badges; none takes them off the list. Starts
 * from the server's copy, so two managers don't undo each other's changes,
 * and keeps any badges a newer Jorvik knows about.
 */
export async function saveUserBadges(client: MatrixClient, userId: string, badges: readonly BadgeId[]): Promise<void> {
    const roomId = settings.roomId;
    if (!roomId) {
        throw new Error("Badges aren't set up on this server yet.");
    }
    // Managers other than the room's creator are invited when it is made.
    if (client.getRoom(roomId)?.getMyMembership() !== KnownMembership.Join) {
        await client.joinRoom(roomId);
    }

    let current: Record<string, unknown> = {};
    try {
        current = await client.getStateEvent(roomId, BADGES_EVENT_TYPE, "");
    } catch (error) {
        if (errcodeOf(error) !== "M_NOT_FOUND") {
            throw error;
        }
    }

    const users: Record<string, unknown> = isRecord(current.users) ? { ...current.users } : {};
    const previous: unknown[] = Array.isArray(users[userId]) ? (users[userId] as unknown[]) : [];
    const unknownToUs = previous.filter((id) => typeof id === "string" && !(BADGE_IDS as readonly string[]).includes(id));
    const next = [...BADGE_IDS.filter((id) => badges.includes(id)), ...unknownToUs];
    if (next.length > 0) {
        users[userId] = next;
    } else {
        delete users[userId];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.sendStateEvent(roomId, BADGES_EVENT_TYPE as any, { ...current, users }, "");
    if (settings.roomId === roomId) {
        setBadges(parseBadgeList({ users }));
    }
}

/**
 * Makes the room that holds the list. Every manager can change it; everyone
 * else can only read it. The server still has to name the room in its
 * /.well-known/matrix/client before anyone's Jorvik trusts it.
 */
export async function createBadgesRoom(client: MatrixClient, managers: readonly string[]): Promise<string> {
    const me = client.getUserId();
    if (!me) {
        throw new Error("Sign in first.");
    }
    const others = managers.filter((id) => id !== me);
    const { room_id: roomId } = await client.createRoom({
        name: "Jorvik badges",
        topic: "Who has which badge in Jorvik. Change them from someone's profile: ⋯ > Badges.",
        visibility: Visibility.Private,
        preset: Preset.PrivateChat,
        invite: others,
        creation_content: { type: BADGES_ROOM_TYPE, "m.federate": false },
        initial_state: [
            {
                type: EventType.RoomHistoryVisibility,
                state_key: "",
                content: { history_visibility: HistoryVisibility.WorldReadable },
            },
            { type: EventType.RoomGuestAccess, state_key: "", content: { guest_access: GuestAccess.Forbidden } },
            { type: BADGES_EVENT_TYPE, state_key: "", content: { users: {} } },
        ],
        power_level_content_override: {
            users: Object.fromEntries([me, ...others].map((id) => [id, 100])),
            users_default: 0,
            events_default: 100,
            state_default: 100,
            invite: 100,
            kick: 100,
            ban: 100,
            redact: 100,
        },
    });
    return roomId;
}

function setBadges(next: Map<string, readonly BadgeId[]>): void {
    badgesByUser = next;
    notify();
}

function setSettings(next: BadgeSettings): void {
    if (next.roomId === settings.roomId && next.managers.join() === settings.managers.join()) {
        return;
    }
    settings = next;
    notify();
}

function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

function errcodeOf(error: unknown): string | undefined {
    return isRecord(error) && typeof error.errcode === "string" ? error.errcode : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
