// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    ActivitySender,
    matrixActivityTransport,
    type ActivityTransport,
    type PlayingGame,
} from "../../../../src/core/activity/activitySender";
import {
    ACTIVITY_EVENT,
    ACTIVITY_HEARTBEAT_MS,
    ACTIVITY_LIFETIME_MS,
    type ActivityContent,
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

interface Sent {
    to: string[];
    game: string | null;
    expiresAt?: number;
}

function setup(delayMs = 0): { sender: ActivitySender; sent: Sent[] } {
    const sent: Sent[] = [];
    const transport: ActivityTransport = {
        send: async (userIds, content: ActivityContent) => {
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            sent.push({ to: [...userIds], game: content.game?.id ?? null, expiresAt: content.expires_at });
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
        sender.update(WOW, ["@bob:s", "@carol:s"]);
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
        sender.update(WOW, ["@bob:s", "@carol:s"]);
        sender.update(WOW, ["@carol:s", "@dave:s"]);
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
        sender.update(WOW, ["@bob:s"]);
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
        sender.update(WOW, ["@bob:s"]);
        sender.update(OSU, ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ game }) => game)).toEqual(["wow", "osu"]);
        sender.stop();
    });

    it("sends nothing while nobody is picked or nothing changed, and catches up when someone is picked", async () => {
        const { sender, sent } = setup();
        sender.update(WOW, []);
        await sender.flush();
        expect(sent).toEqual([]);

        sender.update(WOW, ["@bob:s"]);
        sender.update(WOW, ["@bob:s"]);
        await sender.flush();
        expect(sent.map(({ to, game }) => ({ to, game }))).toEqual([{ to: ["@bob:s"], game: "wow" }]);
        sender.stop();
    });

    it("sends in order, even when sending is slow", async () => {
        const { sender, sent } = setup(1_000);
        sender.update(WOW, ["@bob:s"]);
        sender.update(null, []);
        await vi.advanceTimersByTimeAsync(5_000);
        await sender.flush();
        expect(sent.map(({ game }) => game)).toEqual(["wow", null]);
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
