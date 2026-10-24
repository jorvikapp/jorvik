// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
    activityAudience,
    computeActivityRecipients,
    defaultActivityPrivacy,
    describeActivityAudience,
    isSpaceIncluded,
    migratedActivityPrivacy,
    parseActivityPrivacy,
    type ActivityPrivacySettings,
} from "../../../../src/core/activity/activityPrivacy";

const ME = "@me:jorvik.test";

function settings(changes: Partial<ActivityPrivacySettings> = {}): ActivityPrivacySettings {
    return { ...defaultActivityPrivacy(), enabled: true, ...changes };
}

function space(roomId: string, members: string[]) {
    return { roomId, joinedCount: members.length, joinedMemberIds: members };
}

describe("activity privacy settings", () => {
    it("start off, with friends and small spaces picked for when it's turned on", () => {
        expect(parseActivityPrivacy(undefined)).toEqual({
            enabled: false,
            hidden_games: [],
            hidden_game_names: {},
            space_scope: "small",
            small_space_limit: 200,
            space_overrides: {},
            share_with_friends: true,
        });
    });

    it("keep only what makes sense", () => {
        expect(
            parseActivityPrivacy({
                enabled: "yes",
                hidden_games: ["wow", "WoW", 3, "wow"],
                hidden_game_names: { wow: " World of Warcraft ", osu: "osu!" },
                space_scope: "most",
                small_space_limit: 1.5,
                space_overrides: { "!a:s": false, nope: true, "!b:s": "yes" },
                share_with_friends: 0,
            }),
        ).toEqual({
            enabled: false,
            hidden_games: ["wow"],
            hidden_game_names: { wow: "World of Warcraft" },
            space_scope: "small",
            small_space_limit: 200,
            space_overrides: { "!a:s": false },
            share_with_friends: true,
        });
        expect(parseActivityPrivacy({ small_space_limit: 1 }).small_space_limit).toBe(2);
        expect(parseActivityPrivacy({ small_space_limit: 50 }).small_space_limit).toBe(50);
    });

    it("carry 1.0.27's switch over as sharing with friends and small spaces", () => {
        expect(migratedActivityPrivacy()).toMatchObject({ enabled: true, space_scope: "small", share_with_friends: true });
    });
});

describe("who is told", () => {
    it("lets a space's own toggle beat the default", () => {
        expect(isSpaceIncluded(settings({ space_scope: "none", space_overrides: { "!x:s": true } }), "!x:s", 5_000)).toBe(true);
        expect(isSpaceIncluded(settings({ space_scope: "none" }), "!y:s", 3)).toBe(false);
        expect(isSpaceIncluded(settings({ space_scope: "all", space_overrides: { "!x:s": false } }), "!x:s", 3)).toBe(false);
    });

    it("counts a space as small up to the limit", () => {
        expect(isSpaceIncluded(settings(), "!x:s", 200)).toBe(true);
        expect(isSpaceIncluded(settings(), "!x:s", 201)).toBe(false);
        expect(isSpaceIncluded(settings({ small_space_limit: 50 }), "!x:s", 51)).toBe(false);
    });

    it("tells friends and the members of picked spaces once each, never the user or anyone they blocked", () => {
        expect(
            computeActivityRecipients({
                ownUserId: ME,
                settings: settings({ space_scope: "all", space_overrides: { "!off:s": false } }),
                friendIds: ["@bob:s", "@bob:s", ME],
                spaces: [space("!on:s", [ME, "@bob:s", "@carol:s", "@troll:s"]), space("!off:s", [ME, "@dave:s"])],
                ignoredUserIds: ["@troll:s"],
            }),
        ).toEqual({ userIds: ["@bob:s", "@carol:s"], spaceIds: ["!on:s"], capped: false });
    });

    it("leaves friends out when they aren't picked", () => {
        expect(
            computeActivityRecipients({
                ownUserId: ME,
                settings: settings({ share_with_friends: false, space_scope: "none" }),
                friendIds: ["@bob:s"],
                spaces: [space("!x:s", [ME, "@carol:s"])],
                ignoredUserIds: [],
            }).userIds,
        ).toEqual([]);
    });

    it("tells only friends when the spaces add up to too many people", () => {
        const crowd = Array.from({ length: 10 }, (_, index) => `@user${index}:s`);
        expect(
            computeActivityRecipients({
                ownUserId: ME,
                settings: settings({ space_scope: "all" }),
                friendIds: ["@bob:s"],
                spaces: [space("!hall:s", crowd)],
                ignoredUserIds: [],
                maxRecipients: 5,
            }),
        ).toEqual({ userIds: ["@bob:s"], spaceIds: [], capped: true });
    });

    it("sums up who can see it", () => {
        const spaces = [
            { roomId: "!a:s", joinedCount: 10 },
            { roomId: "!b:s", joinedCount: 900 },
            { roomId: "!c:s", joinedCount: 3 },
        ];
        const summary = (picked: ActivityPrivacySettings): string => describeActivityAudience(picked, activityAudience(picked, spaces));
        expect(summary(settings())).toBe("Activity visible to: friends and 2 spaces.");
        expect(summary(settings({ share_with_friends: false, space_scope: "none", space_overrides: { "!a:s": true } }))).toBe(
            "Activity visible to: 1 space.",
        );
        expect(summary(settings({ share_with_friends: false, space_scope: "none" }))).toBe("Activity visible to: nobody yet.");
        expect(summary(defaultActivityPrivacy())).toBe("Your activity isn't shared.");
    });
});
