import { describe, expect, it, vi } from "vitest";

import { memberAvatarSources } from "../../../../src/core/media/avatar";

function makeClient(profileAvatarByUser: Record<string, string | undefined> = {}) {
    return {
        getUser: vi.fn((userId: string) =>
            userId in profileAvatarByUser ? { avatarUrl: profileAvatarByUser[userId] } : null,
        ),
        mxcUrlToHttp: vi.fn((mxc: string) => `https://example.org/resolved/${mxc.split("/").pop()}`),
    };
}

function makeMember(userId: string, mxc: string | null) {
    return { userId, getMxcAvatarUrl: () => mxc };
}

describe("memberAvatarSources", () => {
    it("uses the member event avatar when it has one", () => {
        const client = makeClient({ "@alice:example.org": "mxc://example.org/profile" });
        const sources = memberAvatarSources(
            client as any,
            makeMember("@alice:example.org", "mxc://example.org/member") as any,
            64,
        );
        expect(sources.every((s) => s.includes("member"))).toBe(true);
    });

    it("falls back to the global profile avatar when the member event has none", () => {
        const client = makeClient({ "@alice:example.org": "mxc://example.org/profile" });
        const sources = memberAvatarSources(
            client as any,
            makeMember("@alice:example.org", null) as any,
            64,
        );
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every((s) => s.includes("profile"))).toBe(true);
    });

    it("returns nothing when neither source has an avatar", () => {
        const client = makeClient({ "@alice:example.org": undefined });
        expect(memberAvatarSources(client as any, makeMember("@alice:example.org", null) as any, 64)).toEqual([]);
    });

    it("returns nothing for a missing member", () => {
        const client = makeClient();
        expect(memberAvatarSources(client as any, null, 64)).toEqual([]);
        expect(client.getUser).not.toHaveBeenCalled();
    });
});
