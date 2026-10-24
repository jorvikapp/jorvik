// @vitest-environment node
import { EventEmitter } from "events";
import { ClientEvent } from "matrix-js-sdk/src/matrix";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    ACTIVITY_RATE_LIMIT_MS,
    clearActivity,
    getUserActivity,
    pruneActivity,
    receiveActivity,
    setOwnActivity,
    startActivityReceiver,
    subscribeActivity,
} from "../../../../src/core/activity/activityStore";
import { ACTIVITY_EVENT, type ActivityGame } from "../../../../src/core/activity/activityWire";

const NOW = 1_792_850_000_000;
const WOW: ActivityGame = { id: "wow", name: "World of Warcraft" };
const DOTA: ActivityGame = { id: "steam-570", name: "Dota 2" };

function playing(game: ActivityGame = WOW, expiresAt = NOW + 600_000) {
    return { game, startedAt: NOW - 60_000, expiresAt };
}

afterEach(() => {
    clearActivity();
});

describe("activity store", () => {
    it("shows the latest of someone's devices, until it expires or that device says it stopped", () => {
        receiveActivity("@bob:s", "PC", playing(WOW), NOW);
        receiveActivity("@bob:s", "LAPTOP", playing(DOTA), NOW + 1_000);
        expect(getUserActivity("@bob:s")?.game).toEqual(DOTA);

        receiveActivity("@bob:s", "LAPTOP", { game: null }, NOW + 2_000);
        expect(getUserActivity("@bob:s")?.game).toEqual(WOW);

        pruneActivity(NOW + 600_000);
        expect(getUserActivity("@bob:s")).toBeNull();
    });

    it("ignores a device repeating the same game too soon, but not a new game", () => {
        expect(receiveActivity("@bob:s", "PC", playing(WOW), NOW)).toBe(true);
        expect(receiveActivity("@bob:s", "PC", playing(WOW, NOW + 700_000), NOW + 5_000)).toBe(false);
        expect(getUserActivity("@bob:s")?.expiresAt).toBe(NOW + 600_000);

        expect(receiveActivity("@bob:s", "PC", playing(DOTA), NOW + 6_000)).toBe(true);
        expect(receiveActivity("@bob:s", "PC", playing(DOTA, NOW + 900_000), NOW + 6_000 + ACTIVITY_RATE_LIMIT_MS)).toBe(true);
        expect(getUserActivity("@bob:s")?.expiresAt).toBe(NOW + 900_000);
    });

    it("lets no device through more than a handful of times a minute", () => {
        const accepted = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, index) =>
            receiveActivity("@spam:s", "PC", playing({ id, name: id }), NOW + index * 1_000),
        );
        expect(accepted.filter(Boolean)).toHaveLength(6);
    });

    it("tells subscribers only when what shows changes", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeActivity(listener);
        receiveActivity("@bob:s", "PC", playing(), NOW);
        receiveActivity("@bob:s", "PC", { game: null }, NOW + 1);
        receiveActivity("@bob:s", "PC", { game: null }, NOW + 2);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
    });

    it("holds the user's own shared game, for their own profile", () => {
        setOwnActivity("@me:s", { game: WOW, startedAt: NOW });
        expect(getUserActivity("@me:s")?.game).toEqual(WOW);
        setOwnActivity("@me:s", null);
        expect(getUserActivity("@me:s")).toBeNull();
    });
});

describe("activity receiver", () => {
    function fakeClient({ sharedWith = ["@bob:s"], blocked = [] as string[] } = {}) {
        const emitter = new EventEmitter();
        const room = {
            roomId: "!dm:s",
            currentState: { getStateEvents: () => [] },
            getMyMembership: () => "join",
            getMember: (userId: string) => (sharedWith.includes(userId) ? { membership: "join" } : null),
            isSpaceRoom: () => false,
            getJoinedMemberCount: () => 2,
            loadMembersIfNeeded: vi.fn(async () => true),
        };
        return Object.assign(emitter, {
            getUserId: () => "@me:s",
            getRooms: () => [room],
            getRoom: () => room,
            getAccountData: () => undefined,
            isUserIgnored: (userId: string) => blocked.includes(userId),
            removeListener: emitter.removeListener.bind(emitter),
        });
    }

    function deliver(client: EventEmitter, sender: string, encryptedBy: string | null, content: unknown): void {
        client.emit(ClientEvent.ReceivedToDeviceMessage, {
            message: { type: ACTIVITY_EVENT, sender, content },
            encryptionInfo: encryptedBy
                ? { sender: encryptedBy, senderDevice: "PC", senderCurve25519KeyBase64: "key", senderVerified: false }
                : null,
        });
    }

    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const content = () => ({ game: WOW, started_at: Date.now() - 1_000, expires_at: Date.now() + 60_000 });

    it("takes encrypted messages from people we share a room with, and forgets them when stopped", async () => {
        const client = fakeClient();
        const stop = startActivityReceiver(client as never);
        deliver(client, "@bob:s", "@bob:s", content());
        await settle();
        expect(getUserActivity("@bob:s")?.game).toEqual(WOW);

        stop();
        expect(getUserActivity("@bob:s")).toBeNull();
    });

    it("ignores messages sent in the clear, from strangers, from blocked people, or encrypted by someone else", async () => {
        const client = fakeClient({ sharedWith: ["@bob:s", "@troll:s"], blocked: ["@troll:s"] });
        const stop = startActivityReceiver(client as never);
        deliver(client, "@bob:s", null, content());
        deliver(client, "@stranger:s", "@stranger:s", content());
        deliver(client, "@troll:s", "@troll:s", content());
        deliver(client, "@bob:s", "@mallory:s", content());
        await settle();

        expect(getUserActivity("@bob:s")).toBeNull();
        expect(getUserActivity("@stranger:s")).toBeNull();
        expect(getUserActivity("@troll:s")).toBeNull();
        stop();
    });

    it("keeps a stop from overtaking the start before it", async () => {
        const client = fakeClient();
        const stop = startActivityReceiver(client as never);
        deliver(client, "@bob:s", "@bob:s", content());
        deliver(client, "@bob:s", "@bob:s", { game: null });
        await settle();
        await settle();
        expect(getUserActivity("@bob:s")).toBeNull();
        stop();
    });
});
