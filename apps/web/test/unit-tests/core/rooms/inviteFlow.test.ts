import { describe, expect, it, vi } from "vitest";

import { inviteUsersToRoom, resolveInviteTargets } from "../../../../src/core/rooms/inviteFlow";

const KNOWN = new Set(["@dave:example.org", "@erin:example.org"]);

function notFound(): Error {
    return Object.assign(new Error("No row found (profiles)"), { httpStatus: 404, errcode: "M_UNKNOWN" });
}

function makeClient(profileLookup?: (userId: string) => Promise<unknown>) {
    return {
        getDomain: () => "example.org",
        getRoom: () => null,
        getProfileInfo: vi.fn(
            profileLookup ??
                (async (userId: string) => {
                    if (!KNOWN.has(userId)) {
                        throw notFound();
                    }
                    return { displayname: userId.slice(1, userId.indexOf(":")) };
                }),
        ),
        invite: vi.fn(async () => ({})),
    };
}

describe("inviteUsersToRoom", () => {
    it("invites a bare @name as someone on our own server", async () => {
        const client = makeClient();

        const result = await inviteUsersToRoom(client as never, "!room:example.org", "@dave, @Erin");

        expect(client.invite).toHaveBeenCalledWith("!room:example.org", "@dave:example.org", undefined);
        expect(client.invite).toHaveBeenCalledWith("!room:example.org", "@erin:example.org", undefined);
        expect(result).toEqual({ invited: ["@dave:example.org", "@erin:example.org"], failed: [] });
    });

    it("doesn't invite someone our server doesn't have, which it would take and say nothing", async () => {
        const client = makeClient();

        const result = await inviteUsersToRoom(client as never, "!room:example.org", "@daev @dave");

        expect(client.invite).toHaveBeenCalledTimes(1);
        expect(client.invite).toHaveBeenCalledWith("!room:example.org", "@dave:example.org", undefined);
        expect(result.failed).toEqual([{ userId: "@daev:example.org", message: "User was not found on the homeserver." }]);
    });

    it("leaves someone on another server to the invite itself", async () => {
        const client = makeClient();

        const result = await inviteUsersToRoom(client as never, "!room:example.org", "@bob:other.org");

        expect(client.getProfileInfo).not.toHaveBeenCalled();
        expect(result.invited).toEqual(["@bob:other.org"]);
    });

    it("still invites when the lookup fails for another reason", async () => {
        const client = makeClient(async () => {
            throw Object.assign(new Error("busy"), { httpStatus: 502 });
        });

        const result = await inviteUsersToRoom(client as never, "!room:example.org", "@dave");

        expect(result.invited).toEqual(["@dave:example.org"]);
    });

    it("says how to write a user ID when it isn't one", async () => {
        const client = makeClient();

        const result = await inviteUsersToRoom(client as never, "!room:example.org", "dave");

        expect(client.invite).not.toHaveBeenCalled();
        expect(result.failed[0]).toEqual({
            userId: "dave",
            message: "Not a user ID. Write @name, or @name:server for someone on another server.",
        });
    });

    it("asks for someone when nothing is typed", async () => {
        await expect(inviteUsersToRoom(makeClient() as never, "!room:example.org", "  ")).rejects.toThrow(
            "Enter at least one user ID (example: @alice).",
        );
    });
});

describe("resolveInviteTargets", () => {
    it("counts the same person typed two ways once", async () => {
        const client = makeClient();

        const targets = await resolveInviteTargets(client as never, "@dave @dave:example.org");

        expect(targets).toEqual({ userIds: ["@dave:example.org"], failed: [] });
        expect(client.getProfileInfo).toHaveBeenCalledTimes(1);
    });
});
