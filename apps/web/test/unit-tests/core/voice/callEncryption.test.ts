import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("livekit-client", () => {
    class BaseKeyProvider {
        public constructor(public readonly options: unknown) {}
        protected onSetEncryptionKey(): void {}
    }
    return {
        BaseKeyProvider,
        RoomEvent: { ParticipantConnected: "participantConnected", ParticipantDisconnected: "participantDisconnected" },
        createKeyMaterialFromBuffer: vi.fn(async () => ({}) as CryptoKey),
    };
});

import {
    CALL_KEY_EVENT_TYPE,
    CallKeyManager,
    parseCallIdentity,
    readCallKeyMessage,
    type CallKeyProvider,
} from "../../../../src/core/voice/callEncryption";

const ROOM = "!call:test.local";
const ALICE = "@alice:test.local::ALICEDEV::a1b2c3d4";
const BOB = "@bob:test.local::BOBDEV::b1b2b3b4";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function keyMessage(overrides: Record<string, unknown> = {}, encryptionInfo: unknown = { sender: "@bob:test.local", senderDevice: "BOBDEV", senderCurve25519KeyBase64: "x", senderVerified: false }) {
    return {
        message: {
            type: CALL_KEY_EVENT_TYPE,
            sender: "@bob:test.local",
            content: { room_id: ROOM, identity: BOB, index: 3, key: KEY, sent_ts: 1, ...overrides },
        },
        encryptionInfo,
    } as never;
}

describe("parseCallIdentity", () => {
    it("reads user and device from the relay's participant names", () => {
        expect(parseCallIdentity(ALICE)).toEqual({ userId: "@alice:test.local", deviceId: "ALICEDEV" });
    });

    it("refuses names without a device", () => {
        expect(parseCallIdentity("@alice:test.local::0b1e7a2c-1111-2222-3333-444455556666")).toBeNull();
        expect(parseCallIdentity("alice::DEV::x")).toBeNull();
    });
});

describe("readCallKeyMessage", () => {
    it("takes a key that came encrypted from the device its identity names", () => {
        const received = readCallKeyMessage(keyMessage(), ROOM);
        expect(received?.identity).toBe(BOB);
        expect(received?.index).toBe(3);
        expect(received?.key).toHaveLength(32);
    });

    it("ignores keys sent in clear, which the server could have written", () => {
        expect(readCallKeyMessage(keyMessage({}, null), ROOM)).toBeNull();
    });

    it("ignores a key whose sender or device doesn't match the identity it is for", () => {
        expect(readCallKeyMessage(keyMessage({ identity: ALICE }), ROOM)).toBeNull();
        expect(
            readCallKeyMessage(
                keyMessage({}, { sender: "@bob:test.local", senderDevice: "OTHERDEV", senderCurve25519KeyBase64: "x", senderVerified: false }),
                ROOM,
            ),
        ).toBeNull();
        expect(
            readCallKeyMessage(keyMessage({}, { sender: "@bob:test.local", senderCurve25519KeyBase64: "x", senderVerified: false }), ROOM),
        ).toBeNull();
    });

    it("ignores other rooms, bad indexes and bad keys", () => {
        expect(readCallKeyMessage(keyMessage({ room_id: "!other:test.local" }), ROOM)).toBeNull();
        expect(readCallKeyMessage(keyMessage({ index: 256 }), ROOM)).toBeNull();
        expect(readCallKeyMessage(keyMessage({ index: 1.5 }), ROOM)).toBeNull();
        expect(readCallKeyMessage(keyMessage({ key: btoa("short") }), ROOM)).toBeNull();
        expect(readCallKeyMessage(keyMessage({ key: "%%%" }), ROOM)).toBeNull();
    });
});

describe("CallKeyManager", () => {
    type Handler = (...args: unknown[]) => void;
    let clientHandlers: Map<string, Handler>;
    let roomHandlers: Map<string, Handler>;
    let sent: Array<{ targets: Array<{ userId: string; deviceId: string }>; content: { index: number; key: string; identity: string } }>;
    let setKey: ReturnType<typeof vi.fn>;
    let remote: Map<string, { identity: string }>;
    let manager: CallKeyManager;
    let received: string[];
    let prepareToEncrypt: ReturnType<typeof vi.fn>;
    const matrixRoom = { roomId: ROOM };

    beforeEach(() => {
        vi.useFakeTimers();
        clientHandlers = new Map();
        roomHandlers = new Map();
        sent = [];
        received = [];
        setKey = vi.fn(async () => undefined);
        prepareToEncrypt = vi.fn();
        remote = new Map([["bob", { identity: BOB }]]);
        const client = {
            on: (event: string, handler: Handler) => clientHandlers.set(event, handler),
            off: (event: string) => clientHandlers.delete(event),
            getRoom: (roomId: string) => (roomId === ROOM ? matrixRoom : null),
            getCrypto: () => ({ prepareToEncrypt }),
            encryptAndSendToDevice: vi.fn(async (_type: string, targets: never, content: never) => {
                sent.push({ targets, content });
            }),
        };
        const room = {
            localParticipant: { identity: ALICE },
            remoteParticipants: remote,
            on: (event: string, handler: Handler) => roomHandlers.set(event, handler),
            off: (event: string) => roomHandlers.delete(event),
        };
        manager = new CallKeyManager(client as never, ROOM, room as never, { setKey } as unknown as CallKeyProvider, {
            onKeyReceived: (identity) => received.push(identity),
        });
    });

    afterEach(() => {
        manager.stop();
        vi.useRealTimers();
    });

    it("uses its own key at once and sends it to everyone already in the call, then once more", async () => {
        remote.set("alice-other-tab", { identity: "@alice:test.local::ALICEDEV::ffff0000" });
        remote.set("old-client", { identity: "@carol:test.local::0b1e7a2c-1111-2222-3333-444455556666" });
        await manager.start();

        expect(setKey).toHaveBeenCalledWith(ALICE, 0, expect.any(Uint8Array));
        expect(sent).toHaveLength(1);
        // Not to its own device, and not to names without a device.
        expect(sent[0].targets).toEqual([{ userId: "@bob:test.local", deviceId: "BOBDEV" }]);
        expect(sent[0].content).toMatchObject({ identity: ALICE, index: 0 });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(sent).toHaveLength(2);
        expect(sent[1].content.key).toBe(sent[0].content.key);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(sent).toHaveLength(3);
    });

    it("has the room's members loaded and their devices fetched, so the keys reach them all", async () => {
        await manager.start();
        expect(prepareToEncrypt).toHaveBeenCalledWith(matrixRoom);

        roomHandlers.get("participantConnected")?.({ identity: "@carol:test.local::CAROLDEV::c1c2c3c4" });
        expect(prepareToEncrypt).toHaveBeenCalledTimes(2);
    });

    it("doesn't hold up the call while the keys go out", async () => {
        let finishSending: () => void = () => undefined;
        const slow = new Promise<void>((resolve) => {
            finishSending = resolve;
        });
        const client = {
            on: vi.fn(),
            off: vi.fn(),
            getRoom: () => matrixRoom,
            getCrypto: () => ({ prepareToEncrypt }),
            encryptAndSendToDevice: vi.fn(() => slow),
        };
        const room = { localParticipant: { identity: ALICE }, remoteParticipants: remote, on: vi.fn(), off: vi.fn() };
        const slowManager = new CallKeyManager(client as never, ROOM, room as never, { setKey } as unknown as CallKeyProvider);

        await slowManager.start(); // resolves although the send hasn't finished
        expect(client.encryptAndSendToDevice).toHaveBeenCalledTimes(1);
        finishSending();
        slowManager.stop();
    });

    it("sends the current key to someone who joins", async () => {
        await manager.start();
        sent = [];
        const carol = { identity: "@carol:test.local::CAROLDEV::c1c2c3c4" };
        roomHandlers.get("participantConnected")?.(carol);
        await vi.advanceTimersByTimeAsync(0);
        expect(sent.map((entry) => entry.targets)).toEqual([[{ userId: "@carol:test.local", deviceId: "CAROLDEV" }]]);
        expect(sent[0].content.index).toBe(0);
    });

    it("makes a new key when someone leaves, sends it to those still there, then switches to it", async () => {
        await manager.start();
        const firstKey = sent[0].content.key;
        sent = [];
        remote.delete("bob");
        remote.set("carol", { identity: "@carol:test.local::CAROLDEV::c1c2c3c4" });
        roomHandlers.get("participantDisconnected")?.({ identity: BOB });

        await vi.advanceTimersByTimeAsync(1_000);
        expect(sent).toHaveLength(1);
        expect(sent[0].targets).toEqual([{ userId: "@carol:test.local", deviceId: "CAROLDEV" }]);
        expect(sent[0].content.index).toBe(1);
        expect(sent[0].content.key).not.toBe(firstKey);
        expect(setKey).not.toHaveBeenCalledWith(ALICE, 1, expect.anything());

        await vi.advanceTimersByTimeAsync(2_000);
        expect(setKey).toHaveBeenCalledWith(ALICE, 1, expect.any(Uint8Array));
    });

    it("uses a key it is sent, for the participant it belongs to", async () => {
        await manager.start();
        clientHandlers.get("receivedToDeviceMessage")?.(keyMessage());
        await vi.advanceTimersByTimeAsync(0);
        expect(setKey).toHaveBeenCalledWith(BOB, 3, expect.any(Uint8Array));
        expect(received).toEqual([BOB]);

        clientHandlers.get("receivedToDeviceMessage")?.(keyMessage({}, null));
        await vi.advanceTimersByTimeAsync(0);
        expect(setKey).toHaveBeenCalledTimes(2); // its own key and Bob's, not the one sent in clear
    });

    it("sends nothing once stopped", async () => {
        await manager.start();
        manager.stop();
        sent = [];
        await vi.advanceTimersByTimeAsync(10_000);
        expect(sent).toHaveLength(0);
        expect(clientHandlers.size).toBe(0);
    });
});
