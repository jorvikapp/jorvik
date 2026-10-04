import { describe, expect, it } from "vitest";

import { findMentions, mentionText } from "../../../../src/ui/mentions/composerMentions";

const LOCAL = "matrix.jorvik.app";

function fakeRoom(members: Record<string, string>) {
    return {
        getMember: (userId: string) => (members[userId] ? { userId, membership: members[userId] } : null),
    } as never;
}

const room = fakeRoom({
    "@riff:matrix.jorvik.app": "join",
    "@efreak:matrix.jorvik.app": "invite",
    "@gone:matrix.jorvik.app": "leave",
    "@bob:matrix.org": "join",
});

function ids(text: string, domain: string | null = LOCAL): string[] {
    return findMentions(text, room, domain).map((mention) => mention.userId);
}

describe("findMentions", () => {
    it("treats @name as the member with that name on our own server", () => {
        expect(ids("hey @riff, look")).toEqual(["@riff:matrix.jorvik.app"]);
        expect(ids("@Riff and @EFREAK")).toEqual(["@riff:matrix.jorvik.app", "@efreak:matrix.jorvik.app"]);
    });

    it("still takes full IDs, for any server", () => {
        expect(ids("ping @bob:matrix.org and @riff:matrix.jorvik.app")).toEqual(["@bob:matrix.org", "@riff:matrix.jorvik.app"]);
    });

    it("never reaches across servers with the short form", () => {
        expect(ids("@bob")).toEqual([]);
    });

    it("ignores people who aren't in the room, email addresses and stray @ signs", () => {
        expect(ids("@gone @stranger admin@jorvik.app @ @@riff")).toEqual([]);
        expect(ids("@riff", null)).toEqual([]);
    });

    it("marks where each mention is, without surrounding punctuation", () => {
        const text = "(@riff): did you see @efreak?";
        const mentions = findMentions(text, room, LOCAL);
        expect(mentions.map((mention) => text.slice(mention.start, mention.end))).toEqual(["@riff", "@efreak"]);
    });
});

describe("mentionText", () => {
    it("is the short form for people on our server and the full ID for everyone else", () => {
        expect(mentionText("@riff:matrix.jorvik.app", LOCAL)).toBe("@riff");
        expect(mentionText("@bob:matrix.org", LOCAL)).toBe("@bob:matrix.org");
        expect(mentionText("@riff:matrix.jorvik.app", null)).toBe("@riff:matrix.jorvik.app");
    });
});
