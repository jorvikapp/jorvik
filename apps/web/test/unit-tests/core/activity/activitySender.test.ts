// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ActivitySender,
    matrixActivityTransport,
    type ActivityTransport,
    MIN_CHANGE_INTERVAL_MS,
    type PlayingGame,
    type SharedNow,
} from "../../../../src/core/activity/activitySender";
import {
    ACTIVITY_EVENT,
    ACTIVITY_HEARTBEAT_MS,
    ACTIVITY_LIFETIME_MS,
    type ActivityContent,
    type ActivityIconFile,
} from "../../../../src/core/activity/activityWire";

vi.mock("@matrix-org/matrix-sdk-crypto-wasm", () => ({
    UserId: class {
        public constructor(private readonly id: string) {}
        public toString(): string {
            return this.id;
        }
    },
}));

const T0 = 1_792_850_000_000;
const WOW: PlayingGame = { id: "wow", name: "World of Warcraft", startedAt: T0 - 60_000 };
const OSU: PlayingGame = { id: "osu", name: "osu!", startedAt: T0 };
const g = (game: PlayingGame): SharedNow => ({ game, music: null });
const song = (title: string, cover?: ActivityIconFile): SharedNow => ({
    game: null,
    music: { player: { id: "spotify", name: "Spotify" }, title, artist: "Artist", ...(cover ? { cover } : {}) },
});
const ICON: ActivityIconFile = {
    url: "mxc://s/osu",
    key: { kty: "oct", alg: "A256CTR", k: "a".repeat(43), key_ops: ["encrypt", "decrypt"], ext: true },
    iv: "b".repeat(22),
    hashes: { sha256: "c".repeat(43) },
    v: "v2",
};

interface Sent {
    to: string[];
    game: string | null;
    expiresAt?: number;
    icon?: string;
    music?: string;
}

function setup(delayMs = 0): { sender: ActivitySender; sent: Sent[] } {
    const sent: Sent[] = [];
    const transport: ActivityTransport = {
        send: async (userIds, content: ActivityContent) => {
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            sent.push({
                to: [...userIds],
                game: content.game?.id ?? null,
                expiresAt: content.expires_at,
                ...(content.game?.icon ? { icon: content.game.icon.url } : {}),
                ...(content.music ? { music: content.music.title } : {}),
            });
        },
    };
    return { sender: new ActivitySender(transport, "DEV"), sent };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("ActivitySender", () => {
    it("tells everyone picked when a game starts, then again every few minutes while it runs", async () => {
        const { sender, sent } = setup();
        sender.update(g(WOW), ["@bob:s", "@carol:s"]);
        await sender.flush();
        expect(sent).toEqual([{ to: ["@bob:s", "@carol:s"], game: "wow", expiresAt: T0 + ACTIVITY_LIFETIME_MS }]);

        await vi.advanceTimersByTimeAsync(ACTIVITY_HEARTBEAT_MS);
        await sender.flush();
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual({
            to: ["@bob:s", "@carol:s"],
            game: "wow",
            expiresAt: T0 + ACTIVITY_HEARTBEAT_MS + ACTIVITY_LIFETIME_MS,
        });
        sender.stop();
    });

    it("tells people who drop out that it stopped, and newcomers what's running", async () => {
        const { sender, sent } = setup();
        sender.update(g(WOW), ["@bob:s", "@carol:s"]);
        sender.update(g(WOW), ["@carol:s", "@dave:s"]);
        await sender.flush();
        expect(sent.map(({ to, game }) => ({ to, game }))).toEqual([
            { to: ["@bob:s", "@carol:s"], game: "wow" },
            { to: ["@bob:s"], game: null },
            { to: ["@dave:s"], game: "wow" },
        ]);
        sender.stop();
    });

    it("tells everyone it stopped when the game ends, and stops repeating it", async () => {
        const { sender, sent } = setup();
        sender.update(g(WOW), ["@bob:s"]);
        sender.update(null, ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ to, game }) => ({ to, game }))).toEqual([
            { to: ["@bob:s"], game: "wow" },
            { to: ["@bob:s"], game: null },
        ]);

        await vi.advanceTimersByTimeAsync(3 * ACTIVITY_HEARTBEAT_MS);
        expect(sent).toHaveLength(2);
    });

    it("tells everyone about a different game", async () => {
        const { sender, sent } = setup();
        sender.update(g(WOW), ["@bob:s"]);
        sender.update(g(OSU), ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ game }) => game)).toEqual(["wow", "osu"]);
        sender.stop();
    });

    it("tells everyone again once the game's icon is ready, and keeps sending it", async () => {
        const { sender, sent } = setup();
        sender.update(g(OSU), ["@bob:s", "@carol:s"]);
        sender.update(g({ ...OSU, icon: ICON }), ["@bob:s", "@carol:s"]);
        sender.update(g({ ...OSU, icon: ICON }), ["@bob:s", "@carol:s"]);
        await sender.flush();
        expect(sent.map(({ to, game, icon }) => ({ to, game, icon }))).toEqual([
            { to: ["@bob:s", "@carol:s"], game: "osu", icon: undefined },
            { to: ["@bob:s", "@carol:s"], game: "osu", icon: "mxc://s/osu" },
        ]);

        await vi.advanceTimersByTimeAsync(ACTIVITY_HEARTBEAT_MS);
        await sender.flush();
        expect(sent[2]?.icon).toBe("mxc://s/osu");
        sender.stop();
    });

    it("sends nothing while nobody is picked or nothing changed, and catches up when someone is picked", async () => {
        const { sender, sent } = setup();
        sender.update(g(WOW), []);
        await sender.flush();
        expect(sent).toEqual([]);

        sender.update(g(WOW), ["@bob:s"]);
        sender.update(g(WOW), ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ to, game }) => ({ to, game }))).toEqual([{ to: ["@bob:s"], game: "wow" }]);
        sender.stop();
    });

    it("sends in order, even when sending is slow", async () => {
        const { sender, sent } = setup(1_000);
        sender.update(g(WOW), ["@bob:s"]);
        sender.update(null, []);
        await vi.advanceTimersByTimeAsync(5_000);
        await sender.flush();
        expect(sent.map(({ game }) => game)).toEqual(["wow", null]);
    });
});

describe("ActivitySender with music", () => {
    it("tells everyone what's playing at once, then each new track no more often than every 15 seconds", async () => {
        const { sender, sent } = setup();
        sender.update(song("One"), ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ game, music }) => ({ game, music }))).toEqual([{ game: null, music: "One" }]);

        // Skipping through three tracks quickly sends only the last, once the 15 seconds are up.
        await vi.advanceTimersByTimeAsync(2_000);
        sender.update(song("Two"), ["@bob:s"]);
        sender.update(song("Three"), ["@bob:s"]);
        sender.update(song("Four"), ["@bob:s"]);
        await sender.flush();
        expect(sent).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(MIN_CHANGE_INTERVAL_MS);
        await sender.flush();
        expect(sent.map(({ music }) => music)).toEqual(["One", "Four"]);

        // A track change long after the last goes out at once.
        await vi.advanceTimersByTimeAsync(60_000);
        sender.update(song("Five"), ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ music }) => music)).toEqual(["One", "Four", "Five"]);
        sender.stop();
    });

    it("drops a queued track change when the music stops, and says it stopped at once", async () => {
        const { sender, sent } = setup();
        sender.update(song("One"), ["@bob:s"]);
        sender.update(song("Two"), ["@bob:s"]);
        sender.update(null, []);
        await vi.advanceTimersByTimeAsync(MIN_CHANGE_INTERVAL_MS * 2);
        await sender.flush();
        expect(sent.map(({ to, music }) => ({ to, music }))).toEqual([
            { to: ["@bob:s"], music: "One" },
            { to: ["@bob:s"], music: undefined },
        ]);
    });

    it("sends a game and music together, and a newcomer hears what the others were told", async () => {
        const { sender, sent } = setup();
        sender.update({ game: WOW, music: song("One").music }, ["@bob:s"]);
        sender.update({ game: WOW, music: song("Two").music }, ["@bob:s", "@carol:s"]);
        await sender.flush();
        expect(sent.map(({ to, game, music }) => ({ to, game, music }))).toEqual([
            { to: ["@bob:s"], game: "wow", music: "One" },
            { to: ["@carol:s"], game: "wow", music: "One" },
        ]);
        await vi.advanceTimersByTimeAsync(MIN_CHANGE_INTERVAL_MS);
        await sender.flush();
        expect(sent[2]).toMatchObject({ to: ["@bob:s", "@carol:s"], game: "wow", music: "Two" });
        sender.stop();
    });
});

describe("matrixActivityTransport", () => {
    function fakeClient(withInternals = true) {
        const steps: string[] = [];
        const crypto = {
            ...(withInternals
                ? {
                      olmMachine: {
                          updateTrackedUsers: vi.fn(async (users: unknown[]) => {
                              steps.push(`track ${users.map(String).join(",")}`);
                          }),
                      },
                      outgoingRequestsManager: {
                          doProcessOutgoingRequests: vi.fn(async () => {
                              steps.push("fetch devices");
                          }),
                      },
                  }
                : {}),
            getUserDeviceInfo: vi.fn(async () => {
                steps.push("devices");
                return new Map([
                    [
                        "@bob:s",
                        new Map([
                            ["PC", { deviceId: "PC", dehydrated: false }],
                            ["SPARE", { deviceId: "SPARE", dehydrated: true }],
                        ]),
                    ],
                ]);
            }),
            encryptToDeviceMessages: vi.fn(async (_type: string, devices: { userId: string; deviceId: string }[]) => ({
                eventType: "m.room.encrypted",
                batch: devices.map((device) => ({ ...device, payload: { ciphertext: "..." } })),
            })),
        };
        const client = { getCrypto: () => crypto, queueToDevice: vi.fn(async () => undefined) };
        return { client, crypto, steps };
    }

    it("tracks the people, fetches their devices, and encrypts for each real device", async () => {
        const { client, crypto, steps } = fakeClient();
        const content: ActivityContent = { device_id: "DEV", game: null };
        await matrixActivityTransport(client as never).send(["@bob:s"], content);

        expect(steps).toEqual(["track @bob:s", "fetch devices", "devices"]);
        expect(crypto.encryptToDeviceMessages).toHaveBeenCalledWith(ACTIVITY_EVENT, [{ userId: "@bob:s", deviceId: "PC" }], content);
        expect(client.queueToDevice).toHaveBeenCalledWith({
            eventType: "m.room.encrypted",
            batch: [{ userId: "@bob:s", deviceId: "PC", payload: { ciphertext: "..." } }],
        });
    });

    it("still reaches the people already tracked if it can't ask for more", async () => {
        const { client, steps } = fakeClient(false);
        await matrixActivityTransport(client as never).send(["@bob:s"], { device_id: "DEV", game: null });
        expect(steps).toEqual(["devices"]);
        expect(client.queueToDevice).toHaveBeenCalled();
    });
});
