import { cleanActivityText, isGameId } from "./activityWire";

/**
 * Who sees the game the user is playing. Kept in account data, so all of their devices share by the
 * same rules:
 *
 *     "com.heorot.activity_privacy": {
 *         "enabled": false,
 *         "hidden_games": ["wow"],
 *         "space_scope": "small",
 *         "small_space_limit": 200,
 *         "space_overrides": { "!spaceRoomId:server": false },
 *         "share_with_friends": true
 *     }
 *
 * space_scope ("all", "small" or "none") is the default for each space the user is in; "small" means
 * spaces with at most small_space_limit members. A space's entry in space_overrides beats it. Friends
 * are the people the user has DMs with. hidden_games are never shared. Off until the user turns it on.
 *
 * The activity itself goes out as encrypted to-device messages to exactly these people
 * (activitySender.ts); presence would show it to everyone in every shared room, and room state would
 * keep a history of it.
 */

export const ACTIVITY_PRIVACY_EVENT = "com.heorot.activity_privacy";

export type SpaceScope = "all" | "small" | "none";

export const DEFAULT_SMALL_SPACE_LIMIT = 200;
/** More people than this and only friends are told: a message to every device of a crowd every few minutes is too much. */
export const MAX_ACTIVITY_RECIPIENTS = 500;

const SPACE_SCOPES: readonly SpaceScope[] = ["all", "small", "none"];
const MIN_SMALL_SPACE_LIMIT = 2;
const MAX_SMALL_SPACE_LIMIT = 10_000;
const MAX_HIDDEN_GAMES = 200;
const ROOM_ID_PATTERN = /^![^:\s]+:\S+$/;

export interface ActivityPrivacySettings {
    enabled: boolean;
    hidden_games: string[];
    /** The names of hidden games, for the settings list; the rules only use the ids. */
    hidden_game_names: Record<string, string>;
    space_scope: SpaceScope;
    small_space_limit: number;
    space_overrides: Record<string, boolean>;
    share_with_friends: boolean;
}

export function defaultActivityPrivacy(): ActivityPrivacySettings {
    return {
        enabled: false,
        hidden_games: [],
        hidden_game_names: {},
        space_scope: "small",
        small_space_limit: DEFAULT_SMALL_SPACE_LIMIT,
        space_overrides: {},
        share_with_friends: true,
    };
}

/** What someone who had 1.0.27's "Show the game I'm playing" on gets the first time a newer version starts. */
export function migratedActivityPrivacy(): ActivityPrivacySettings {
    return { ...defaultActivityPrivacy(), enabled: true, space_scope: "small", share_with_friends: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseActivityPrivacy(raw: unknown): ActivityPrivacySettings {
    const source = isRecord(raw) ? raw : {};
    const defaults = defaultActivityPrivacy();

    const hiddenGames = Array.isArray(source.hidden_games)
        ? [...new Set(source.hidden_games.filter(isGameId))].slice(0, MAX_HIDDEN_GAMES)
        : [];
    const names = isRecord(source.hidden_game_names) ? source.hidden_game_names : {};
    const hiddenGameNames: Record<string, string> = {};
    for (const id of hiddenGames) {
        const name = cleanActivityText(names[id]);
        if (name) {
            hiddenGameNames[id] = name;
        }
    }

    const overrides: Record<string, boolean> = {};
    if (isRecord(source.space_overrides)) {
        for (const [roomId, included] of Object.entries(source.space_overrides)) {
            if (ROOM_ID_PATTERN.test(roomId) && typeof included === "boolean") {
                overrides[roomId] = included;
            }
        }
    }

    const limit = source.small_space_limit;
    return {
        enabled: source.enabled === true,
        hidden_games: hiddenGames,
        hidden_game_names: hiddenGameNames,
        space_scope: SPACE_SCOPES.includes(source.space_scope as SpaceScope)
            ? (source.space_scope as SpaceScope)
            : defaults.space_scope,
        small_space_limit:
            typeof limit === "number" && Number.isInteger(limit)
                ? Math.min(MAX_SMALL_SPACE_LIMIT, Math.max(MIN_SMALL_SPACE_LIMIT, limit))
                : defaults.small_space_limit,
        space_overrides: overrides,
        share_with_friends: source.share_with_friends !== false,
    };
}

/** Whether a space's members are told: its own toggle if it has one, otherwise the default scope. */
export function isSpaceIncluded(settings: ActivityPrivacySettings, roomId: string, joinedCount: number): boolean {
    const override = settings.space_overrides[roomId];
    if (typeof override === "boolean") {
        return override;
    }
    switch (settings.space_scope) {
        case "all":
            return true;
        case "small":
            return joinedCount <= settings.small_space_limit;
        case "none":
            return false;
    }
}

export interface ActivitySpace {
    roomId: string;
    joinedCount: number;
    joinedMemberIds: readonly string[];
}

export interface ActivityRecipientsInput {
    ownUserId: string;
    settings: ActivityPrivacySettings;
    /** The joined members of the user's DMs. */
    friendIds: readonly string[];
    /** The spaces the user is in, with their joined members. */
    spaces: readonly ActivitySpace[];
    ignoredUserIds: readonly string[];
    maxRecipients?: number;
}

export interface ActivityRecipients {
    userIds: string[];
    /** The spaces whose members are told; empty when capped. */
    spaceIds: string[];
    /** True when the spaces made it too many people, so only friends are told. */
    capped: boolean;
}

export function computeActivityRecipients(input: ActivityRecipientsInput): ActivityRecipients {
    const { settings } = input;
    const excluded = new Set([input.ownUserId, ...input.ignoredUserIds]);
    const friends = settings.share_with_friends
        ? [...new Set(input.friendIds)].filter((userId) => !excluded.has(userId)).sort()
        : [];

    const everyone = new Set(friends);
    const spaceIds: string[] = [];
    for (const space of input.spaces) {
        if (!isSpaceIncluded(settings, space.roomId, space.joinedCount)) {
            continue;
        }
        spaceIds.push(space.roomId);
        for (const userId of space.joinedMemberIds) {
            if (!excluded.has(userId)) {
                everyone.add(userId);
            }
        }
    }

    const max = input.maxRecipients ?? MAX_ACTIVITY_RECIPIENTS;
    if (everyone.size > max) {
        return { userIds: friends.slice(0, max), spaceIds: [], capped: true };
    }
    return { userIds: [...everyone].sort(), spaceIds, capped: false };
}

export interface ActivityAudience {
    friends: boolean;
    spaceCount: number;
}

export function activityAudience(
    settings: ActivityPrivacySettings,
    spaces: readonly { roomId: string; joinedCount: number }[],
): ActivityAudience {
    return {
        friends: settings.share_with_friends,
        spaceCount: spaces.filter((space) => isSpaceIncluded(settings, space.roomId, space.joinedCount)).length,
    };
}

/** "Activity visible to: friends and 3 spaces." */
export function describeActivityAudience(settings: ActivityPrivacySettings, audience: ActivityAudience): string {
    if (!settings.enabled) {
        return "Your activity isn't shared.";
    }
    const parts: string[] = [];
    if (audience.friends) {
        parts.push("friends");
    }
    if (audience.spaceCount > 0) {
        parts.push(audience.spaceCount === 1 ? "1 space" : `${audience.spaceCount} spaces`);
    }
    return parts.length > 0 ? `Activity visible to: ${parts.join(" and ")}.` : "Activity visible to: nobody yet.";
}
