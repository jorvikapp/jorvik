import { describe, expect, it, vi } from "vitest";
import type { Room } from "matrix-js-sdk/src/matrix";

import {
    dmMenuEntries,
    memberMenuEntries,
    moderationRights,
    type DmMenuActions,
    type MemberMenuActions,
    type UserMenuEntry,
} from "../../../../src/ui/users/userMenus";

const ME = "@me:example.org";
const RIFF = "@riff:example.org";

const dmActions = (): DmMenuActions => ({
    profile: vi.fn(),
    startCall: vi.fn(),
    markRead: vi.fn(),
    toggleMute: vi.fn(),
    toggleFavourite: vi.fn(),
    copyUserId: vi.fn(),
    close: vi.fn(),
    block: vi.fn(),
});
const memberActions = (): MemberMenuActions => ({
    profile: vi.fn(),
    message: vi.fn(),
    mention: vi.fn(),
    copyUserId: vi.fn(),
    block: vi.fn(),
    remove: vi.fn(),
    ban: vi.fn(),
});
// "label" for an item (with its tone when it has one), "--" for a separator, "[label]" for a heading.
const shape = (entries: UserMenuEntry[]): string[] =>
    entries.map((entry) =>
        entry.kind === "separator" ? "--" : entry.kind === "label" ? `[${entry.label}]` : entry.tone && entry.tone !== "default" ? `${entry.label} (${entry.tone})` : entry.label,
    );

describe("menu A: a conversation in the DM list", () => {
    it("offers everything about the person and the conversation, Block last and red", () => {
        expect(shape(dmMenuEntries({ partnerId: RIFF, ownUserId: ME, muted: false, favourite: false }, dmActions()))).toEqual([
            "Profile",
            "Start call",
            "Mark as read",
            "Mute",
            "Favourite",
            "Copy user ID",
            "--",
            "Close DM",
            "Block (danger)",
        ]);
    });

    it("says what toggling would do: Unmute when muted, Unfavourite when a favourite", () => {
        const labels = shape(dmMenuEntries({ partnerId: RIFF, ownUserId: ME, muted: true, favourite: true }, dmActions()));
        expect(labels).toContain("Unmute");
        expect(labels).toContain("Unfavourite");
        expect(labels).not.toContain("Mute");
        expect(labels).not.toContain("Favourite");
    });

    it("leaves out the person's items in a group conversation", () => {
        expect(shape(dmMenuEntries({ partnerId: null, ownUserId: ME, muted: false, favourite: false }, dmActions()))).toEqual([
            "Mark as read",
            "Mute",
            "Favourite",
            "--",
            "Close DM",
        ]);
    });

    it("runs the right action for each item", () => {
        const actions = dmActions();
        const entries = dmMenuEntries({ partnerId: RIFF, ownUserId: ME, muted: false, favourite: false }, actions);
        for (const entry of entries) {
            if (entry.kind === "item") {
                entry.run();
            }
        }
        for (const action of Object.values(actions)) {
            expect(action).toHaveBeenCalledTimes(1);
        }
    });
});

describe("menu B: a member, or a message's author", () => {
    const facts = { userId: RIFF, ownUserId: ME, canMention: true, canKick: false, canBan: false, scope: "space" as const };

    it("gives a regular member no moderation at all", () => {
        expect(shape(memberMenuEntries(facts, memberActions()))).toEqual([
            "Profile",
            "Message",
            "Mention",
            "Copy user ID",
            "--",
            "Block (danger)",
        ]);
    });

    it("adds Remove (amber) and Ban (red) under Moderators only, each by its own rank", () => {
        expect(shape(memberMenuEntries({ ...facts, canKick: true, canBan: true }, memberActions()))).toEqual([
            "Profile",
            "Message",
            "Mention",
            "Copy user ID",
            "--",
            "Block (danger)",
            "--",
            "[Moderators only]",
            "Remove from space (warning)",
            "Ban from space (danger)",
        ]);
        expect(shape(memberMenuEntries({ ...facts, canKick: true }, memberActions())).slice(-2)).toEqual([
            "[Moderators only]",
            "Remove from space (warning)",
        ]);
        expect(shape(memberMenuEntries({ ...facts, canBan: true }, memberActions())).slice(-2)).toEqual([
            "[Moderators only]",
            "Ban from space (danger)",
        ]);
    });

    it("says room instead of space for a room on its own, and has no Mention without a message box", () => {
        const labels = shape(memberMenuEntries({ ...facts, scope: "room", canMention: false, canKick: true, canBan: true }, memberActions()));
        expect(labels).toContain("Remove from room (warning)");
        expect(labels).toContain("Ban from room (danger)");
        expect(labels).not.toContain("Mention");
    });
});

describe("yourself", () => {
    it("only Profile and Copy user ID, from either menu, whatever your rank", () => {
        expect(shape(memberMenuEntries({ userId: ME, ownUserId: ME, canMention: true, canKick: true, canBan: true, scope: "space" }, memberActions()))).toEqual([
            "Profile",
            "Copy user ID",
        ]);
        expect(shape(dmMenuEntries({ partnerId: ME, ownUserId: ME, muted: false, favourite: false }, dmActions()))).toEqual([
            "Profile",
            "Copy user ID",
        ]);
    });
});

describe("moderationRights", () => {
    const room = (levels: Record<string, number>, needed: { kick: number; ban: number }): Room =>
        ({
            getMember: (userId: string) => ({ powerLevel: levels[userId] ?? 0 }),
            currentState: { hasSufficientPowerLevelFor: (action: "kick" | "ban", level: number) => level >= needed[action] },
        }) as unknown as Room;

    it("goes by the rank the room asks for, each action on its own", () => {
        expect(moderationRights(room({ [ME]: 100 }, { kick: 50, ban: 50 }), ME)).toEqual({ canKick: true, canBan: true });
        expect(moderationRights(room({ [ME]: 50 }, { kick: 50, ban: 75 }), ME)).toEqual({ canKick: true, canBan: false });
        expect(moderationRights(room({ [ME]: 0 }, { kick: 50, ban: 50 }), ME)).toEqual({ canKick: false, canBan: false });
        expect(moderationRights(null, ME)).toEqual({ canKick: false, canBan: false });
    });
});
