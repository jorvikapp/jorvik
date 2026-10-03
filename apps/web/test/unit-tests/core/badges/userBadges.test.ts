// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createBadgesRoom,
    fetchBadgeList,
    fetchBadgeSettings,
    getBadgeSettings,
    getUserBadges,
    parseBadgeList,
    parseBadgeSettings,
    saveUserBadges,
    startUserBadges,
    subscribeUserBadges,
} from "../../../../src/core/badges/userBadges";

const RIFF = "@riff:matrix.jorvik.app";
const ADMIN = "@admin:matrix.jorvik.app";
const ROOM = "!badges:matrix.jorvik.app";
const WELL_KNOWN = { "m.homeserver": { base_url: "https://matrix.jorvik.app" }, "app.jorvik.badges": { room_id: ROOM, managers: [ADMIN] } };

function notFound(): Error {
    return Object.assign(new Error("Event not found."), { errcode: "M_NOT_FOUND" });
}

function serveWellKnown(body: unknown = WELL_KNOWN, status = 200) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function fakeClient(state: Record<string, unknown> | Error = { users: { [RIFF]: ["staff"] } }, membership = "join") {
    return {
        getUserId: () => ADMIN,
        getRoom: vi.fn(() => ({ getMyMembership: () => membership })),
        getStateEvent: vi.fn(async () => {
            if (state instanceof Error) throw state;
            return state;
        }),
        joinRoom: vi.fn(async () => ({})),
        sendStateEvent: vi.fn(async () => ({ event_id: "$e" })),
        createRoom: vi.fn(async () => ({ room_id: ROOM })),
    };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("parseBadgeList", () => {
    it("keeps known badges, in the order Jorvik shows them", () => {
        const list = parseBadgeList({ users: { [RIFF]: ["tester", "made_up", "staff", "tester"] } });
        expect(list.get(RIFF)).toEqual(["staff", "tester"]);
    });

    it("skips malformed entries and people left without a known badge", () => {
        const list = parseBadgeList({
            users: {
                riff: ["staff"],
                "@riff": ["staff"],
                "@a:matrix.jorvik.app": "staff",
                "@b:matrix.jorvik.app": ["made_up"],
                "@c:matrix.jorvik.app": ["bug_finder"],
            },
        });
        expect([...list.keys()]).toEqual(["@c:matrix.jorvik.app"]);
    });

    it("is empty for anything that isn't a list of users", () => {
        expect(parseBadgeList(null).size).toBe(0);
        expect(parseBadgeList([]).size).toBe(0);
        expect(parseBadgeList({ users: [RIFF] }).size).toBe(0);
    });
});

describe("parseBadgeSettings", () => {
    it("reads the room and the managers from the server's client settings", () => {
        expect(parseBadgeSettings(WELL_KNOWN)).toEqual({ roomId: ROOM, managers: [ADMIN] });
    });

    it("drops anything that isn't a room or user ID", () => {
        expect(parseBadgeSettings({ "app.jorvik.badges": { room_id: "#badges:matrix.jorvik.app", managers: [ADMIN, "admin", 7] } })).toEqual({
            roomId: null,
            managers: [ADMIN],
        });
        expect(parseBadgeSettings({ "m.homeserver": {} })).toEqual({ roomId: null, managers: [] });
    });
});

describe("fetchBadgeSettings", () => {
    it("reads the client settings next to the homeserver", async () => {
        const fetchMock = serveWellKnown();
        expect(await fetchBadgeSettings("https://matrix.jorvik.app/")).toEqual({ roomId: ROOM, managers: [ADMIN] });
        expect(fetchMock.mock.calls[0][0]).toBe("https://matrix.jorvik.app/.well-known/matrix/client");
    });

    it("treats a server without the file as having no badges, and a failure as unknown", async () => {
        serveWellKnown({}, 404);
        expect(await fetchBadgeSettings("https://example.org")).toEqual({ roomId: null, managers: [] });
        serveWellKnown({}, 502);
        expect(await fetchBadgeSettings("https://example.org")).toBeNull();
    });
});

describe("fetchBadgeList", () => {
    it("reads the list from the badges room", async () => {
        const client = fakeClient();
        expect((await fetchBadgeList(client as never, ROOM))?.get(RIFF)).toEqual(["staff"]);
        expect(client.getStateEvent).toHaveBeenCalledWith(ROOM, "app.jorvik.badges", "");
    });

    it("is empty before the first badge, and unknown when the room can't be read", async () => {
        expect((await fetchBadgeList(fakeClient(notFound()) as never, ROOM))?.size).toBe(0);
        expect(await fetchBadgeList(fakeClient(new Error("offline")) as never, ROOM)).toBeNull();
    });
});

describe("startUserBadges", () => {
    it("shows the badges, keeps them through a failed refresh and forgets them when stopped", async () => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        serveWellKnown();
        const client = fakeClient();
        const listener = vi.fn();
        const unsubscribe = subscribeUserBadges(listener);

        const stop = startUserBadges(client as never, "https://matrix.jorvik.app");
        await settle();
        expect(getUserBadges(RIFF)).toEqual(["staff"]);
        expect(getBadgeSettings()).toEqual({ roomId: ROOM, managers: [ADMIN] });

        client.getStateEvent.mockRejectedValue(new Error("offline"));
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
        vi.advanceTimersByTime(10 * 60 * 1000);
        await settle();
        expect(getUserBadges(RIFF)).toEqual(["staff"]);

        stop();
        expect(getUserBadges(RIFF)).toEqual([]);
        expect(getBadgeSettings().roomId).toBeNull();
        expect(listener).toHaveBeenCalled();
        unsubscribe();
    });

    it("has no badges on a server that hasn't set them up", async () => {
        serveWellKnown({ "m.homeserver": { base_url: "https://example.org" } });
        const client = fakeClient();
        const stop = startUserBadges(client as never, "https://example.org");
        await settle();
        expect(getUserBadges(RIFF)).toEqual([]);
        expect(client.getStateEvent).not.toHaveBeenCalled();
        stop();
    });

    it("ignores answers that arrive after it was stopped", async () => {
        let answer: (response: Response) => void = () => {};
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
        const stop = startUserBadges(fakeClient() as never, "https://matrix.jorvik.app");
        stop();
        answer(new Response(JSON.stringify(WELL_KNOWN), { status: 200 }));
        await settle();
        expect(getBadgeSettings().roomId).toBeNull();
        expect(getUserBadges(RIFF)).toEqual([]);
    });
});

describe("saveUserBadges", () => {
    async function started(client: ReturnType<typeof fakeClient>): Promise<() => void> {
        serveWellKnown();
        const stop = startUserBadges(client as never, "https://matrix.jorvik.app");
        await settle();
        return stop;
    }

    it("writes the person's badges into the server's copy and shows them straight away", async () => {
        const client = fakeClient({ users: { [RIFF]: ["staff"], "@other:matrix.jorvik.app": ["tester"] } });
        const stop = await started(client);

        await saveUserBadges(client as never, RIFF, ["tester", "bug_finder"]);
        expect(client.joinRoom).not.toHaveBeenCalled();
        expect(client.sendStateEvent).toHaveBeenCalledWith(
            ROOM,
            "app.jorvik.badges",
            { users: { [RIFF]: ["bug_finder", "tester"], "@other:matrix.jorvik.app": ["tester"] } },
            "",
        );
        expect(getUserBadges(RIFF)).toEqual(["bug_finder", "tester"]);
        stop();
    });

    it("keeps badges a newer Jorvik knows about, and drops people left with none", async () => {
        const client = fakeClient({ users: { [RIFF]: ["staff", "translator"], [ADMIN]: ["staff"] } });
        const stop = await started(client);

        await saveUserBadges(client as never, RIFF, []);
        await saveUserBadges(client as never, ADMIN, []);
        expect(client.sendStateEvent.mock.calls[0][2]).toEqual({ users: { [RIFF]: ["translator"], [ADMIN]: ["staff"] } });
        expect((client.sendStateEvent.mock.calls[1][2] as { users: Record<string, unknown> }).users).not.toHaveProperty(ADMIN);
        stop();
    });

    it("joins the room first when the manager was only invited", async () => {
        const client = fakeClient(notFound(), "invite");
        const stop = await started(client);

        await saveUserBadges(client as never, RIFF, ["staff"]);
        expect(client.joinRoom).toHaveBeenCalledWith(ROOM);
        expect(client.sendStateEvent.mock.calls[0][2]).toEqual({ users: { [RIFF]: ["staff"] } });
        stop();
    });
});

describe("createBadgesRoom", () => {
    it("makes a locked, world-readable room that only the managers can change", async () => {
        const client = fakeClient();
        expect(await createBadgesRoom(client as never, [ADMIN, "@xuruh:matrix.jorvik.app"])).toBe(ROOM);

        const options = client.createRoom.mock.calls[0][0] as Record<string, any>;
        expect(options.invite).toEqual(["@xuruh:matrix.jorvik.app"]);
        expect(options.creation_content).toEqual({ type: "app.jorvik.badges", "m.federate": false });
        expect(options.initial_state).toContainEqual({
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "world_readable" },
        });
        expect(options.power_level_content_override).toMatchObject({
            users: { [ADMIN]: 100, "@xuruh:matrix.jorvik.app": 100 },
            users_default: 0,
            events_default: 100,
            state_default: 100,
        });
    });
});
